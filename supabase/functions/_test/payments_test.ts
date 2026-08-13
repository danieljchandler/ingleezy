import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * The three functions that touch money.
 *
 * Nothing about them was tested. They take an authenticated caller, look them
 * up in Stripe by email, and hand back a URL the browser opens — so the failure
 * modes that matter are charging the wrong plan, creating a session for the
 * wrong person, or duplicating a customer for someone who already pays.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** Supabase auth and Stripe, with the parts each test cares about. */
function upstreams(options: {
  email?: string | null;
  existingCustomer?: string | null;
  stripeFails?: boolean;
} = {}) {
  const { email = "learner@example.com", existingCustomer = null, stripeFails = false } = options;

  return {
    "/auth/v1/user": () =>
      email === null
        ? json({ message: "invalid claim" }, 401)
        : json({ id: USER, email, aud: "authenticated", role: "authenticated" }),

    "api.stripe.com": (request: Request) => {
      if (stripeFails) return json({ error: { message: "card_declined" } }, 402);

      const url = new URL(request.url);

      if (url.pathname.includes("/customers")) {
        return json({
          data: existingCustomer ? [{ id: existingCustomer, email }] : [],
        });
      }
      if (url.pathname.includes("checkout/sessions")) {
        return json({ id: "cs_fixture", url: "https://checkout.stripe.test/cs_fixture" });
      }
      if (url.pathname.includes("billing_portal")) {
        return json({ id: "bps_fixture", url: "https://billing.stripe.test/bps_fixture" });
      }
      if (url.pathname.includes("/subscriptions")) {
        return json({ data: [] });
      }
      return json({ data: [] });
    },
  };
}

/** The body Stripe was actually sent, decoded from its form encoding. */
function stripeForm(body: string | null): URLSearchParams {
  return new URLSearchParams(body ?? "");
}

Deno.test("create-checkout returns a session URL for a valid tier", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    const response = await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    assertEquals(response.status, 200);
    assertEquals((await response.json()).url, "https://checkout.stripe.test/cs_fixture");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout charges the price for the tier that was asked for", async () => {
  // The two price ids are hardcoded in the function and duplicated in
  // src/hooks/useSubscription.ts. Sending the wrong one bills the wrong amount.
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "allin" }));

    const session = fn.callsTo("checkout/sessions").at(-1);
    const form = stripeForm(session?.body ?? null);

    assertEquals(form.get("line_items[0][price]"), "price_1T8t9QHVAO3F9uuDvaRVzEg4");
    assertEquals(form.get("line_items[0][quantity]"), "1");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout always opens a subscription, never a one-off payment", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("mode"), "subscription");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout reuses an existing Stripe customer", async () => {
  // Otherwise a returning subscriber gets a second customer record and their
  // billing history splits in two.
  const fn = await loadFunction("create-checkout", {
    upstreams: upstreams({ existingCustomer: "cus_existing" }),
  });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("customer"), "cus_existing");
    // And does not also pass an email, which Stripe rejects alongside customer.
    assertEquals(form.get("customer_email"), null);
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout passes the email when there is no customer yet", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("customer_email"), "learner@example.com");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout looks the customer up by the caller's own email", async () => {
  // The lookup is what ties the session to a person. Searching for anything
  // other than the authenticated user's email would let one account start a
  // checkout attached to another's customer record.
  const fn = await loadFunction("create-checkout", {
    upstreams: upstreams({ email: "someone@example.com" }),
  });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const lookup = fn.callsTo("/customers").at(-1);
    assertStringIncludes(decodeURIComponent(lookup?.url ?? ""), "someone@example.com");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout rejects a tier that is not on offer", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    for (const tier of ["free", "enterprise", "", null, 1]) {
      const response = await fn.handler(jsonRequest("create-checkout", { tier }));
      assertEquals(response.status, 500, `tier ${JSON.stringify(tier)} was accepted`);
      assertStringIncludes((await response.json()).error, "Invalid tier");
    }

    // And never reached Stripe.
    assertEquals(fn.callsTo("checkout/sessions").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout refuses a caller the auth server does not recognise", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams({ email: null }) });
  try {
    const response = await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    assertEquals(response.status, 500);
    assertStringIncludes((await response.json()).error, "not authenticated");
    assertEquals(fn.callsTo("checkout/sessions").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout returns the origin the request came from", async () => {
  // success_url and cancel_url send the browser back to wherever it started;
  // a hardcoded origin would bounce a Lovable preview user to production.
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    await fn.handler(
      jsonRequest("create-checkout", { tier: "standard" }, { origin: "https://ingleezy.app" }),
    );

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertStringIncludes(form.get("success_url") ?? "", "https://ingleezy.app");
    assertStringIncludes(form.get("cancel_url") ?? "", "https://ingleezy.app");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout surfaces a Stripe failure rather than a broken URL", async () => {
  const fn = await loadFunction("create-checkout", { upstreams: upstreams({ stripeFails: true }) });
  try {
    const response = await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    assertEquals(response.status, 500);
    // The client throws on this, so the learner sees an error instead of a
    // new tab opening on nothing.
    assertEquals(typeof (await response.json()).error, "string");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout keeps its CORS headers on the error path", async () => {
  // An error response without them is unreadable to the browser, so the client
  // reports a network failure instead of the reason.
  const fn = await loadFunction("create-checkout", { upstreams: upstreams({ email: null }) });
  try {
    const response = await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    assertEquals(response.headers.get("access-control-allow-origin"), "https://ingleezy.app");
  } finally {
    fn.restore();
  }
});

Deno.test("customer-portal returns a management URL", async () => {
  const fn = await loadFunction("customer-portal", {
    upstreams: upstreams({ existingCustomer: "cus_existing" }),
  });
  try {
    const response = await fn.handler(jsonRequest("customer-portal", {}));

    assertEquals(response.status, 200);
    assertEquals((await response.json()).url, "https://billing.stripe.test/bps_fixture");
  } finally {
    fn.restore();
  }
});

Deno.test("customer-portal refuses an unauthenticated caller", async () => {
  const fn = await loadFunction("customer-portal", { upstreams: upstreams({ email: null }) });
  try {
    const response = await fn.handler(
      jsonRequest("customer-portal", {}, { jwt: null }),
    );

    assertEquals(response.status >= 400, true);
    assertEquals(fn.callsTo("billing_portal").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("check-subscription reports no plan when Stripe has no customer", async () => {
  const fn = await loadFunction("check-subscription", { upstreams: upstreams() });
  try {
    const response = await fn.handler(jsonRequest("check-subscription", {}));

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.subscribed, false);
    // `tier`, which is the field useSubscription reads.
    assertEquals(body.tier, null);
  } finally {
    fn.restore();
  }
});

Deno.test("check-subscription authenticates with the caller's own token", async () => {
  const fn = await loadFunction("check-subscription", { upstreams: upstreams() });
  try {
    const token = fixtureJwt(USER);
    await fn.handler(jsonRequest("check-subscription", {}, { jwt: token }));

    const lookup = fn.callsTo("/auth/v1/user").at(-1);
    assertStringIncludes(lookup?.headers.authorization ?? "", token);
  } finally {
    fn.restore();
  }
});

// ── Annual billing ──────────────────────────────────────────────────────────
// Annual prices are env-configured (STRIPE_ANNUAL_PRICE_*) rather than
// hardcoded: they don't exist in Stripe yet, and the function must refuse
// clearly rather than silently fall back to monthly billing.

Deno.test("create-checkout charges the annual price when configured and asked", async () => {
  const fn = await loadFunction("create-checkout", {
    upstreams: upstreams(),
    env: { STRIPE_ANNUAL_PRICE_STANDARD: "price_annual_std_fixture" },
  });
  try {
    const response = await fn.handler(
      jsonRequest("create-checkout", { tier: "standard", cadence: "annual" }),
    );

    assertEquals(response.status, 200);
    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("line_items[0][price]"), "price_annual_std_fixture");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout refuses annual when no annual price is configured", async () => {
  const fn = await loadFunction("create-checkout", {
    upstreams: upstreams(),
    env: { STRIPE_ANNUAL_PRICE_STANDARD: undefined },
  });
  try {
    const response = await fn.handler(
      jsonRequest("create-checkout", { tier: "standard", cadence: "annual" }),
    );

    // A clear refusal, not a silent fall-back to monthly — the learner clicked
    // a price and must never be billed a different one.
    assertEquals(response.status, 500);
    assert(!fn.callsTo("checkout/sessions").length);
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout still bills monthly when no cadence is sent", async () => {
  // Every deployed client predates the cadence field.
  const fn = await loadFunction("create-checkout", { upstreams: upstreams() });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("line_items[0][price]"), "price_1T8t8sHVAO3F9uuDOpwSh2zQ");
  } finally {
    fn.restore();
  }
});

Deno.test("check-subscription writes what Stripe said into subscribers", async () => {
  // usageCap reads this table on every AI request; without the write-back the
  // per-tier allowances run on stale data.
  const fn = await loadFunction("check-subscription", {
    upstreams: upstreams({ existingCustomer: "cus_fixture" }),
  });
  try {
    await fn.handler(jsonRequest("check-subscription", {}));

    const upsert = fn.callsTo("/rest/v1/subscribers").at(-1);
    assert(upsert, "expected an upsert into subscribers");
    assertStringIncludes(upsert.body ?? "", '"subscribed"');
    assertStringIncludes(upsert.body ?? "", '"subscription_tier"');
  } finally {
    fn.restore();
  }
});

// ── Referral rewards (D4) ───────────────────────────────────────────────────
// Both rewards are Stripe-side. The referred learner's month off is a coupon
// auto-applied at first checkout while their redemption is still pending; the
// referrer's $5 balance credit is granted by check-subscription only when the
// referral actually converts to a paid plan — fabricated signups earn nothing.

Deno.test("create-checkout applies the referral coupon to a pending referred learner", async () => {
  const fn = await loadFunction("create-checkout", {
    upstreams: {
      ...upstreams(),
      "/rest/v1/referral_redemptions": () => json({ status: "pending" }),
    },
    env: { STRIPE_REFERRAL_COUPON: "coupon_month_free" },
  });
  try {
    const response = await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    assertEquals(response.status, 200);
    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("discounts[0][coupon]"), "coupon_month_free");
  } finally {
    fn.restore();
  }
});

Deno.test("create-checkout applies no coupon without a redemption", async () => {
  const fn = await loadFunction("create-checkout", {
    upstreams: {
      ...upstreams(),
      "/rest/v1/referral_redemptions": () => json(null),
    },
    env: { STRIPE_REFERRAL_COUPON: "coupon_month_free" },
  });
  try {
    await fn.handler(jsonRequest("create-checkout", { tier: "standard" }));

    const form = stripeForm(fn.callsTo("checkout/sessions").at(-1)?.body ?? null);
    assertEquals(form.get("discounts[0][coupon]"), null);
  } finally {
    fn.restore();
  }
});

Deno.test("check-subscription converts a referral and credits the referrer", async () => {
  const REFERRER = "99999999-8888-4777-8666-555555555555";
  const fn = await loadFunction("check-subscription", {
    upstreams: {
      ...upstreams({ existingCustomer: "cus_referred" }),
      // The referred learner now has an active subscription…
      "api.stripe.com": (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname.includes("/customers") && request.method === "GET") {
          // Two lookups by email: the caller's, then the referrer's.
          return json({ data: [{ id: url.search.includes("referrer") ? "cus_referrer" : "cus_referred", email: "x" }] });
        }
        if (url.pathname.includes("/subscriptions")) {
          return json({
            data: [{
              id: "sub_1",
              current_period_end: Math.floor(Date.now() / 1000) + 86_400,
              items: { data: [{ price: { product: "prod_U77NfmTFN3mabx" } }] },
            }],
          });
        }
        if (url.pathname.includes("balance_transactions")) {
          return json({ id: "cbtxn_1", amount: -500 });
        }
        return json({ data: [] });
      },
      // …and a pending redemption that this check claims.
      "/rest/v1/referral_redemptions": (request) =>
        request.method === "PATCH"
          ? json([{ id: "red_1", referrer_id: REFERRER }])
          : json([]),
      "/auth/v1/admin/users": () => json({ user: { id: REFERRER, email: "referrer@example.com" } }),
    },
  });
  try {
    const response = await fn.handler(jsonRequest("check-subscription", {}));

    assertEquals(response.status, 200);
    // The credit landed on the referrer's Stripe balance…
    const credit = fn.callsTo("balance_transactions").at(-1);
    assert(credit, "expected a customer balance credit");
    assertStringIncludes(credit.body ?? "", "-500");
    // …and the redemption graduated out of pending.
    const patches = fn.callsTo("referral_redemptions").filter((c) => c.method === "PATCH");
    assert(patches.length >= 2, "expected pending→converted and converted→rewarded updates");
    assertStringIncludes(patches.at(-1)?.body ?? "", "rewarded");
  } finally {
    fn.restore();
  }
});

Deno.test("check-subscription touches no referral machinery for an unsubscribed caller", async () => {
  const fn = await loadFunction("check-subscription", {
    upstreams: {
      ...upstreams({ existingCustomer: "cus_free" }),
      "/rest/v1/referral_redemptions": (request) =>
        request.method === "PATCH" ? json([{ id: "red_1", referrer_id: "x" }]) : json([]),
    },
  });
  try {
    await fn.handler(jsonRequest("check-subscription", {}));

    // No active subscription → no conversion claim, no reward.
    assertEquals(fn.callsTo("referral_redemptions").filter((c) => c.method === "PATCH").length, 0);
  } finally {
    fn.restore();
  }
});
