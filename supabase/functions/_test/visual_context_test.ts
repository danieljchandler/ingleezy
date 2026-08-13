import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `extract-visual-context` — OCR over sampled video frames.
 *
 * It has two quite different jobs behind one endpoint, and the split is by
 * whether `videoId` is present. Without one it is a read-only helper any
 * signed-in learner can call from Transcribe. With one it becomes part of the
 * admin video pipeline: it writes to `discover_videos` with the service role
 * and can kick off processing — so it re-checks for admin at that point rather
 * than trusting the caller's earlier authentication.
 *
 * The normalisation is the other half. A vision model asked for structured OCR
 * routinely returns segments with a missing translation, an out-of-range
 * confidence, or timestamps as strings, and every one of those is rendered
 * directly onto a video timeline.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO_ID = "22222222-0000-4000-8000-000000000000";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/rpc/is_admin": () => json(false),
    "/rest/v1/discover_videos": () => json({}, 204),
    "/storage/v1/object/video-audio": () => json({ Key: "video-audio/x" }),
    "/functions/v1/process-approved-video": () => json({ ok: true }),
    ...extra,
  };
}

const aFrame = (seconds: number) => ({
  dataUri: btoa("fake jpeg"),
  timestampSeconds: seconds,
});

const aResult = (over: Record<string, unknown> = {}) => ({
  onScreenTextSegments: [
    {
      text: "الزحمة قاتلة",
      translation: "The traffic is killing me",
      transliteration: "iz-zahma qaatila",
      startSeconds: 0,
      endSeconds: 3,
      confidence: "high",
    },
  ],
  sceneContext: "One person in a car, daytime.",
  culturalContext: "",
  detectedDialectCues: ["زحمة"],
  ...over,
});

/** The vision model answers prose containing JSON, not a tool call. */
const vision = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(JSON.stringify(payload));

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("extract-visual-context", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("extract-visual-context", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
    };
  } finally {
    fn.restore();
  }
}

Deno.test("extract-visual-context returns the OCR it found", async () => {
  const { status, body } = await call(
    { frames: [aFrame(0), aFrame(3)] },
    caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
  );

  assertEquals(status, 200);
  assertEquals(body.success, true);
  const result = body.result as { onScreenTextSegments: unknown[]; sceneContext: string };
  assertEquals(result.onScreenTextSegments.length, 1);
  assertEquals(result.sceneContext, "One person in a car, daytime.");
});

Deno.test("extract-visual-context sends every frame with its timestamp", async () => {
  const { bodies, calls } = await call(
    { frames: [aFrame(0), aFrame(2), aFrame(4)], audioDuration: 6, videoTitle: "Traffic" },
    caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  // The timestamps are what let the model place text on the timeline; without
  // them it can only say "this text appears somewhere".
  assertStringIncludes(sent, "Frame 1: 0s");
  assertStringIncludes(sent, "Frame 3: 4s");
  assertStringIncludes(sent, "total duration: 6s");
  // JSON-encoded, so the quotes around the title arrive escaped.
  assertStringIncludes(sent, 'titled \\"Traffic\\"');
});

Deno.test("extract-visual-context caps how many frames it sends", async () => {
  const { bodies, calls } = await call(
    { frames: Array.from({ length: 40 }, (_, i) => aFrame(i)) },
    caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as {
    messages: Array<{ content: Array<{ type: string }> }>;
  };
  const images = sent.messages.at(-1)?.content.filter((c) => c.type === "image_url") ?? [];
  // 16. Each frame is a full image in the request, so an uncapped long video
  // would blow the context window and the bill at the same time.
  assertEquals(images.length, 16);
});

Deno.test("extract-visual-context wraps bare base64 frames as data URIs", async () => {
  const { bodies, calls } = await call(
    { frames: [aFrame(0)] },
    caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assertStringIncludes(bodies[i] ?? "", "data:image/jpeg;base64,");
});

Deno.test("extract-visual-context drops segments with no text", async () => {
  const { body } = await call(
    { frames: [aFrame(0)] },
    caller({
      "ai.gateway.lovable.dev": vision(
        aResult({
          onScreenTextSegments: [
            { text: "الزحمة", translation: "traffic", startSeconds: 0, endSeconds: 1 },
            { text: "   ", translation: "nothing" },
            { translation: "orphan" },
          ],
        }),
      ),
    }),
  );

  const result = body.result as { onScreenTextSegments: unknown[] };
  // A segment with no text is a caption box on the timeline with nothing in it.
  assertEquals(result.onScreenTextSegments.length, 1);
});

Deno.test("extract-visual-context defaults a missing confidence to medium", async () => {
  const { body } = await call(
    { frames: [aFrame(0)] },
    caller({
      "ai.gateway.lovable.dev": vision(
        aResult({
          onScreenTextSegments: [
            { text: "أ", startSeconds: 0, endSeconds: 1 },
            { text: "ب", startSeconds: 0, endSeconds: 1, confidence: "extremely sure" },
            { text: "ج", startSeconds: 0, endSeconds: 1, confidence: "low" },
          ],
        }),
      ),
    }),
  );

  const segments = body.result as {
    onScreenTextSegments: Array<{ confidence: string }>;
  };
  // The UI styles by confidence. An unrecognised value would fall through every
  // branch and render unstyled, which reads as a fourth state.
  assertEquals(segments.onScreenTextSegments.map((s) => s.confidence), [
    "medium",
    "medium",
    "low",
  ]);
});

Deno.test("extract-visual-context ends an untimed segment at the last frame", async () => {
  const { body } = await call(
    { frames: [aFrame(0), aFrame(5), aFrame(12)] },
    caller({
      "ai.gateway.lovable.dev": vision(
        aResult({
          onScreenTextSegments: [{ text: "الزحمة", translation: "traffic" }],
        }),
      ),
    }),
  );

  const result = body.result as { onScreenTextSegments: Array<{ endSeconds: number }> };
  // Defaulting to 0 would collapse the segment to a zero-width sliver at the
  // start of the timeline rather than spanning what was sampled.
  assertEquals(result.onScreenTextSegments[0].endSeconds, 12);
});

Deno.test("extract-visual-context coerces string timestamps to numbers", async () => {
  const { body } = await call(
    { frames: [aFrame(0)] },
    caller({
      "ai.gateway.lovable.dev": vision(
        aResult({
          onScreenTextSegments: [
            { text: "الزحمة", startSeconds: "1.5", endSeconds: "4", confidence: "high" },
          ],
        }),
      ),
    }),
  );

  const result = body.result as {
    onScreenTextSegments: Array<{ startSeconds: unknown; endSeconds: unknown }>;
  };
  // These are used in arithmetic on the timeline; a string would concatenate
  // rather than add.
  assertEquals(result.onScreenTextSegments[0].startSeconds, 1.5);
  assertEquals(result.onScreenTextSegments[0].endSeconds, 4);
});

Deno.test("extract-visual-context defaults the free-text fields to empty strings", async () => {
  const { body } = await call(
    { frames: [aFrame(0)] },
    caller({
      "ai.gateway.lovable.dev": vision({ onScreenTextSegments: [] }),
    }),
  );

  const result = body.result as {
    sceneContext: string;
    culturalContext: string;
    detectedDialectCues: unknown[];
  };
  // `String(undefined)` is the string "undefined", which would be written into
  // `discover_videos.cultural_context` and shown to a reviewer.
  assertEquals(result.sceneContext, "");
  assertEquals(result.culturalContext, "");
  assertEquals(result.detectedDialectCues, []);
});

Deno.test("extract-visual-context refuses a request with no frames", async () => {
  for (const frames of [undefined, [], "not an array"]) {
    const { status, body, calls } = await call(
      { frames },
      caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(frames)} to be refused`);
    assertStringIncludes(String(body.error), "frames array is required");
    assert(!calls.some((url) => url.includes("chat/completions")));
  }
});

Deno.test("extract-visual-context refuses an unauthenticated caller", async () => {
  const { status, calls } = await call(
    { frames: [aFrame(0)] },
    caller({ "ai.gateway.lovable.dev": vision(aResult()) }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("chat/completions")));
});

Deno.test("extract-visual-context names an exhausted-credits failure", async () => {
  const { status, body } = await call(
    { frames: [aFrame(0)] },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402) }),
  );

  // Flattened to 500, but with the reason in the message — an operator reading
  // logs needs to tell an outage from a billing problem.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "AI credits exhausted");
});

Deno.test("extract-visual-context names a rate limit", async () => {
  const { body } = await call(
    { frames: [aFrame(0)] },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "slow" }, 429) }),
  );

  assertStringIncludes(String(body.error), "Rate limit exceeded");
});

Deno.test("extract-visual-context reports unparsable output rather than empty OCR", async () => {
  const { status, body } = await call(
    { frames: [aFrame(0)] },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("I cannot read these frames.") }),
  );

  // Unlike `analyze-meme`, this one fails rather than degrading. It feeds a
  // transcription pipeline, and empty OCR presented as success would be written
  // into the video row as "no readable text" — a claim rather than a failure.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Failed to parse");
});

// ── The admin half ──────────────────────────────────────────────────────────

Deno.test("extract-visual-context re-checks for admin before writing a video", async () => {
  const { status, body, calls } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(false),
    }),
  );

  // The learner-facing half of this function needs no role. Passing a `videoId`
  // turns it into a service-role write against shared content, so the check
  // happens at that point rather than at the door.
  assertEquals(status, 403);
  assertStringIncludes(String(body.error), "Admin access required");
  assert(!calls.some((url) => url.includes("discover_videos")));
});

Deno.test("extract-visual-context refuses when the admin check itself fails", async () => {
  const { status, calls } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json({ message: "boom" }, 500),
    }),
  );

  // Fails closed.
  assertEquals(status, 403);
  assert(!calls.some((url) => url.includes("discover_videos")));
});

Deno.test("extract-visual-context stores the result and updates the video", async () => {
  const { status, calls, bodies } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  assertEquals(status, 200);
  assert(calls.some((url) => url.includes("video-audio")));
  const update = bodies[calls.findIndex((u) => u.includes("discover_videos"))] ?? "";
  // The reviewer reads `cultural_context`, so the segments are flattened into
  // a timestamped summary rather than left as JSON they would have to decode.
  assertStringIncludes(update, "On-screen text:");
  assertStringIncludes(update, "الزحمة قاتلة");
});

Deno.test("extract-visual-context flags a video with no readable text", async () => {
  const { calls, bodies } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult({ onScreenTextSegments: [] })),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  const update = JSON.parse(
    bodies[calls.findIndex((u) => u.includes("discover_videos"))] ?? "{}",
  ) as Record<string, unknown>;
  // A meme with no OCR is not necessarily broken — it may be spoken-only — so
  // the row is flagged for review rather than failed. The scene description is
  // still worth keeping, and it is what the reviewer has to go on.
  assertStringIncludes(
    String(update.transcription_error),
    "found no readable on-screen text",
  );
  assertStringIncludes(String(update.cultural_context), "One person in a car");
});

Deno.test("extract-visual-context asks for manual review when it saw nothing at all", async () => {
  const { calls, bodies } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision({
        onScreenTextSegments: [],
        sceneContext: "",
        culturalContext: "",
        detectedDialectCues: [],
      }),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  const update = JSON.parse(
    bodies[calls.findIndex((u) => u.includes("discover_videos"))] ?? "{}",
  ) as Record<string, unknown>;
  // With no text *and* no scene there is nothing to write, so the column would
  // otherwise be set to an empty string — which reads to a reviewer as "this
  // was analysed and there was nothing here" rather than "look at this
  // yourself".
  assertStringIncludes(String(update.cultural_context), "Review the source video manually");
});

Deno.test("extract-visual-context clears a previous error when text is found", async () => {
  const { calls, bodies } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  const update = JSON.parse(
    bodies[calls.findIndex((u) => u.includes("discover_videos"))] ?? "{}",
  ) as Record<string, unknown>;
  // Null, not left alone: a stale error on a video that now has text would
  // keep it out of the publishable queue forever.
  assertEquals(update.transcription_error, null);
});

Deno.test("extract-visual-context does not kick off processing unless asked", async () => {
  const { body, calls } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  assertEquals(body.processingQueued, false);
  assert(!calls.some((url) => url.includes("process-approved-video")));
});

Deno.test("extract-visual-context kicks off processing when asked", async () => {
  const { body } = await call(
    { frames: [aFrame(0)], videoId: VIDEO_ID, kickoffProcessing: true },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  // Reported as queued rather than done: the kickoff runs after the response,
  // so the admin sees "started" rather than waiting out a full transcription.
  assertEquals(body.processingQueued, true);
});

Deno.test("extract-visual-context does no video write without a videoId", async () => {
  const { status, calls } = await call(
    { frames: [aFrame(0)] },
    caller({
      "ai.gateway.lovable.dev": vision(aResult()),
      "/rest/v1/rpc/is_admin": () => json(true),
    }),
  );

  // The learner-facing path: OCR back, nothing persisted, no admin check even
  // attempted.
  assertEquals(status, 200);
  assert(!calls.some((url) => url.includes("discover_videos")));
  assert(!calls.some((url) => url.includes("is_admin")));
});
