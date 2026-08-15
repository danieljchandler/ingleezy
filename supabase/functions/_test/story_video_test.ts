import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-story-video` — the cheap slideshow preview: one AI scene image and
 * one narration clip, standing in for a real generated video.
 *
 * Two guards make it worth testing. The narration is built out of the story's
 * own ENGLISH — the text the learner is here to read — and refuses anything
 * with no Latin letters in it. That check is inverted from the Arabic era and
 * kept rather than dropped: it is what catches a story whose columns were
 * filled the wrong way round, which is the failure the flip exists to
 * prevent. And the status write at the end deliberately preserves an existing
 * `video_status: "ready"` — regenerating a preview must not hide the Publish
 * button on a story whose full audio is already done.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

/** A 1x1 PNG, base64, as the image model's answer. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const line = (over: Record<string, unknown> = {}) => ({
  english: "Once upon a time. And then he walked.",
  ...over,
});

function backend(
  options: {
    story?: Record<string, unknown> | null;
    lines?: Array<Record<string, unknown>>;
    videoStatus?: string | null;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const {
    story = {
      id: STORY,
      title: "A story",
      title_arabic: "قصة",
      body_english: "Once upon a time",
      dialect: "Yemeni",
    },
    lines = [line()],
    videoStatus = "draft",
    extra = {},
  } = options;
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/authentic_stories": (request) => {
      if (request.method !== "GET") return json([], 200);
      // The second read asks only for video_status, to decide what to preserve.
      return request.url.includes("select=video_status")
        ? json({ video_status: videoStatus })
        : json(story);
    },
    "/rest/v1/authentic_story_lines": () => json(lines),
    "ai.gateway.lovable.dev": () => json({ data: [{ b64_json: PNG_B64 }] }),
    "/storage/v1": () => json({ Key: "listen-audio/authentic-stories/file" }),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("generate-story-video", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("generate-story-video", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    const patches = fn.calls
      .filter((c) => c.url.includes("authentic_stories") && c.method === "PATCH")
      .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      patches,
    };
  } finally {
    fn.restore();
  }
}

const imagePrompt = (result: { calls: string[]; bodies: Array<string | null> }) =>
  result.bodies[result.calls.findIndex((u) => u.includes("images/generations"))] ?? "";

Deno.test("generate-story-video answers the preflight", async () => {
  const fn = await loadFunction("generate-story-video", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("generate-story-video"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-video turns away an anonymous caller", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ extra: { "/auth/v1/user": () => json({ error: "no session" }, 401) } }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-video needs a story", async () => {
  const result = await call({}, backend());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing story_id");
});

Deno.test("generate-story-video says so when the story is gone", async () => {
  const result = await call({ story_id: STORY }, backend({ story: null }));

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "story_not_found");
});

Deno.test("generate-story-video returns the image and the narration", async () => {
  const result = await call({ story_id: STORY }, backend());

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready");
  assert(String(result.body.image_url).includes("listen-audio"));
  assert(String(result.body.audio_url).includes("listen-audio"));
  assertEquals(result.body.narration_arabic, "Once upon a time.");
  assertEquals(typeof result.body.duration_seconds, "number");
});

Deno.test("generate-story-video marks the story generating before it starts", async () => {
  const result = await call({ story_id: STORY }, backend());

  assertEquals(result.patches[0].story_video_status, "generating");
  // A previous failure's message and approval are cleared on the way in, so a
  // retry does not show the old error.
  assertEquals(result.patches[0].story_video_error, null);
  assertEquals(result.patches[0].story_video_approved, false);
});

Deno.test("generate-story-video stores both artefacts on the story", async () => {
  const result = await call({ story_id: STORY }, backend());

  const final = result.patches.at(-1);
  assertEquals(final?.story_video_status, "ready");
  assert(String(final?.story_video_url).includes("listen-audio"));
  assert(String(final?.video_preview_url).includes("listen-audio"));
  assertEquals((final?.line_durations as number[]).length, 1);
});

Deno.test("generate-story-video marks a fresh story preview-ready", async () => {
  const result = await call({ story_id: STORY }, backend({ videoStatus: "draft" }));

  assertEquals(result.patches.at(-1)?.video_status, "preview_ready");
});

Deno.test("generate-story-video leaves a finished story ready", async () => {
  // Regenerating the preview scene on a story whose full audio is already done
  // must not knock it back to preview_ready and hide the Publish button.
  const result = await call({ story_id: STORY }, backend({ videoStatus: "ready" }));

  assertEquals(result.patches.at(-1)?.video_status, undefined);
  assertEquals(result.patches.at(-1)?.story_video_status, "ready");
});

Deno.test("generate-story-video narrates the story's first sentence only", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ lines: [line({ english: "The first sentence. The second sentence." })] }),
  );

  assertEquals(result.body.narration_arabic, "The first sentence.");
});

Deno.test("generate-story-video caps the narration at 26 words", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const result = await call({ story_id: STORY }, backend({ lines: [line({ english: long })] }));

  assertEquals(String(result.body.narration_arabic).split(/\s+/).length, 26);
});

Deno.test("generate-story-video narrates the line's English", async () => {
  // The fallback chain over vocalised/dialect/bare Arabic went with the flip:
  // there is one field to narrate and it is the story's own text.
  const result = await call(
    { story_id: STORY },
    backend({ lines: [line({ english: "The market opens at dawn." })] }),
  );

  assertEquals(result.body.narration_arabic, "The market opens at dawn.");
});

Deno.test("generate-story-video falls back to the story body when it has no lines", async () => {
  const result = await call({ story_id: STORY }, backend({ lines: [] }));

  assertEquals(result.status, 200);
  assertEquals(result.body.narration_arabic, "Once upon a time");
});

Deno.test("generate-story-video refuses to narrate a line with no English in it", async () => {
  // The direction guard. A story whose `english` column somehow holds Arabic
  // has been filled the wrong way round, and narrating it would hand the
  // learner their own language read in an English voice.
  const result = await call(
    { story_id: STORY },
    backend({
      lines: [line({ english: "كان يا ما كان." })],
      story: {
        id: STORY,
        title: "A story",
        title_arabic: "قصة",
        body_english: "",
        dialect: "Gulf",
      },
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "no English text");
});

Deno.test("generate-story-video refuses when there is no English at all", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      lines: [],
      story: {
        id: STORY,
        title: "A story",
        title_arabic: null,
        body_english: "",
        dialect: "Gulf",
      },
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "No English text");
});

Deno.test("generate-story-video asks for a picture with no writing in it", async () => {
  // The image sits behind subtitles in the player, and a model that renders
  // its own text produces gibberish letters over real ones.
  const result = await call({ story_id: STORY }, backend());

  const prompt = imagePrompt(result);
  assertStringIncludes(prompt, "no text of any language");
  assertStringIncludes(prompt, "no letters visible in the scene");
});

Deno.test("generate-story-video does not force an Arab setting onto the story", async () => {
  // Removed with the flip, deliberately. `dialect` is the LEARNER's own
  // language, not the story's origin — so keying the scene on it dressed a
  // London news article in kanduras because the reader happens to be Gulf.
  // The scene now follows whatever the text itself describes.
  const result = await call({ story_id: STORY }, backend());

  const prompt = imagePrompt(result);
  assertEquals(prompt.includes("Sana'a tower houses"), false);
  assertEquals(prompt.includes("authentic Arab cultural setting"), false);
});

Deno.test("generate-story-video draws the scene from the narrated line", async () => {
  const result = await call({ story_id: STORY }, backend());

  // The image and the narration describe the same moment, so they are built
  // from the same text rather than from two different fields.
  assertStringIncludes(imagePrompt(result), "Once upon a time.");
});

Deno.test("generate-story-video reads only the first few lines", async () => {
  const result = await call({ story_id: STORY }, backend());

  const read = result.calls.find((url) => url.includes("authentic_story_lines")) ?? "";
  assertStringIncludes(read, "limit=3");
  assertStringIncludes(read, "line_index.asc");
});

Deno.test("generate-story-video leaves a failed run showing a spinner", async () => {
  // Pinned, not fixed. The failure handler re-reads the request with
  // `req.clone().json()` to recover the story id — but the body was already
  // consumed by the `req.json()` at the top, and cloning a disturbed request
  // throws. That throw lands in the handler's own empty catch, so the
  // `story_video_status: "failed"` write never happens and the row is left at
  // "generating" — which the admin form renders as a spinner, indefinitely.
  const result = await call(
    { story_id: STORY },
    backend({ extra: { "ai.gateway.lovable.dev": () => json({ error: "down" }, 503) } }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "image gen failed: 503");
  // The last thing written is still the entry marker.
  assertEquals(result.patches.at(-1)?.story_video_status, "generating");
  assertEquals(
    result.patches.some((p) => p.story_video_status === "failed"),
    false,
  );
});

Deno.test("generate-story-video reports an image model that returned nothing", async () => {
  const result = await call(
    { story_id: STORY },
    backend({ extra: { "ai.gateway.lovable.dev": () => json({ data: [] }) } }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "no image in response");
});

Deno.test("generate-story-video reports a missing gateway key", async () => {
  const result = await call({ story_id: STORY }, backend(), {
    env: { LOVABLE_API_KEY: undefined },
  });

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "LOVABLE_API_KEY");
});

Deno.test("generate-story-video reports a TTS outage", async () => {
  const result = await call(
    { story_id: STORY },
    backend({
      extra: {
        "api.elevenlabs.io": () => json({ error: "down" }, 503),
        "tts.speech.microsoft.com": () => json({ error: "down" }, 503),
      },
    }),
  );

  assertEquals(result.status, 500);
  // Same as above: the status is never moved off "generating".
  assertEquals(result.patches.at(-1)?.story_video_status, "generating");
});
