import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, sseCompletion, type UpstreamHandler } from "./upstreams.ts";

/**
 * `conversation-practice` and `practice-sentence-coach` — the two functions
 * that answer a learner mid-practice.
 *
 * `conversation-practice` is the only function that buffers a stream back into
 * a single reply: the brain streams, the client expects `{ reply }`, so the SSE
 * frames are accumulated server-side. It also carries the app's only
 * multi-turn drift check, scanning its own last three replies for MSA leaks and
 * nudging itself back into dialect.
 *
 * `practice-sentence-coach` is a two-stage pipeline — Munsit ASR, then the
 * brain — with a retry between Munsit models and a learner-error write that
 * depends on the model's verdict rather than on any status code.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/profiles": () => json([]),
    "/rest/v1/learner_errors": () => json([]),
    "/rest/v1/user_concept_mastery": () => json([]),
    ...extra,
  };
}

const streaming = (...pieces: string[]): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => sseCompletion(...pieces),
  "openrouter.ai": () => sseCompletion(...pieces),
});

const emitting = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => chatCompletion("", payload),
  "openrouter.ai": () => chatCompletion("", payload),
});

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: {
    jwt?: string | null;
    env?: Record<string, string | undefined>;
    /**
     * Wait for a fire-and-forget call before tearing the routes down.
     *
     * `practice-sentence-coach` writes learner errors with `void
     * recordLearnerErrors(...)` — deliberately, so the coaching is not held up
     * by bookkeeping. That means the write is still in flight when the response
     * resolves, and tearing the fetch table down at that point would let a late
     * call escape to the real network.
     */
    settleFor?: { match: string; method?: string };
  } = {},
) {
  const fn = await loadFunction(name, { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(name, body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();

    if (opts.settleFor) {
      const { match, method } = opts.settleFor;
      for (let i = 0; i < 100; i++) {
        if (fn.calls.some((c) => c.url.includes(match) && (!method || c.method === method))) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
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
      bodies: fn.calls.map((c) => c.body),
      methods: fn.calls.map((c) => c.method),
    };
  } finally {
    fn.restore();
  }
}

function gatewayPrompt(bodies: Array<string | null>, calls: string[]): string {
  const index = calls.findIndex((url) => url.includes("gateway") || url.includes("openrouter"));
  return bodies[index] ?? "";
}

// ── conversation-practice ────────────────────────────────────────────────────

const turn = (content: string, role = "user") => ({ role, content });

Deno.test("conversation-practice answers the preflight", async () => {
  const fn = await loadFunction("conversation-practice", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("conversation-practice"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("conversation-practice asks an anonymous caller to sign in", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller(),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("conversation-practice needs a conversation to continue", async () => {
  const result = await call("conversation-practice", { messages: [] }, caller());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "messages array is required");
});

Deno.test("conversation-practice rejects messages that are not an array", async () => {
  const result = await call("conversation-practice", { messages: "مرحبا" }, caller());

  assertEquals(result.status, 400);
});

Deno.test("conversation-practice buffers the stream into one reply", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller(streaming("شلون", "ك ", "اليوم؟")),
  );

  assertEquals(result.status, 200);
  // Three frames, one reply: the client never sees the stream.
  assertEquals(result.body.reply, "شلونك اليوم؟");
});

Deno.test("conversation-practice reports a stream that carried nothing", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller(streaming()),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "AI service unavailable");
});

Deno.test("conversation-practice tunes the prompt to the stated level", async () => {
  const advanced = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")], difficulty: "advanced" },
    caller(streaming("رد")),
  );
  assertStringIncludes(gatewayPrompt(advanced.bodies, advanced.calls), "advanced");

  const beginner = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")], difficulty: "beginner" },
    caller(streaming("رد")),
  );
  assertStringIncludes(gatewayPrompt(beginner.bodies, beginner.calls), "very simple, short sentences");
});

Deno.test("conversation-practice treats an unknown level as beginner", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")], difficulty: "wizard" },
    caller(streaming("رد")),
  );

  assertStringIncludes(gatewayPrompt(result.bodies, result.calls), "Be encouraging and patient");
});

Deno.test("conversation-practice nudges itself back after its own MSA leaks", async () => {
  const result = await call(
    "conversation-practice",
    {
      dialect: "Gulf",
      messages: [
        turn("مرحبا"),
        // An earlier assistant turn that drifted into MSA/Egyptian forms.
        turn("دلوقتي أنا ماذا أفعل", "assistant"),
        turn("طيب"),
      ],
    },
    caller(streaming("رد")),
  );

  assertEquals(result.status, 200);
  const prompt = gatewayPrompt(result.bodies, result.calls);
  assertStringIncludes(prompt, "SELF-CORRECTION");
});

Deno.test("conversation-practice adds no nudge to a clean history", async () => {
  const result = await call(
    "conversation-practice",
    { dialect: "Gulf", messages: [turn("مرحبا"), turn("شلونك", "assistant"), turn("زين")] },
    caller(streaming("رد")),
  );

  const prompt = gatewayPrompt(result.bodies, result.calls);
  assertEquals(prompt.includes("SELF-CORRECTION"), false);
});

Deno.test("conversation-practice only pays for the learner profile on the opening turns", async () => {
  const opening = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller(streaming("رد")),
  );
  assert(
    opening.calls.some((url) => url.includes("/rest/v1/user_vocabulary")),
    "expected the learner profile to be read on the first turn",
  );

  const later = await call(
    "conversation-practice",
    {
      messages: [turn("مرحبا"), turn("شلونك", "assistant"), turn("زين"), turn("حلو", "assistant")],
    },
    caller(streaming("رد")),
  );
  assertEquals(later.calls.some((url) => url.includes("/rest/v1/user_vocabulary")), false);
});

Deno.test("conversation-practice passes a paywall answer straight through", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "payment required" }, 402),
      "openrouter.ai": () => json({ error: "payment required" }, 402),
    }),
  );

  assertEquals(result.status, 402);
  assertStringIncludes(String(result.body.error), "credits");
});

Deno.test("conversation-practice passes a rate limit straight through", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429),
      "openrouter.ai": () => json({ error: "slow down" }, 429),
    }),
  );

  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "Rate limit");
});

Deno.test("conversation-practice flattens any other model failure to a 500", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "AI service error");
});

Deno.test("conversation-practice counts against the free-tier daily cap", async () => {
  const result = await call(
    "conversation-practice",
    { messages: [turn("مرحبا")] },
    caller({
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(51),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});

// ── practice-sentence-coach ──────────────────────────────────────────────────

const feedback = {
  used_target_word: true,
  understandable: true,
  verdict: "Nicely done.",
  natural_rewrite: "أبي أروح السوق",
  natural_rewrite_english: "I want to go to the market",
  alternatives: [{ arabic: "ودي أروح السوق", english: "I'd like to go to the market" }],
  tips: ["Stress the first syllable."],
};

const AUDIO = btoa("fixture-audio-bytes");

const munsit = (transcription: string): UpstreamHandler => () =>
  json({ data: { transcription } });

function coachUpstreams(extra: Record<string, UpstreamHandler> = {}) {
  return caller({
    "api.munsit.com": munsit("أبغى أروح السوق"),
    ...emitting(feedback),
    ...extra,
  });
}

Deno.test("practice-sentence-coach answers the preflight", async () => {
  const fn = await loadFunction("practice-sentence-coach", { upstreams: coachUpstreams() });
  try {
    const response = await fn.handler(optionsRequest("practice-sentence-coach"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("practice-sentence-coach asks an anonymous caller to sign in", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams(),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("practice-sentence-coach needs both the clip and the target", async () => {
  const noAudio = await call(
    "practice-sentence-coach",
    { targetArabic: "سوق" },
    coachUpstreams(),
  );
  assertEquals(noAudio.status, 400);

  const noTarget = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO },
    coachUpstreams(),
  );
  assertEquals(noTarget.status, 400);
});

Deno.test("practice-sentence-coach returns the transcript alongside the coaching", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق", targetEnglish: "market", dialect: "Gulf" },
    coachUpstreams(),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.transcript, "أبغى أروح السوق");
  assertEquals(result.body.used_target_word, true);
  assertEquals(result.body.natural_rewrite, "أبي أروح السوق");
  assertEquals((result.body.alternatives as unknown[]).length, 1);
});

Deno.test("practice-sentence-coach says so gently when it heard nothing", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({ "api.munsit.com": munsit("") }),
  );

  // A silent clip is a 200 with `empty: true`, not an error — the learner is
  // asked to try again rather than shown a failure.
  assertEquals(result.status, 200);
  assertEquals(result.body.empty, true);
  assertStringIncludes(String(result.body.message), "try recording again");
});

Deno.test("practice-sentence-coach never reaches the model on a silent clip", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({ "api.munsit.com": munsit("") }),
  );

  assertEquals(result.calls.filter((url) => url.includes("gateway")).length, 0);
});

Deno.test("practice-sentence-coach retries the other ASR model on an empty answer", async () => {
  let attempt = 0;
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      "api.munsit.com": () => {
        attempt += 1;
        return json({ data: { transcription: attempt === 1 ? "" : "أبغى أروح السوق" } });
      },
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(attempt, 2);
  assertEquals(result.body.transcript, "أبغى أروح السوق");
});

Deno.test("practice-sentence-coach tells the model what was being practised", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق", targetEnglish: "market", dialect: "Egyptian" },
    coachUpstreams(),
  );

  const prompt = gatewayPrompt(result.bodies, result.calls);
  assertStringIncludes(prompt, "سوق");
  assertStringIncludes(prompt, "market");
  assertStringIncludes(prompt, "أبغى أروح السوق");
  assertStringIncludes(prompt, "Egyptian");
});

Deno.test("practice-sentence-coach records a miss as a learner error", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      ...emitting({ ...feedback, used_target_word: false }),
      "/rest/v1/learner_errors": () => json({}, 201),
    }),
    { settleFor: { match: "/rest/v1/learner_errors", method: "POST" } },
  );

  assertEquals(result.status, 200);
  const write = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/learner_errors") && c.method === "POST");
  assert(write, "expected a learner error to be recorded");
  const rows = JSON.parse(write?.body ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows[0].source, "sentence_coach");
  assertEquals(rows[0].error_kind, "wrong_word");
});

Deno.test("practice-sentence-coach records an unintelligible attempt differently", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      ...emitting({ ...feedback, understandable: false }),
      "/rest/v1/learner_errors": () => json({}, 201),
    }),
    { settleFor: { match: "/rest/v1/learner_errors", method: "POST" } },
  );

  const write = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/learner_errors") && c.method === "POST");
  const rows = JSON.parse(write?.body ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows[0].error_kind, "other");
});

Deno.test("practice-sentence-coach clears the target after a clean attempt", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({ "/rest/v1/learner_errors": () => json({}, 204) }),
    { settleFor: { match: "/rest/v1/learner_errors", method: "PATCH" } },
  );

  assertEquals(result.status, 200);
  const resolved = result.calls
    .map((url, i) => ({ url, method: result.methods[i] }))
    .find((c) => c.url.includes("/rest/v1/learner_errors") && c.method === "PATCH");
  assert(resolved, "expected the outstanding error for this target to be resolved");
});

Deno.test("practice-sentence-coach passes a rate limit through", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429),
      "openrouter.ai": () => json({ error: "slow down" }, 429),
    }),
  );

  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "Rate limited");
});

Deno.test("practice-sentence-coach passes a credit failure through", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402),
      "openrouter.ai": () => json({ error: "no credits" }, 402),
    }),
  );

  assertEquals(result.status, 402);
  assertStringIncludes(String(result.body.error), "credits");
});

Deno.test("practice-sentence-coach reports an ASR outage as its own message", async () => {
  // Pinned, not fixed. A Munsit failure is rethrown into the outer catch and
  // returned verbatim, so the learner sees "Munsit 503: ..." — an upstream
  // vendor's name and status in the middle of a practice session.
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({ "api.munsit.com": () => json({ error: "down" }, 503) }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "Munsit 503");
});

Deno.test("practice-sentence-coach reports a missing ASR key as a server error", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams(),
    { env: { MUNSIT_API_KEY: undefined } },
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "MUNSIT_API_KEY");
});

Deno.test("practice-sentence-coach counts against the free-tier daily cap", async () => {
  const result = await call(
    "practice-sentence-coach",
    { audioBase64: AUDIO, targetArabic: "سوق" },
    coachUpstreams({
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(41),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});
