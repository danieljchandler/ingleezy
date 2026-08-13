import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `azure-pronunciation` — the only function that scores how a learner *sounds*.
 *
 * Almost all of its surface is translation. Azure returns pronunciation
 * assessment in a shape that changes between responses: the same scores appear
 * either nested under `PronunciationAssessment` or inlined on the object beside
 * it, and the per-phoneme breakdown arrives as `Phonemes` or `Syllables`
 * depending on the locale. The function normalises all of that into one flat
 * result, so the parser is where a real bug would live and it is invisible from
 * the page — a mis-parse produces zeros, and zeros look like bad pronunciation.
 *
 * The second half is bookkeeping the learner never sees: words Azure flags are
 * written to `learner_errors` so they can be targeted later, and a clean run
 * resolves the ones previously flagged. Both are fire-and-forget by design —
 * the score must not wait on them, and must not fail with them.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const AUDIO = btoa("fake audio bytes");

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/learner_errors": () => json({}, 201),
    "/rest/v1/rpc/record_learner_errors": () => json(null),
    "/rest/v1/rpc/resolve_learner_errors": () => json(null),
    ...extra,
  };
}

/** Decode the base64 config header back to text, UTF-8 aware. */
function decodeConfigHeader(header: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(header), (c) => c.charCodeAt(0)),
  );
}

/**
 * Wait for a fire-and-forget write to land.
 *
 * `recordLearnerErrors` and `resolveLearnerErrors` are deliberately not awaited
 * — the learner's score must not wait on bookkeeping — so the response returns
 * before the request is issued and reading `calls` straight away races it.
 */
async function settled(
  calls: () => string[],
  match: string,
  attempts = 50,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (calls().some((url) => url.includes(match))) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

/** Azure's envelope, with `nbest` slotted into the position the function reads. */
const azure = (nbest: unknown, status = "Success"): UpstreamHandler => () =>
  json({ RecognitionStatus: status, NBest: nbest === null ? [] : [nbest] });

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler> = caller(),
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("azure-pronunciation", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("azure-pronunciation", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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
      headers: fn.calls.map((c) => c.headers),
    };
  } finally {
    fn.restore();
  }
}

const ok = { audioBase64: AUDIO, referenceText: "مرحبا" };

// ── The parser ──────────────────────────────────────────────────────────────

Deno.test("flattens Azure's nested scores", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: {
        PronScore: 82,
        AccuracyScore: 85,
        FluencyScore: 78,
        CompletenessScore: 100,
        ProsodyScore: 70,
      },
      Words: [],
    }),
  }));

  assertEquals(status, 200);
  assertEquals(body.overall, 82);
  assertEquals(body.accuracy, 85);
  assertEquals(body.fluency, 78);
  assertEquals(body.completeness, 100);
  assertEquals(body.prosody, 70);
  assertEquals(body.recognizedText, "مرحبا");
});

Deno.test("reads the same scores when Azure inlines them instead", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Display: "مرحبا",
      PronScore: 90,
      AccuracyScore: 91,
      FluencyScore: 88,
      CompletenessScore: 100,
      Words: [],
    }),
  }));

  // Azure returns both shapes for the same request depending on locale and
  // load. Handling only the nested one would produce a flat zero — which reads
  // to the learner as "you got everything wrong", not "the parser missed".
  assertEquals(body.overall, 90);
  assertEquals(body.accuracy, 91);
  assertEquals(body.fluency, 88);
  assertEquals(body.recognizedText, "مرحبا");
});

Deno.test("omits prosody when Azure did not score it", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 80, AccuracyScore: 80 },
      Words: [],
    }),
  }));

  // Absent rather than zero. A prosody of 0 rendered next to an accuracy of 80
  // tells the learner their intonation is hopeless when it was never assessed.
  assert(!("prosody" in body));
});

Deno.test("falls back to the accuracy score when there is no PronScore", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { AccuracyScore: 77 },
      Words: [],
    }),
  }));

  assertEquals(body.overall, 77);
});

Deno.test("carries the per-word breakdown through", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا كيف",
      PronunciationAssessment: { PronScore: 70 },
      Words: [
        { Word: "مرحبا", PronunciationAssessment: { AccuracyScore: 90, ErrorType: "None" }, Phonemes: [] },
        { Word: "كيف", PronunciationAssessment: { AccuracyScore: 30, ErrorType: "Mispronunciation" }, Phonemes: [] },
      ],
    }),
  }));

  const words = body.words as Array<Record<string, unknown>>;
  // The only actionable part of the result — an overall 70 does not tell a
  // learner which sound to work on.
  assertEquals(words.length, 2);
  assertEquals(words[1].word, "كيف");
  assertEquals(words[1].errorType, "Mispronunciation");
  assertEquals(words[1].accuracy, 30);
});

Deno.test("defaults a word with no error type to None", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 90 },
      Words: [{ Word: "مرحبا", Phonemes: [] }],
    }),
  }));

  const words = body.words as Array<Record<string, unknown>>;
  // Undefined here would be recorded as an error kind of "undefined" in
  // learner_errors, so the default is load-bearing beyond display.
  assertEquals(words[0].errorType, "None");
  assertEquals(words[0].accuracy, 0);
});

Deno.test("reads phonemes from Syllables when that is what Azure sent", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 80 },
      Words: [
        {
          Word: "مرحبا",
          PronunciationAssessment: { AccuracyScore: 80, ErrorType: "None" },
          Syllables: [{ Syllable: "mar", AccuracyScore: 75 }],
        },
      ],
    }),
  }));

  const words = body.words as Array<{ phonemes: Array<Record<string, unknown>> }>;
  // Arabic locales return syllables where European ones return phonemes.
  assertEquals(words[0].phonemes[0].phoneme, "mar");
  assertEquals(words[0].phonemes[0].accuracy, 75);
});

Deno.test("keeps the alternatives Azure heard instead", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 60 },
      Words: [
        {
          Word: "مرحبا",
          PronunciationAssessment: { AccuracyScore: 60, ErrorType: "Mispronunciation" },
          Phonemes: [
            {
              Phoneme: "ħ",
              PronunciationAssessment: {
                AccuracyScore: 20,
                NBestPhonemes: [{ Phoneme: "h", Score: 80 }],
              },
            },
          ],
        },
      ],
    }),
  }));

  const words = body.words as Array<{ phonemes: Array<{ nbest?: Array<Record<string, unknown>> }> }>;
  // ح heard as ه is the single most common Arabic pronunciation error for
  // English speakers; showing what they said instead is more useful than a
  // score for the sound they meant.
  assertEquals(words[0].phonemes[0].nbest?.[0].phoneme, "h");
  assertEquals(words[0].phonemes[0].nbest?.[0].accuracy, 80);
});

Deno.test("omits nbest entirely when there are no alternatives", async () => {
  const { body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 90 },
      Words: [
        {
          Word: "مرحبا",
          PronunciationAssessment: { AccuracyScore: 90, ErrorType: "None" },
          Phonemes: [{ Phoneme: "m", PronunciationAssessment: { AccuracyScore: 95 } }],
        },
      ],
    }),
  }));

  const words = body.words as Array<{ phonemes: Array<Record<string, unknown>> }>;
  assert(!("nbest" in words[0].phonemes[0]));
});

// ── What Azure is asked for ─────────────────────────────────────────────────

Deno.test("asks for phoneme-level IPA scoring against the reference text", async () => {
  const { calls, headers } = await call(
    { ...ok, referenceText: "مرحبا كيف حالك" },
  );

  const i = calls.findIndex((url) => url.includes("stt.speech.microsoft.com"));
  const config = JSON.parse(
    decodeConfigHeader(headers[i]["pronunciation-assessment"]),
  ) as Record<string, unknown>;
  // The reference text is the whole assessment: Azure aligns what it heard
  // against it, and sending the wrong one scores a correct take as incomplete.
  assertEquals(config.ReferenceText, "مرحبا كيف حالك");
  assertEquals(config.Granularity, "Phoneme");
  assertEquals(config.PhonemeAlphabet, "IPA");
  assertEquals(config.EnableMiscue, true);
});

Deno.test("base64-encodes the config as UTF-8, not Latin-1", async () => {
  const { calls, headers } = await call({ ...ok, referenceText: "مرحبا" });

  const i = calls.findIndex((url) => url.includes("stt.speech.microsoft.com"));
  // `btoa` throws on any code point above U+00FF, so the Arabic reference text
  // has to be encoded to UTF-8 bytes first. Getting this wrong makes the
  // function fail for Arabic and only Arabic — which is every request it gets.
  assertStringIncludes(decodeConfigHeader(headers[i]["pronunciation-assessment"]), "مرحبا");
});

Deno.test("declares the opus codec for a WebM upload", async () => {
  const { calls, headers } = await call({ ...ok, audioMimeType: "audio/webm" });

  const i = calls.findIndex((url) => url.includes("stt.speech.microsoft.com"));
  // Azure rejects bare `audio/webm`; the codec parameter is required.
  assertEquals(headers[i]["content-type"], "audio/webm; codecs=opus");
});

Deno.test("re-adds the codec when the browser already supplied one", async () => {
  const { calls, headers } = await call({ ...ok, audioMimeType: "audio/webm;codecs=opus" });

  const i = calls.findIndex((url) => url.includes("stt.speech.microsoft.com"));
  // MediaRecorder reports its type with the codec attached, so the parameter
  // would otherwise be doubled.
  assertEquals(headers[i]["content-type"], "audio/webm; codecs=opus");
});

Deno.test("passes a WAV upload through untouched", async () => {
  const { calls, headers } = await call({ ...ok, audioMimeType: "audio/wav" });

  const i = calls.findIndex((url) => url.includes("stt.speech.microsoft.com"));
  // This is the type the app actually sends — `useAzurePronunciation`
  // transcodes to PCM WAV before upload because Azure scores Opus as zero.
  assertEquals(headers[i]["content-type"], "audio/wav");
});

Deno.test("asks Azure for the requested locale", async () => {
  const { calls } = await call({ ...ok, locale: "ar-EG" });

  const url = calls.find((u) => u.includes("stt.speech.microsoft.com")) ?? "";
  assertStringIncludes(url, "language=ar-EG");
  assertStringIncludes(url, "format=detailed");
});

Deno.test("prefers a custom endpoint over the region", async () => {
  const { calls } = await call(ok, caller({
    "custom.cognitiveservices.azure.com": azure({
      Lexical: "مرحبا",
      PronunciationAssessment: { PronScore: 80 },
      Words: [],
    }),
  }), { env: { AZURE_SPEECH_ENDPOINT: "https://custom.cognitiveservices.azure.com/" } });

  const url = calls.find((u) => u.includes("cognitiveservices.azure.com")) ?? "";
  // Multi-service Azure AI resources need the `/stt/` prefix that a plain
  // Speech resource does not — the two are not interchangeable URLs.
  assertStringIncludes(url, "/stt/speech/recognition/");
});

// ── Refusals ────────────────────────────────────────────────────────────────

Deno.test("refuses a request with no audio", async () => {
  const { status, body, calls } = await call({ referenceText: "مرحبا" });

  assertEquals(status, 400);
  assertEquals(body.error, "audioBase64 and referenceText are required");
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

Deno.test("refuses a request with no reference text", async () => {
  const { status, calls } = await call({ audioBase64: AUDIO });

  // Nothing to align against — Azure would score it as 100% incomplete.
  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

Deno.test("refuses malformed JSON", async () => {
  const fn = await loadFunction("azure-pronunciation", { upstreams: caller() });
  try {
    const response = await fn.handler(
      new Request("http://localhost/azure-pronunciation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://hakiya.app",
          authorization: "Bearer fixture",
        },
        body: "{not json",
      }),
    );
    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "Invalid JSON in request body");
  } finally {
    fn.restore();
  }
});

Deno.test("refuses a locale Azure has no Arabic model for", async () => {
  const { status, body, calls } = await call({ ...ok, locale: "ar-MA" });

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "Unsupported locale");
  // Refused here rather than at Azure, which answers an unsupported locale with
  // a generic 400 the learner cannot act on.
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

Deno.test("accepts ar-YE", async () => {
  const { status } = await call({ ...ok, locale: "ar-YE" });

  // Yemeni was previously absent from the allow-list while `localeToDialect`
  // already mapped it, so Yemeni learners got a hard 400 from a branch that was
  // plainly meant to work.
  assertEquals(status, 200);
});

Deno.test("accepts every Gulf locale", async () => {
  for (const locale of ["ar-SA", "ar-QA", "ar-KW", "ar-BH", "ar-AE", "ar-OM", "ar-EG"]) {
    const { status } = await call({ ...ok, locale });
    assertEquals(status, 200, `expected ${locale} to be accepted`);
  }
});

Deno.test("says so when the Azure key is missing", async () => {
  const { status, body, calls } = await call(ok, caller(), {
    env: { AZURE_SPEECH_KEY: undefined },
  });

  // 503, not 500: the service is unconfigured rather than broken, and nothing
  // is attempted.
  assertEquals(status, 503);
  assertStringIncludes(String(body.error), "AZURE_SPEECH_KEY");
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

Deno.test("turns an anonymous caller away", async () => {
  const { status, body, calls } = await call(ok, caller(), { jwt: null });

  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

// ── Upstream trouble ────────────────────────────────────────────────────────

Deno.test("reports an Azure failure as 502 with its detail", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": () => new Response("quota exceeded", { status: 429 }),
  }));

  assertEquals(status, 502);
  assertStringIncludes(String(body.error), "Azure API error 429");
  // The upstream text is kept: an Azure 429 and an Azure 401 need different
  // operator responses, and the status alone does not distinguish a bad key
  // from a busy region.
  assertStringIncludes(String(body.detail), "quota exceeded");
});

Deno.test("reports silence as a 200 the page can read", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure(null, "NoMatch"),
  }));

  // Pinned as-is. Azure heard nothing, which is a normal outcome of a learner
  // tapping record and not speaking — so it comes back 200 with an `error`
  // field rather than a failure status. `useAzurePronunciation` reads
  // `data?.error` and throws, which is how it surfaces; a caller checking only
  // the status would treat "no speech" as a successful score of zero.
  assertEquals(status, 200);
  assertEquals(body.error, "No speech detected");
  assertEquals(body.recognitionStatus, "NoMatch");
});

Deno.test("reports an initial-silence timeout the same way", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure(null, "InitialSilenceTimeout"),
  }));

  assertEquals(status, 200);
  assertEquals(body.recognitionStatus, "InitialSilenceTimeout");
});

Deno.test("reports an empty result set rather than parsing nothing", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": () => json({ RecognitionStatus: "Success", NBest: [] }),
  }));

  assertEquals(status, 200);
  assertEquals(body.error, "No assessment results returned");
});

// ── Bookkeeping ─────────────────────────────────────────────────────────────

Deno.test("records the words Azure flagged", async () => {
  const fn = await loadFunction("azure-pronunciation", {
    upstreams: caller({
      "stt.speech.microsoft.com": azure({
        Lexical: "مرحبا كيف",
        PronunciationAssessment: { PronScore: 55 },
        Words: [
          { Word: "مرحبا", PronunciationAssessment: { AccuracyScore: 90, ErrorType: "None" }, Phonemes: [] },
          { Word: "كيف", PronunciationAssessment: { AccuracyScore: 20, ErrorType: "Mispronunciation" }, Phonemes: [] },
        ],
      }),
    }),
  });
  try {
    await fn.handler(jsonRequest("azure-pronunciation", ok));

    // Azure's per-word error type is the most precise production signal the app
    // produces; before this it was rendered once and dropped.
    assert(await settled(() => fn.calls.map((c) => c.url), "learner_errors"));
    const write = fn.calls.find((c) => c.url.includes("learner_errors"));
    // Only the flagged word — a clean word recorded as an error would put a
    // sound the learner already says correctly into their targeted practice.
    assertStringIncludes(write?.body ?? "", "كيف");
    assert(!(write?.body ?? "").includes("مرحبا"));
  } finally {
    fn.restore();
  }
});

Deno.test("resolves previously flagged words after a clean run", async () => {
  const fn = await loadFunction("azure-pronunciation", {
    upstreams: caller({
      "stt.speech.microsoft.com": azure({
        Lexical: "مرحبا",
        PronunciationAssessment: { PronScore: 95 },
        Words: [
          { Word: "مرحبا", PronunciationAssessment: { AccuracyScore: 95, ErrorType: "None" }, Phonemes: [] },
        ],
      }),
    }),
  });
  try {
    await fn.handler(jsonRequest("azure-pronunciation", ok));

    // Resolved per word, not per utterance: errors are recorded against
    // individual words, so resolving on the whole reference text would never
    // match anything and flagged words would never clear.
    assert(await settled(() => fn.calls.map((c) => c.url), "learner_errors"));
    const resolve = fn.calls.find((c) => c.url.includes("learner_errors"));
    assertStringIncludes(decodeURIComponent(resolve?.url ?? ""), "مرحبا");
  } finally {
    fn.restore();
  }
});

Deno.test("still answers when the bookkeeping write fails", async () => {
  const { status, body } = await call(ok, caller({
    "stt.speech.microsoft.com": azure({
      Lexical: "كيف",
      PronunciationAssessment: { PronScore: 40 },
      Words: [
        { Word: "كيف", PronunciationAssessment: { AccuracyScore: 20, ErrorType: "Omission" }, Phonemes: [] },
      ],
    }),
    "/rest/v1/learner_errors": () => json({ message: "denied" }, 403),
    "/rest/v1/rpc/record_learner_errors": () => json({ message: "denied" }, 403),
  }));

  // Fire-and-forget by design. The learner's score must never wait on, or fail
  // with, a bookkeeping write they cannot see.
  assertEquals(status, 200);
  assertEquals(body.overall, 40);
});

// ── CORS ────────────────────────────────────────────────────────────────────

Deno.test("answers a preflight without touching the cap", async () => {
  const fn = await loadFunction("azure-pronunciation", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("azure-pronunciation"));

    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
    assertEquals(fn.calls.length, 0);
  } finally {
    fn.restore();
  }
});
