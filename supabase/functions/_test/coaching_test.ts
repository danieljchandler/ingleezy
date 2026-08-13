import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `pronunciation-feedback` — the tips a learner reads after being scored.
 *
 * Two entirely different prompts behind one endpoint, chosen by `mode`. The
 * shadow path coaches on the gap between what the learner said and the exact
 * words a native said in one clip, working from the per-word alignment
 * `score-shadow-attempt` produced. The legacy path coaches on Azure's phoneme
 * scores. They take different bodies, validate different fields, and the only
 * thing they share is the tool call at the end.
 *
 * What makes this worth testing is that everything interesting happens in the
 * *prompt*. There is no logic to check afterwards — the tips are whatever the
 * model returns — so the tests assert on what was asked, because a prompt that
 * quietly stopped mentioning the words the learner actually got wrong would
 * still produce plausible, useless, entirely generic advice.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/client_errors": () => json({}, 201),
    "/rest/v1/edge_errors": () => json({}, 201),
    ...extra,
  };
}

const tips = (...items: string[]): UpstreamHandler => () =>
  chatCompletion("", { tips: items });

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>) {
  const fn = await loadFunction("pronunciation-feedback", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("pronunciation-feedback", body));
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

/** The prompt the model was actually sent. */
function promptOf(bodies: Array<string | null>, calls: string[]): string {
  const i = calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ content: string }> };
  return sent.messages.at(-1)?.content ?? "";
}

const aScore = (over: Record<string, unknown> = {}) => ({
  overall: 72,
  accuracy: 70,
  fluency: 80,
  completeness: 100,
  recognizedText: "مرحبا",
  words: [
    {
      word: "مرحبا",
      accuracy: 70,
      errorType: "Mispronunciation",
      phonemes: [
        { phoneme: "ħ", accuracy: 30 },
        { phoneme: "m", accuracy: 95 },
      ],
    },
  ],
  ...over,
});

// ── The shadow path ─────────────────────────────────────────────────────────

Deno.test("pronunciation-feedback returns the tips it was given", async () => {
  const { status, body } = await call(
    {
      mode: "shadow",
      referenceText: "الجو حلو اليوم",
      recognizedText: "الجو بارد اليوم",
      closeness: 68,
      wordDiffs: [{ ref: "حلو", said: "بارد", status: "sub" }],
    },
    caller({ "ai.gateway.lovable.dev": tips("Round your lips on حلو.", "Slow down.") }),
  );

  assertEquals(status, 200);
  assertEquals((body.tips as string[]).length, 2);
});

Deno.test("pronunciation-feedback names the words the learner got wrong", async () => {
  const { bodies, calls } = await call(
    {
      mode: "shadow",
      referenceText: "الجو حلو اليوم",
      recognizedText: "الجو اليوم واجد",
      closeness: 55,
      wordDiffs: [
        { ref: "الجو", said: "الجو", status: "match" },
        { ref: "حلو", status: "missing" },
        { said: "واجد", status: "extra" },
        { ref: "اليوم", said: "اليم", status: "sub" },
      ],
    },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  const prompt = promptOf(bodies, calls);
  // Each status becomes a different phrase, because "you missed a word" and
  // "you said a different word" call for different advice. Without them the
  // model has only a score and produces advice that fits any take at all.
  assertStringIncludes(prompt, 'missed "حلو"');
  assertStringIncludes(prompt, 'added "واجد"');
  assertStringIncludes(prompt, 'said "اليم" instead of "اليوم"');
});

Deno.test("pronunciation-feedback leaves matched words out of the summary", async () => {
  const { bodies, calls } = await call(
    {
      mode: "shadow",
      referenceText: "الجو حلو",
      recognizedText: "الجو حلو",
      closeness: 100,
      wordDiffs: [
        { ref: "الجو", said: "الجو", status: "match" },
        { ref: "حلو", said: "حلو", status: "match" },
      ],
    },
    caller({ "ai.gateway.lovable.dev": tips("Work on rhythm.") }),
  );

  const prompt = promptOf(bodies, calls);
  // A perfect take still gets tips, but on rhythm and intonation rather than
  // on words — otherwise the feature has nothing to say to the learners who
  // use it most.
  assertStringIncludes(prompt, "The words matched the clip closely");
  assertStringIncludes(prompt, "rhythm/intonation");
});

Deno.test("pronunciation-feedback says so when nothing was recognised", async () => {
  const { bodies, calls } = await call(
    {
      mode: "shadow",
      referenceText: "الجو حلو",
      recognizedText: "",
      closeness: 0,
      wordDiffs: [],
    },
    caller({ "ai.gateway.lovable.dev": tips("Try recording again.") }),
  );

  const prompt = promptOf(bodies, calls);
  // An empty string interpolated here reads as the learner having said
  // nothing, which is true — but only if it is stated. Left bare it looks like
  // a prompt-building bug to the model.
  assertStringIncludes(prompt, "(nothing recognised)");
});

Deno.test("pronunciation-feedback rounds the closeness it quotes", async () => {
  const { bodies, calls } = await call(
    {
      mode: "shadow",
      referenceText: "الجو حلو",
      recognizedText: "الجو حلو",
      closeness: 67.83333,
      wordDiffs: [],
    },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  assertStringIncludes(promptOf(bodies, calls), "68/100");
});

Deno.test("pronunciation-feedback treats a missing closeness as zero", async () => {
  const { status, bodies, calls } = await call(
    { mode: "shadow", referenceText: "الجو حلو", recognizedText: "الجو" },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  assertEquals(status, 200);
  // `Math.round(undefined)` is NaN, which would be interpolated into the
  // prompt as "NaN/100".
  assertStringIncludes(promptOf(bodies, calls), "0/100");
});

Deno.test("pronunciation-feedback refuses a shadow request with no reference", async () => {
  const { status, body, calls } = await call(
    { mode: "shadow", recognizedText: "الجو" },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  // There is nothing to coach against. The clip's words *are* the lesson.
  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "referenceText is required");
  assert(!calls.some((url) => url.includes("chat/completions")));
});

// ── The Azure-scores path ───────────────────────────────────────────────────

Deno.test("pronunciation-feedback coaches from the phoneme scores", async () => {
  const { status, bodies, calls } = await call(
    { word_arabic: "مرحبا", word_english: "hello", scores: aScore(), dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": tips("Push the ح from your throat.") }),
  );

  assertEquals(status, 200);
  const prompt = promptOf(bodies, calls);
  assertStringIncludes(prompt, "Overall: 72/100");
  assertStringIncludes(prompt, "مرحبا");
});

Deno.test("pronunciation-feedback surfaces only the weak phonemes", async () => {
  const { bodies, calls } = await call(
    { word_arabic: "مرحبا", scores: aScore() },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  const prompt = promptOf(bodies, calls);
  // Under 70 only. Listing every phoneme buries the one sound worth working
  // on among a dozen the learner already says correctly.
  assertStringIncludes(prompt, "weak_phonemes=[ħ(30)]");
  assert(!prompt.includes("m(95)"));
});

Deno.test("pronunciation-feedback asks for phoneme advice on a word and fluency advice on a phrase", async () => {
  const single = await call(
    { word_arabic: "مرحبا", scores: aScore() },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );
  const phrase = await call(
    { word_arabic: "مرحبا كيف حالك", scores: aScore() },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  // A single word has no rhythm to critique; a phrase has little else worth
  // saying beyond it.
  assertStringIncludes(promptOf(single.bodies, single.calls), "Focus on phoneme-level feedback");
  assertStringIncludes(promptOf(phrase.bodies, phrase.calls), "word-level and fluency feedback");
});

Deno.test("pronunciation-feedback accepts a dialect in either vocabulary", async () => {
  for (
    const [dialect, label] of [
      ["ar-EG", "Egyptian Arabic"],
      ["Egyptian", "Egyptian Arabic"],
      ["ar-YE", "Yemeni Arabic"],
      ["Yemeni", "Yemeni Arabic"],
      ["Gulf", "Gulf Arabic"],
      ["ar-SA", "Gulf Arabic"],
      [undefined, "Gulf Arabic"],
    ] as const
  ) {
    const { bodies, calls } = await call(
      { word_arabic: "مرحبا", scores: aScore(), dialect },
      caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
    );

    // Callers reach this from two directions: the pronunciation page has an
    // Azure locale to hand, the rest of the app has the canonical dialect key.
    // Accepting one and silently defaulting the other coaches Egyptian
    // learners in Gulf.
    assertStringIncludes(
      promptOf(bodies, calls),
      label,
      `expected ${dialect} to be read as ${label}`,
    );
  }
});

Deno.test("pronunciation-feedback copes with a word that has no breakdown", async () => {
  const { status, bodies, calls } = await call(
    { word_arabic: "مرحبا", scores: aScore({ words: [] }) },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  assertEquals(status, 200);
  // "N/A" rather than an empty section, so the model is told there is no
  // breakdown instead of being handed a heading with nothing under it.
  assertStringIncludes(promptOf(bodies, calls), "N/A");
});

Deno.test("pronunciation-feedback refuses a scores request with no scores", async () => {
  const { status, body, calls } = await call(
    { word_arabic: "مرحبا" },
    caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "scores is required");
  assert(!calls.some((url) => url.includes("chat/completions")));
});

// ── Shared failure handling ─────────────────────────────────────────────────

Deno.test("pronunciation-feedback returns no tips rather than failing on a bad tool call", async () => {
  const { status, body } = await call(
    { word_arabic: "مرحبا", scores: aScore() },
    caller({
      "ai.gateway.lovable.dev": () =>
        json({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "return_tips", arguments: "{not json" } },
                ],
              },
            },
          ],
        }),
    }),
  );

  // Coaching is an extra on top of a score the learner already has. An empty
  // list hides the tips panel; a 500 would make the whole attempt look failed.
  assertEquals(status, 200);
  assertEquals(body.tips, []);
});

Deno.test("pronunciation-feedback returns no tips when the model skipped the tool", async () => {
  const { status, body } = await call(
    { word_arabic: "مرحبا", scores: aScore() },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("Sure, here are some tips!") }),
  );

  assertEquals(status, 200);
  assertEquals(body.tips, []);
});

Deno.test("pronunciation-feedback preserves 429 and 402", async () => {
  for (const [upstream, expected] of [[429, 429], [402, 402]] as const) {
    const { status } = await call(
      { word_arabic: "مرحبا", scores: aScore() },
      caller({ "ai.gateway.lovable.dev": () => json({ error: "no" }, upstream) }),
    );

    assertEquals(status, expected);
  }
});

Deno.test("pronunciation-feedback flattens any other gateway failure to 500", async () => {
  const { status, body } = await call(
    { word_arabic: "مرحبا", scores: aScore() },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503) }),
  );

  assertEquals(status, 500);
  assertEquals(body.error, "AI gateway error");
});

Deno.test("pronunciation-feedback says so when its key is missing", async () => {
  const fn = await loadFunction("pronunciation-feedback", {
    upstreams: caller({ "ai.gateway.lovable.dev": tips("A tip.") }),
    env: { LOVABLE_API_KEY: undefined },
  });
  try {
    const response = await fn.handler(
      jsonRequest("pronunciation-feedback", { word_arabic: "مرحبا", scores: aScore() }),
    );

    assertEquals(response.status, 500);
    assertStringIncludes((await response.json()).error, "LOVABLE_API_KEY");
  } finally {
    fn.restore();
  }
});
