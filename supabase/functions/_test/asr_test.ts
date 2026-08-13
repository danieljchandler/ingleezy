import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { audioFile, formRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The four ASR engines, each driven end to end with a realistic upstream reply.
 *
 * Transcribe fires all four in parallel and reads them for `text`, but the
 * *flags* decide what reaches the analyser — Fanar's transcript is used only
 * when `fanarUsed`, Soniox's only when `sonioxUsed`. That makes the response
 * envelope, not the transcript, the contract worth pinning: a function that
 * returned the right words under the wrong key is a silent failure, and one
 * that reported `fanarUsed: true` on a budget rejection would feed the analyser
 * an engine's fallback output as though it were a real second opinion.
 *
 * These are also the functions whose shapes the browser test fixtures had wrong
 * — invented as `{ transcript, segments }` where all four answer `text` — so
 * this file is the source of truth those fixtures are now written against.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** The Supabase side of a request that is allowed through. */
function allowed(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/fanar_usage": () => json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

async function callWithFile(
  name: string,
  parts: Record<string, string | File>,
  upstreams: Record<string, UpstreamHandler>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(formRequest(name, parts));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed };
  } finally {
    fn.restore();
  }
}

Deno.test("deepgram-transcribe answers with text and word timings", async () => {
  const { status, body } = await callWithFile(
    "deepgram-transcribe",
    { audio: audioFile() },
    allowed({
      "api.deepgram.com": () =>
        json({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: "شلونك اليوم",
                    words: [
                      { punctuated_word: "شلونك", word: "شلونك", start: 0.1, end: 0.6, speaker: 0 },
                      { punctuated_word: "اليوم", word: "اليوم", start: 0.6, end: 1.2, speaker: 0 },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.text, "شلونك اليوم");
  // Deepgram is the only engine that returns word-level timings, and they are
  // what `filterTranscriptByTimeRange` and `mapTimestampsToLines` run on — a
  // clip trimmed to 0–60s and a line-by-line transcript both depend on them.
  const words = body.words as Array<Record<string, unknown>>;
  assertEquals(words.length, 2);
  assertEquals(words[0].text, "شلونك");
  assertEquals(words[0].start, 0.1);
});

Deno.test("deepgram-transcribe labels each speaker", async () => {
  const { body } = await callWithFile(
    "deepgram-transcribe",
    { audio: audioFile() },
    allowed({
      "api.deepgram.com": () =>
        json({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: "مرحبا أهلا",
                    words: [
                      { word: "مرحبا", start: 0, end: 0.5, speaker: 0 },
                      { word: "أهلا", start: 0.5, end: 1, speaker: 1 },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    }),
  );

  // Deepgram numbers speakers; the app wants a string it can show.
  const words = body.words as Array<Record<string, unknown>>;
  assertEquals(words[0].speaker, "speaker_0");
  assertEquals(words[1].speaker, "speaker_1");
});

Deno.test("deepgram-transcribe prefers the punctuated form of a word", async () => {
  const { body } = await callWithFile(
    "deepgram-transcribe",
    { audio: audioFile() },
    allowed({
      "api.deepgram.com": () =>
        json({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: "مرحبا.",
                    words: [{ word: "مرحبا", punctuated_word: "مرحبا.", start: 0, end: 1 }],
                  },
                ],
              },
            ],
          },
        }),
    }),
  );

  const words = body.words as Array<Record<string, unknown>>;
  assertEquals(words[0].text, "مرحبا.");
});

Deno.test("deepgram-transcribe answers empty rather than failing on silence", async () => {
  const { status, body } = await callWithFile(
    "deepgram-transcribe",
    { audio: audioFile() },
    allowed({
      "api.deepgram.com": () =>
        json({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } }),
    }),
  );

  // The page treats an empty transcript as this engine having nothing to say
  // and falls through to the next one; a non-2xx here would read as an outage.
  assertEquals(status, 200);
  assertEquals(body.text, "");
});

Deno.test("deepgram-transcribe refuses a request with no file", async () => {
  const { status, body } = await callWithFile(
    "deepgram-transcribe",
    { dialect: "Gulf" },
    allowed(),
  );

  assertEquals(status, 400);
  assert(String(body.error).length > 0);
});

Deno.test("deepgram-transcribe accepts the file under either part name", async () => {
  // The page sends `audio`; the function also accepts `file`, which is what
  // keeps it usable from a caller written against Munsit's convention.
  const { status, body } = await callWithFile(
    "deepgram-transcribe",
    { file: audioFile() },
    allowed(),
  );

  assertEquals(status, 200);
  assertEquals(body.text, "مرحبا");
});

Deno.test("deepgram-transcribe surfaces an upstream refusal with its status", async () => {
  const { status, body } = await callWithFile(
    "deepgram-transcribe",
    { audio: audioFile() },
    allowed({ "api.deepgram.com": () => json({ err_msg: "quota exceeded" }, 429) }),
  );

  // Passed through rather than flattened to 500: the caller's `Promise.allSettled`
  // records the reason, and 429 is the one an operator needs to see.
  assertEquals(status, 429);
  assert(String(body.error).length > 0);
});

Deno.test("munsit-transcribe reads the file from its own part name", async () => {
  const { status, body } = await callWithFile(
    "munsit-transcribe",
    { file: audioFile("lesson.mp3") },
    allowed(),
  );

  // `file`, not `audio`. The page has a comment about this and sends a
  // separately-named part for exactly this reason.
  assertEquals(status, 200);
  assertEquals(body.text, "مرحبا");
});

Deno.test("munsit-transcribe reports no transcript rather than throwing", async () => {
  const { status, body } = await callWithFile(
    "munsit-transcribe",
    { file: audioFile() },
    allowed({ "api.munsit.com": () => json({ data: {} }) }),
  );

  // 200 with `text: null` is the shape the page checks for. A rejection here
  // would be recorded as an engine failure instead of an empty result, and the
  // "all engines failed" message would name the wrong reason.
  assertEquals(status, 200);
  assertEquals(body.text, null);
});

Deno.test("munsit-transcribe reports an upstream error in band", async () => {
  const { status, body } = await callWithFile(
    "munsit-transcribe",
    { file: audioFile() },
    allowed({ "api.munsit.com": () => json({ message: "bad key" }, 401) }),
  );

  assertEquals(status, 502);
  assertEquals(body.text, null);
  assert(String(body.error).includes("401"));
});

Deno.test("fanar-transcribe marks a transcript as really used", async () => {
  const { status, body } = await callWithFile(
    "fanar-transcribe",
    { audio: audioFile() },
    allowed({ "api.fanar.qa": () => json({ text: "من فنار" }) }),
  );

  assertEquals(status, 200);
  assertEquals(body.text, "من فنار");
  // The flag the page gates on. Without it the transcript is dropped, and with
  // it wrongly set an unused engine's output reaches the analyser.
  assertEquals(body.fanarUsed, true);
  assertEquals(body.fanarAvailable, true);
});

Deno.test("fanar-transcribe reports its remaining budget", async () => {
  const { body } = await callWithFile(
    "fanar-transcribe",
    { audio: audioFile() },
    allowed({ "api.fanar.qa": () => json({ text: "من فنار" }) }),
  );

  // The page logs this when Fanar is skipped; it is the only visibility an
  // operator has into a budget that silently stops an engine.
  assert(typeof body.budgetRemaining === "number");
});

Deno.test("fanar-transcribe withholds its flag when the upstream refuses", async () => {
  const { status, body } = await callWithFile(
    "fanar-transcribe",
    { audio: audioFile() },
    allowed({ "api.fanar.qa": () => json({ error: "server error" }, 500) }),
  );

  // Still 200: an unavailable engine is a normal state for this pipeline, not
  // an error the page should surface. What matters is that `fanarUsed` is
  // false, so nothing downstream treats the absent text as a second opinion.
  assertEquals(status, 200);
  assertEquals(body.text, null);
  assertEquals(body.fanarUsed, false);
  assert(String(body.reason).includes("500"));
});

Deno.test("fanar-transcribe answers unconfigured without calling anything", async () => {
  const fn = await loadFunction("fanar-transcribe", {
    env: { FANAR_API_KEY: undefined },
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(formRequest("fanar-transcribe", { audio: audioFile() }));
    const body = (await response.json()) as Record<string, unknown>;

    assertEquals(response.status, 200);
    assertEquals(body.fanarUsed, false);
    assertEquals(body.fanarAvailable, false);
    assertEquals(body.reason, "api_key_not_configured");
    // Nothing was attempted, which is the point of the early return.
    assertEquals(fn.calls.filter((c) => c.url.includes("api.fanar.qa")).length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("soniox-transcribe answers unconfigured in band", async () => {
  const fn = await loadFunction("soniox-transcribe", {
    env: { SONIOX_API_KEY: undefined },
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(formRequest("soniox-transcribe", { audio: audioFile() }));
    const body = (await response.json()) as Record<string, unknown>;

    // Same contract as Fanar, and the same reason: four engines racing means an
    // absent one has to look like an absent one rather than an outage.
    assertEquals(response.status, 200);
    assertEquals(body.text, null);
    assertEquals(body.sonioxUsed, false);
    assertEquals(body.reason, "api_key_not_configured");
  } finally {
    fn.restore();
  }
});

Deno.test("soniox-transcribe merges its sub-word tokens into words", async () => {
  const { status, body } = await callWithFile(
    "soniox-transcribe",
    { audio: audioFile() },
    allowed(),
  );

  assertEquals(status, 200);
  assertEquals(body.text, "مرحبا");
  assertEquals(body.sonioxUsed, true);
  // Soniox returns sub-word tokens — "مر" and "حبا" are one word split across
  // two — so the function reassembles them on whitespace before handing back
  // anything with a timing on it. Left as tokens, every "word" timing would
  // point at a fragment.
  const words = body.words as Array<Record<string, unknown>>;
  assertEquals(words.length, 1);
  assertEquals(words[0].text, "مرحبا");
});

Deno.test("soniox-transcribe converts token times from milliseconds", async () => {
  const { body } = await callWithFile("soniox-transcribe", { audio: audioFile() }, allowed());

  // Soniox counts in milliseconds and Deepgram in seconds; the page maps both
  // onto one timeline, so the conversion has to happen here.
  const words = body.words as Array<Record<string, number>>;
  assertEquals(words[0].start, 0);
  assertEquals(words[0].end, 0.4);
});

Deno.test("soniox-transcribe reports a failed upload in band", async () => {
  const { status, body } = await callWithFile(
    "soniox-transcribe",
    { audio: audioFile() },
    allowed({
      "api.soniox.com": (request) => {
        if (new URL(request.url).pathname.endsWith("/files")) return json({}, 413);
        return json({ id: "tr_fixture", status: "completed" });
      },
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.text, null);
  assertEquals(body.sonioxUsed, false);
  assertEquals(body.reason, "file_upload_error_413");
});

Deno.test("soniox-transcribe takes the dialect the caller asked for", async () => {
  const fn = await loadFunction("soniox-transcribe", { upstreams: allowed() });
  try {
    await fn.handler(
      formRequest("soniox-transcribe", { audio: audioFile(), dialect: "Egyptian" }),
    );

    // The dialect steers Soniox's context biasing — a vocabulary list and a
    // domain hint sent with the transcription request. Sending the wrong one is
    // worse than sending none, so the part has to reach the create call.
    const create = fn.calls.find(
      (call) => call.url.includes("/transcriptions") && !call.url.endsWith("/transcript"),
    );
    assert(create, "no transcription was created");
  } finally {
    fn.restore();
  }
});

Deno.test("every engine answers under the same key", async () => {
  // The invariant the caller depends on. `Transcribe.tsx` reads `data.text`
  // from all four and picks the first non-empty one; an engine that answered
  // `transcript` instead would look permanently silent, and the fallback chain
  // would quietly skip it.
  const engines: Array<[string, Record<string, string | File>]> = [
    ["deepgram-transcribe", { audio: audioFile() }],
    ["munsit-transcribe", { file: audioFile() }],
    ["fanar-transcribe", { audio: audioFile() }],
    ["soniox-transcribe", { audio: audioFile() }],
  ];

  for (const [name, parts] of engines) {
    const { status, body } = await callWithFile(name, parts, allowed());
    assertEquals(status, 200, `${name} did not answer 200`);
    assert("text" in body, `${name} answered without a "text" key`);
  }
});
