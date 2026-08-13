import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `referral` — one shareable code per learner, one redemption per new
 * account. The anti-abuse posture is the point: self-redemption and old
 * accounts are refused here, double redemption is refused by the table's
 * unique constraint, and the actual rewards live Stripe-side, gated on the
 * referred account CONVERTING (check-subscription) — so none of the paths in
 * this function can mint value on their own.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const REFERRER = "99999999-8888-4777-8666-555555555555";

function backend(options: {
  accountAgeDays?: number;
  myCode?: { code: string } | null;
  codeOwner?: { user_id: string } | null;
  redemptionInsert?: UpstreamHandler;
} = {}): Record<string, UpstreamHandler> {
  const {
    accountAgeDays = 1,
    myCode = null,
    codeOwner = { user_id: REFERRER },
    redemptionInsert = () => json({}, 201),
  } = options;
  const createdAt = new Date(Date.now() - accountAgeDays * 86_400_000).toISOString();

  return {
    "/auth/v1/user": () =>
      json({ id: USER, aud: "authenticated", role: "authenticated", created_at: createdAt }),
    "/rest/v1/referral_codes": (request) =>
      request.method === "GET"
        ? json(new URL(request.url).searchParams.get("code") ? codeOwner : myCode)
        : json({}, 201),
    "/rest/v1/referral_redemptions": (request) =>
      request.method === "GET" ? json([]) : redemptionInsert(request),
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, jwt?: string | null) {
  const fn = await loadFunction("referral", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("referral", body, jwt === undefined ? {} : { jwt }),
    );
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

Deno.test("referral get mints a code once and returns it with the tallies", async () => {
  const { status, body, bodies, calls } = await call({ action: "get" }, backend());

  assertEquals(status, 200);
  const code = String(body.code);
  // Readable-aloud alphabet: no 0/O/1/I to misread from a phone screen.
  assert(/^[A-HJ-KM-NP-Z2-9]{8}$/.test(code), `unexpected code shape: ${code}`);
  const insert = calls.findIndex((url, i) => url.includes("referral_codes") && (bodies[i] ?? "").length > 0);
  assert(insert >= 0, "expected the code to be inserted");
  assertEquals(body.referrals, { pending: 0, converted: 0, rewarded: 0 });
  assertEquals(body.redeemed, false);
});

Deno.test("referral get returns the existing code without minting another", async () => {
  const { body, calls, bodies } = await call(
    { action: "get" },
    backend({ myCode: { code: "GVQX7RPM" } }),
  );

  assertEquals(body.code, "GVQX7RPM");
  const inserts = calls.filter((url, i) => url.includes("referral_codes") && (bodies[i] ?? "").length > 0);
  assertEquals(inserts.length, 0);
});

Deno.test("referral redeem records the pairing", async () => {
  const { status, body, bodies, calls } = await call(
    { action: "redeem", code: "gvqx7rpm" },
    backend(),
  );

  assertEquals(status, 200);
  assertEquals(body.ok, true);
  const insert = calls.findIndex((url, i) => url.includes("referral_redemptions") && (bodies[i] ?? "").length > 0);
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.referrer_id, REFERRER);
  assertEquals(row.referred_user_id, USER);
});

Deno.test("referral redeem refuses your own code", async () => {
  const { status, body } = await call(
    { action: "redeem", code: "GVQX7RPM" },
    backend({ codeOwner: { user_id: USER } }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "own_code");
});

Deno.test("referral redeem refuses an account past its first month", async () => {
  // An old account "redeeming" a friend's code is reward farming, not a
  // referral — the person was already here.
  const { status, body } = await call(
    { action: "redeem", code: "GVQX7RPM" },
    backend({ accountAgeDays: 45 }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "new_accounts_only");
});

Deno.test("referral redeem reports a second attempt as already redeemed", async () => {
  const { status, body } = await call(
    { action: "redeem", code: "GVQX7RPM" },
    backend({
      redemptionInsert: () =>
        json({ message: 'duplicate key value violates unique constraint "referral_redemptions_referred_user_id_key"' }, 409),
    }),
  );

  // The table's unique constraint is the backstop; the function translates it.
  assertEquals(status, 409);
  assertEquals(body.error, "already_redeemed");
});

Deno.test("referral redeem answers cleanly for an unknown code", async () => {
  const { status, body } = await call(
    { action: "redeem", code: "NOPENOPE" },
    backend({ codeOwner: null }),
  );

  assertEquals(status, 404);
  assertEquals(body.error, "unknown_code");
});

Deno.test("referral turns anonymous callers away", async () => {
  const { status } = await call(
    { action: "get" },
    { "/auth/v1/user": () => json({}, 401) },
    null,
  );

  assertEquals(status, 401);
});
