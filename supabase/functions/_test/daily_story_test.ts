import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-daily-story` — the ~200-word story built out of the learner's own
 * deck, one per user per dialect per UTC day.
 *
 * Two things make it worth testing. The cache key is a triple — user, date,
 * dialect — and the row is upserted on exactly that, so a learner switching
 * dialect must get a second story rather than overwriting the first. And the
 * cold start: a brand-new account has no mature words, and rather than showing
 * a "not enough vocabulary" wall it pads from a built-in starter set, which is
 * the difference between the feature working on day one and not.
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
    ...extra,
  };
}

const story = {
  title: "A day at the market",
  body_english: "The house was quiet. Ali went to work",
  body_arabic: "كان البيت هادي. راح علي للشغل",
  body_english_literal: "الـ بيت كان هادي. علي راح إلى الـ شغل",
  sentences: [
    {
      english: "The house was quiet.",
      arabic: "كان البيت هادي.",
      literal: "الـ بيت كان هادي.",
    },
    {
      english: "Ali went to work",
      arabic: "راح علي للشغل",
      literal: "علي راح إلى الـ شغل",
    },
  ],
  used_mature: ["house"],
  used_new: ["work"],
};

const emitting = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => chatCompletion("", payload),
  "openrouter.ai": () => chatCompletion("", payload),
});

const word = (arabic: string, english: string, over: Record<string, unknown> = {}) => ({
  word_arabic: arabic,
  word_english: english,
  stage: "REVIEW",
  interval_days: 30,
  ...over,
});

/**
 * The learner's deck plus the story cache.
 *
 * The two deck queries hit the same table and are told apart by their filters —
 * `interval_days=gte.7` for the settled words, `stage=eq.NEW` for the fresh
 * ones. Answering both with the same rows would make a word look saved twice
 * and mask the padding logic, so they are routed separately.
 */
function backend(
  options: {
    cached?: Record<string, unknown> | null;
    mature?: Array<Record<string, unknown>>;
    fresh?: Array<Record<string, unknown>>;
    extra?: Record<string, UpstreamHandler>;
  } = {},
) {
  const { cached = null, mature = [word("بيت", "house")], fresh = [], extra = {} } = options;
  return caller({
    "/rest/v1/daily_vocab_stories": (request) =>
      request.method === "GET"
        ? json(cached)
        : json({ id: "story-1", title: story.title, body_arabic: story.body_arabic }),
    "/rest/v1/user_vocabulary": (request) =>
      json(request.url.includes("stage=eq.NEW") ? fresh : mature),
    ...emitting(story),
    ...extra,
  });
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("generate-daily-story", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("generate-daily-story", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

function gatewayPrompt(result: { calls: string[]; bodies: Array<string | null> }): string {
  const index = result.calls.findIndex((u) => u.includes("gateway") || u.includes("openrouter"));
  return result.bodies[index] ?? "";
}

function savedRow(result: {
  calls: string[];
  methods: string[];
  bodies: Array<string | null>;
}): Record<string, unknown> {
  const found = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("daily_vocab_stories") && c.method === "POST");
  return JSON.parse(found?.body ?? "{}") as Record<string, unknown>;
}

Deno.test("generate-daily-story answers the preflight", async () => {
  const fn = await loadFunction("generate-daily-story", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("generate-daily-story"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-daily-story asks an anonymous caller to sign in", async () => {
  const result = await call({}, backend(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("generate-daily-story counts against the free-tier daily cap", async () => {
  const result = await call(
    {},
    backend({
      extra: {
        "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
        "/rest/v1/rpc/increment_usage_counter": () => json(6),
      },
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});

Deno.test("generate-daily-story returns today's story without regenerating it", async () => {
  const result = await call(
    {},
    backend({ cached: { id: "story-1", title: "قصة الأمس", body_arabic: "نص" } }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.cached, true);
  assertEquals((result.body.story as Record<string, unknown>).title, "قصة الأمس");
  // Neither the deck nor the model is touched on a hit.
  assertEquals(result.calls.some((url) => url.includes("user_vocabulary")), false);
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("generate-daily-story caches per user, day and dialect", async () => {
  const result = await call({ dialect: "Egyptian" }, backend({ cached: null }));

  const read = result.calls.find((url) => url.includes("daily_vocab_stories")) ?? "";
  assertStringIncludes(read, `user_id=eq.${USER}`);
  assertStringIncludes(read, "dialect=eq.Egyptian");
  assertStringIncludes(read, "story_date=eq.");
});

Deno.test("generate-daily-story regenerates when forced", async () => {
  const result = await call(
    { force: true },
    backend({ cached: { id: "story-1", title: "قصة الأمس", body_arabic: "نص" } }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.cached, false);
  // The cache is not even read on a forced run.
  assertEquals(
    result.calls.filter((url, i) => url.includes("daily_vocab_stories") && result.methods[i] === "GET")
      .length,
    0,
  );
});

Deno.test("generate-daily-story anchors the story on mature words", async () => {
  const result = await call(
    {},
    backend({ mature: [word("بيت", "house"), word("شغل", "work")] }),
  );

  assertEquals(result.status, 200);
  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "house (بيت)");
  assertStringIncludes(prompt, "MATURE words");
});

Deno.test("generate-daily-story asks only for words settled into review", async () => {
  const result = await call({ dialect: "Gulf" }, backend());

  const mature = result.calls.find(
    (url) => url.includes("user_vocabulary") && url.includes("interval_days=gte"),
  ) ?? "";
  // Seven days is the line between "still learning it" and "worth weaving in".
  assertStringIncludes(mature, "interval_days=gte.7");
  assertStringIncludes(mature, "limit=15");
  assertStringIncludes(mature, "dialect=eq.Gulf");

  const fresh = result.calls.find(
    (url) => url.includes("user_vocabulary") && url.includes("stage=eq.NEW"),
  ) ?? "";
  assertStringIncludes(fresh, "limit=5");
});

Deno.test("generate-daily-story pads a nearly empty deck from the starter set", async () => {
  // Day one: no mature words at all. Rather than a wall, the prompt is padded
  // with a built-in set so the learner still gets a story.
  const result = await call({ dialect: "Gulf" }, backend({ mature: [] }));

  assertEquals(result.status, 200);
  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "house (بيت)");
  assertStringIncludes(prompt, "good (زين)");
});

Deno.test("generate-daily-story pads with the right dialect's starters", async () => {
  const result = await call({ dialect: "Egyptian" }, backend({ mature: [] }));

  const prompt = gatewayPrompt(result);
  // Egyptian says كويس where Gulf says زين.
  assertStringIncludes(prompt, "good (كويس)");
  assertEquals(prompt.includes("good (زين)"), false);
});

Deno.test("generate-daily-story does not pad a deck that already has enough", async () => {
  const result = await call(
    { dialect: "Gulf" },
    backend({
      mature: [word("قهوة", "coffee"), word("سيارة", "car"), word("مطار", "airport")],
    }),
  );

  const prompt = gatewayPrompt(result);
  assertEquals(prompt.includes("good (زين)"), false);
});

Deno.test("generate-daily-story does not repeat a starter the learner already has", async () => {
  const result = await call(
    { dialect: "Gulf" },
    // One settled word and nothing new: the deck is short enough to pad, and
    // the starter set contains بيت too.
    backend({ mature: [word("بيت", "house")] }),
  );

  const prompt = gatewayPrompt(result);
  // "house" is both saved and a starter; it must appear once, not twice.
  assertEquals(prompt.split("house (بيت)").length - 1, 1);
});

Deno.test("generate-daily-story saves the story it generated", async () => {
  const result = await call({ dialect: "Yemeni" }, backend());

  assertEquals(result.status, 200);
  assertEquals(result.body.cached, false);

  const saved = savedRow(result);
  assertEquals(saved.user_id, USER);
  assertEquals(saved.dialect, "Yemeni");
  assertEquals(saved.title, "A day at the market");
  assertEquals(saved.body_english, story.body_english);
  assertEquals(saved.body_arabic, story.body_arabic);
  // Retired: an Arabic speaker needs no romanization of Arabic.
  assertEquals(saved.body_transliteration, null);
  assertEquals(saved.body_english_literal, story.body_english_literal);
  assertEquals(saved.vocab_used, ["house"]);
  assertEquals(saved.new_words, ["work"]);
});

Deno.test("generate-daily-story saves the story's sentence split", async () => {
  // The story is read one sentence to a card. The page can split the English
  // on punctuation by itself, but only the model can say which Arabic scaffold
  // belongs to which line, so the split is stored rather than re-derived.
  const result = await call({}, backend());

  assertEquals(savedRow(result).sentences, story.sentences);
});

Deno.test("generate-daily-story asks the model to split the story up", async () => {
  const result = await call({}, backend());

  assertStringIncludes(gatewayPrompt(result), "the story split one entry per sentence");
});

Deno.test("generate-daily-story stores no split when the model left one out", async () => {
  // A split that does not account for the whole body would show the learner a
  // shortened story with nothing to say a sentence went missing. Dropping it
  // costs only the per-sentence translations — the page still splits the body.
  const result = await call(
    {},
    backend({ extra: emitting({ ...story, sentences: [story.sentences[0]] }) }),
  );

  assertEquals(savedRow(result).sentences, null);
});

Deno.test("generate-daily-story drops a sentence that has no English", async () => {
  // English is the story now - an entry without it is nothing to read.
  const result = await call(
    {},
    backend({
      extra: emitting({
        ...story,
        sentences: [...story.sentences, { english: "  ", arabic: "لا شيء" }],
      }),
    }),
  );

  assertEquals(savedRow(result).sentences, story.sentences);
});

Deno.test("generate-daily-story stores a missing split as null", async () => {
  const result = await call({}, backend({ extra: emitting({ ...story, sentences: [] }) }));

  assertEquals(savedRow(result).sentences, null);
});

Deno.test("generate-daily-story upserts on the three-part cache key", async () => {
  // Two requests racing the same day must not leave two stories behind.
  const result = await call({}, backend());

  const write = result.calls.find(
    (url, i) => url.includes("daily_vocab_stories") && result.methods[i] === "POST",
  ) ?? "";
  assertStringIncludes(write, "on_conflict=user_id%2Cstory_date%2Cdialect");
});

Deno.test("generate-daily-story stores an absent optional field as null", async () => {
  const result = await call(
    {},
    backend({
      extra: emitting({
        ...story,
        body_arabic: "",
        body_english_literal: "",
      }),
    }),
  );

  const saved = savedRow(result);
  assertEquals(saved.body_arabic, null);
  assertEquals(saved.body_english_literal, null);
});

Deno.test("generate-daily-story titles an untitled story", async () => {
  const result = await call({}, backend({ extra: emitting({ ...story, title: "" }) }));

  assertEquals(savedRow(result).title, "Today's story");
});

Deno.test("generate-daily-story truncates a runaway title", async () => {
  const result = await call(
    {},
    backend({ extra: emitting({ ...story, title: "a".repeat(400) }) }),
  );

  assertEquals(String(savedRow(result).title).length, 160);
});

Deno.test("generate-daily-story refuses to save a story with no English", async () => {
  const result = await call({}, backend({ extra: emitting({ ...story, body_english: "   " }) }));

  assertEquals(result.status, 502);
  assertEquals(result.body.error, "empty_story");
  assertEquals(result.calls.some((url, i) => url.includes("daily_vocab_stories") && result.methods[i] === "POST"), false);
});

Deno.test("generate-daily-story reports a model failure as a gateway error", async () => {
  const result = await call(
    {},
    backend({
      extra: {
        "ai.gateway.lovable.dev": () => json({ error: "down" }, 503),
        "openrouter.ai": () => json({ error: "down" }, 503),
      },
    }),
  );

  assertEquals(result.status, 502);
  assertEquals(result.body.error, "ai_failed");
});

Deno.test("generate-daily-story reports a rejected save", async () => {
  const result = await call(
    {},
    backend({
      extra: {
        "/rest/v1/daily_vocab_stories": (request) =>
          request.method === "GET"
            ? json(null)
            : json({ message: "permission denied" }, 403),
      },
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "save_failed");
});

Deno.test("generate-daily-story asks for English with a dialect scaffold", async () => {
  const result = await call({ dialect: "Gulf" }, backend());

  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "180-220 English words");
  assertStringIncludes(prompt, "Gulf dialect Arabic translation");
  assertStringIncludes(prompt, "NOT Modern Standard Arabic");
});
