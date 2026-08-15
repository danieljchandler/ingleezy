import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-story-video-full` — the expensive follow-up to the preview. Once an
 * admin approves the one-frame slideshow, this plans a whole storyboard and
 * renders three to six scenes, each with its own image and its own narration
 * clip.
 *
 * Almost everything worth asserting happens *after* the response. The handler
 * plans the film, writes "generating", hands the render to
 * `EdgeRuntime.waitUntil` and returns immediately — so the scene loop, the
 * uploads, the incremental segment writes and the terminal status all land in
 * the background. `fn.background()` is what makes them observable.
 *
 * The two things this function is built around are consistency and staying on
 * the right side of the flip. One `style_anchor` and one cast list are
 * prepended to every scene prompt so six independently generated images look
 * like one book; and `validateEnglishOnly` rejects a beat with no Latin
 * letters in it. That check is inverted from the Arabic era and kept rather
 * than dropped: it catches a story whose columns were filled the wrong way
 * round, which would otherwise ship a narrator reading the learner their own
 * translation.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

/** A 1x1 PNG, base64, as the image model's answer. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const BEATS = [
  "Once upon a time, long ago",
  "Then the boy walked to the market",
  "And in the evening he returned home",
];

const aScene = (index: number, over: Record<string, unknown> = {}) => ({
  index,
  arabic_beat: BEATS[index % BEATS.length],
  visual_prompt: `scene ${index} depiction`,
  characters_in_scene: ["boy"],
  ...over,
});

const aPlan = (over: Record<string, unknown> = {}) => ({
  style_anchor: "Warm painterly storybook gouache, dusk palette.",
  characters: [{ id: "boy", appearance: "a boy of nine in a grey kandura" }],
  scenes: [aScene(0), aScene(1), aScene(2)],
  ...over,
});

/** The planner is a chat completion whose content is the JSON plan. */
const planning = (plan: unknown): UpstreamHandler => () =>
  json({ choices: [{ message: { content: JSON.stringify(plan) } }] });

/**
 * The gateway serves two different endpoints for this function — chat
 * completions for the storyboard, images/generations for each frame — so the
 * host route has to dispatch on the path or the planner would answer the image
 * calls with a plan and no `b64_json`.
 */
function gateway(
  plan: unknown,
  imageHandler?: UpstreamHandler,
): Record<string, UpstreamHandler> {
  return {
    "ai.gateway.lovable.dev/v1/chat/completions": planning(plan),
    "ai.gateway.lovable.dev/v1/images/generations":
      imageHandler ?? (() => json({ data: [{ b64_json: PNG_B64 }] })),
  };
}

function backend(
  options: {
    story?: Record<string, unknown> | null;
    storyStatus?: number;
    plan?: unknown;
    image?: UpstreamHandler;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const {
    story = {
      id: STORY,
      title: "The boy and the souq",
      title_arabic: "الولد والسوق",
      body_english: "A boy goes to the market.",
      body_english: "Once upon a time, long ago. Then the boy walked to the market.",
      // Yemeni rather than Gulf on purpose: `planProvider` only reaches for
      // Munsit on Gulf, and Munsit's voice list is cached at module scope for
      // the life of the process. Staying off that path keeps these tests
      // independent of the order the whole edge suite happens to run in.
      dialect: "Yemeni",
      story_video_approved: true,
    },
    storyStatus = 200,
    plan = aPlan(),
    image,
    extra = {},
  } = options;

  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/authentic_stories": (request) =>
      request.method === "GET"
        ? json(story, storyStatus)
        : json([], 200),
    ...gateway(plan, image),
    // English narration goes through the shared English provider plan, which
    // prefers ElevenLabs and falls back to Azure en-US. Both are stubbed so a
    // change of preference does not silently leave the narration unmocked.
    //
    // 32 KB rather than the 4 KB below it: durations are estimated from byte
    // count against the provider's bitrate, and ElevenLabs is 128 kbps, so a
    // 4 KB clip rounds to zero seconds and reads as a failed synthesis.
    "api.elevenlabs.io": () =>
      new Response(new Uint8Array(32768), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    "tts.speech.microsoft.com": () =>
      new Response(new Uint8Array(4096), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    "/storage/v1": () => json({ Key: "listen-audio/authentic-stories/file" }),
    ...extra,
  };
}

interface Result {
  status: number;
  body: Record<string, unknown>;
  calls: string[];
  bodies: Array<string | null>;
  patches: Record<string, unknown>[];
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined>; settle?: boolean } = {},
): Promise<Result> {
  const fn = await loadFunction("generate-story-video-full", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(
        "generate-story-video-full",
        body,
        opts.jwt === undefined ? {} : { jwt: opts.jwt },
      ),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }

    if (opts.settle !== false) await fn.background();

    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      patches: fn.calls
        .filter((c) => c.url.includes("authentic_stories") && c.method === "PATCH")
        .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>),
    };
  } finally {
    fn.restore();
  }
}

/** Every prompt sent to the image model, in the order the scenes were rendered. */
const imagePrompts = (result: Result): string[] =>
  result.calls
    .map((url, i) => (url.includes("images/generations") ? result.bodies[i] : null))
    .filter((body): body is string => body !== null)
    .map((body) => {
      const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
      return parsed.messages?.[0]?.content ?? "";
    });

/** The last set of segments the function persisted. */
const lastSegments = (result: Result): Record<string, unknown>[] => {
  const withSegments = result.patches.filter((p) => Array.isArray(p.story_video_segments));
  const last = withSegments.at(-1)?.story_video_segments;
  return Array.isArray(last) ? (last as Record<string, unknown>[]) : [];
};

// ── The way in ───────────────────────────────────────────────────────────────

Deno.test("generate-story-video-full answers the preflight", async () => {
  const fn = await loadFunction("generate-story-video-full", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("generate-story-video-full"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-video-full refuses a caller with no token", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "/auth/v1/user": () => json({ error: "invalid token" }, 401),
  }, { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-video-full refuses a token the auth server rejects", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "/auth/v1/user": () => json({ error: "bad jwt" }, 401),
  });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-video-full lets any signed-in learner spend the render budget", async () => {
  // Pinned, not fixed. This is the most expensive function in the codebase —
  // one planning call plus up to six image generations and six TTS syntheses
  // per invocation — and the only thing standing in front of it is
  // `getUser(token)`. There is no `has_role(user, 'admin')` check and no
  // `user_roles` read at all, so a plain learner with a valid session can
  // trigger a full render of any approved story, repeatedly. Its sibling
  // `generate-story-video` has the same gap; `generate-story-full-audio` and
  // `translate-story-dialect` are the other two of the four.
  const result = await call({ story_id: STORY }, backend());

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "generating");
  assertEquals(result.calls.some((u) => u.includes("user_roles")), false);
});

Deno.test("generate-story-video-full needs a story id", async () => {
  const result = await call({}, backend());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing story_id");
});

Deno.test("generate-story-video-full says so when the story does not exist", async () => {
  const result = await call({ story_id: STORY }, backend({ story: null, storyStatus: 406 }));

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "story_not_found");
});

Deno.test("generate-story-video-full will not render before the preview is approved", async () => {
  // The gate that makes the cost bearable: the cheap one-frame preview has to
  // be signed off before the six-frame render is allowed to start.
  const result = await call(
    { story_id: STORY },
    backend({
      story: {
        id: STORY,
        title: "The boy and the souq",
        title_arabic: "الولد والسوق",
        body_english: "A boy goes to the market.",
        body_fusha: "كان يا ما كان",
        dialect: "Yemeni",
        story_video_approved: false,
      },
    }),
  );

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "preview_not_approved");
  assertEquals(result.calls.some((u) => u.includes("images/generations")), false);
});

Deno.test("generate-story-video-full refuses to start with no image key configured", async () => {
  const result = await call({ story_id: STORY }, backend(), {
    env: { LOVABLE_API_KEY: undefined },
  });

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "LOVABLE_API_KEY");
});

// ── Planning the storyboard ──────────────────────────────────────────────────

Deno.test("generate-story-video-full plans from the story's English text", async () => {
  const result = await call({ story_id: STORY }, backend());

  const planIndex = result.calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(result.bodies[planIndex] ?? "{}") as {
    messages: Array<{ role: string; content: string }>;
  };
  const user = sent.messages.find((m) => m.role === "user")?.content ?? "";

  // The English is the story, so it is what the planner reads and what beats
  // must be quotable from. It used to read `body_fusha`, which the flipped
  // importer never writes — leaving the director planning scenes from the
  // title alone and calling the real text "context only".
  assertStringIncludes(user, "STORY (authoritative");
  assertStringIncludes(user, "Once upon a time, long ago");
});

Deno.test("generate-story-video-full asks the planner for strict JSON", async () => {
  const result = await call({ story_id: STORY }, backend());

  const planIndex = result.calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(result.bodies[planIndex] ?? "{}") as {
    response_format?: { type?: string };
  };
  assertEquals(sent.response_format?.type, "json_object");
});

Deno.test("generate-story-video-full does not force an Arab setting onto the story", async () => {
  // Removed with the flip, deliberately. `dialect` is the LEARNER's own
  // language, not the story's origin — keying the scene on it dressed a London
  // news article in kanduras because the reader happens to be Gulf.
  const result = await call({ story_id: STORY }, backend());

  const planIndex = result.calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(result.bodies[planIndex] ?? "{}") as {
    messages: Array<{ role: string; content: string }>;
  };
  const system = sent.messages.find((m) => m.role === "system")?.content ?? "";
  assertEquals(system.includes("Sana'a tower houses"), false);
  assertEquals(system.includes("authentic Arab cultural setting"), false);
});

Deno.test("generate-story-video-full rejects a plan with too few scenes", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ plan: aPlan({ scenes: [aScene(0), aScene(1)] }) }),
  );

  // Two scenes is not a slideshow. Failing here rather than rendering it keeps
  // the story out of "ready" with a half-told version of itself.
  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "invalid plan");
});

Deno.test("generate-story-video-full rejects a plan with no style anchor", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ plan: aPlan({ style_anchor: "" }) }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "invalid plan");
});

Deno.test("generate-story-video-full rejects a beat with no English in it", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      plan: aPlan({
        scenes: [aScene(0), aScene(1), aScene(2, { arabic_beat: "مشى الولد إلى السوق" })],
      }),
    }),
  );

  // The beat is narrated verbatim by an English voice, so one Arabic scene
  // would ship a clip of a bilingual reader mid-story — and is a sign the
  // story's columns were filled the wrong way round.
  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "no English text");
  assertEquals(result.calls.some((u) => u.includes("images/generations")), false);
});

Deno.test("generate-story-video-full caps the plan at six scenes", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      plan: aPlan({ scenes: Array.from({ length: 9 }, (_, i) => aScene(i)) }),
    }),
  );

  assertEquals(result.body.scenes, 6);
  assertEquals(imagePrompts(result).length, 6);
});

Deno.test("generate-story-video-full renumbers the scenes it was given", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      // A planner that numbers its own scenes badly must not produce segments
      // the reader plays out of order — the index is taken from position.
      plan: aPlan({ scenes: [aScene(0, { index: 7 }), aScene(1, { index: 7 }), aScene(2, { index: 7 })] }),
    }),
  );

  assertEquals(lastSegments(result).map((s) => s.index), [0, 1, 2]);
});

Deno.test("generate-story-video-full survives a planner that omits the cast", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ plan: aPlan({ characters: undefined }) }),
  );

  assertEquals(result.status, 200);
  assertEquals(imagePrompts(result).length, 3);
  // With nobody to describe, the cast block is simply absent rather than an
  // empty heading the image model has to interpret.
  assertEquals(imagePrompts(result)[0].includes("CHARACTERS IN THIS SCENE"), false);
});

Deno.test("generate-story-video-full fills in a missing visual prompt", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      plan: aPlan({ scenes: [aScene(0, { visual_prompt: "" }), aScene(1), aScene(2)] }),
    }),
  );

  assertStringIncludes(imagePrompts(result)[0], "A precise storybook depiction");
});

Deno.test("generate-story-video-full reports a planner outage as a failure to start", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "ai.gateway.lovable.dev/v1/chat/completions": () => new Response("upstream down", { status: 503 }),
  });

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "scene planning failed");
  // Nothing was written, so the row keeps whatever status it had rather than
  // being parked at "generating" for a job that never began.
  assertEquals(result.patches.length, 0);
});

// ── Rendering the scenes ─────────────────────────────────────────────────────

Deno.test("generate-story-video-full returns before it renders anything", async () => {
  const fn = await loadFunction("generate-story-video-full", { upstreams: backend() });
  try {
    const response = await fn.handler(jsonRequest("generate-story-video-full", { story_id: STORY }));
    const body = await response.json();

    // The response is the receipt, not the result — six image generations would
    // not fit inside an edge function's request budget.
    assertEquals(response.status, 200);
    assertEquals(body, { status: "generating", scenes: 3 });
    assertEquals(fn.callsTo("images/generations").length, 0);

    await fn.background();
    assertEquals(fn.callsTo("images/generations").length, 3);
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-video-full clears the previous render before starting", async () => {
  const result = await call({ story_id: STORY }, backend());

  // The first write empties `story_video_segments`, so the admin form never
  // shows last run's frames next to this run's spinner.
  assertEquals(result.patches[0].story_video_full_status, "generating");
  assertEquals(result.patches[0].story_video_full_error, null);
  assertEquals(result.patches[0].story_video_segments, []);
});

Deno.test("generate-story-video-full prepends one style anchor to every scene", async () => {
  const result = await call({ story_id: STORY }, backend());
  const prompts = imagePrompts(result);

  assertEquals(prompts.length, 3);
  // The whole reason the plan is made up front: six images generated in
  // isolation look like six different books.
  for (const prompt of prompts) {
    assertStringIncludes(prompt, "Warm painterly storybook gouache");
    assertStringIncludes(prompt, "a boy of nine in a grey kandura");
  }
});

Deno.test("generate-story-video-full numbers each scene against the total", async () => {
  const result = await call({ story_id: STORY }, backend());
  const prompts = imagePrompts(result);

  assertStringIncludes(prompts[0], "SCENE 1 of 3");
  assertStringIncludes(prompts[2], "SCENE 3 of 3");
});

Deno.test("generate-story-video-full forbids text inside the artwork", async () => {
  const result = await call({ story_id: STORY }, backend());

  // The beat is passed in so the image matches it, which means the model is
  // holding Arabic text it must not draw — hence the explicit ban on letters
  // of either script.
  const prompt = imagePrompts(result)[0];
  assertStringIncludes(prompt, "No text of any language in the image");
  assertStringIncludes(prompt, "No text of any language in the image");
});

Deno.test("generate-story-video-full narrates each scene with its own beat", async () => {
  const result = await call({ story_id: STORY }, backend());
  const segments = lastSegments(result);

  assertEquals(segments.length, 3);
  assertEquals(segments[0].narration_arabic, BEATS[0]);
  assertEquals(segments[1].narration_arabic, BEATS[1]);
  assertEquals(segments[2].narration_arabic, BEATS[2]);
});

Deno.test("generate-story-video-full trims a long beat before narrating it", async () => {
  const longBeat = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const result = await call(
    { story_id: STORY },
    backend({
      plan: aPlan({ scenes: [aScene(0, { arabic_beat: longBeat }), aScene(1), aScene(2)] }),
    }),
  );

  // Forty words is roughly the length a single slide can hold the viewer for;
  // the untrimmed beat still drives the image, only the narration is capped.
  const narration = String(lastSegments(result)[0].narration_arabic);
  assertEquals(narration.split(/\s+/).length, 40);
  assertStringIncludes(imagePrompts(result)[0], "word59");
});

Deno.test("generate-story-video-full writes each segment as it finishes", async () => {
  const result = await call({ story_id: STORY }, backend());

  const segmentWrites = result.patches
    .filter((p) => Array.isArray(p.story_video_segments))
    .map((p) => (p.story_video_segments as unknown[]).length);

  // Incremental rather than one write at the end, so a render that dies at
  // scene five leaves four usable frames behind instead of nothing.
  assertEquals(segmentWrites, [0, 1, 2, 3]);
});

Deno.test("generate-story-video-full carries the legacy url field alongside image_url", async () => {
  const result = await call({ story_id: STORY }, backend());
  const first = lastSegments(result)[0];

  // Two names for one value: older admin selectors read `url`, the reader reads
  // `image_url`. Dropping either breaks one of the two.
  assertEquals(first.url, first.image_url);
  assert(String(first.image_url).length > 0);
});

Deno.test("generate-story-video-full records a duration for each segment", async () => {
  const result = await call({ story_id: STORY }, backend());

  for (const segment of lastSegments(result)) {
    assert(
      typeof segment.duration_seconds === "number" && segment.duration_seconds > 0,
      `expected a positive duration, got ${JSON.stringify(segment.duration_seconds)}`,
    );
  }
});

Deno.test("generate-story-video-full keeps the prompt it used on the segment", async () => {
  const result = await call({ story_id: STORY }, backend());

  // The prompt is the only record of why a frame looks the way it does, and the
  // admin form offers a re-roll from it.
  assertStringIncludes(String(lastSegments(result)[0].prompt), "SCENE 1 of 3");
  assertEquals(lastSegments(result)[0].arabic_beat, BEATS[0]);
});

Deno.test("generate-story-video-full marks the story ready when every scene lands", async () => {
  const result = await call({ story_id: STORY }, backend());

  assertEquals(result.patches.at(-1)?.story_video_full_status, "ready");
  assertEquals(result.patches.at(-1)?.story_video_full_error, null);
});

// ── When the render goes wrong ───────────────────────────────────────────────

Deno.test("generate-story-video-full reports a story as ready with scenes missing", async () => {
  // Pinned, not fixed. A scene that throws is caught inside the loop and only
  // logged, so a render where the image model failed on four of six frames ends
  // at `story_video_full_status: "ready"` with two segments and no error. The
  // admin sees a green status and a story that jumps from its opening straight
  // to its ending, with nothing saying a frame is absent — and because the
  // status is terminal, nothing retries.
  let attempt = 0;
  const result = await call({ story_id: STORY }, backend({
    image: () => {
      attempt += 1;
      return attempt === 2
        ? new Response("model overloaded", { status: 503 })
        : json({ data: [{ b64_json: PNG_B64 }] });
    },
  }));

  assertEquals(lastSegments(result).length, 2);
  assertEquals(result.patches.at(-1)?.story_video_full_status, "ready");
  assertEquals(result.patches.at(-1)?.story_video_full_error, null);
  // The gap is visible in the data if anyone looks, but nothing surfaces it.
  assertEquals(lastSegments(result).map((s) => s.arabic_beat), [BEATS[0], BEATS[2]]);
});

Deno.test("generate-story-video-full marks the story failed when every scene fails", async () => {
  const result = await call({ story_id: STORY }, backend({
    image: () => new Response("model overloaded", { status: 503 }),
  }));

  assertEquals(result.patches.at(-1)?.story_video_full_status, "failed");
  assertStringIncludes(String(result.patches.at(-1)?.story_video_full_error), "no scenes generated");
});

Deno.test("generate-story-video-full records a narration outage as a failure", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "api.elevenlabs.io": () => new Response("voice unavailable", { status: 500 }),
    "tts.speech.microsoft.com": () => new Response("voice unavailable", { status: 500 }),
  });

  // Narration is synthesised before the image, so a TTS outage costs nothing in
  // image credits — no frame is generated at all.
  assertEquals(result.calls.some((u) => u.includes("images/generations")), false);
  assertEquals(result.patches.at(-1)?.story_video_full_status, "failed");
});

Deno.test("generate-story-video-full records a storage outage as a failure", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "/storage/v1": () => json({ error: "bucket full", message: "bucket full" }, 507),
  });

  assertEquals(result.patches.at(-1)?.story_video_full_status, "failed");
  assert(String(result.patches.at(-1)?.story_video_full_error).length > 0);
});

Deno.test("generate-story-video-full truncates a runaway failure message", async () => {
  const result = await call({ story_id: STORY }, backend({
    image: () => new Response("x".repeat(4000), { status: 500 }),
  }));

  // The column is not unbounded, and an upstream that echoes a whole HTML error
  // page would otherwise fail the write that records the failure.
  const message = String(result.patches.at(-1)?.story_video_full_error);
  assertEquals(result.patches.at(-1)?.story_video_full_status, "failed");
  assert(message.length <= 500, `expected <=500 chars, got ${message.length}`);
});

Deno.test("generate-story-video-full fails the run when the model returns no image", async () => {
  const result = await call({ story_id: STORY }, backend({
    // A 200 with the wrong shape is the failure mode a status check misses.
    image: () => json({ data: [{}] }),
  }));

  assertEquals(result.patches.at(-1)?.story_video_full_status, "failed");
  assertStringIncludes(String(result.patches.at(-1)?.story_video_full_error), "no scenes generated");
});

Deno.test("generate-story-video-full fails the run on an unparseable plan", async () => {
  const result = await call({ story_id: STORY }, {
    ...backend(),
    "ai.gateway.lovable.dev/v1/chat/completions": () =>
      json({ choices: [{ message: { content: "here is your plan:" } }] }),
  });

  assertEquals(result.status, 500);
  assertEquals(result.patches.length, 0);
});
