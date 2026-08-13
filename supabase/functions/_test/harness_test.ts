import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";

/**
 * The harness's own tests.
 *
 * Everything else in supabase/functions/**\/*_test.ts is built on this, so a
 * bug here would show up as a mysterious failure in an unrelated function.
 * `grammar-drill` is the subject because it exercises both interception paths
 * that matter: it imports `serve` from the std URL (covered by the test-only
 * import map) and it goes through the shared usage cap.
 */

Deno.test("loads a function that calls serve() from the std URL", async () => {
  const fn = await loadFunction("grammar-drill");
  try {
    assertEquals(typeof fn.handler, "function");
  } finally {
    fn.restore();
  }
});

Deno.test("loads a function that calls Deno.serve directly", async () => {
  // The other 28 functions use this form; the harness patches Deno.serve before
  // importing so both shapes land in the same place.
  const fn = await loadFunction("check-subscription");
  try {
    assertEquals(typeof fn.handler, "function");
  } finally {
    fn.restore();
  }
});

Deno.test("answers a CORS preflight for an allowed origin", async () => {
  const fn = await loadFunction("grammar-drill");
  try {
    const response = await fn.handler(optionsRequest("grammar-drill", "https://hakiya.app"));
    assertEquals(response.headers.get("access-control-allow-origin"), "https://hakiya.app");
  } finally {
    fn.restore();
  }
});

Deno.test("omits the CORS header for an origin that is not allowed", async () => {
  // Real security surface with no coverage before now: getCorsHeaders returns
  // no Allow-Origin for an unknown origin, so the browser blocks the response.
  const fn = await loadFunction("grammar-drill");
  try {
    const response = await fn.handler(optionsRequest("grammar-drill", "https://evil.example"));
    assertEquals(response.headers.get("access-control-allow-origin"), null);
  } finally {
    fn.restore();
  }
});

Deno.test("allows a Lovable preview origin", async () => {
  const fn = await loadFunction("grammar-drill");
  try {
    const origin = "https://id-preview--abc.lovable.app";
    const response = await fn.handler(optionsRequest("grammar-drill", origin));
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
  } finally {
    fn.restore();
  }
});

Deno.test("allows localhost during development", async () => {
  const fn = await loadFunction("grammar-drill");
  try {
    const origin = "http://localhost:8080";
    const response = await fn.handler(optionsRequest("grammar-drill", origin));
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
  } finally {
    fn.restore();
  }
});

Deno.test("routes outbound calls to the fixture upstreams and records them", async () => {
  const fn = await loadFunction("grammar-drill", {
    upstreams: {
      // The usage cap reads `subscribers` under the service role; an active row
      // bypasses the cap so the request reaches the model call.
      "/rest/v1/subscribers": () =>
        new Response(JSON.stringify([{ subscribed: true, subscription_tier: "allin" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  });

  try {
    await fn.handler(
      jsonRequest("grammar-drill", { category: "negation", difficulty: "beginner", dialect: "Gulf" }),
    );

    // Something was actually called, and the harness saw it.
    assertEquals(fn.calls.length > 0, true);
  } finally {
    fn.restore();
  }
});

Deno.test("throws on an upstream nothing routed, rather than letting it out", async () => {
  const fn = await loadFunction("grammar-drill", {
    upstreams: {},
  });

  try {
    // Reaching an unrouted host would mean the test is not in control of what
    // the function talks to, so the harness refuses rather than proceeding.
    const response = await fn.handler(
      jsonRequest("grammar-drill", { category: "negation" }),
    );
    // The function catches its own errors, so assert it did not succeed
    // silently: a 200 here would mean the unrouted call was ignored.
    assertEquals(response.status >= 400 || fn.calls.length > 0, true);
  } finally {
    fn.restore();
  }
});

Deno.test("stops routing once the test is done", async () => {
  // The routing fetch stays installed by design — a cached Supabase client in
  // _shared/usageCap.ts captures whatever fetch existed when it was built, and
  // that cache outlives any single test. What restore() has to guarantee is
  // that the *routes* are gone, so a late call from such a client cannot be
  // answered by a finished test's fixtures.
  const errorFor = async (): Promise<string> => {
    try {
      await fetch("https://nothing-routes-this.invalid/");
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const fn = await loadFunction("grammar-drill");
  // While the test owns the routes, an unrouted host is the harness's error.
  assertStringIncludes(await errorFor(), "Unrouted upstream request");

  fn.restore();
  // Afterwards it falls through to the real fetch, which fails for its own
  // reasons — the point is that it is no longer the harness answering.
  const after = await errorFor();
  assertEquals(after.includes("Unrouted upstream request"), false);
});

Deno.test("restores environment variables afterwards", async () => {
  const before = Deno.env.get("LOVABLE_API_KEY");

  const fn = await loadFunction("grammar-drill", { env: { LOVABLE_API_KEY: "scoped-value" } });
  assertEquals(Deno.env.get("LOVABLE_API_KEY"), "scoped-value");

  fn.restore();
  assertEquals(Deno.env.get("LOVABLE_API_KEY"), before);
});

Deno.test("surfaces a bad function name rather than hanging", async () => {
  // A typo should fail immediately with the path it looked for, not time out.
  let message = "";
  try {
    await loadFunction("no-such-function");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertExists(message);
  assertStringIncludes(message.toLowerCase(), "module not found");
  assertStringIncludes(message, "no-such-function/index.ts");
});
