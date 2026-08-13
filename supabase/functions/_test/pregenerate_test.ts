import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `pregenerate-daily` — the nightly batch that pre-builds daily stories, so
 * that `generate-daily-story` answers from cache instantly the next morning.
 *
 * It shares its generation core (`_shared/dailyStory.ts`) with the on-demand
 * function, whose behaviour is pinned in daily_story_test.ts — so these tests
 * are about the batch policy, not the story: who may trigger a run, who counts
 * as recently active, whose dialect gets used, what a skip is, and the two
 * bounds (batch size, and one learner's failure not ending the round). Each
 * story is real model spend, which is why the bounds are the tests.
 */

const ADMIN = "00000000-0000-4000-8000-000000000001";
const LEARNER_1 = "00000000-0000-4000-8000-000000000011";
const LEARNER_2 = "00000000-0000-4000-8000-000000000012";
const SERVICE_ROLE = "fixture-service-role";

const story = {
  title: "يوم في السوق",
  body_arabic: "كَانَ البَيْت هَادِئًا",
  body_transliteration: "kaan al-bayt haadi'an",
  body_english: "The house was quiet",
  body_english_literal: "was the-house quiet",
  used_mature: ["بيت"],
  used_new: ["شغل"],
};

const activeRow = (userId: string) => ({
  user_id: userId,
  updated_at: new Date().toISOString(),
});

const word = {
  word_arabic: "بيت",
  word_english: "house",
  stage: "REVIEW",
  interval_days: 30,
};

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: ADMIN, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json({ role: "admin" }),
    "/rest/v1/user_xp": () => json([activeRow(LEARNER_1)]),
    "/rest/v1/profiles": () => json([{ id: LEARNER_1, preferred_dialect: "Gulf" }]),
    "/rest/v1/daily_vocab_stories": (request) =>
      request.method === "GET" ? json(null) : json({ id: "story-1", title: story.title }),
    "/rest/v1/user_vocabulary": () => json([word]),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "ai.gateway.lovable.dev": () => chatCompletion("", story),
    "openrouter.ai": () => chatCompletion("", story),
    ...extra,
  };
}

async function call(
  body: unknown,
  routes: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("pregenerate-daily", {
    upstreams: routes,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
  });
  try {
    const response = await fn.handler(
      jsonRequest("pregenerate-daily", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

/** Every story row POSTed to daily_vocab_stories, parsed. */
function savedRows(result: {
  calls: string[];
  methods: string[];
  bodies: Array<string | null>;
}): Array<Record<string, unknown>> {
  return result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes("daily_vocab_stories") && c.method === "POST")
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
}

// ── Who may run a round ─────────────────────────────────────────────────────

Deno.test("pregenerate-daily answers the preflight", async () => {
  const fn = await loadFunction("pregenerate-daily", { upstreams: upstreams() });
  try {
    const response = await fn.handler(optionsRequest("pregenerate-daily"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("pregenerate-daily accepts the scheduler's service-role key", async () => {
  const result = await call({}, upstreams(), { jwt: SERVICE_ROLE });

  assertEquals(result.status, 200);
  assertEquals(result.body.generated, 1);
  assertEquals(result.body.failed, 0);
});

Deno.test("pregenerate-daily accepts an admin", async () => {
  const { status } = await call({ dryRun: true }, upstreams());

  assertEquals(status, 200);
});

Deno.test("pregenerate-daily refuses an ordinary learner", async () => {
  const result = await call({}, upstreams({ "/rest/v1/user_roles": () => json(null) }));

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "forbidden");
  // Refused before touching anything that costs money.
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("pregenerate-daily refuses an anonymous caller", async () => {
  const result = await call({}, upstreams(), { jwt: null });

  assertEquals(result.status, 403);
});

// ── Who gets a story ────────────────────────────────────────────────────────

Deno.test("pregenerate-daily asks only for recently-active learners", async () => {
  const result = await call({}, upstreams(), { jwt: SERVICE_ROLE });

  const query = result.calls.find((url) => url.includes("user_xp")) ?? "";
  // Activity window, most recent first, bounded pool.
  assertStringIncludes(query, "updated_at=gte.");
  assertStringIncludes(query, "order=updated_at.desc");
  assertStringIncludes(query, "limit=200");
});

Deno.test("pregenerate-daily builds the story in the learner's preferred dialect", async () => {
  const result = await call(
    {},
    upstreams({
      "/rest/v1/profiles": () => json([{ id: LEARNER_1, preferred_dialect: "Egyptian" }]),
    }),
    { jwt: SERVICE_ROLE },
  );

  const saved = savedRows(result);
  assertEquals(saved.length, 1);
  assertEquals(saved[0].user_id, LEARNER_1);
  assertEquals(saved[0].dialect, "Egyptian");
});

Deno.test("pregenerate-daily falls back to Gulf for a learner with no profile", async () => {
  const result = await call(
    {},
    upstreams({ "/rest/v1/profiles": () => json([]) }),
    { jwt: SERVICE_ROLE },
  );

  const saved = savedRows(result);
  assertEquals(saved.length, 1);
  assertEquals(saved[0].dialect, "Gulf");
});

Deno.test("pregenerate-daily skips a learner whose story is already built", async () => {
  const result = await call(
    {},
    upstreams({
      "/rest/v1/daily_vocab_stories": () => json({ id: "story-1", title: "قصة الأمس" }),
    }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.skipped, 1);
  assertEquals(result.body.generated, 0);
  // A skip costs one cache read and nothing else.
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("pregenerate-daily reports an empty night as zeros", async () => {
  const result = await call(
    {},
    upstreams({ "/rest/v1/user_xp": () => json([]) }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.candidates, 0);
  assertEquals(result.body.generated, 0);
});

// ── The bounds ──────────────────────────────────────────────────────────────

Deno.test("pregenerate-daily stops at the requested batch size", async () => {
  const result = await call(
    { batchSize: 1 },
    upstreams({
      "/rest/v1/user_xp": () => json([activeRow(LEARNER_1), activeRow(LEARNER_2)]),
      "/rest/v1/profiles": () =>
        json([
          { id: LEARNER_1, preferred_dialect: "Gulf" },
          { id: LEARNER_2, preferred_dialect: "Gulf" },
        ]),
    }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.candidates, 2);
  assertEquals(result.body.attempted, 1);
  assertEquals(savedRows(result).length, 1);
});

Deno.test("pregenerate-daily counts a dry run without spending anything", async () => {
  const result = await call({ dryRun: true }, upstreams(), { jwt: SERVICE_ROLE });

  assertEquals(result.status, 200);
  assertEquals(result.body.generated, 1);
  assertEquals(result.body.dryRun, true);
  // The cache read happens (a dry run still reports real skips); the model
  // and the save do not.
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
  assertEquals(savedRows(result).length, 0);
});

Deno.test("pregenerate-daily keeps going when one learner's story fails", async () => {
  // The first save is rejected; the round must still reach the second learner.
  let saves = 0;
  const result = await call(
    {},
    upstreams({
      "/rest/v1/user_xp": () => json([activeRow(LEARNER_1), activeRow(LEARNER_2)]),
      "/rest/v1/profiles": () =>
        json([
          { id: LEARNER_1, preferred_dialect: "Gulf" },
          { id: LEARNER_2, preferred_dialect: "Gulf" },
        ]),
      "/rest/v1/daily_vocab_stories": (request) => {
        if (request.method === "GET") return json(null);
        saves++;
        return saves === 1
          ? json({ message: "permission denied" }, 403)
          : json({ id: "story-2", title: story.title });
      },
    }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.attempted, 2);
  assertEquals(result.body.failed, 1);
  assertEquals(result.body.generated, 1);
});

Deno.test("pregenerate-daily writes the same row the on-demand cache reads", async () => {
  // The whole point of the batch: the story it saves must be keyed exactly the
  // way generate-daily-story looks it up — user, UTC date, dialect.
  const result = await call({}, upstreams(), { jwt: SERVICE_ROLE });

  const write = result.calls.find(
    (url, i) => url.includes("daily_vocab_stories") && result.methods[i] === "POST",
  ) ?? "";
  assertStringIncludes(write, "on_conflict=user_id%2Cstory_date%2Cdialect");

  const saved = savedRows(result)[0];
  assertEquals(saved.user_id, LEARNER_1);
  const today = new Date().toISOString().slice(0, 10);
  assertEquals(saved.story_date, today);
});
