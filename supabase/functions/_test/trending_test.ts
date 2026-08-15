import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `discover-trending-videos` — the YouTube crawler behind /admin/trending.
 *
 * Almost all of its behaviour is filtering, and every filter is there because
 * something unsuitable reached the admin queue: clips that are not in English,
 * clips with no speech in them at all, gaming, videos too long to be Shorts,
 * and videos with too few views to be worth a transcription budget.
 *
 * Post-flip it searches the US and the UK with two randomly chosen queries
 * each, so the fixtures answer both regions identically and the
 * de-duplication decides which bucket a video lands in.
 */

const USER = "00000000-0000-4000-8000-000000000001";

interface Snippet {
  title: string;
  description?: string;
  channelTitle?: string;
  channelId?: string;
  categoryId?: string;
  thumbnails?: Record<string, { url: string }>;
}

/** One entry as the YouTube videos endpoint returns it. */
function video(
  id: string,
  snippet: Snippet,
  statistics: Record<string, string> = { viewCount: "50000", likeCount: "5000", commentCount: "500" },
  duration = "PT45S",
) {
  return {
    id,
    snippet: {
      channelTitle: "A creator",
      channelId: "UC-fixture",
      thumbnails: { high: { url: "https://i.ytimg.com/high.jpg" }, medium: { url: "https://i.ytimg.com/med.jpg" } },
      ...snippet,
    },
    statistics,
    contentDetails: { duration },
  };
}

/**
 * Routes are matched longest-first, and the default table already carries
 * `www.googleapis.com/youtube` — so a shorter key like `youtube/v3/search`
 * loses to it and every search silently answers with an empty list.
 */
function youtube(videos: Array<ReturnType<typeof video>>): Record<string, UpstreamHandler> {
  return {
    "googleapis.com/youtube/v3/search": () =>
      json({ items: videos.map((v) => ({ id: { videoId: v.id } })) }),
    "googleapis.com/youtube/v3/videos": () => json({ items: videos }),
  };
}

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

interface Candidate {
  video_id: string;
  url: string;
  title: string;
  creator_name: string;
  creator_handle: string;
  thumbnail_url: string | null;
  view_count: number;
  trending_score: number;
  detected_topic: string;
  region_code: string;
  duration_seconds: number | null;
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("discover-trending-videos", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("discover-trending-videos", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      candidates: (parsed.candidates ?? []) as Candidate[],
      calls: fn.calls.map((c) => c.url),
    };
  } finally {
    fn.restore();
  }
}

const englishClip = () =>
  video("vid-1", { title: "A day in my life in London", description: "vlog" });

Deno.test("discover-trending-videos answers the preflight", async () => {
  const fn = await loadFunction("discover-trending-videos", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("discover-trending-videos"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("discover-trending-videos will not run for an anonymous caller", async () => {
  // It drives the paid YouTube Data API, so the cap's auth check is the point
  // rather than the daily allowance.
  const result = await call({}, caller(youtube([englishClip()])), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("discover-trending-videos says so when it has no API key", async () => {
  const result = await call({}, caller(youtube([])), { env: { YOUTUBE_API_KEY: undefined } });

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "YouTube API key not configured");
});

Deno.test("discover-trending-videos returns a candidate per accepted video", async () => {
  const result = await call({}, caller(youtube([englishClip()])));

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.candidates_found, 1);

  const found = result.candidates[0];
  assertEquals(found.video_id, "vid-1");
  assertEquals(found.url, "https://www.youtube.com/shorts/vid-1");
  assertEquals(found.title, "A day in my life in London");
  assertEquals(found.creator_name, "A creator");
  assertEquals(found.creator_handle, "UC-fixture");
  assertEquals(found.thumbnail_url, "https://i.ytimg.com/high.jpg");
  assertEquals(found.duration_seconds, 45);
});

Deno.test("discover-trending-videos counts each region separately", async () => {
  const result = await call({}, caller(youtube([englishClip()])));

  const summary = result.body.region_summary as Record<string, number>;
  // Both regions are reported, even an empty one — an admin needs to see that
  // the UK returned nothing rather than that the UK was not searched.
  assertEquals(Object.keys(summary).sort(), ["GB", "US"]);
  // Deduplication is global, so an identical video across every region lands in
  // exactly one bucket.
  assertEquals(Object.values(summary).reduce((a, b) => a + b, 0), 1);
});

Deno.test("discover-trending-videos falls back to the medium thumbnail", async () => {
  const result = await call(
    {},
    caller(youtube([
      video("vid-1", {
        title: "A day in my life",
        thumbnails: { medium: { url: "https://i.ytimg.com/med.jpg" } },
      }),
    ])),
  );

  assertEquals(result.candidates[0].thumbnail_url, "https://i.ytimg.com/med.jpg");
});

Deno.test("discover-trending-videos accepts a video with no thumbnail at all", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life", thumbnails: {} })])),
  );

  assertEquals(result.candidates[0].thumbnail_url, null);
});

Deno.test("discover-trending-videos drops a title that is not in English", async () => {
  // regionCode and relevanceLanguage are ranking hints, not filters: a US
  // crawl returns plenty of Shorts in other languages, and the transcription
  // budget is spent before anyone notices.
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "يوميات في الرياض", description: "vlog" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos judges the title by proportion, not by presence", async () => {
  // A contains-a-Latin-letter check would keep this: one English loanword in
  // an otherwise Arabic title, on a video nobody speaks English in.
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "أفضل vlog", description: "" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos reads the title, not the description", async () => {
  // Descriptions are boilerplate, hashtags and links, often in whatever
  // language the uploader's template happens to be in.
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "Street interview in London", description: "يوميات" })])),
  );

  assertEquals(result.body.candidates_found, 1);
});

Deno.test("discover-trending-videos drops Shorts with no speech in them", async () => {
  // The slot Quran recitation used to occupy: content that trends hugely and
  // teaches the target language nothing, because nobody says a sentence.
  for (const title of ["Oddly satisfying slime", "Relaxing music for study", "ASMR no talking"]) {
    const result = await call({}, caller(youtube([video("vid-1", { title })])));
    assertEquals(result.body.candidates_found, 0, `${title} should be dropped`);
  }
});

Deno.test("discover-trending-videos drops music by YouTube's own category", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life", categoryId: "10" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos drops gaming by keyword", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "Fortnite with the lads", description: "" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos drops gaming by YouTube's own category", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life", categoryId: "20" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos drops a video longer than a Short", async () => {
  const result = await call(
    {},
    caller(youtube([
      video("vid-1", { title: "A day in my life" }, { viewCount: "50000" }, "PT3M1S"),
    ])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos keeps a video right on the three-minute line", async () => {
  const result = await call(
    {},
    caller(youtube([
      video("vid-1", { title: "A day in my life" }, { viewCount: "50000" }, "PT3M"),
    ])),
  );

  assertEquals(result.body.candidates_found, 1);
  assertEquals(result.candidates[0].duration_seconds, 180);
});

Deno.test("discover-trending-videos drops a video with no readable duration", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life" }, { viewCount: "50000" }, "")])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos drops a video below the view threshold", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life" }, { viewCount: "999" })])),
  );

  assertEquals(result.body.candidates_found, 0);
});

Deno.test("discover-trending-videos scores views, likes and comments together", async () => {
  const result = await call(
    {},
    caller(youtube([
      video("vid-1", { title: "A day in my life" }, {
        viewCount: "100000",
        likeCount: "10000",
        commentCount: "2000",
      }),
    ])),
  );

  // (100000/10000)*40 + (10/100 as a percentage → 10)*30 + (2000/1000)*30
  assertEquals(result.candidates[0].trending_score, 760);
});

Deno.test("discover-trending-videos scores a video with no engagement stats", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "A day in my life" }, { viewCount: "20000" })])),
  );

  assertEquals(result.candidates[0].trending_score, 80);
});

Deno.test("discover-trending-videos labels the topic it can recognise", async () => {
  const cases: Array<[string, string]> = [
    ["Quick pasta recipe", "food"],
    ["Premier League reaction", "sports"],
    ["Breaking news today", "news"],
    ["My morning routine", "lifestyle"],
    ["British slang explained", "education"],
    ["Job interview tips", "work"],
    // Three traps the first draft of these lists fell into, all of them silent:
    // a bare "ai" matched "expl-ai-ned", a bare "tips" made every beauty and
    // travel clip a lesson, and a bare "interview" filed a vox pop under work
    // — while "street interview" is one of the queries this crawler runs.
    ["Street interview in London", "general"],
    ["Makeup tips for beginners", "beauty"],
    ["What she said next", "general"],
  ];

  for (const [title, topic] of cases) {
    const result = await call({}, caller(youtube([video("vid-1", { title })])));
    assertEquals(result.candidates[0]?.detected_topic, topic, `${title} should be ${topic}`);
  }
});

Deno.test("discover-trending-videos labels an unrecognised topic as general", async () => {
  const result = await call(
    {},
    caller(youtube([video("vid-1", { title: "Something or other" })])),
  );

  assertEquals(result.candidates[0].detected_topic, "general");
});

Deno.test("discover-trending-videos searches only the last two weeks", async () => {
  const result = await call({}, caller(youtube([englishClip()])));

  const search = result.calls.find((url) => url.includes("youtube/v3/search")) ?? "";
  assertStringIncludes(search, "videoDuration=short");
  assertStringIncludes(search, "relevanceLanguage=en");
  assertStringIncludes(search, "order=viewCount");

  const publishedAfter = new URL(search).searchParams.get("publishedAfter") ?? "";
  const days = (Date.now() - new Date(publishedAfter).getTime()) / 86_400_000;
  assert(days > 13.9 && days < 14.1, `publishedAfter should be ~14 days ago, was ${days}`);
});

Deno.test("discover-trending-videos searches both English regions", async () => {
  const result = await call({}, caller(youtube([englishClip()])));

  const regions = new Set(
    result.calls
      .filter((url) => url.includes("youtube/v3/search"))
      .map((url) => new URL(url).searchParams.get("regionCode")),
  );
  assertEquals([...regions].sort(), ["GB", "US"]);
});

Deno.test("discover-trending-videos skips the details call when a search found nothing", async () => {
  const result = await call(
    {},
    caller({
      "googleapis.com/youtube/v3/search": () => json({ items: [] }),
      "googleapis.com/youtube/v3/videos": () => json({ items: [] }),
    }),
  );

  assertEquals(result.body.candidates_found, 0);
  assertEquals(result.calls.some((url) => url.includes("youtube/v3/videos")), false);
});

Deno.test("discover-trending-videos survives one region failing", async () => {
  // Pinned, not fixed. Every search runs through Promise.allSettled and a
  // rejection is logged and skipped, so a total YouTube outage returns 200
  // with zero candidates — indistinguishable from a quiet fortnight.
  const result = await call(
    {},
    caller({
      "googleapis.com/youtube/v3/search": () => json({ error: "quota exceeded" }, 403),
      "googleapis.com/youtube/v3/videos": () => json({ items: [] }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.candidates_found, 0);
});
