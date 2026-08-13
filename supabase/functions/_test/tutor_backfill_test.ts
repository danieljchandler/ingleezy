import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `classify-tutor-segments` and `backfill-literal-translations` — two
 * pipeline functions that turn raw transcript into something teachable.
 *
 * `classify-tutor-segments` reconciles two clocks: the model reasons over
 * segment indices, but the timings that actually cut the audio come from
 * word-level tokens when they exist. Everything the model returns is then
 * defended — an out-of-range index, a missing confidence, a classification it
 * invented — because a bad timestamp silently produces a clip of the wrong
 * word rather than a visible failure.
 *
 * `backfill-literal-translations` is the one maintenance job in the set, and
 * the only function in the app that writes with the service role without
 * checking who is calling.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "aaaaaaaa-0000-4000-8000-000000000000";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    ...extra,
  };
}

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction(name, { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(name, body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      bodies: fn.calls.map((c) => c.body),
      methods: fn.calls.map((c) => c.method),
    };
  } finally {
    fn.restore();
  }
}

// ── classify-tutor-segments ──────────────────────────────────────────────────

const segments = [
  { text: "سوق", startMs: 1000, endMs: 1500 },
  { text: "أبغى أروح السوق", startMs: 2000, endMs: 4000 },
  { text: "سوق", startMs: 5000, endMs: 5400 },
];

const words = [
  { text: "سوق", startMs: 1010, endMs: 1490, index: 0 },
  { text: "أبغى", startMs: 2000, endMs: 2400, index: 1 },
  { text: "أروح", startMs: 2400, endMs: 2800, index: 2 },
  { text: "السوق", startMs: 2800, endMs: 3400, index: 3 },
];

const candidate = {
  word_segment_index: 0,
  word_text: "سوق",
  word_english: "market",
  sentence_segment_index: 1,
  sentence_text: "أبغى أروح السوق",
  sentence_english: "I want to go to the market",
  confidence: 0.92,
  classification: "CONCRETE",
};

interface Classified {
  word_text: string;
  word_english: string;
  word_standard?: string;
  sentence_text?: string;
  word_start_ms: number;
  word_end_ms: number;
  sentence_start_ms?: number;
  sentence_end_ms?: number;
  confidence: number;
  classification: string;
}

Deno.test("classify-tutor-segments answers the preflight", async () => {
  const fn = await loadFunction("classify-tutor-segments", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("classify-tutor-segments"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("classify-tutor-segments refuses a request with no bearer token", async () => {
  const result = await call("classify-tutor-segments", { segments }, caller(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "Unauthorized");
});

Deno.test("classify-tutor-segments refuses a token the auth server rejects", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "/auth/v1/user": () => json({ error: "bad token" }, 401) }),
  );

  assertEquals(result.status, 401);
});

Deno.test("classify-tutor-segments needs segments to classify", async () => {
  const result = await call("classify-tutor-segments", { segments: [] }, caller());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "No segments provided");
});

Deno.test("classify-tutor-segments returns a candidate with its segment timings", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [candidate] }) }),
  );

  assertEquals(result.status, 200);
  const found = (result.body.candidates as Classified[])[0];
  assertEquals(found.word_text, "سوق");
  assertEquals(found.word_english, "market");
  // With no word-level tokens the segment's own bounds are used.
  assertEquals(found.word_start_ms, 1000);
  assertEquals(found.word_end_ms, 1500);
  assertEquals(found.sentence_start_ms, 2000);
  assertEquals(found.sentence_end_ms, 4000);
  assertEquals(found.classification, "CONCRETE");
});

Deno.test("classify-tutor-segments prefers word-level timings when it has them", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments, words },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [{ ...candidate, word_start_index: 0, word_end_index: 0 }],
      }),
    }),
  );

  const found = (result.body.candidates as Classified[])[0];
  // Tighter than the segment: this is what makes the extracted clip land on the
  // word rather than on the pause around it.
  assertEquals(found.word_start_ms, 1010);
  assertEquals(found.word_end_ms, 1490);
});

Deno.test("classify-tutor-segments falls back when a word index does not exist", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments, words },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [{ ...candidate, word_start_index: 99, word_end_index: 100 }],
      }),
    }),
  );

  const found = (result.body.candidates as Classified[])[0];
  assertEquals(found.word_start_ms, 1000);
  assertEquals(found.word_end_ms, 1500);
});

Deno.test("classify-tutor-segments leaves the sentence out when none was paired", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [
          { ...candidate, sentence_segment_index: -1, sentence_text: undefined, sentence_english: undefined },
        ],
      }),
    }),
  );

  const found = (result.body.candidates as Classified[])[0];
  assertEquals(found.sentence_start_ms, undefined);
  assertEquals(found.sentence_end_ms, undefined);
});

Deno.test("classify-tutor-segments defaults a missing confidence rather than dropping the word", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [{ ...candidate, confidence: undefined }],
      }),
    }),
  );

  const found = (result.body.candidates as Classified[])[0];
  assertEquals(found.confidence, 0.5);
});

Deno.test("classify-tutor-segments falls back to ABSTRACT for an invented class", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [{ ...candidate, classification: "PROPER_NOUN" }],
      }),
    }),
  );

  assertEquals((result.body.candidates as Classified[])[0].classification, "ABSTRACT");
});

Deno.test("classify-tutor-segments drops a candidate with no word at all", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [
          { ...candidate, word_text: "", word_segment_index: 99 },
          candidate,
        ],
      }),
    }),
  );

  assertEquals((result.body.candidates as Classified[]).length, 1);
});

Deno.test("classify-tutor-segments falls back to the segment text when the model gave none", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({
      "ai.gateway.lovable.dev": emitting({
        candidates: [{ ...candidate, word_text: "" }],
      }),
    }),
  );

  assertEquals((result.body.candidates as Classified[])[0].word_text, "سوق");
});

Deno.test("classify-tutor-segments tells the model which dialect it is hearing", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments, dialectModule: "Yemeni" },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [] }) }),
  );

  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "Yemeni Arabic");
  // And the reason the whole classification exists: skip the student's echo.
  assertStringIncludes(prompt, "NOT the student's repetition");
});

Deno.test("classify-tutor-segments treats an unknown dialect as Gulf", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments, dialectModule: "Levantine" },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [] }) }),
  );

  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "Khaliji");
});

Deno.test("classify-tutor-segments only puts word indices in the schema when it has words", async () => {
  const without = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [] }) }),
  );
  const withoutBody = JSON.parse(
    without.bodies[without.calls.findIndex((u) => u.includes("gateway"))] ?? "{}",
  ) as { tools: Array<{ function: { parameters: { properties: { candidates: { items: { properties: Record<string, unknown> } } } } } }> };
  const withoutProps =
    withoutBody.tools[0].function.parameters.properties.candidates.items.properties;
  assertEquals("word_start_index" in withoutProps, false);
  assertEquals(without.bodies.join("").includes("Word-level timestamps"), false);

  const withWords = await call(
    "classify-tutor-segments",
    { segments, words },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [] }) }),
  );
  const withBody = withWords.bodies[withWords.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(withBody, "word_start_index");
  assertStringIncludes(withBody, "Word-level timestamps");
});

Deno.test("classify-tutor-segments asks for word indices it did not offer a place for", async () => {
  // Pinned, not fixed. Point 4 of the system prompt always tells the model to
  // "specify the exact word indices (word_start_index and word_end_index)",
  // but those properties are added to the tool schema only when word-level
  // timestamps were supplied. Without them the model is asked for fields the
  // schema forbids — `additionalProperties: false` — so the instruction is at
  // best ignored and at worst a rejected tool call.
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": emitting({ candidates: [] }) }),
  );

  const sent = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(sent, "word_start_index and word_end_index");
});

Deno.test("classify-tutor-segments passes a rate limit through", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429) }),
  );

  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "Rate limit");
});

Deno.test("classify-tutor-segments passes a payment failure through", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402) }),
  );

  assertEquals(result.status, 402);
});

Deno.test("classify-tutor-segments reports a reply with no tool call", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("prose, not a tool call") }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "No tool call");
});

Deno.test("classify-tutor-segments reports a missing gateway key", async () => {
  const result = await call(
    "classify-tutor-segments",
    { segments },
    caller(),
    { env: { LOVABLE_API_KEY: undefined } },
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "LOVABLE_API_KEY");
});

// ── backfill-literal-translations ────────────────────────────────────────────

const line = (arabic: string, over: Record<string, unknown> = {}) => ({
  arabic,
  translation: "the market",
  ...over,
});

/** The gateway answers with JSON in the message content, not a tool call. */
const literals = (...values: string[]): UpstreamHandler => () =>
  chatCompletion(JSON.stringify({ literals: values }));

function backfillUpstreams(
  videos: Array<Record<string, unknown>>,
  extra: Record<string, UpstreamHandler> = {},
) {
  return {
    "/rest/v1/discover_videos": (request: Request) =>
      request.method === "GET" ? json(videos) : json([], 204),
    "ai.gateway.lovable.dev": literals("the market"),
    ...extra,
  };
}

Deno.test("backfill-literal-translations answers the preflight", async () => {
  const fn = await loadFunction("backfill-literal-translations", {
    upstreams: backfillUpstreams([]),
  });
  try {
    const response = await fn.handler(optionsRequest("backfill-literal-translations"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("backfill-literal-translations runs for an anonymous caller", async () => {
  // Pinned, not fixed. There is no auth check and no role check, and the client
  // it builds uses the service role — so anyone who can reach the function can
  // rewrite `transcript_lines` on any Discover video. It is also absent from
  // config.toml, so it falls to the platform's verify_jwt default rather than
  // declaring one.
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([{ id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق")] }]),
    { jwt: null },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
});

Deno.test("backfill-literal-translations writes the gloss onto each line", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق"), line("أبغى")] },
    ], { "ai.gateway.lovable.dev": literals("the-market", "want-I") }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.processed, 1);

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH");
  const saved = JSON.parse(patch?.body ?? "{}") as { transcript_lines: Array<Record<string, string>> };
  assertEquals(saved.transcript_lines[0].literal, "the-market");
  assertEquals(saved.transcript_lines[1].literal, "want-I");
  // The rest of each line survives untouched.
  assertEquals(saved.transcript_lines[0].arabic, "السوق");
  assertEquals(saved.transcript_lines[0].translation, "the market");
});

Deno.test("backfill-literal-translations skips a video that already has glosses", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق", { literal: "the-market" })] },
    ]),
  );

  assertEquals(result.status, 200);
  assertEquals((result.body.results as Array<Record<string, string>>)[0].skipped, "already has literals");
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("backfill-literal-translations redoes a done video when forced", async () => {
  const result = await call(
    "backfill-literal-translations",
    { force: true },
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق", { literal: "stale" })] },
    ], { "ai.gateway.lovable.dev": literals("fresh") }),
  );

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH");
  const saved = JSON.parse(patch?.body ?? "{}") as { transcript_lines: Array<Record<string, string>> };
  assertEquals(saved.transcript_lines[0].literal, "fresh");
});

Deno.test("backfill-literal-translations treats a blank gloss as missing", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق", { literal: "   " })] },
    ], { "ai.gateway.lovable.dev": literals("the-market") }),
  );

  assertEquals(result.status, 200);
  assert(result.calls.some((url) => url.includes("gateway")));
});

Deno.test("backfill-literal-translations skips a video with no lines", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([{ id: VIDEO, dialect: "Gulf", transcript_lines: [] }]),
  );

  assertEquals((result.body.results as Array<Record<string, string>>)[0].skipped, "no lines");
});

Deno.test("backfill-literal-translations pads a short answer rather than misaligning", async () => {
  // The model returning fewer glosses than lines is the failure that would
  // shift every later gloss onto the wrong sentence; padding keeps the
  // alignment and leaves the tail blank instead.
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق"), line("أبغى")] },
    ], { "ai.gateway.lovable.dev": literals("the-market") }),
  );

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH");
  const saved = JSON.parse(patch?.body ?? "{}") as { transcript_lines: Array<Record<string, string>> };
  assertEquals(saved.transcript_lines[0].literal, "the-market");
  assertEquals(saved.transcript_lines[1].literal, "");
});

Deno.test("backfill-literal-translations trims an over-long answer", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق")] },
    ], { "ai.gateway.lovable.dev": literals("the-market", "extra", "more") }),
  );

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH");
  const saved = JSON.parse(patch?.body ?? "{}") as { transcript_lines: unknown[] };
  assertEquals(saved.transcript_lines.length, 1);
});

Deno.test("backfill-literal-translations caps how many videos one run touches", async () => {
  const result = await call(
    "backfill-literal-translations",
    { limit: 500 },
    backfillUpstreams([]),
  );

  const read = result.calls.find((url) => url.includes("/rest/v1/discover_videos")) ?? "";
  assertStringIncludes(read, "limit=20");
});

Deno.test("backfill-literal-translations narrows to one video when asked", async () => {
  const result = await call(
    "backfill-literal-translations",
    { videoId: VIDEO },
    backfillUpstreams([{ id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق")] }]),
  );

  const read = result.calls.find((url) => url.includes("/rest/v1/discover_videos")) ?? "";
  assertStringIncludes(read, `id=eq.${VIDEO}`);
});

Deno.test("backfill-literal-translations reports a per-video failure and carries on", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    backfillUpstreams([
      { id: VIDEO, dialect: "Gulf", transcript_lines: [line("السوق")] },
    ], { "ai.gateway.lovable.dev": () => json({ error: "down" }, 503) }),
  );

  assertEquals(result.status, 200);
  const first = (result.body.results as Array<Record<string, string>>)[0];
  assertStringIncludes(first.error, "AI gateway 503");
});

Deno.test("backfill-literal-translations reports a failed read as a server error", async () => {
  const result = await call(
    "backfill-literal-translations",
    {},
    {
      "/rest/v1/discover_videos": () => json({ message: "permission denied" }, 403),
    },
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "permission denied");
});
