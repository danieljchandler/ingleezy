import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, loadSharedModule, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `convert-to-fusha` — dialect Arabic in, Modern Standard Arabic out.
 *
 * It is the only translation-adjacent function whose output is *not* English,
 * and that is the whole risk: the answer is rendered RTL under a فصحى heading,
 * so a model that replies "I went to the market" produces a row that looks like
 * Arabic-shaped nonsense to a beginner and like a broken feature to everyone
 * else. The function drops anything without Arabic script rather than showing
 * it, and falls through to the second model when the first does that.
 *
 * The alignment is the other half. The caller matches the response array to its
 * lines by index, so a short or reordered answer silently files every
 * subsequent line's Fusha under the wrong sentence — a mistake only a Fusha
 * speaker could catch, which is precisely who the row exists for.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("convert-to-fusha", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("convert-to-fusha", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      /** What was sent to a gateway — the auth and cap calls come first. */
      sentTo: (match: string) => fn.callsTo(match).map((c) => c.body ?? "").join("\n"),
    };
  } finally {
    fn.restore();
  }
}

const DIALECT = ["شلونك اليوم", "وش تبغى"];
const FUSHA = ["كيف حالك اليوم", "ماذا تريد"];

Deno.test("convert-to-fusha answers CORS preflight", async () => {
  const fn = await loadFunction("convert-to-fusha");
  try {
    const response = await fn.handler(optionsRequest("convert-to-fusha"));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("access-control-allow-origin"), "https://hakiya.app");
  } finally {
    fn.restore();
  }
});

Deno.test("convert-to-fusha returns one Fusha rendering per line", async () => {
  const { status, body } = await call(
    { lines: DIALECT, dialect: "Gulf" },
    caller({ "openrouter.ai": () => chatCompletion(JSON.stringify({ fusha: FUSHA })) }),
  );

  assertEquals(status, 200);
  assertEquals(body.fusha, FUSHA);
});

Deno.test("convert-to-fusha asks the model to convert, not to translate", async () => {
  const { sentTo } = await call(
    { lines: DIALECT, dialect: "Egyptian" },
    caller({ "openrouter.ai": () => chatCompletion(JSON.stringify({ fusha: FUSHA })) }),
  );

  const sent = sentTo("openrouter.ai");
  assertStringIncludes(sent, "not a translation");
  assertStringIncludes(sent, "Egyptian Arabic");
  // The lines go up numbered, which is what makes the answer alignable.
  assertStringIncludes(sent, "1. ");
});

Deno.test("convert-to-fusha pads a short answer rather than shifting it", async () => {
  const { status, body } = await call(
    { lines: [...DIALECT, "زين"] },
    caller({ "openrouter.ai": () => chatCompletion(JSON.stringify({ fusha: FUSHA })) }),
  );

  assertEquals(status, 200);
  // Three lines in, three out — the third simply has no rendering. Shifting
  // would have put "ماذا تريد" under a line that never said it.
  assertEquals(body.fusha, [...FUSHA, ""]);
});

Deno.test("convert-to-fusha falls through to the second model when the first answers in English", async () => {
  const { status, body } = await call(
    { lines: [DIALECT[0]] },
    caller({
      "openrouter.ai": () => chatCompletion(JSON.stringify({ fusha: ["How are you today?"] })),
      "ai.gateway.lovable.dev": () => chatCompletion(JSON.stringify({ fusha: [FUSHA[0]] })),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.fusha, [FUSHA[0]]);
  assertEquals(body.model, "google/gemini-3.5-flash");
});

Deno.test("convert-to-fusha reports a failure instead of an empty conversion", async () => {
  const { status, body } = await call(
    { lines: DIALECT },
    caller({
      "openrouter.ai": () => json({ error: "upstream down" }, 500),
      "ai.gateway.lovable.dev": () => json({ error: "upstream down" }, 500),
    }),
  );

  // An empty array here would read as "these lines are already Fusha".
  assertEquals(status, 502);
  assertEquals(body.error, "fusha_unavailable");
});

Deno.test("convert-to-fusha rejects an empty request", async () => {
  const { status } = await call({ lines: [] }, caller());
  assertEquals(status, 400);
});

Deno.test("convert-to-fusha refuses a batch bigger than it can align", async () => {
  const { status, body } = await call(
    { lines: new Array(41).fill("شلونك") },
    caller({ "openrouter.ai": () => chatCompletion(JSON.stringify({ fusha: [] })) }),
  );

  // Truncating would answer a different question than the one asked, and the
  // caller matches the result to its lines by index.
  assertEquals(status, 400);
  assertEquals(body.error, "too_many_lines");
});

Deno.test("convert-to-fusha is capped for anonymous callers", async () => {
  const { status } = await call({ lines: DIALECT }, caller(), { jwt: null });
  assertEquals(status, 401);
});

// ── the shared rules ────────────────────────────────────────────────────────

interface FushaBridgeModule {
  FUSHA_LINE_RULE: string;
  buildFushaSystemPrompt: (dialectLabel: string) => string;
  sanitizeFushaLine: (raw: unknown) => string;
  alignFushaLines: (parsed: unknown, count: number) => string[];
  fushaDiffers: (dialect: string, fusha?: string | null) => boolean;
}

Deno.test("fushaBridge states the conversion rule the analyzer and the page share", async () => {
  const mod = await loadSharedModule<FushaBridgeModule>("fushaBridge");

  assertStringIncludes(mod.FUSHA_LINE_RULE, "not a translation");
  assertStringIncludes(mod.buildFushaSystemPrompt("Yemeni Arabic"), "Yemeni Arabic");
  // Same module powers analyze-gulf-arabic's pass, so a line converted on
  // demand reads like a line converted at analysis time.
  assertEquals(mod.sanitizeFushaLine("How are you?"), "");
  assertEquals(mod.alignFushaLines({ fusha: ["كيف حالك"] }, 2), ["كيف حالك", ""]);
  assert(mod.fushaDiffers("شلونك", "كيف حالك"));
  assert(!mod.fushaDiffers("كيف حالك", "كيف حالك"));
});
