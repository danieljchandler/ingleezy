import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-story` and `generate-story-full-audio` — writing a branching story,
 * and narrating a linear one end to end.
 *
 * `generate-story` writes nothing: it hands the drafted story straight back for
 * the admin form to review, so what is testable is the contract it asks the
 * model for — a scene count inside bounds, the last scene an ending, choices
 * that point at real scenes — and how it maps the gateway's failures.
 *
 * `generate-story-full-audio` is the long one. It marks the story generating
 * before it starts and either ready or failed at the end, which is the only
 * signal the admin list has; it carries on past a line that fails rather than
 * abandoning the story; and it conditions each line's prosody on its
 * neighbours, which is what stops narration sounding like separate takes.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

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
    "/storage/v1": () => json({ Key: "listen-audio/authentic-stories/file" }),
    ...extra,
  };
}

const emitting = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => chatCompletion("", payload),
  "openrouter.ai": () => chatCompletion("", payload),
});

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction(name, { upstreams });
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

function gatewayPrompt(result: { calls: string[]; bodies: Array<string | null> }): string {
  const index = result.calls.findIndex((u) => u.includes("gateway") || u.includes("openrouter"));
  return result.bodies[index] ?? "";
}

/** Every write to a table, parsed, in order. */
function writesTo(
  result: { calls: string[]; methods: string[]; bodies: Array<string | null> },
  table: string,
  method = "PATCH",
): Array<Record<string, unknown>> {
  return result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes(table) && c.method === method)
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
}

// ── generate-story ───────────────────────────────────────────────────────────

const drafted = {
  title: "The Lost Camel",
  title_arabic: "الجمل الضائع",
  description: "A traveller loses a camel.",
  description_arabic: "مسافر يفقد جمله.",
  scenes: [
    {
      scene_order: 0,
      narrative_english: "Once upon a time",
      narrative_arabic: "كان يا ما كان",
      narrative_literal: "مرة في زمان",
      vocabulary: [{ word_english: "camel", word_arabic: "جمل" }],
      is_ending: false,
      choices: [{ text_english: "walk on", text_arabic: "امشِ", next_scene_order: 1 }],
      ending_message: null,
      ending_message_arabic: null,
    },
  ],
};

Deno.test("generate-story answers the preflight", async () => {
  const fn = await loadFunction("generate-story", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("generate-story"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story asks an anonymous caller to sign in", async () => {
  const result = await call("generate-story", { prompt: "a camel" }, caller(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("generate-story needs something to write about", async () => {
  const result = await call("generate-story", {}, caller());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "prompt is required");
});

Deno.test("generate-story counts against the free-tier daily cap", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a camel" },
    caller({
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(11),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});

Deno.test("generate-story hands the drafted story back unsaved", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel", dialect: "Egyptian" },
    caller(emitting(drafted)),
  );

  assertEquals(result.status, 200);
  const storyBack = result.body.story as typeof drafted;
  assertEquals(storyBack.title, "The Lost Camel");
  assertEquals(storyBack.scenes.length, 1);
  // Nothing is written — the admin form reviews it first.
  assertEquals(result.calls.some((url) => url.includes("interactive_stories")), false);
});

Deno.test("generate-story defaults to five scenes", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller(emitting(drafted)),
  );

  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "exactly 5 scenes");
  assertStringIncludes(prompt, "numbered 0 to 4");
});

Deno.test("generate-story clamps the scene count to what a reader can follow", async () => {
  const tooMany = await call(
    "generate-story",
    { prompt: "a lost camel", sceneCount: 50 },
    caller(emitting(drafted)),
  );
  assertStringIncludes(gatewayPrompt(tooMany), "exactly 10 scenes");

  const tooFew = await call(
    "generate-story",
    { prompt: "a lost camel", sceneCount: 1 },
    caller(emitting(drafted)),
  );
  assertStringIncludes(gatewayPrompt(tooFew), "exactly 3 scenes");
});

Deno.test("generate-story requires the story to be finishable", async () => {
  // The three rules that stop a branching story trapping the reader.
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller(emitting(drafted)),
  );

  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "MUST be an ending scene");
  assertStringIncludes(prompt, "Choices must reference valid scene numbers");
  assertStringIncludes(prompt, "Avoid circular references that trap the player");
});

Deno.test("generate-story writes English scenes over a dialect scaffold", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller(emitting(drafted)),
  );

  const prompt = gatewayPrompt(result);
  // The narrative is the learner's reading task, so its language is a prompt
  // requirement: stories in English, with each scene's Arabic scaffold in the
  // learner's dialect rather than the MSA a model defaults to — and no
  // vocalisation machinery, which belonged to the Arabic-era generator.
  assertStringIncludes(prompt, "stories in ENGLISH");
  assertStringIncludes(prompt, "NEVER Modern Standard Arabic");
  assertStringIncludes(prompt, "ENGLISH word order");
  assertEquals(prompt.includes("fully vocalized"), false);
  assertEquals(prompt.includes("transliteration"), false);
});

Deno.test("generate-story passes the author's own guidance through", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel", guidance: "Set it in Oman, in winter." },
    caller(emitting(drafted)),
  );

  assertStringIncludes(gatewayPrompt(result), "Set it in Oman, in winter.");
});

Deno.test("generate-story omits the guidance block when there is none", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller(emitting(drafted)),
  );

  assertEquals(gatewayPrompt(result).includes("Additional guidance from the author"), false);
});

Deno.test("generate-story tunes the register to the stated level", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel", difficulty: "Advanced" },
    caller(emitting(drafted)),
  );

  assertStringIncludes(gatewayPrompt(result), "at a Advanced level");
});

Deno.test("generate-story defaults to Beginner and Gulf", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller(emitting(drafted)),
  );

  const prompt = gatewayPrompt(result);
  assertStringIncludes(prompt, "at a Beginner level");
  assertStringIncludes(prompt, "Gulf");
});

Deno.test("generate-story passes a paywall answer straight through", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "payment required" }, 402),
      "openrouter.ai": () => json({ error: "payment required" }, 402),
    }),
  );

  assertEquals(result.status, 402);
  assertStringIncludes(String(result.body.error), "credits");
});

Deno.test("generate-story passes a rate limit straight through", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429),
      "openrouter.ai": () => json({ error: "slow down" }, 429),
    }),
  );

  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "Rate limit");
});

Deno.test("generate-story flattens any other model failure to a 500", async () => {
  const result = await call(
    "generate-story",
    { prompt: "a lost camel" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "AI service error");
});

// ── generate-story-full-audio ────────────────────────────────────────────────

const storyLine = (index: number, over: Record<string, unknown> = {}) => ({
  id: `line-${index}`,
  story_id: STORY,
  line_index: index,
  arabic: `سطر ${index}`,
  arabic_vocalized: `سَطْر ${index}`,
  dialect: null,
  dialect_vocalized: null,
  audio_url: null,
  ...over,
});

function audioBackend(
  options: {
    story?: Record<string, unknown> | null;
    lines?: Array<Record<string, unknown>>;
    extra?: Record<string, UpstreamHandler>;
  } = {},
) {
  const {
    story = { id: STORY, dialect: "Yemeni" },
    lines = [storyLine(0), storyLine(1)],
    extra = {},
  } = options;
  return caller({
    "/rest/v1/authentic_stories": (request) =>
      request.method === "GET" ? json(story) : json([], 200),
    "/rest/v1/authentic_story_lines": (request) => {
      if (request.method !== "GET") return json([], 200);
      // The trailing lookup for line 0's URL is a maybeSingle on line_index.
      return request.url.includes("line_index=eq.0")
        ? json({ audio_url: "https://cdn.test/line-0.mp3" })
        : json(lines);
    },
    ...extra,
  });
}

Deno.test("generate-story-full-audio answers the preflight", async () => {
  const fn = await loadFunction("generate-story-full-audio", { upstreams: audioBackend() });
  try {
    const response = await fn.handler(optionsRequest("generate-story-full-audio"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-full-audio turns away an anonymous caller", async () => {
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({ extra: { "/auth/v1/user": () => json({ error: "no session" }, 401) } }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-full-audio needs a story", async () => {
  const result = await call("generate-story-full-audio", {}, audioBackend());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing story_id");
});

Deno.test("generate-story-full-audio marks the story generating before it starts", async () => {
  // The admin list has no other signal that a long run is under way.
  const result = await call("generate-story-full-audio", { story_id: STORY }, audioBackend());

  const patches = writesTo(result, "authentic_stories");
  assertEquals(patches[0].video_status, "generating");
});

Deno.test("generate-story-full-audio marks the story ready when it finishes", async () => {
  const result = await call("generate-story-full-audio", { story_id: STORY }, audioBackend());

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.lines_generated, 2);

  const final = writesTo(result, "authentic_stories").at(-1);
  assertEquals(final?.video_status, "ready");
  assertEquals(final?.audio_url, "https://cdn.test/line-0.mp3");
  assert(Array.isArray(final?.line_durations));
  assertEquals((final?.line_durations as number[]).length, 2);
});

Deno.test("generate-story-full-audio marks the story failed when it has no lines", async () => {
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({ lines: [] }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "no_lines_found");
  assertEquals(writesTo(result, "authentic_stories").at(-1)?.video_status, "failed");
});

Deno.test("generate-story-full-audio says so when the story is gone", async () => {
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({ story: null }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "story_not_found");
});

Deno.test("generate-story-full-audio stores one clip per line", async () => {
  const result = await call("generate-story-full-audio", { story_id: STORY }, audioBackend());

  const uploads = result.calls.filter((url) => url.includes("/storage/v1/object"));
  assertEquals(uploads.length, 2);
  assertStringIncludes(uploads[0], `authentic-stories/${STORY}/line-0.`);
  assertStringIncludes(uploads[1], `authentic-stories/${STORY}/line-1.`);
});

Deno.test("generate-story-full-audio records a duration per line", async () => {
  const result = await call("generate-story-full-audio", { story_id: STORY }, audioBackend());

  const linePatch = writesTo(result, "authentic_story_lines")[0];
  assert(String(linePatch.audio_url).includes("listen-audio"));
  assertEquals(typeof linePatch.duration_seconds, "number");
});

Deno.test("generate-story-full-audio conditions each line on its neighbours", async () => {
  // Prosody carries across line boundaries for ElevenLabs; without the
  // surrounding text every line is read as a fresh take.
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({
      story: { id: STORY, dialect: "Egyptian" },
      lines: [storyLine(0), storyLine(1), storyLine(2)],
    }),
  );

  assertEquals(result.status, 200);
  const middle = result.bodies[
    result.calls.map((u, i) => ({ u, i })).filter((c) => c.u.includes("elevenlabs"))[1]?.i ?? -1
  ] ?? "";
  assertStringIncludes(middle, "سَطْر 0");
  assertStringIncludes(middle, "سَطْر 2");
});

Deno.test("generate-story-full-audio gives a skipped line a zero duration", async () => {
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({
      lines: [storyLine(0, { arabic: "", arabic_vocalized: null }), storyLine(1)],
    }),
  );

  assertEquals(result.status, 200);
  const durations = writesTo(result, "authentic_stories").at(-1)?.line_durations as number[];
  // The array stays aligned with the lines, so the reader's highlighting does
  // not slip by one.
  assertEquals(durations.length, 2);
  assertEquals(durations[0], 0);
});

Deno.test("generate-story-full-audio carries on past a line whose TTS failed", async () => {
  let attempts = 0;
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({
      extra: {
        "tts.speech.microsoft.com": () => {
          attempts += 1;
          return attempts === 1
            ? json({ error: "down" }, 503)
            : new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 });
        },
      },
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.lines_generated, 2);
  const durations = writesTo(result, "authentic_stories").at(-1)?.line_durations as number[];
  assertEquals(durations[0], 0);
  assertEquals(writesTo(result, "authentic_stories").at(-1)?.video_status, "ready");
});

Deno.test("generate-story-full-audio carries on past a failed upload", async () => {
  let uploads = 0;
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({
      extra: {
        "/storage/v1": () => {
          uploads += 1;
          return uploads === 1
            ? json({ message: "bucket missing" }, 400)
            : json({ Key: "listen-audio/ok" });
        },
      },
    }),
  );

  assertEquals(result.status, 200);
  const durations = writesTo(result, "authentic_stories").at(-1)?.line_durations as number[];
  assertEquals(durations[0], 0);
});

Deno.test("generate-story-full-audio never leaves the story stuck at generating", async () => {
  // "generating" is what the admin list renders as a spinner, so every exit
  // path has to move it on. A rejected lines read is the failure most likely to
  // happen for real — the story is marked failed rather than left mid-run.
  const result = await call(
    "generate-story-full-audio",
    { story_id: STORY },
    audioBackend({
      extra: {
        "/rest/v1/authentic_story_lines": (request) =>
          request.method === "GET"
            ? json({ message: "permission denied" }, 403)
            : json([], 200),
      },
    }),
  );

  assertEquals(result.status, 404);
  const statuses = writesTo(result, "authentic_stories").map((p) => p.video_status);
  assertEquals(statuses[0], "generating");
  assertEquals(statuses.at(-1), "failed");
});
