import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `discover-feed` — the recommender.
 *
 * No model call anywhere in it: the whole function is arithmetic over four
 * parallel reads, and that arithmetic decides what every learner sees on the
 * Discover page. Nothing downstream would notice it going wrong, because a bad
 * ranking still looks like a ranking.
 *
 * The weighting has a specific pedagogy behind it. The sweet spot is 80–95% of
 * a video's words already known — comprehensible input, not comprehension. Too
 * easy scores *lower* than the sweet spot rather than higher, which is the
 * counter-intuitive half and the one a well-meaning simplification would
 * flatten. A learner with almost no vocabulary and no placement level gets a
 * completely different formula, because the usual one has nothing to work with.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** 25 known words: enough to clear the cold-start floor of 20. */
const knownVocabulary = (words: string[]) =>
  words.map((word_arabic) => ({ word_arabic, dialect: "Gulf" }));

const MANY_WORDS = Array.from({ length: 25 }, (_, i) => `كلمة${i}`);

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated", sub: USER }),
    "/rest/v1/profiles": () => json({ preferred_dialect: "Gulf", placement_level: "B1" }),
    "/rest/v1/user_vocabulary": () => json(knownVocabulary(MANY_WORDS)),
    "/rest/v1/video_views": () => json([]),
    "/rest/v1/video_likes": () => json([]),
    "/rest/v1/discover_videos": () => json([]),
    ...extra,
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const aVideo = (over: Record<string, unknown> = {}) => ({
  id: "vid-1",
  dialect: "Gulf",
  difficulty: "Intermediate",
  cefr_level: "B1",
  created_at: daysAgo(3),
  vocabulary: MANY_WORDS.slice(0, 10).map((word_arabic) => ({ word_arabic })),
  title: "A clip",
  ...over,
});

interface FeedItem {
  video_id: string;
  score: number;
  comprehension: number;
  reason: string;
  bucket: string;
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  jwt?: string | null,
) {
  const fn = await loadFunction("discover-feed", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("discover-feed", body, jwt === undefined ? {} : { jwt }),
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
      items: (parsed.items ?? []) as FeedItem[],
      calls: fn.calls.map((c) => c.url),
    };
  } finally {
    fn.restore();
  }
}

/** Rank two videos against each other and report which came first. */
async function rank(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  upstreams: Record<string, UpstreamHandler> = {},
) {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo(a), aVideo(b)]),
      ...upstreams,
    }),
  );
  return items.map((i) => i.video_id);
}

Deno.test("discover-feed ranks and explains every candidate", async () => {
  const { status, items } = await call(
    { seed: 1 },
    caller({ "/rest/v1/discover_videos": () => json([aVideo()]) }),
  );

  assertEquals(status, 200);
  assertEquals(items.length, 1);
  assertEquals(items[0].video_id, "vid-1");
  // The reason is rendered as a chip on the card. A feed that cannot say why it
  // picked something is indistinguishable from a random one.
  assert(items[0].reason.length > 0);
  assert(typeof items[0].score === "number");
});

Deno.test("discover-feed prefers the comprehensible-input sweet spot over easier video", async () => {
  const order = await rank(
    // 10 words, all known → 100% overlap. Too easy.
    { id: "too-easy", vocabulary: MANY_WORDS.slice(0, 10).map((w) => ({ word_arabic: w })) },
    // 10 words, 9 known → 90% overlap. The sweet spot.
    {
      id: "sweet-spot",
      vocabulary: [
        ...MANY_WORDS.slice(0, 9).map((w) => ({ word_arabic: w })),
        { word_arabic: "جديدة" },
      ],
    },
  );

  // The counter-intuitive half: a video the learner understands completely
  // scores *lower* than one with a word or two they do not. Comprehensible
  // input means one step beyond, not zero steps.
  assertEquals(order[0], "sweet-spot");
});

Deno.test("discover-feed prefers the sweet spot over something far too hard", async () => {
  const order = await rank(
    { id: "too-hard", vocabulary: [{ word_arabic: "غريبة1" }, { word_arabic: "غريبة2" }] },
    {
      id: "sweet-spot",
      vocabulary: [
        ...MANY_WORDS.slice(0, 9).map((w) => ({ word_arabic: w })),
        { word_arabic: "جديدة" },
      ],
    },
  );

  assertEquals(order[0], "sweet-spot");
});

Deno.test("discover-feed labels the sweet spot with the percentage known", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () =>
        json([
          aVideo({
            vocabulary: [
              ...MANY_WORDS.slice(0, 9).map((w) => ({ word_arabic: w })),
              { word_arabic: "جديدة" },
            ],
          }),
        ]),
    }),
  );

  assertEquals(items[0].reason, "تعرف 90% من كلماته");
  assertEquals(items[0].bucket, "match");
});

Deno.test("discover-feed calls a too-easy video a review rather than a match", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () =>
        json([aVideo({ vocabulary: MANY_WORDS.slice(0, 10).map((w) => ({ word_arabic: w })) })]),
    }),
  );

  // Still worth watching, just not as new input. The bucket is what the variety
  // guarantee later reaches for.
  assertEquals(items[0].reason, "مراجعة سهلة");
  assertEquals(items[0].bucket, "comfort");
});

Deno.test("discover-feed calls a partly-known video a stretch", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () =>
        json([
          aVideo({
            vocabulary: [
              ...MANY_WORDS.slice(0, 6).map((w) => ({ word_arabic: w })),
              { word_arabic: "غريبة1" },
              { word_arabic: "غريبة2" },
              { word_arabic: "غريبة3" },
              { word_arabic: "غريبة4" },
            ],
          }),
        ]),
    }),
  );

  assertEquals(items[0].reason, "وسّع مفرداتك");
  assertEquals(items[0].bucket, "stretch");
});

Deno.test("discover-feed says when it picked something because you liked it", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo()]),
      "/rest/v1/video_likes": () => json([{ video_id: "vid-1" }]),
    }),
  );

  // Beats every other reason, because it is the only one the learner
  // themselves supplied.
  assertEquals(items[0].reason, "لأنك أعجبت به");
});

Deno.test("discover-feed folds Arabic spelling variants when matching vocabulary", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/user_vocabulary": () =>
        json(knownVocabulary([...MANY_WORDS.slice(0, 24), "مدرسة"])),
      "/rest/v1/discover_videos": () =>
        json([
          aVideo({
            vocabulary: [
              ...MANY_WORDS.slice(0, 9).map((w) => ({ word_arabic: w })),
              // Same word, ta marbuta written as ha.
              { word_arabic: "مدرسه" },
            ],
          }),
        ]),
    }),
  );

  // 100% known once folded. Without the normalisation the learner is shown a
  // "new" word they already have, and the ranking is wrong for every video
  // containing one.
  assertEquals(items[0].comprehension, 1);
});

Deno.test("discover-feed reads vocabulary in any of the shapes it is stored in", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () =>
        json([
          aVideo({
            vocabulary: [
              "كلمة0",
              { arabic: "كلمة1" },
              { lemma: "كلمة2" },
              { word: "كلمة3" },
              { word_arabic: "كلمة4" },
            ],
          }),
        ]),
    }),
  );

  // `vocabulary` is a JSON column written by several different generators over
  // time. Reading only one shape silently scores older videos as having no
  // words at all.
  assertEquals(items[0].comprehension, 1);
});

Deno.test("discover-feed gives a video with no vocabulary a neutral comprehension", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({ "/rest/v1/discover_videos": () => json([aVideo({ vocabulary: [] })]) }),
  );

  // 0.5 rather than 0. An untagged video is unknown, not incomprehensible, and
  // scoring it as the latter would bury everything the pipeline has not
  // processed yet.
  assertEquals(items[0].comprehension, 0.5);
});

Deno.test("discover-feed prefers a video at the learner's own CEFR level", async () => {
  const order = await rank(
    { id: "far-off", cefr_level: "C2" },
    { id: "on-level", cefr_level: "B1" },
  );

  assertEquals(order[0], "on-level");
});

Deno.test("discover-feed falls back to the coarse difficulty for legacy rows", async () => {
  const order = await rank(
    { id: "legacy-hard", cefr_level: null, difficulty: "Expert" },
    { id: "legacy-right", cefr_level: null, difficulty: "Intermediate" },
  );

  // `cefr_level` is set by `rate-video-cefr` and older rows predate it. Without
  // the fallback every legacy video would be treated as B1 and the level
  // signal would vanish for exactly the videos that need it most.
  assertEquals(order[0], "legacy-right");
});

Deno.test("discover-feed prefers the learner's dialect over MSA", async () => {
  const order = await rank({ id: "msa", dialect: "MSA" }, { id: "gulf", dialect: "Gulf" });

  assertEquals(order[0], "gulf");
});

Deno.test("discover-feed asks only for the learner's dialect and MSA", async () => {
  const { calls } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () => json({ preferred_dialect: "Egyptian", placement_level: "B1" }),
      "/rest/v1/discover_videos": () => json([]),
    }),
  );

  const query = decodeURIComponent(calls.find((u) => u.includes("discover_videos")) ?? "");
  // Filtered in the query rather than after the fact, so an Egyptian learner
  // never pays to rank three hundred Gulf videos.
  assert(query.includes("Egyptian"));
  assert(query.includes("MSA"));
  assert(query.includes("published=eq.true"));
});

Deno.test("discover-feed prefers a newer video when everything else ties", async () => {
  const order = await rank(
    { id: "old", created_at: daysAgo(120) },
    { id: "new", created_at: daysAgo(1) },
  );

  assertEquals(order[0], "new");
});

Deno.test("discover-feed hides something finished recently", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo({ id: "watched" }), aVideo({ id: "fresh" })]),
      "/rest/v1/video_views": () =>
        json([{ video_id: "watched", completed: true, watched_at: daysAgo(2) }]),
    }),
  );

  // A hard filter, not a penalty: a video watched to the end two days ago has
  // nothing left to teach this week.
  assertEquals(items.map((i) => i.video_id), ["fresh"]);
});

Deno.test("discover-feed brings a finished video back after a fortnight", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo({ id: "watched" })]),
      "/rest/v1/video_views": () =>
        json([{ video_id: "watched", completed: true, watched_at: daysAgo(20) }]),
    }),
  );

  assertEquals(items.length, 1);
});

Deno.test("discover-feed keeps showing a finished video the learner liked", async () => {
  const { items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo({ id: "loved" })]),
      "/rest/v1/video_views": () =>
        json([{ video_id: "loved", completed: true, watched_at: daysAgo(1) }]),
      "/rest/v1/video_likes": () => json([{ video_id: "loved" }]),
    }),
  );

  // The like is an explicit "show me this again", and it overrides the
  // recently-finished filter.
  assertEquals(items.length, 1);
});

Deno.test("discover-feed drops anything the caller has already got", async () => {
  const { items } = await call(
    { seed: 1, exclude_ids: ["seen-1"] },
    caller({
      "/rest/v1/discover_videos": () => json([aVideo({ id: "seen-1" }), aVideo({ id: "new-1" })]),
    }),
  );

  // Infinite scroll: the client sends what it is already holding so page two
  // does not repeat page one.
  assertEquals(items.map((i) => i.video_id), ["new-1"]);
});

Deno.test("discover-feed gives the same seed the same order", async () => {
  const videos = Array.from({ length: 8 }, (_, i) =>
    aVideo({ id: `vid-${i}`, created_at: daysAgo(3) }));

  const first = await call(
    { seed: 42 },
    caller({ "/rest/v1/discover_videos": () => json(videos) }),
  );
  const second = await call(
    { seed: 42 },
    caller({ "/rest/v1/discover_videos": () => json(videos) }),
  );

  // The jitter inside a score band is seeded, so paging through a feed does not
  // reshuffle what the learner already scrolled past.
  assertEquals(
    first.items.map((i) => i.video_id),
    second.items.map((i) => i.video_id),
  );
  assertEquals(first.body.seed, 42);
});

Deno.test("discover-feed switches formula for a learner with nothing to go on", async () => {
  const { body, items } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () => json({ preferred_dialect: "Gulf", placement_level: null }),
      "/rest/v1/user_vocabulary": () => json(knownVocabulary(["كلمة0", "كلمة1"])),
      "/rest/v1/discover_videos": () => json([aVideo({ id: "a" }), aVideo({ id: "b" })]),
    }),
  );

  // Under 20 known words and no placement level. Vocabulary overlap and CEFR
  // distance are both meaningless here, so the score is freshness, dialect and
  // engagement only — and the flag lets the page say so.
  assertEquals(body.cold_start, true);
  assertEquals(items.length, 2);
});

Deno.test("discover-feed is not cold-started by a placement level alone", async () => {
  const { body } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () => json({ preferred_dialect: "Gulf", placement_level: "A2" }),
      "/rest/v1/user_vocabulary": () => json(knownVocabulary(["كلمة0"])),
      "/rest/v1/discover_videos": () => json([aVideo()]),
    }),
  );

  // A learner who took the placement quiz but has saved nothing still has a
  // level to rank against.
  assertEquals(body.cold_start, false);
});

Deno.test("discover-feed reads the per-dialect placement level", async () => {
  const { body } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () =>
        json({
          preferred_dialect: "Egyptian",
          placement_level: "C1",
          placement_level_egyptian: "A2",
        }),
      "/rest/v1/discover_videos": () => json([]),
    }),
  );

  // Level is per dialect — someone advanced in Gulf may be a beginner in
  // Egyptian, and ranking them against their Gulf level would bury everything
  // they could actually watch.
  assertEquals(body.cefr, "A2");
});

Deno.test("discover-feed falls back to the shared placement level", async () => {
  const { body } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () => json({ preferred_dialect: "Yemeni", placement_level: "B2" }),
      "/rest/v1/discover_videos": () => json([]),
    }),
  );

  assertEquals(body.cefr, "B2");
});

Deno.test("discover-feed honours the requested size within limits", async () => {
  const videos = Array.from({ length: 30 }, (_, i) => aVideo({ id: `vid-${i}` }));

  for (const [limit, expected] of [[5, 5], [200, 30], [0, 30]] as const) {
    const { items } = await call(
      { seed: 1, limit },
      caller({ "/rest/v1/discover_videos": () => json(videos) }),
    );

    // Clamped to 1..50. An unbounded limit would let a client ask for the whole
    // candidate pool in one request.
    assert(items.length <= expected, `limit ${limit} returned ${items.length}`);
  }
});

Deno.test("discover-feed defaults to Gulf for a learner with no profile row", async () => {
  const { status, body } = await call(
    { seed: 1 },
    caller({
      "/rest/v1/profiles": () => json(null),
      "/rest/v1/discover_videos": () => json([]),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.active_dialect, "Gulf");
});

Deno.test("discover-feed refuses a caller with no bearer token", async () => {
  const { status, calls } = await call({ seed: 1 }, caller(), null);

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("discover_videos")));
});

Deno.test("discover-feed works with no body at all", async () => {
  const fn = await loadFunction("discover-feed", {
    upstreams: caller({ "/rest/v1/discover_videos": () => json([aVideo()]) }),
  });
  try {
    const response = await fn.handler(
      new Request("http://localhost/discover-feed", {
        method: "POST",
        headers: {
          origin: "https://ingleezy.app",
          authorization: `Bearer ${fixtureJwt()}`,
        },
      }),
    );

    // The body parse is caught and defaulted, so a bare POST returns a feed
    // seeded from the clock rather than throwing.
    assertEquals(response.status, 200);
    const body = await response.json();
    assert(typeof body.seed === "number");
  } finally {
    fn.restore();
  }
});
