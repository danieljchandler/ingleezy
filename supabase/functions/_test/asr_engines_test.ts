import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { audioFile, formRequest, jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * Deepgram and Munsit — the two ASR engines the Soniox/Fanar tests do not cover.
 *
 * Transcribe fires all four in parallel and arbitrates between the results, so
 * each one's job is to produce the *same normalised shape* out of a completely
 * different upstream. That normalisation is the whole contract and it is
 * invisible from the page: an engine that returns a plausible-looking body with
 * the wrong field names just looks like an engine that heard nothing, and the
 * arbitration quietly drops it.
 *
 * They also disagree about how they are invoked, which is not cosmetic:
 * Deepgram accepts both a JSON `audioUrl` (streamed through, so a long video
 * never lands in edge memory) and a multipart upload; Munsit is multipart or
 * base64 and dispatches its decoder on the *filename extension*, so the part
 * has to be named for the container the bytes actually are.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

/** Deepgram's own envelope: everything useful is four levels down. */
const deepgram = (
  transcript: string,
  words: Array<Record<string, unknown>> = [],
): UpstreamHandler =>
() =>
  json({
    results: {
      channels: [{ alternatives: [{ transcript, words, confidence: 0.9 }] }],
    },
  });

/** The audio file Deepgram is pointed at when given a URL. */
const storedAudio = (): UpstreamHandler => () =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "audio/mp4" },
  });

async function run(
  name: string,
  request: Request,
  upstreams: Record<string, UpstreamHandler>,
  env?: Record<string, string | undefined>,
) {
  const fn = await loadFunction(name, { upstreams, env });
  try {
    const response = await fn.handler(request);
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
      headers: fn.calls.map((c) => c.headers),
    };
  } finally {
    fn.restore();
  }
}

// ── deepgram-transcribe ─────────────────────────────────────────────────────

Deno.test("deepgram-transcribe normalises the transcript out of Deepgram's envelope", async () => {
  const { status, body } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/clip.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا كيف حالك"),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  assertEquals(status, 200);
  // `text`, flat. Every one of the four engines answers `text`, and Transcribe
  // reads exactly that — an engine returning `transcript` looks silent.
  assertEquals(body.text, "مرحبا كيف حالك");
});

Deno.test("deepgram-transcribe prefers the punctuated form of each word", async () => {
  const { body } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/clip.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا، كيف حالك؟", [
        { word: "مرحبا", punctuated_word: "مرحبا،", start: 0, end: 0.5, speaker: 0 },
        { word: "كيف", start: 0.5, end: 0.9, speaker: 1 },
      ]),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const words = body.words as Array<Record<string, unknown>>;
  // Punctuation is what makes a transcript readable as sentences rather than a
  // word list, and it only exists on `punctuated_word`.
  assertEquals(words[0].text, "مرحبا،");
  // Falls back to the bare word when Deepgram did not punctuate that token.
  assertEquals(words[1].text, "كيف");
});

Deno.test("deepgram-transcribe turns speaker integers into labels", async () => {
  const { body } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/clip.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا", [
        { word: "مرحبا", start: 0, end: 0.5, speaker: 0 },
        { word: "أهلا", start: 1, end: 1.5, speaker: 1 },
        { word: "طيب", start: 2, end: 2.5 },
      ]),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const words = body.words as Array<Record<string, unknown>>;
  // Speaker 0 is falsy. A `speaker && ...` check here would drop the first
  // speaker's label entirely and make a two-person dialogue look like one.
  assertEquals(words[0].speaker, "speaker_0");
  assertEquals(words[1].speaker, "speaker_1");
  assertEquals(words[2].speaker, undefined);
});

Deno.test("deepgram-transcribe asks for diarisation and Arabic", async () => {
  const { calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/clip.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا"),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const url = calls.find((u) => u.includes("api.deepgram.com")) ?? "";
  assertStringIncludes(url, "language=ar");
  assertStringIncludes(url, "diarize=true");
  assertStringIncludes(url, "model=nova-3");
});

Deno.test("deepgram-transcribe boosts the lesson's own vocabulary", async () => {
  const { calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", {
      audioUrl: "https://e2e.supabase.co/storage/clip.mp4",
      keyterms: ["مفرج", "جنبية"],
    }),
    caller({
      "api.deepgram.com": deepgram("مرحبا"),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const url = decodeURIComponent(calls.find((u) => u.includes("api.deepgram.com")) ?? "");
  // Keyterm prompting is what gets dialect-specific nouns recognised at all —
  // a general Arabic model has never seen most of them.
  assertStringIncludes(url, "keyterm=مفرج:2");
  assertStringIncludes(url, "keyterm=جنبية:2");
});

Deno.test("deepgram-transcribe caps and cleans the keyterm list", async () => {
  const { calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", {
      audioUrl: "https://e2e.supabase.co/storage/clip.mp4",
      keyterms: [...Array.from({ length: 150 }, (_, i) => `كلمة${i}`), "", "   ", 42, null],
    }),
    caller({
      "api.deepgram.com": deepgram("مرحبا"),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const url = calls.find((u) => u.includes("api.deepgram.com")) ?? "";
  // Deepgram's own limit is 100. Sending more, or sending blanks, is rejected
  // for the whole request rather than partially honoured.
  assertEquals(url.split("keyterm=").length - 1, 100);
});

Deno.test("deepgram-transcribe streams a stored file rather than buffering it", async () => {
  const { calls, headers } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/clip.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا"),
      "/storage/clip.mp4": storedAudio(),
    }),
  );

  const i = calls.findIndex((u) => u.includes("api.deepgram.com"));
  // The stored file's own content type is forwarded, because the body is that
  // response's stream — passing the bytes through without buffering is what
  // lets a long video be transcribed inside the edge function's memory limit.
  assertEquals(headers[i]["content-type"], "audio/mp4");
});

Deno.test("deepgram-transcribe reports an unreachable file as 502", async () => {
  const { status, body, calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://e2e.supabase.co/storage/gone.mp4" }),
    caller({
      "api.deepgram.com": deepgram("مرحبا"),
      "/storage/gone.mp4": () => new Response("not found", { status: 404 }),
    }),
  );

  // 502 rather than 404: the *caller's* request was fine, and the file the app
  // itself stored is what is missing.
  assertEquals(status, 502);
  assertStringIncludes(String(body.error), "Failed to fetch audio");
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("deepgram-transcribe refuses a JSON request with no URL", async () => {
  const { status, body, calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", {}),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "audioUrl is required");
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("deepgram-transcribe accepts a multipart upload", async () => {
  const { status, body } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile("clip.mp3", "audio/mpeg") }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  assertEquals(status, 200);
  assertEquals(body.text, "مرحبا");
});

Deno.test("deepgram-transcribe accepts the upload under either part name", async () => {
  for (const part of ["audio", "file"]) {
    const { status } = await run(
      "deepgram-transcribe",
      formRequest("deepgram-transcribe", { [part]: audioFile() }),
      caller({ "api.deepgram.com": deepgram("مرحبا") }),
    );

    // The four engines disagree on the part name — three use `audio`, Munsit
    // uses `file` — so this one takes either rather than making the caller
    // branch per engine.
    assertEquals(status, 200, `expected part name "${part}" to be accepted`);
  }
});

Deno.test("deepgram-transcribe refuses a multipart request with no file", async () => {
  const { status, body, calls } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { notes: "nothing here" }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "No audio file provided");
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("deepgram-transcribe forwards a multipart upload's own mime type", async () => {
  const { calls, headers } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile("clip.m4a", "audio/mp4") }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  const i = calls.findIndex((u) => u.includes("api.deepgram.com"));
  assertEquals(headers[i]["content-type"], "audio/mp4");
});

Deno.test("deepgram-transcribe sends no keyterms in multipart mode", async () => {
  const { calls } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile() }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  const url = calls.find((u) => u.includes("api.deepgram.com")) ?? "";
  // Pinned as a real asymmetry: keyterm prompting is only reachable through
  // the JSON path, because there is no JSON body to read the terms from. A
  // caller that uploads bytes gets no vocabulary boost.
  assert(!url.includes("keyterm"));
});

Deno.test("deepgram-transcribe answers an empty transcript rather than failing", async () => {
  const { status, body } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile() }),
    caller({ "api.deepgram.com": () => json({ results: { channels: [] } }) }),
  );

  // Silence is a legitimate answer, and Transcribe arbitrates between four
  // engines — one returning nothing must not fail the whole request.
  assertEquals(status, 200);
  assertEquals(body.text, "");
  assertEquals(body.words, []);
});

Deno.test("deepgram-transcribe passes an upstream failure's status through", async () => {
  const { status, body } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile() }),
    caller({ "api.deepgram.com": () => new Response("bad key", { status: 401 }) }),
  );

  assertEquals(status, 401);
  assertEquals(body.error, "Transcription failed");
  assertStringIncludes(String(body.details), "bad key");
});

Deno.test("deepgram-transcribe says so when its key is missing", async () => {
  const { status, body, calls } = await run(
    "deepgram-transcribe",
    formRequest("deepgram-transcribe", { audio: audioFile() }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
    { DEEPGRAM_API_KEY: undefined },
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "DEEPGRAM_API_KEY is not configured");
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("deepgram-transcribe refuses a caller with no bearer token", async () => {
  const { status, calls } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://x/clip.mp4" }, { jwt: null }),
    caller({ "api.deepgram.com": deepgram("مرحبا") }),
  );

  // Pinned as a difference: this one checks the Authorization header itself
  // rather than going through `enforceDailyCap` like its three siblings, so it
  // has no free-tier limit at all — only "signed in or not".
  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("deepgram-transcribe refuses a token that does not resolve to a user", async () => {
  const { status } = await run(
    "deepgram-transcribe",
    jsonRequest("deepgram-transcribe", { audioUrl: "https://x/clip.mp4" }),
    caller({
      "/auth/v1/user": () => json({ message: "bad jwt" }, 401),
      "api.deepgram.com": deepgram("مرحبا"),
    }),
  );

  assertEquals(status, 401);
});

// ── munsit-transcribe ───────────────────────────────────────────────────────

/** Munsit's envelope: `{ statusCode, data: { transcription } }`. */
const munsit = (data: Record<string, unknown>): UpstreamHandler => () =>
  json({ statusCode: 200, data });

Deno.test("munsit-transcribe normalises transcription to text", async () => {
  const { status, body } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا", duration: 3.2 }) }),
  );

  assertEquals(status, 200);
  // Munsit calls it `transcription`; the shared shape calls it `text`. Without
  // the rename the engine reports null and the arbitration drops it silently.
  assertEquals(body.text, "مرحبا");
  assertEquals(body.duration, 3.2);
});

Deno.test("munsit-transcribe reads the older root-level shape too", async () => {
  const { body } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }),
    caller({ "api.munsit.com": () => json({ transcription: "مرحبا", duration: 1 }) }),
  );

  assertEquals(body.text, "مرحبا");
});

/** Real MP4 bytes: the `ftyp` box the container sniffer looks for. */
function mp4File(name = "clip.mp3", type = "audio/mpeg"): File {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 0x10], 0); // box size
  for (const [i, ch] of [..."ftypM4A "].entries()) bytes[4 + i] = ch.charCodeAt(0);
  return new File([bytes], name, { type });
}

Deno.test("munsit-transcribe names the upload after the bytes, not the label", async () => {
  const { bodies, calls } = await run(
    "munsit-transcribe",
    // Deliberately mislabelled: MP4 bytes announced as `clip.mp3`/`audio/mpeg`,
    // which is exactly what a browser upload of a re-muxed file looks like.
    formRequest("munsit-transcribe", { file: mp4File() }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  const i = calls.findIndex((u) => u.includes("api.munsit.com"));
  // Munsit dispatches its decoder on the file extension, so the part has to be
  // named for the container the bytes *are*. A hardcoded `audio.mp3` wrapped
  // around MP4/AAC comes back 200 with an empty transcription — a silent wrong
  // answer rather than an error. Sniffing beats the declared type because the
  // declared type is routinely wrong.
  assertStringIncludes(bodies[i] ?? "", "audio.m4a");
  assertStringIncludes(bodies[i] ?? "", "audio/mp4");
});

Deno.test("munsit-transcribe names an MP3 upload as MP3", async () => {
  const { bodies, calls } = await run(
    "munsit-transcribe",
    // `audioFile` writes an ID3 header, so these really are MP3 bytes even
    // though the part claims MP4.
    formRequest("munsit-transcribe", { file: audioFile("clip.m4a", "audio/mp4") }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  const i = calls.findIndex((u) => u.includes("api.munsit.com"));
  assertStringIncludes(bodies[i] ?? "", "audio.mp3");
});

Deno.test("munsit-transcribe accepts base64 audio", async () => {
  const { status, body } = await run(
    "munsit-transcribe",
    jsonRequest("munsit-transcribe", {
      audioBase64: btoa("fake audio"),
      mimeType: "audio/webm",
    }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  // The conversation simulator's push-to-talk sends base64, not multipart.
  assertEquals(status, 200);
  assertEquals(body.text, "مرحبا");
});

Deno.test("munsit-transcribe refuses a JSON request with no audio", async () => {
  const { status, body, calls } = await run(
    "munsit-transcribe",
    jsonRequest("munsit-transcribe", { mimeType: "audio/webm" }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "audioBase64 is required");
  assert(!calls.some((url) => url.includes("api.munsit.com")));
});

Deno.test("munsit-transcribe refuses a multipart request with no file", async () => {
  const { status, calls } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { model: "munsit-1" }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("api.munsit.com")));
});

Deno.test("munsit-transcribe honours a caller-supplied model", async () => {
  const { bodies, calls } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile(), model: "munsit-2" }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  const i = calls.findIndex((u) => u.includes("api.munsit.com"));
  assertStringIncludes(bodies[i] ?? "", "munsit-2");
});

Deno.test("munsit-transcribe answers a null transcript rather than failing", async () => {
  const { status, body } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }),
    caller({ "api.munsit.com": munsit({ duration: 2 }) }),
  );

  // `null`, not `""`. Transcribe distinguishes "this engine ran and heard
  // nothing" from "this engine returned an empty string", and only the former
  // is grounds for preferring another engine's result.
  assertEquals(status, 200);
  assertEquals(body.text, null);
});

Deno.test("munsit-transcribe reports an upstream failure as 502 with a null text", async () => {
  const { status, body } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }),
    caller({ "api.munsit.com": () => new Response("rate limited", { status: 429 }) }),
  );

  assertEquals(status, 502);
  // The `text: null` is kept on the failure body too, so a caller reading the
  // shared shape gets a consistent answer whichever way the call went.
  assertEquals(body.text, null);
  assertStringIncludes(String(body.error), "Munsit 429");
});

Deno.test("munsit-transcribe says so when its key is missing", async () => {
  const { status, body, calls } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
    { MUNSIT_API_KEY: undefined },
  );

  assertEquals(status, 503);
  assertEquals(body.text, null);
  assert(!calls.some((url) => url.includes("api.munsit.com")));
});

Deno.test("munsit-transcribe turns an anonymous caller away", async () => {
  const { status, calls } = await run(
    "munsit-transcribe",
    formRequest("munsit-transcribe", { file: audioFile() }, { jwt: null }),
    caller({ "api.munsit.com": munsit({ transcription: "مرحبا" }) }),
  );

  // Capped at 10 transcriptions/day for free users, unlike Deepgram's bare
  // signed-in check.
  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("api.munsit.com")));
});
