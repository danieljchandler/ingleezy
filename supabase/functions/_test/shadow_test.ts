import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * Shadowing — `score-shadow-attempt` and the coaching half of
 * `pronunciation-feedback`.
 *
 * Ingleezy shadows two kinds of clip: native English videos, which are the
 * point of the app, and Hakiya-bridged Arabic ones kept as secondary
 * immersion. Which language a take is in decides which recogniser can score it
 * and what the tips should talk about, and `useShadowQueue` already works that
 * out per line and sends a BCP-47 locale.
 *
 * These tests exist because getting it wrong is **silent**. Sending an English
 * take to the Arabic ASR does not error — it returns Arabic-script noise, the
 * edit-distance similarity lands near zero, and the learner is told they
 * mispronounced every word of a line they said correctly. Nothing in the
 * response looks like a failure. So the routing itself is what gets pinned,
 * on both sides.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const AUDIO = btoa("fake audio bytes");

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/learner_errors": () => json({}, 201),
    "/rest/v1/rpc/record_learner_errors": () => json(null),
    "/rest/v1/rpc/resolve_learner_errors": () => json(null),
    "/rest/v1/profiles": () => json(null),
    ...extra,
  };
}

/** Deepgram's transcript shape. */
const deepgram = (transcript: string): UpstreamHandler => () =>
  json({ results: { channels: [{ alternatives: [{ transcript }] }] } });

/** Munsit's transcript shape. */
const munsit = (text: string): UpstreamHandler => () => json({ text });

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
) {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(jsonRequest(name, body));
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
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

const englishTake = {
  audioBase64: AUDIO,
  mimeType: "audio/wav",
  referenceText: "I went to the market yesterday",
  dialect: "Gulf",
  locale: "en-US",
};

// ── Which recogniser scores the take ────────────────────────────────────────

Deno.test("score-shadow-attempt answers the preflight", async () => {
  const fn = await loadFunction("score-shadow-attempt", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("score-shadow-attempt"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("score-shadow-attempt sends an English take to the English recogniser", async () => {
  const result = await call("score-shadow-attempt", englishTake, caller({
    "api.deepgram.com": deepgram("I went to the market yesterday"),
    "api.munsit.com": munsit("لا ينبغي أن يصل هنا"),
  }));

  assertEquals(result.status, 200);
  assertEquals(result.body.recognizedText, "I went to the market yesterday");
  // A perfect take has to score as one. Routed to Munsit this came back as
  // Arabic noise and scored near zero, which reads as "you said it all wrong".
  assertEquals(result.body.transcriptSimilarity, 1);
  assert(result.calls.some((url) => url.includes("deepgram")), "should call Deepgram");
  assert(!result.calls.some((url) => url.includes("munsit")), "should not call Munsit");
});

Deno.test("score-shadow-attempt sends a bridged Arabic take to the Arabic recogniser", async () => {
  // Hakiya-bridged clips are still shadowable, and Munsit is the right engine
  // for them — the flip narrowed this function's job, it did not remove half.
  const result = await call("score-shadow-attempt", {
    ...englishTake,
    referenceText: "رحت السوق أمس",
    locale: "ar-SA",
  }, caller({
    "api.deepgram.com": deepgram("should not reach here"),
    "api.munsit.com": munsit("رحت السوق أمس"),
  }));

  assertEquals(result.status, 200);
  assert(result.calls.some((url) => url.includes("munsit")), "should call Munsit");
  assert(!result.calls.some((url) => url.includes("deepgram")), "should not call Deepgram");
});

Deno.test("score-shadow-attempt treats an unlabelled clip as English", async () => {
  // An older client, or a clip whose locale went missing, is far more likely to
  // be one of ours than a bridged Arabic one. Failing toward the common case
  // keeps a silent bug rare rather than universal.
  const { locale: _dropped, ...noLocale } = englishTake;
  const result = await call("score-shadow-attempt", noLocale, caller({
    "api.deepgram.com": deepgram("I went to the market yesterday"),
    "api.munsit.com": munsit("noise"),
  }));

  assertEquals(result.status, 200);
  assert(result.calls.some((url) => url.includes("deepgram")), "should default to Deepgram");
});

Deno.test("score-shadow-attempt still reports the words that were missed", async () => {
  const result = await call("score-shadow-attempt", englishTake, caller({
    "api.deepgram.com": deepgram("I went to the market"),
  }));

  assertEquals(result.status, 200);
  const diffs = result.body.wordDiffs as Array<Record<string, unknown>>;
  // "yesterday" was dropped: the diff is what the coaching prompt and the
  // weak-set loop both read.
  assert(diffs.some((d) => d.status === "missing" && d.ref === "yesterday"));
});

// ── What the coaching talks about ───────────────────────────────────────────

const tipsResponse: UpstreamHandler = () =>
  json({
    choices: [{
      message: {
        tool_calls: [{
          function: { name: "return_tips", arguments: JSON.stringify({ tips: ["a tip"] }) },
        }],
      },
    }],
  });

function shadowFeedback(over: Record<string, unknown> = {}) {
  return {
    mode: "shadow",
    referenceText: "I went to the market yesterday",
    recognizedText: "I go to the market yesterday",
    closeness: 80,
    wordDiffs: [{ ref: "went", said: "go", status: "sub" }],
    dialect: "Egyptian",
    locale: "en-US",
    ...over,
  };
}

Deno.test("pronunciation-feedback coaches an English take on English sounds", async () => {
  const result = await call("pronunciation-feedback", shadowFeedback(), caller({
    "ai.gateway.lovable.dev": tipsResponse,
  }));

  assertEquals(result.status, 200);
  const sent = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(sent, "ENGLISH pronunciation coach");
  // The learner's L1 shapes the advice even though the target is English —
  // which sounds to watch for depends on the dialect they speak.
  assertStringIncludes(sent, "Egyptian Arabic");
  // The interference sounds are the whole reason an L1-aware coach beats a
  // generic one.
  assertStringIncludes(sent, "/p/ said as /b/");
});

Deno.test("pronunciation-feedback coaches a bridged Arabic take on Arabic sounds", async () => {
  const result = await call(
    "pronunciation-feedback",
    shadowFeedback({ locale: "ar-EG", referenceText: "رحت السوق أمس" }),
    caller({ "ai.gateway.lovable.dev": tipsResponse }),
  );

  assertEquals(result.status, 200);
  const sent = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(sent, "Egyptian Arabic pronunciation coach");
  assert(!sent.includes("ENGLISH pronunciation coach"));
});

Deno.test("pronunciation-feedback treats an unlabelled shadow take as English", async () => {
  const { locale: _dropped, ...noLocale } = shadowFeedback();
  const result = await call("pronunciation-feedback", noLocale, caller({
    "ai.gateway.lovable.dev": tipsResponse,
  }));

  assertEquals(result.status, 200);
  const sent = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(sent, "ENGLISH pronunciation coach");
});
