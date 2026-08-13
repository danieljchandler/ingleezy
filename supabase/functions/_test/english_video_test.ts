import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `process-english-video` — the English-target video pipeline.
 *
 * A deliberately small mirror of the Arabic pipeline: one Deepgram pass with
 * utterance segmentation, then batched Brain calls for the Arabic scaffold
 * (dialect + Fusha + literal gloss). What is worth pinning is the persisted
 * line shape — { english, arabic, fusha, literal, startMs, endMs } is the
 * contract every learner surface will read — the status machine
 * (processing → completed / failed with the error preserved), and the
 * batching guard that pads a miscounting model instead of shifting every
 * later line's scaffold onto the wrong sentence.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "33333333-3333-4333-8333-333333333333";

const scaffold = (n: number) => ({
  lines: Array.from({ length: n }, (_, i) => ({
    arabic: `عربي ${i + 1}`,
    fusha: `فصحى ${i + 1}`,
    literal: `حرفي ${i + 1}`,
  })),
});

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

const deepgram = (utterances: Array<{ transcript: string; start: number; end: number }>): UpstreamHandler =>
  () => json({ results: { utterances }, metadata: { duration: utterances.at(-1)?.end ?? 0 } });

const TWO_UTTERANCES = [
  { transcript: "Good morning, everyone.", start: 0.5, end: 2.1 },
  { transcript: "Let's get started.", start: 2.4, end: 4.0 },
];

/** PATCH bodies written to discover_videos, in order. */
function patches(calls: Array<{ url: string; method: string; body: string | null }>) {
  return calls
    .filter((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "PATCH")
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);
}

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    "/rest/v1/discover_videos": (request) => {
      if (request.method === "GET") {
        return json({ id: VIDEO, source_url: "https://youtube.com/watch?v=abc", dialect: "Gulf" });
      }
      return json({});
    },
    // Storage miss by default — the wav/mp4/… ladder all 404s.
    "/storage/v1/object": () => json({ error: "not found" }, 404),
    "functions/v1/download-media": () =>
      json({ audioBase64: btoa("fixture-audio"), contentType: "audio/mp4" }),
    "api.deepgram.com": deepgram(TWO_UTTERANCES),
    ...emittingRoutes(scaffold(2)),
    ...extra,
  };
}

/** Both gateway routes answer with the same tool payload. */
function emittingRoutes(payload: unknown): Record<string, UpstreamHandler> {
  return {
    "ai.gateway.lovable.dev": emitting(payload),
    "openrouter.ai": emitting(payload),
  };
}

async function call(
  body: unknown,
  routes: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("process-english-video", { upstreams: routes, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("process-english-video", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    await fn.background();
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => ({ url: c.url, method: c.method, body: c.body })),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("process-english-video answers the preflight", async () => {
  const fn = await loadFunction("process-english-video", { upstreams: upstreams() });
  try {
    const response = await fn.handler(optionsRequest("process-english-video"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("process-english-video turns an anonymous caller away", async () => {
  const result = await call({ videoId: VIDEO }, upstreams(), { jwt: null });
  assertEquals(result.status, 401);
});

Deno.test("process-english-video is admin-only", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(result.status, 403);
});

Deno.test("process-english-video needs a videoId", async () => {
  const result = await call({}, upstreams());
  assertEquals(result.status, 400);
});

Deno.test("process-english-video persists the bilingual line contract", async () => {
  const result = await call({ videoId: VIDEO }, upstreams());

  assertEquals(result.status, 200);
  assertEquals(result.body.success, true);
  assertEquals(result.body.lines, 2);

  const finals = patches(result.calls).filter((p) => p.transcription_status === "completed");
  assertEquals(finals.length, 1);
  const lines = finals[0].transcript_lines as Array<Record<string, unknown>>;
  assertEquals(lines.length, 2);
  assertEquals(lines[0].english, "Good morning, everyone.");
  assertEquals(lines[0].arabic, "عربي 1");
  assertEquals(lines[0].fusha, "فصحى 1");
  assertEquals(lines[0].literal, "حرفي 1");
  assertEquals(lines[0].startMs, 500);
  assertEquals(lines[0].endMs, 2100);
  // Duration learned from the last utterance.
  assertEquals(finals[0].duration_seconds, 4);
});

Deno.test("process-english-video marks processing before it transcribes", async () => {
  const result = await call({ videoId: VIDEO }, upstreams());
  const all = patches(result.calls);
  assertEquals(all[0].transcription_status, "processing");
});

Deno.test("process-english-video pads a miscounting scaffold instead of shifting lines", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams(emittingRoutes(scaffold(1))), // model returned 1 entry for 2 lines
  );

  assertEquals(result.status, 200);
  const finals = patches(result.calls).filter((p) => p.transcription_status === "completed");
  const lines = finals[0].transcript_lines as Array<Record<string, unknown>>;
  assertEquals(lines.length, 2);
  assertEquals(lines[0].arabic, "عربي 1");
  // The second line's scaffold is empty, not stolen from a later batch.
  assertEquals(lines[1].arabic, "");
  assertEquals(lines[1].english, "Let's get started.");
});

Deno.test("process-english-video falls back to one whole-transcript line without utterances", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({
      "api.deepgram.com": () =>
        json({
          results: { channels: [{ alternatives: [{ transcript: "Hello there." }] }] },
          metadata: { duration: 1.5 },
        }),
      ...emittingRoutes(scaffold(1)),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.lines, 1);
});

Deno.test("process-english-video records a Deepgram failure on the row", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({ "api.deepgram.com": () => json({ error: "down" }, 503) }),
  );

  assertEquals(result.status, 500);
  const failed = patches(result.calls).filter((p) => p.transcription_status === "failed");
  assertEquals(failed.length, 1);
  assertStringIncludes(String(failed[0].transcription_error), "Deepgram 503");
});

Deno.test("process-english-video treats a silent video as a failure, not an empty publish", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({ "api.deepgram.com": () => json({ results: { utterances: [] }, metadata: { duration: 0 } }) }),
  );

  assertEquals(result.status, 500);
  const failed = patches(result.calls).filter((p) => p.transcription_status === "failed");
  assertStringIncludes(String(failed[0].transcription_error), "no speech");
});

Deno.test("process-english-video uses download-media when storage has nothing", async () => {
  const result = await call({ videoId: VIDEO }, upstreams());
  assert(result.calls.some((c) => c.url.includes("download-media")));
});

Deno.test("process-english-video reports an unknown video as 404", async () => {
  const result = await call(
    { videoId: VIDEO },
    upstreams({
      "/rest/v1/discover_videos": (request) =>
        request.method === "GET" ? json(null) : json({}),
    }),
  );
  assertEquals(result.status, 404);
});
