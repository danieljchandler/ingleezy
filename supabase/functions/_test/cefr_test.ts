import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `rate-video-cefr` — what decides how hard a Discover video is.
 *
 * The design is a deterministic floor plus a bounded LLM adjustment, and that
 * shape is the point: an earlier version asked a model outright and got
 * "Intermediate" for almost everything, which made the whole difficulty signal
 * useless. Now the metrics compute a floor, the model may move it by one step
 * with a reason, and an unavailable or nonsensical model falls back to the
 * floor rather than to a default.
 *
 * That matters downstream. `discover-feed` ranks on `cefr_level`, so a rating
 * that collapses to one value collapses the recommender with it — and nothing
 * would report the failure, because every video would still have a level.
 *
 * Since the retarget there are two modes: transcripts whose lines carry
 * `english` are the app's primary content, rated against an English A1/A2
 * baseline; lines without it are the Hakiya-bridged Arabic immersion clips,
 * rated exactly as before. The Arabic fixtures below therefore double as the
 * bridge-mode regression suite.
 */

const VIDEO_ID = "33333333-0000-4000-8000-000000000000";

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/rest/v1/discover_videos": () => json(null),
    "ai.gateway.lovable.dev": () => chatCompletion(JSON.stringify({ cefr_level: "B1", rationale: "Routine." })),
    ...extra,
  };
}

/** A line of transcript. Words are repeated to control the token counts. */
const lines = (...texts: string[]) => texts.map((arabic, i) => ({ arabic, id: `l${i}` }));

/** N distinct long, rare words — the combination that drives the floor up. */
const hardLine = (n: number) =>
  Array.from({ length: n }, (_, i) => `استقلالية${i}`).join(" ");

/** N repetitions of a single very common word. */
const easyLine = (n: number) => Array.from({ length: n }, () => "في").join(" ");

async function call(body: unknown, routes: Record<string, UpstreamHandler> = upstreams()) {
  const fn = await loadFunction("rate-video-cefr", { upstreams: routes });
  try {
    const response = await fn.handler(jsonRequest("rate-video-cefr", body));
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

/** The model, answering with a level. */
const rating = (cefr_level: string, rationale = "Because."): UpstreamHandler => () =>
  chatCompletion(JSON.stringify({ cefr_level, rationale }));

Deno.test("rate-video-cefr returns a level, a difficulty and its evidence", async () => {
  const { status, body } = await call(
    { transcript_lines: lines("الجو حلو اليوم", "شفت الأسعار") },
    upstreams({ "ai.gateway.lovable.dev": rating("A2", "Short concrete sentences.") }),
  );

  assertEquals(status, 200);
  assertEquals(body.cefr_level, "A2");
  // The coarse bucket is derived, not stored separately — the two cannot drift.
  assertEquals(body.difficulty, "Beginner");
  assertEquals(body.rationale, "Short concrete sentences.");
  assert(body.metrics);
  assert(body.metric_floor);
});

Deno.test("rate-video-cefr maps each level to its coarse bucket", async () => {
  for (
    const [level, difficulty] of [
      ["A1", "Beginner"],
      ["A2", "Beginner"],
      ["B1", "Intermediate"],
      ["B2", "Intermediate"],
    ] as const
  ) {
    const { body } = await call(
      { transcript_lines: lines("الجو حلو اليوم") },
      upstreams({ "ai.gateway.lovable.dev": rating(level) }),
    );

    // Two learners at A1 and A2 both see "Beginner"; the fine level is what
    // the feed actually ranks on.
    assertEquals(body.difficulty, difficulty, `for ${level}`);
  }
});

Deno.test("rate-video-cefr rates a short, simple clip at the bottom", async () => {
  const { body } = await call(
    { transcript_lines: lines(easyLine(10)) },
    upstreams({ "ai.gateway.lovable.dev": rating("A1") }),
  );

  // Under 25 tokens with almost no rare words is A1 outright, ahead of the
  // scoring — a ten-word greeting clip is not "intermediate" no matter what
  // the other ratios say about such a small sample.
  assertEquals(body.metric_floor, "A1");
});

Deno.test("rate-video-cefr rates dense, rare, long-worded speech higher", async () => {
  const { body } = await call(
    {
      transcript_lines: lines(hardLine(14), hardLine(14), hardLine(14)),
      duration_seconds: 12,
    },
    upstreams({ "ai.gateway.lovable.dev": rating("C1") }),
  );

  const floor = String(body.metric_floor);
  // Every signal pushed at once: rare words, long words, high type/token,
  // long lines, fast speech. The floor has to actually move — the failure this
  // design exists to prevent is everything landing on one level.
  assert(["B2", "C1", "C2"].includes(floor), `floor was ${floor}`);
});

Deno.test("rate-video-cefr separates two clips of different difficulty", async () => {
  const easy = await call(
    { transcript_lines: lines(easyLine(15), easyLine(15)) },
    upstreams({ "ai.gateway.lovable.dev": rating("A1") }),
  );
  const hard = await call(
    { transcript_lines: lines(hardLine(14), hardLine(14), hardLine(14)), duration_seconds: 12 },
    upstreams({ "ai.gateway.lovable.dev": rating("C1") }),
  );

  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  // The property that matters more than any single threshold: two genuinely
  // different clips must not come out the same.
  assert(
    order.indexOf(String(hard.body.metric_floor)) >
      order.indexOf(String(easy.body.metric_floor)),
    `${easy.body.metric_floor} vs ${hard.body.metric_floor}`,
  );
});

Deno.test("rate-video-cefr counts speech rate only when the duration is known", async () => {
  const timed = await call(
    { transcript_lines: lines(hardLine(20)), duration_seconds: 5 },
    upstreams({ "ai.gateway.lovable.dev": rating("B2") }),
  );
  const untimed = await call(
    { transcript_lines: lines(hardLine(20)) },
    upstreams({ "ai.gateway.lovable.dev": rating("B2") }),
  );

  const timedMetrics = timed.body.metrics as Record<string, unknown>;
  const untimedMetrics = untimed.body.metrics as Record<string, unknown>;
  // Null rather than zero: an unknown duration must not read as "spoken
  // infinitely slowly" and drag the floor down.
  assertEquals(untimedMetrics.words_per_minute, null);
  assert(typeof timedMetrics.words_per_minute === "number");
});

Deno.test("rate-video-cefr counts idiomatic vocabulary from either field", async () => {
  const { body } = await call(
    {
      transcript_lines: lines("الجو حلو اليوم"),
      vocabulary: [
        { arabic: "أ", tags: ["idiom"] },
        { arabic: "ب", types: ["colloquial"] },
        { arabic: "ج", note: "a common saying" },
        { arabic: "د", usage_note: "an expression used at weddings" },
        { arabic: "ه" },
      ],
    },
    upstreams({ "ai.gateway.lovable.dev": rating("B1") }),
  );

  const metrics = body.metrics as Record<string, unknown>;
  // The vocabulary column has been written by several generators with
  // different field names. Reading one undercounts idiom density, which is one
  // of the strongest difficulty signals there is.
  assertEquals(metrics.vocab_items_marked_idiomatic, 4);
  assertEquals(metrics.vocab_items_total, 5);
});

Deno.test("rate-video-cefr reads a line from either text field", async () => {
  const { body } = await call(
    { transcript_lines: [{ arabic: "الجو حلو" }, { text: "شفت الأسعار" }] },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const metrics = body.metrics as Record<string, unknown>;
  // Transcript lines carry `arabic` from the analyser and `text` from the ASR
  // legs; reading one halves the token count for half the library.
  assertEquals(metrics.total_lines, 2);
  assertEquals(metrics.total_tokens, 4);
});

Deno.test("rate-video-cefr ignores blank lines", async () => {
  const { body } = await call(
    { transcript_lines: [{ arabic: "الجو حلو" }, { arabic: "   " }, { text: "" }, {}] },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const metrics = body.metrics as Record<string, unknown>;
  // A blank line counted as a line drags the average words-per-line down and
  // makes a dense clip look simple.
  assertEquals(metrics.total_lines, 1);
});

Deno.test("rate-video-cefr gives the model the metrics and the floor", async () => {
  const { bodies, calls } = await call(
    { transcript_lines: lines("الجو حلو اليوم"), dialect: "Egyptian" },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const prompt = bodies[calls.findIndex((u) => u.includes("chat/completions"))] ?? "";
  // The floor is stated so the model adjusts rather than guesses, and it is
  // told the ceiling on how far it may move.
  assertStringIncludes(prompt, "metric-based floor estimate");
  assertStringIncludes(prompt, "at most ONE step");
  assertStringIncludes(prompt, "rare-word ratio");
  assertStringIncludes(prompt, "Egyptian");
});

Deno.test("rate-video-cefr tells the model not to default to the middle", async () => {
  const { bodies, calls } = await call(
    { transcript_lines: lines("الجو حلو اليوم") },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const prompt = bodies[calls.findIndex((u) => u.includes("chat/completions"))] ?? "";
  // The whole reason this function was rewritten: the previous prompt produced
  // "Intermediate" for nearly every video.
  assertStringIncludes(prompt, "Never default to B1");
});

Deno.test("rate-video-cefr falls back to the floor when the model is unavailable", async () => {
  const { status, body } = await call(
    { transcript_lines: lines("الجو حلو اليوم") },
    upstreams({ "ai.gateway.lovable.dev": () => json({ error: "down" }, 503) }),
  );

  // A video with no level at all would be unrankable. The metrics alone are a
  // worse answer than the metrics plus a model, and a far better one than none.
  assertEquals(status, 200);
  assertEquals(body.cefr_level, body.metric_floor);
  assertStringIncludes(String(body.rationale), "LLM unavailable");
});

Deno.test("rate-video-cefr falls back to the floor for an invalid level", async () => {
  for (const level of ["Intermediate", "", "Z9", "b1 maybe"]) {
    const { body } = await call(
      { transcript_lines: lines("الجو حلو اليوم") },
      upstreams({ "ai.gateway.lovable.dev": rating(level) }),
    );

    // The value is written to a column the feed compares against a fixed
    // ladder, so anything off the ladder makes the video unrankable rather
    // than misranked.
    assertEquals(body.cefr_level, body.metric_floor, `for "${level}"`);
    assertStringIncludes(String(body.rationale), "invalid level");
  }
});

Deno.test("rate-video-cefr accepts a lower-case level from the model", async () => {
  const { body } = await call(
    { transcript_lines: lines("الجو حلو اليوم") },
    upstreams({ "ai.gateway.lovable.dev": rating("b2") }),
  );

  assertEquals(body.cefr_level, "B2");
});

Deno.test("rate-video-cefr caps the rationale it stores", async () => {
  const { body } = await call(
    { transcript_lines: lines("الجو حلو اليوم") },
    upstreams({ "ai.gateway.lovable.dev": rating("B1", "x".repeat(2000)) }),
  );

  // Shown to an admin in a table cell; an unbounded essay from the model would
  // make the row unreadable.
  assertEquals(String(body.rationale).length, 600);
});

// ── English mode ────────────────────────────────────────────────────────────

/** English transcript lines; the arabic on each is scaffold, not content. */
const englishLines = (...texts: string[]) =>
  texts.map((english, i) => ({ english, arabic: `سطر ${i}`, id: `l${i}` }));

/** N distinct long, rare English words. */
const hardEnglishLine = (n: number) =>
  Array.from({ length: n }, (_, i) => `bureaucratisation${i}`).join(" ");

const easyEnglishLine = (n: number) => Array.from({ length: n }, () => "the").join(" ");

Deno.test("rate-video-cefr rates an English transcript as an English video", async () => {
  const { bodies, calls } = await call(
    { transcript_lines: englishLines("I went to the market today", "It was very busy") },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const prompt = bodies[calls.findIndex((u) => u.includes("chat/completions"))] ?? "";
  // The prompt has to say what is being rated, for whom, and against which
  // descriptors — phrasal verbs and connected speech are English difficulty,
  // not Arabic's dialect markers.
  assertStringIncludes(prompt, "ENGLISH video for Arabic-speaking English learners");
  assertStringIncludes(prompt, "phrasal verbs");
  assert(!prompt.includes("DIALECT NOTE"));
});

Deno.test("rate-video-cefr measures the English, not its Arabic scaffold", async () => {
  const { body } = await call(
    { transcript_lines: englishLines("I went to the market", "It was busy") },
    upstreams({ "ai.gateway.lovable.dev": rating("A1") }),
  );

  const metrics = body.metrics as Record<string, unknown>;
  // Each line carries its scaffold translation; counting those tokens would
  // rate every English video partly on the Arabic bolted to it.
  assertEquals(metrics.total_lines, 2);
  assertEquals(metrics.total_tokens, 8);
});

Deno.test("rate-video-cefr floors simple English at the bottom", async () => {
  const { body } = await call(
    { transcript_lines: englishLines(easyEnglishLine(10)) },
    upstreams({ "ai.gateway.lovable.dev": rating("A1") }),
  );

  assertEquals(body.metric_floor, "A1");
});

Deno.test("rate-video-cefr separates easy from hard English", async () => {
  const easy = await call(
    { transcript_lines: englishLines(easyEnglishLine(15), easyEnglishLine(15)) },
    upstreams({ "ai.gateway.lovable.dev": rating("A1") }),
  );
  const hard = await call(
    {
      transcript_lines: englishLines(hardEnglishLine(14), hardEnglishLine(14), hardEnglishLine(14)),
      duration_seconds: 12,
    },
    upstreams({ "ai.gateway.lovable.dev": rating("C1") }),
  );

  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  // Same property the Arabic mode pins: two genuinely different clips must
  // not come out the same — the English baseline has to do real work.
  assert(
    order.indexOf(String(hard.body.metric_floor)) >
      order.indexOf(String(easy.body.metric_floor)),
    `${easy.body.metric_floor} vs ${hard.body.metric_floor}`,
  );
});

Deno.test("rate-video-cefr keeps the Arabic path for a bridged clip", async () => {
  const { bodies, calls } = await call(
    { transcript_lines: lines("الجو حلو اليوم"), dialect: "Gulf" },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  const prompt = bodies[calls.findIndex((u) => u.includes("chat/completions"))] ?? "";
  // A transcript with no English lines is Hakiya-bridged immersion content;
  // it keeps the dialect-aware Arabic rating rather than being measured
  // against an English baseline it would fail entirely.
  assertStringIncludes(prompt, "Gulf Arabic video");
  assertStringIncludes(prompt, "DIALECT NOTE");
});

Deno.test("rate-video-cefr rates a stored video and writes the result back", async () => {
  const { status, calls, bodies } = await call(
    { videoId: VIDEO_ID },
    upstreams({
      "/rest/v1/discover_videos": () =>
        json({
          transcript_lines: lines("الجو حلو اليوم", "شفت الأسعار"),
          duration_seconds: 20,
          vocabulary: [],
          dialect: "Gulf",
        }),
      "ai.gateway.lovable.dev": rating("A2", "Concrete topics."),
    }),
  );

  assertEquals(status, 200);
  const update = bodies[
    calls.findIndex((u, i) =>
      u.includes("discover_videos") && (bodies[i] ?? "").includes("cefr_level")
    )
  ] ?? "";
  // The metrics are stored alongside the level so an admin questioning a
  // rating can see what it was based on rather than re-deriving it.
  assertStringIncludes(update, '"cefr_level":"A2"');
  assertStringIncludes(update, '"difficulty":"Beginner"');
  assertStringIncludes(update, "difficulty_metrics");
  assertStringIncludes(update, "Concrete topics.");
});

Deno.test("rate-video-cefr rates an inline transcript without writing anything", async () => {
  const { status, calls } = await call(
    { transcript_lines: lines("الجو حلو اليوم") },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  // The pipeline calls this with a videoId; the admin form calls it with a
  // draft transcript that is not saved yet.
  assertEquals(status, 200);
  assert(!calls.some((u) => u.includes("discover_videos")));
});

Deno.test("rate-video-cefr refuses a video with no transcript", async () => {
  const { status, body, calls } = await call(
    { transcript_lines: [] },
    upstreams({ "ai.gateway.lovable.dev": rating("A2") }),
  );

  // There is nothing to measure. Rating it anyway would produce a confident
  // A1 for every video whose transcription failed.
  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "no transcript lines");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("rate-video-cefr reports an unknown video", async () => {
  const { status, body } = await call(
    { videoId: VIDEO_ID },
    upstreams({ "/rest/v1/discover_videos": () => json(null) }),
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "video not found");
});
