import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `native-feedback` — the paid lane into the reviewers' queue. What carries
 * the money: a submission spends exactly one credit and lands in
 * dialect_native_reviews carrying the request id the settle trigger needs; a
 * purchase is granted exactly once per Stripe session; and every refusal
 * (no credits, bad length) happens before anything is written.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const TEXT = "الليله بنروح السوق وبعدين ناكل عشا مع الشباب ان شاء الله";

function backend(options: {
  ledger?: Array<{ delta: number }>;
  session?: Record<string, unknown>;
} = {}): Record<string, UpstreamHandler> {
  const { ledger = [{ delta: 5 }], session } = options;
  return {
    "/auth/v1/user": () =>
      json({ id: USER, email: "learner@example.com", aud: "authenticated", role: "authenticated" }),
    "/rest/v1/native_feedback_credits": (request) =>
      request.method === "GET" ? json(ledger) : json({}, 201),
    "/rest/v1/native_feedback_requests": (request) =>
      request.method === "GET"
        ? json([])
        : json({ id: "22222222-3333-4444-8555-666666666666" }, 201),
    "/rest/v1/dialect_native_reviews": () => json({}, 201),
    "api.stripe.com": (request) => {
      const url = new URL(request.url);
      if (url.pathname.includes("checkout/sessions") && request.method === "POST") {
        return json({ id: "cs_pack", url: "https://checkout.stripe.test/cs_pack" });
      }
      return json(
        session ?? {
          id: "cs_pack",
          payment_status: "paid",
          metadata: { user_id: USER, credits: "5" },
        },
      );
    },
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, env: Record<string, string | undefined> = {}) {
  const fn = await loadFunction("native-feedback", {
    upstreams,
    env: { STRIPE_FEEDBACK_PACK_PRICE: "price_pack", STRIPE_SECRET_KEY: "sk_fixture", ...env },
  });
  try {
    const response = await fn.handler(jsonRequest("native-feedback", body));
    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("native-feedback reports balance, requests and purchasability", async () => {
  const { status, body } = await call({ action: "status" }, backend({ ledger: [{ delta: 5 }, { delta: -1 }] }));

  assertEquals(status, 200);
  assertEquals(body.balance, 4);
  assertEquals(body.purchase_enabled, true);
});

Deno.test("native-feedback goes dark on purchases without the price configured", async () => {
  const { body } = await call({ action: "status" }, backend(), { STRIPE_FEEDBACK_PACK_PRICE: undefined });
  assertEquals(body.purchase_enabled, false);

  const purchase = await call({ action: "purchase" }, backend(), { STRIPE_FEEDBACK_PACK_PRICE: undefined });
  assertEquals(purchase.status, 400);
});

Deno.test("native-feedback submit spends one credit and queues for review", async () => {
  const { status, body, calls, bodies } = await call(
    { action: "submit", dialect: "Gulf", text: TEXT },
    backend(),
  );

  assertEquals(status, 200);
  assertEquals(body.balance, 4);

  const spend = calls.findIndex(
    (url, i) => url.includes("native_feedback_credits") && (bodies[i] ?? "").includes('"delta":-1'),
  );
  assert(spend >= 0, "expected a -1 ledger row");

  // The review row carries the linkage the settle trigger keys on.
  const review = calls.findIndex((url) => url.includes("dialect_native_reviews"));
  assert(review >= 0, "expected a review-queue row");
  assertStringIncludes(bodies[review] ?? "", '"feedback_request_id":"22222222-3333-4444-8555-666666666666"');
  assertStringIncludes(bodies[review] ?? "", '"content_type":"paid_feedback"');
});

Deno.test("native-feedback submit refuses an empty balance before writing anything", async () => {
  const { status, body, calls, bodies } = await call(
    { action: "submit", dialect: "Gulf", text: TEXT },
    backend({ ledger: [] }),
  );

  assertEquals(status, 402);
  assertEquals(body.error, "no_credits");
  const writes = calls.filter((_, i) => (bodies[i] ?? "").length > 0);
  assertEquals(writes.length, 0);
});

Deno.test("native-feedback submit bounds the text", async () => {
  const short = await call({ action: "submit", dialect: "Gulf", text: "قصير" }, backend());
  assertEquals(short.status, 400);

  const long = await call({ action: "submit", dialect: "Gulf", text: "ا".repeat(2001) }, backend());
  assertEquals(long.status, 400);
});

Deno.test("native-feedback confirm grants the paid session's credits", async () => {
  const { status, calls, bodies } = await call({ action: "confirm", sessionId: "cs_pack" }, backend());

  assertEquals(status, 200);
  const grant = calls.findIndex(
    (url, i) => url.includes("native_feedback_credits") && (bodies[i] ?? "").includes('"delta":5'),
  );
  assert(grant >= 0, "expected a +5 grant row");
  assertStringIncludes(bodies[grant] ?? "", '"stripe_session_id":"cs_pack"');
});

Deno.test("native-feedback confirm refuses an unpaid or foreign session", async () => {
  const unpaid = await call(
    { action: "confirm", sessionId: "cs_pack" },
    backend({ session: { id: "cs_pack", payment_status: "unpaid", metadata: { user_id: USER } } }),
  );
  assertEquals(unpaid.status, 400);

  const foreign = await call(
    { action: "confirm", sessionId: "cs_pack" },
    backend({
      session: { id: "cs_pack", payment_status: "paid", metadata: { user_id: "someone-else" } },
    }),
  );
  // A session paid by another account must never credit this one.
  assertEquals(foreign.status, 400);
});

Deno.test("native-feedback turns anonymous callers away", async () => {
  const fn = await loadFunction("native-feedback", {
    upstreams: { "/auth/v1/user": () => json({}, 401) },
  });
  try {
    const response = await fn.handler(jsonRequest("native-feedback", { action: "status" }, { jwt: null }));
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});
