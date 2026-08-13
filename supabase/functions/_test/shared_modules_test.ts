import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import { requireEnvVars } from "../_shared/requireEnvVars.ts";

/**
 * The three shared modules every function depends on, tested directly.
 *
 * The CORS contract is swept across all 84 elsewhere, which proves the
 * production origin works and an arbitrary one does not. What that sweep cannot
 * show is *why* — the allow-list, the localhost exemption and the Lovable
 * preview pattern are three separate rules, and a change to the regex that
 * accidentally matched `lovable.app.evil.com` would still pass a sweep testing
 * only `https://evil.example`.
 *
 * These run in Deno rather than Vitest because all three read `Deno.env`
 * directly at call time.
 */

const withEnv = <T>(vars: Record<string, string | undefined>, run: () => T): T => {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(vars)) {
    previous.set(name, Deno.env.get(name));
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    return run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
};

const originFor = (origin: string, allowed?: string): string | undefined =>
  withEnv({ ALLOWED_ORIGINS: allowed }, () =>
    getCorsHeaders(new Request("https://fn.test/x", { headers: { origin } }))[
      "Access-Control-Allow-Origin"
    ]);

Deno.test("cors mirrors an allow-listed origin", () => {
  assertEquals(originFor("https://hakiya.app", "https://hakiya.app"), "https://hakiya.app");
});

Deno.test("cors omits the header entirely for an unknown origin", () => {
  // Omitted rather than set to something wrong: the browser then blocks the
  // response, which is the behaviour the header exists to produce. A wildcard
  // here would let any page on the internet read a learner's data.
  assertEquals(originFor("https://evil.example", "https://hakiya.app"), undefined);
});

Deno.test("cors falls back to the production domains when nothing is configured", () => {
  // A missing secret must not open the functions up, and must not lock the real
  // site out either.
  assertEquals(originFor("https://hakiya.app", undefined), "https://hakiya.app");
  assertEquals(originFor("https://evil.example", undefined), undefined);
});

Deno.test("cors reads a comma-separated list, ignoring the spacing", () => {
  const allowed = " https://hakiya.app , https://other.test ";
  assertEquals(originFor("https://other.test", allowed), "https://other.test");
  assertEquals(originFor("https://hakiya.app", allowed), "https://hakiya.app");
});

Deno.test("cors allows local development on either loopback name", () => {
  assertEquals(originFor("http://localhost:5173", "https://hakiya.app"), "http://localhost:5173");
  assertEquals(originFor("http://127.0.0.1:5173", "https://hakiya.app"), "http://127.0.0.1:5173");
});

Deno.test("cors allows Lovable preview subdomains", () => {
  // Preview deploys get a generated subdomain per branch, so they cannot be
  // enumerated in the allow-list.
  assertEquals(
    originFor("https://id-preview--abc123.lovable.app", "https://hakiya.app"),
    "https://id-preview--abc123.lovable.app",
  );
  assertEquals(originFor("https://foo.lovable.dev", "https://hakiya.app"), "https://foo.lovable.dev");
});

Deno.test("cors does not allow a domain that merely ends in a Lovable name", () => {
  // The pattern is anchored at both ends. Without the anchors,
  // `lovable.app.evil.com` and `evil-lovable.app` would both match, which is
  // the whole risk of matching a domain with a regex.
  assertEquals(originFor("https://lovable.app.evil.com", "https://hakiya.app"), undefined);
  assertEquals(originFor("https://notlovable.app", "https://hakiya.app"), undefined);
  assertEquals(originFor("http://foo.lovable.app", "https://hakiya.app"), undefined);
});

Deno.test("cors omits the header when there is no origin at all", () => {
  // A server-to-server call has no Origin. Echoing an empty string would be a
  // malformed header rather than an absent one.
  const headers = getCorsHeaders(new Request("https://fn.test/x"));
  assertEquals(headers["Access-Control-Allow-Origin"], undefined);
});

Deno.test("cors always varies on origin", () => {
  // Without this a CDN or browser cache can serve one origin's response — and
  // its Allow-Origin header — to another.
  assertEquals(getCorsHeaders(new Request("https://fn.test/x")).Vary, "Origin");
  assertEquals(
    getCorsHeaders(new Request("https://fn.test/x", { headers: { origin: "https://hakiya.app" } }))
      .Vary,
    "Origin",
  );
});

Deno.test("cors allows the headers supabase-js actually sends", () => {
  const allowed = getCorsHeaders()["Access-Control-Allow-Headers"];

  // The client sends apikey and its own telemetry headers on every request; a
  // missing one fails the preflight and the call never happens.
  for (const header of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assert(allowed.includes(header), `expected ${header} to be allowed`);
  }
});

Deno.test("an error response carries the status, the message and the CORS headers", async () => {
  const cors = getCorsHeaders(
    new Request("https://fn.test/x", { headers: { origin: "https://hakiya.app" } }),
  );
  const response = createErrorResponse(400, "Invalid input", cors);

  assertEquals(response.status, 400);
  // Without the CORS headers the browser reports a network error instead of the
  // message, so the caller cannot tell a validation failure from being offline.
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://hakiya.app");
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(await response.json(), { error: "Invalid input" });
});

Deno.test("an error response includes details only when given", async () => {
  const withDetails = await createErrorResponse(422, "Bad field", {}, { field: "count" }).json();
  assertEquals(withDetails, { error: "Bad field", details: { field: "count" } });

  const without = await createErrorResponse(422, "Bad field").json();
  assertEquals(without, { error: "Bad field" });
});

Deno.test("an error response sets its own content type over a caller's", () => {
  // Callers spread the CORS headers in, and getting text/plain here would make
  // supabase-js hand the caller a string instead of the parsed error.
  const response = createErrorResponse(500, "boom", { "Content-Type": "text/plain" });
  assertEquals(response.headers.get("Content-Type"), "application/json");
});

Deno.test("requireEnvVars returns the values it found", () => {
  withEnv({ FIXTURE_A: "one", FIXTURE_B: "two" }, () => {
    assertEquals(requireEnvVars("FIXTURE_A", "FIXTURE_B"), {
      FIXTURE_A: "one",
      FIXTURE_B: "two",
    });
  });
});

Deno.test("requireEnvVars names every missing variable at once", () => {
  withEnv({ FIXTURE_A: undefined, FIXTURE_B: undefined, FIXTURE_C: "set" }, () => {
    const error = assertThrows(() => requireEnvVars("FIXTURE_A", "FIXTURE_B", "FIXTURE_C"));

    // Reporting one at a time turns a misconfigured deploy into several
    // deploy-and-retry cycles.
    const message = (error as Error).message;
    assert(message.includes("FIXTURE_A"), message);
    assert(message.includes("FIXTURE_B"), message);
    assert(!message.includes("FIXTURE_C"), message);
  });
});

Deno.test("requireEnvVars treats an empty value as missing", () => {
  // An empty secret is the usual shape of a misconfigured deploy — the variable
  // exists in the dashboard with nothing in it — and passing "" to an API
  // client fails much later with an unrelated auth error.
  withEnv({ FIXTURE_A: "" }, () => {
    assertThrows(() => requireEnvVars("FIXTURE_A"));
  });
});

Deno.test("requireEnvVars says where to set them", () => {
  withEnv({ FIXTURE_A: undefined }, () => {
    const error = assertThrows(() => requireEnvVars("FIXTURE_A"));
    assert((error as Error).message.includes("secrets"), (error as Error).message);
  });
});
