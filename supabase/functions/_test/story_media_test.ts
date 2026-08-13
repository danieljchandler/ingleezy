import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-story-preview-audio` and `edit-story-scene-image` — the two
 * story-media functions an admin drives by hand.
 *
 * The preview reads a story's first five lines and narrates them, choosing the
 * text to speak through a fallback chain (vocalised dialect, vocalised Fusha,
 * plain dialect, plain Arabic) that decides what the learner actually hears.
 * It also carries on past a failed line rather than abandoning the preview.
 *
 * The scene editor replaces one image inside a JSONB array by index, from
 * either a generated image or an uploaded data URL — and the array is
 * rewritten whole, so leaving the other scenes intact is the property worth
 * asserting.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

/** A 1x1 PNG, base64, as an upload and as an image-model answer. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/rpc/can_manage_content": () => json(true),
    "/storage/v1": () => json({ Key: "listen-audio/authentic-stories/file" }),
    ...extra,
  };
}

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

/** The last write to a table, parsed. */
function lastWrite(
  result: { calls: string[]; methods: string[]; bodies: Array<string | null> },
  table: string,
  method = "PATCH",
): Record<string, unknown> | undefined {
  const found = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes(table) && c.method === method)
    .at(-1);
  return found ? (JSON.parse(found.body ?? "{}") as Record<string, unknown>) : undefined;
}

// ── generate-story-preview-audio ─────────────────────────────────────────────

const storyLine = (index: number, over: Record<string, unknown> = {}) => ({
  id: `line-${index}`,
  story_id: STORY,
  line_index: index,
  arabic: `سطر ${index}`,
  arabic_vocalized: `سَطْر ${index}`,
  dialect: null,
  dialect_vocalized: null,
  ...over,
});

function previewBackend(
  options: {
    story?: Record<string, unknown> | null;
    lines?: Array<Record<string, unknown>>;
    extra?: Record<string, UpstreamHandler>;
  } = {},
) {
  const {
    story = { id: STORY, dialect: "Yemeni", status: "draft" },
    lines = [storyLine(0), storyLine(1)],
    extra = {},
  } = options;
  return caller({
    "/rest/v1/authentic_stories": (request) =>
      request.method === "GET" ? json(story) : json([], 200),
    "/rest/v1/authentic_story_lines": (request) =>
      request.method === "GET" ? json(lines) : json([], 200),
    ...extra,
  });
}

Deno.test("generate-story-preview-audio answers the preflight", async () => {
  const fn = await loadFunction("generate-story-preview-audio", { upstreams: previewBackend() });
  try {
    const response = await fn.handler(optionsRequest("generate-story-preview-audio"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-story-preview-audio turns away an anonymous caller", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({ extra: { "/auth/v1/user": () => json({ error: "no session" }, 401) } }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("generate-story-preview-audio needs a story", async () => {
  const result = await call("generate-story-preview-audio", {}, previewBackend());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing story_id");
});

Deno.test("generate-story-preview-audio says so when the story is gone", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({ story: null }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "story_not_found");
});

Deno.test("generate-story-preview-audio says so when the story has no lines", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({ lines: [] }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "no_lines_found");
});

Deno.test("generate-story-preview-audio narrates each line and reports the count", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend(),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.preview_lines, 2);
  assertEquals(result.body.provider, "azure");
  assert(String(result.body.preview_url).includes("listen-audio"));
});

Deno.test("generate-story-preview-audio asks only for the first five lines", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend(),
  );

  const read = result.calls.find((url) => url.includes("authentic_story_lines")) ?? "";
  assertStringIncludes(read, "limit=5");
  assertStringIncludes(read, "line_index.asc");
});

Deno.test("generate-story-preview-audio stores one clip per line", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend(),
  );

  const uploads = result.calls.filter((url) => url.includes("/storage/v1/object"));
  assertEquals(uploads.length, 2);
  assertStringIncludes(uploads[0], `authentic-stories/${STORY}/preview-line-0.`);
  assertStringIncludes(uploads[1], `authentic-stories/${STORY}/preview-line-1.`);
});

Deno.test("generate-story-preview-audio writes each clip back onto its line", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend(),
  );

  const patch = lastWrite(result, "authentic_story_lines");
  assert(String(patch?.audio_url).includes("listen-audio"));
});

Deno.test("generate-story-preview-audio marks the story as previewed", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend(),
  );

  const patch = lastWrite(result, "authentic_stories");
  assertEquals(patch?.video_status, "preview_generated");
  assert(String(patch?.video_preview_url).includes("listen-audio"));
});

Deno.test("generate-story-preview-audio prefers the vocalised dialect text", async () => {
  // The fallback chain decides what the learner hears: dialect with tashkeel
  // first, because that is the version the reading view highlights.
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
      lines: [
        storyLine(0, {
          dialect_vocalized: "بِالدَّارِجَة",
          dialect: "بالدارجة",
          arabic_vocalized: "بِالفُصْحَى",
          arabic: "بالفصحى",
        }),
      ],
    }),
  );

  assertEquals(result.status, 200);
  const spoken = result.bodies[result.calls.findIndex((u) => u.includes("speech.microsoft.com"))];
  assertStringIncludes(spoken ?? "", "بِالدَّارِجَة");
});

Deno.test("generate-story-preview-audio falls back to the vocalised Fusha", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
      lines: [
        storyLine(0, {
          dialect_vocalized: null,
          dialect: null,
          arabic_vocalized: "بِالفُصْحَى",
          arabic: "بالفصحى",
        }),
      ],
    }),
  );

  const spoken = result.bodies[result.calls.findIndex((u) => u.includes("speech.microsoft.com"))];
  assertStringIncludes(spoken ?? "", "بِالفُصْحَى");
});

Deno.test("generate-story-preview-audio falls back to bare Arabic last", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
      lines: [
        storyLine(0, { dialect_vocalized: null, dialect: null, arabic_vocalized: null }),
      ],
    }),
  );

  const spoken = result.bodies[result.calls.findIndex((u) => u.includes("speech.microsoft.com"))];
  assertStringIncludes(spoken ?? "", "سطر 0");
});

Deno.test("generate-story-preview-audio skips a line with no text at all", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
      lines: [
        storyLine(0, { arabic: "", arabic_vocalized: null }),
        storyLine(1),
      ],
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.preview_lines, 1);
});

Deno.test("generate-story-preview-audio carries on past a failed upload", async () => {
  let uploads = 0;
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
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
  // One of two lines made it, and the preview is still published rather than
  // the whole run being lost.
  assertEquals(result.body.preview_lines, 1);
});

Deno.test("generate-story-preview-audio reports a TTS outage", async () => {
  const result = await call(
    "generate-story-preview-audio",
    { story_id: STORY },
    previewBackend({
      extra: { "tts.speech.microsoft.com": () => json({ error: "down" }, 503) },
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "internal");
});

// ── edit-story-scene-image ───────────────────────────────────────────────────

const segment = (index: number, over: Record<string, unknown> = {}) => ({
  index,
  image_url: `https://cdn.test/scene-${index}.png`,
  url: `https://cdn.test/scene-${index}.png`,
  prompt: `a desert at dusk, scene ${index}`,
  narration_arabic: `سطر ${index}`,
  duration_seconds: 4,
  ...over,
});

function sceneBackend(
  options: {
    story?: Record<string, unknown> | null;
    extra?: Record<string, UpstreamHandler>;
  } = {},
) {
  const {
    story = { id: STORY, story_video_segments: [segment(0), segment(1)] },
    extra = {},
  } = options;
  return caller({
    "/rest/v1/authentic_stories": (request) =>
      request.method === "GET" ? json(story) : json([], 200),
    "ai.gateway.lovable.dev": () => json({ data: [{ b64_json: PNG_B64 }] }),
    ...extra,
  });
}

Deno.test("edit-story-scene-image answers the preflight", async () => {
  const fn = await loadFunction("edit-story-scene-image", { upstreams: sceneBackend() });
  try {
    const response = await fn.handler(optionsRequest("edit-story-scene-image"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("edit-story-scene-image turns away an anonymous caller", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({ extra: { "/auth/v1/user": () => json({ error: "no session" }, 401) } }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("edit-story-scene-image turns away a caller who may not manage content", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({ extra: { "/rest/v1/rpc/can_manage_content": () => json(false) } }),
  );

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "forbidden");
});

Deno.test("edit-story-scene-image needs a story and a scene number", async () => {
  const noStory = await call("edit-story-scene-image", { scene_index: 0 }, sceneBackend());
  assertEquals(noStory.status, 400);

  const noScene = await call("edit-story-scene-image", { story_id: STORY }, sceneBackend());
  assertEquals(noScene.status, 400);
});

Deno.test("edit-story-scene-image rejects a scene outside the story", async () => {
  const tooHigh = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 9 },
    sceneBackend(),
  );
  assertEquals(tooHigh.status, 500);
  assertStringIncludes(String(tooHigh.body.error), "out of range");

  const negative = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: -1 },
    sceneBackend(),
  );
  assertEquals(negative.status, 500);
});

Deno.test("edit-story-scene-image says so when the story is gone", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({ story: null }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "story not found");
});

Deno.test("edit-story-scene-image regenerates from the scene's own prompt", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 1 },
    sceneBackend(),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  assertEquals(result.body.scene_index, 1);

  const sent = result.bodies[result.calls.findIndex((u) => u.includes("images/generations"))] ?? "";
  assertStringIncludes(sent, "a desert at dusk, scene 1");
});

Deno.test("edit-story-scene-image prefers a prompt the admin edited", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0, prompt: "  a souq at night  " },
    sceneBackend(),
  );

  assertEquals(result.status, 200);
  const sent = result.bodies[result.calls.findIndex((u) => u.includes("images/generations"))] ?? "";
  assertStringIncludes(sent, "a souq at night");

  // The edited prompt is stored, so regenerating again reuses it.
  const patch = lastWrite(result, "authentic_stories");
  const segments = patch?.story_video_segments as Array<Record<string, unknown>>;
  assertEquals(segments[0].prompt, "a souq at night");
});

Deno.test("edit-story-scene-image refuses to regenerate with no prompt anywhere", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({
      story: { id: STORY, story_video_segments: [segment(0, { prompt: "" })] },
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "no prompt available");
});

Deno.test("edit-story-scene-image uploads a supplied image instead of generating", async () => {
  const result = await call(
    "edit-story-scene-image",
    {
      story_id: STORY,
      scene_index: 0,
      image_data_url: `data:image/jpeg;base64,${PNG_B64}`,
    },
    sceneBackend(),
  );

  assertEquals(result.status, 200);
  assertEquals(result.calls.some((url) => url.includes("images/generations")), false);
  // The extension follows the declared type, so the stored file is servable.
  const upload = result.calls.find((url) => url.includes("/storage/v1/object")) ?? "";
  assertStringIncludes(upload, ".jpg");
});

Deno.test("edit-story-scene-image rejects something that is not a data URL", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0, image_data_url: "https://cdn.test/image.png" },
    sceneBackend(),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "base64 data URL");
});

Deno.test("edit-story-scene-image replaces only the scene it was asked about", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 1 },
    sceneBackend(),
  );

  const patch = lastWrite(result, "authentic_stories");
  const segments = patch?.story_video_segments as Array<Record<string, unknown>>;
  assertEquals(segments.length, 2);
  // Untouched.
  assertEquals(segments[0].image_url, "https://cdn.test/scene-0.png");
  // Replaced — and both URL fields, because different readers use different ones.
  assert(String(segments[1].image_url).includes("listen-audio"));
  assertEquals(segments[1].image_url, segments[1].url);
  // Everything else about the scene survives the rewrite.
  assertEquals(segments[1].narration_arabic, "سطر 1");
  assertEquals(segments[1].duration_seconds, 4);
});

Deno.test("edit-story-scene-image names each edit uniquely", async () => {
  // The path carries a timestamp rather than overwriting, so a browser holding
  // the previous image cached still sees the new one.
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend(),
  );

  const upload = result.calls.find((url) => url.includes("/storage/v1/object")) ?? "";
  assertStringIncludes(upload, `authentic-stories/${STORY}/scene-0-edit-`);
});

Deno.test("edit-story-scene-image reports an image model that returned nothing", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({ extra: { "ai.gateway.lovable.dev": () => json({ data: [] }) } }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "no image in response");
});

Deno.test("edit-story-scene-image reports a failed image call", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({ extra: { "ai.gateway.lovable.dev": () => json({ error: "down" }, 503) } }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "image gen failed: 503");
});

Deno.test("edit-story-scene-image reports a rejected save", async () => {
  const result = await call(
    "edit-story-scene-image",
    { story_id: STORY, scene_index: 0 },
    sceneBackend({
      extra: {
        "/rest/v1/authentic_stories": (request) =>
          request.method === "GET"
            ? json({ id: STORY, story_video_segments: [segment(0)] })
            : json({ message: "permission denied" }, 403),
      },
    }),
  );

  assertEquals(result.status, 500);
});
