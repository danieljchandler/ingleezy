import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The two functions that judge whether a learner said the right thing.
 *
 * Both compare a transcription against a reference by normalised edit
 * distance, and the *normalisation* is the substance — comparing raw strings
 * marks a correct take wrong for reasons that have nothing to do with
 * pronunciation, and none of those false negatives is visible from the page:
 * the learner just sees a low score.
 *
 * They differ in language and in what they compare against. Shadowing still
 * scores ARABIC (echoing native clips is an immersion exercise, and Arabic
 * folding — diacritics, أ/إ/آ, ى/ي, ة/ه — is its substance); the set-phrase
 * scorer is flipped to ENGLISH via Deepgram, folding case, punctuation and
 * apostrophes, and compares against a canonical phrase *and its accepted
 * variants*, because there is usually more than one right answer.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const AUDIO = btoa("fake audio");
const PHRASE_ID = "11111111-0000-4000-8000-000000000000";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/learner_errors": () => json({}, 201),
    "/rest/v1/set_phrases": () => json(null),
    ...extra,
  };
}

/** Munsit's transcription envelope. */
const heard = (text: string): UpstreamHandler => () =>
  json({ statusCode: 200, data: { transcription: text } });

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
    };
  } finally {
    fn.restore();
  }
}

// ── score-shadow-attempt ────────────────────────────────────────────────────

const shadow = (reference: string, recognised: string, over: Record<string, unknown> = {}) =>
  call(
    "score-shadow-attempt",
    { audioBase64: AUDIO, referenceText: reference, mimeType: "audio/wav", ...over },
    caller({ "api.munsit.com": heard(recognised) }),
  );

Deno.test("score-shadow-attempt scores a perfect take as a perfect match", async () => {
  const { status, body } = await shadow("الجو حلو اليوم", "الجو حلو اليوم");

  assertEquals(status, 200);
  assertEquals(body.transcriptSimilarity, 1);
  assertEquals(body.recognizedText, "الجو حلو اليوم");
});

Deno.test("score-shadow-attempt ignores diacritics the learner cannot hear", async () => {
  // The reference is vocalised; ASR output never is.
  const { body } = await shadow("الجَوّ حِلْو اليَوْم", "الجو حلو اليوم");

  // Comparing raw strings here scores a word-perfect take at roughly half.
  assertEquals(body.transcriptSimilarity, 1);
});

Deno.test("score-shadow-attempt folds letter variants a speaker does not distinguish", async () => {
  for (
    const [reference, recognised, why] of [
      ["أنا رايح", "انا رايح", "hamza on alef"],
      ["إلى البيت", "الي البيت", "alef maqsura vs ya"],
      ["مدرسة كبيرة", "مدرسه كبيره", "ta marbuta vs ha"],
      ["مسـاء", "مساء", "tatweel"],
    ] as const
  ) {
    const { body } = await shadow(reference, recognised);

    // None of these is a pronunciation difference. Scoring them as errors marks
    // a correct take wrong for an orthographic reason the learner has no way to
    // act on.
    assert(
      (body.transcriptSimilarity as number) > 0.8,
      `${why}: expected a high score, got ${body.transcriptSimilarity}`,
    );
  }
});

Deno.test("score-shadow-attempt scores an unrelated take low", async () => {
  const { body } = await shadow("الجو حلو اليوم", "ما اعرف شنو تقول");

  assert((body.transcriptSimilarity as number) < 0.5);
});

Deno.test("score-shadow-attempt scores silence as zero rather than a match", async () => {
  const { body } = await shadow("الجو حلو اليوم", "");

  // An empty transcription against a non-empty reference is the "we did not
  // hear you" case, and it must not fall out of the maths as a perfect match.
  assertEquals(body.transcriptSimilarity, 0);
});

Deno.test("score-shadow-attempt aligns the words it heard against the clip", async () => {
  const { body } = await shadow("الجو حلو اليوم", "الجو بارد اليوم");

  const diffs = body.wordDiffs as Array<{ ref?: string; said?: string; status: string }>;
  // The alignment is what `pronunciation-feedback` coaches from, so a status
  // per word matters more than the aggregate score.
  assertEquals(diffs.map((d) => d.status), ["match", "sub", "match"]);
  assertEquals(diffs[1].ref, "حلو");
  assertEquals(diffs[1].said, "بارد");
});

Deno.test("score-shadow-attempt marks a word the learner skipped as missing", async () => {
  const { body } = await shadow("الجو حلو اليوم", "الجو اليوم");

  const diffs = body.wordDiffs as Array<{ ref?: string; status: string }>;
  const missing = diffs.filter((d) => d.status === "missing");
  assertEquals(missing.length, 1);
  assertEquals(missing[0].ref, "حلو");
});

Deno.test("score-shadow-attempt marks a word the learner added as extra", async () => {
  const { body } = await shadow("الجو حلو", "الجو حلو واجد");

  const diffs = body.wordDiffs as Array<{ said?: string; status: string }>;
  const extra = diffs.filter((d) => d.status === "extra");
  assertEquals(extra.length, 1);
  assertEquals(extra[0].said, "واجد");
});

Deno.test("score-shadow-attempt reports the normalised form, not what was heard", async () => {
  const { body } = await shadow("الجو حلو", "الجو حلو مرة");

  const diffs = body.wordDiffs as Array<{ said?: string; status: string }>;
  const extra = diffs.filter((d) => d.status === "extra");
  // Pinned. `alignWords` splits the *normalised* strings, so every word in the
  // diff has already had its ta marbuta folded to ha and its diacritics
  // stripped — `مرة` comes back as `مره`. Fine for the similarity maths, but
  // these words are also what `pronunciation-feedback` coaches on and what is
  // written into `learner_errors`, so the stored spelling is the folded one
  // rather than the one the learner would see anywhere else.
  assertEquals(extra[0].said, "مره");
});

Deno.test("score-shadow-attempt retries on the other model when the first hears nothing", async () => {
  let attempt = 0;
  const { body, calls } = await call(
    "score-shadow-attempt",
    { audioBase64: AUDIO, referenceText: "الجو حلو", mimeType: "audio/wav" },
    caller({
      "api.munsit.com": () => {
        attempt += 1;
        return attempt === 1
          ? json({ data: { transcription: "" } })
          : json({ data: { transcription: "الجو حلو" } });
      },
    }),
  );

  // The bare `munsit` model went degraded upstream once, returning a few
  // characters for any payload. The retry covers the reverse happening to
  // whichever model is currently primary.
  assertEquals(calls.filter((u) => u.includes("api.munsit.com")).length, 2);
  assertEquals(body.transcriptSimilarity, 1);
});

Deno.test("score-shadow-attempt names the upload after the container", async () => {
  const { bodies, calls } = await call(
    "score-shadow-attempt",
    { audioBase64: btoa("RIFFfake"), referenceText: "الجو", mimeType: "audio/webm" },
    caller({ "api.munsit.com": heard("الجو") }),
  );

  const i = calls.findIndex((u) => u.includes("api.munsit.com"));
  // Sniffs the RIFF header rather than trusting the declared type, because
  // Munsit dispatches its decoder on the extension and the browser's label is
  // routinely wrong.
  assertStringIncludes(bodies[i] ?? "", "utterance.wav");
});

Deno.test("score-shadow-attempt refuses a request missing either half", async () => {
  for (const body of [{ referenceText: "الجو" }, { audioBase64: AUDIO }, {}]) {
    const { status, calls } = await call(
      "score-shadow-attempt",
      body,
      caller({ "api.munsit.com": heard("الجو") }),
    );

    assertEquals(status, 400);
    assert(!calls.some((url) => url.includes("api.munsit.com")));
  }
});

Deno.test("score-shadow-attempt says so when its key is missing", async () => {
  const { status, body } = await call(
    "score-shadow-attempt",
    { audioBase64: AUDIO, referenceText: "الجو" },
    caller({ "api.munsit.com": heard("الجو") }),
    { env: { MUNSIT_API_KEY: undefined } },
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "MUNSIT_API_KEY");
});

Deno.test("score-shadow-attempt scores an anonymous take without recording anything", async () => {
  const { status, body } = await call(
    "score-shadow-attempt",
    { audioBase64: AUDIO, referenceText: "الجو حلو", mimeType: "audio/wav" },
    caller({ "api.munsit.com": heard("الجو بارد") }),
    { jwt: null },
  );

  // Pinned as-is. There is no cap and no auth check on this function: an
  // anonymous caller gets scored, and the learner-error bookkeeping simply
  // records nothing because there is no user id. Every Munsit call costs money.
  assertEquals(status, 200);
  assert(typeof body.transcriptSimilarity === "number");
});

// ── score-set-phrase-voice ──────────────────────────────────────────────────

/** Deepgram's transcription envelope. */
const heardEnglish = (text: string): UpstreamHandler => () =>
  json({ results: { channels: [{ alternatives: [{ transcript: text }] }] } });

const aPhrase = (over: Record<string, unknown> = {}) => ({
  id: PHRASE_ID,
  phrase_english: "how are you today",
  reply_english: "I'm good, thanks!",
  accepted_variants: ["how are you doing today"],
  dialect: "Gulf",
  ...over,
});

const scorePhrase = (recognised: string, body: Record<string, unknown> = {}, phrase = aPhrase()) =>
  call(
    "score-set-phrase-voice",
    { audioBase64: AUDIO, phraseId: PHRASE_ID, mimeType: "audio/webm", ...body },
    caller({
      "api.deepgram.com": heardEnglish(recognised),
      "/rest/v1/set_phrases": () => json(phrase),
    }),
  );

Deno.test("score-set-phrase-voice accepts a phrase said correctly", async () => {
  const { status, body } = await scorePhrase("how are you today");

  assertEquals(status, 200);
  assertEquals(body.accepted, true);
  assertEquals(body.quality, 5);
  assertEquals(body.canonical, "how are you today");
});

Deno.test("score-set-phrase-voice ignores case, punctuation and apostrophes", async () => {
  // ASR output styles these freely; none of them is pronunciation.
  const { body } = await scorePhrase("im good thanks", { target: "reply" });

  assertEquals(body.similarity, 1);
  assertEquals(body.accepted, true);
});

Deno.test("score-set-phrase-voice accepts a listed variant", async () => {
  const { body } = await scorePhrase("how are you doing today");

  // There is usually more than one right answer. Scoring only against the
  // canonical form marks a native-sounding alternative wrong.
  assertEquals(body.accepted, true);
  assertEquals(body.similarity, 1);
});

Deno.test("score-set-phrase-voice takes the best match across all candidates", async () => {
  const { body } = await scorePhrase(
    "how are you doing today",
    {},
    aPhrase({ accepted_variants: ["whats up", "how are you doing today", "hows it going"] }),
  );

  // Best, not first — the order variants happen to be stored in must not
  // decide the score.
  assertEquals(body.similarity, 1);
});

Deno.test("score-set-phrase-voice bands the similarity into SRS qualities", async () => {
  for (
    const [recognised, expected] of [
      // Exact: 1.0 → 5.
      ["how are you today", 5],
      // Three characters short out of seventeen: ~0.82 → 4.
      ["how are you to", 4],
      // Six characters short: ~0.65 → 3.
      ["how are you", 3],
      // Only the first two words: ~0.41 → 2.
      ["how are", 2],
      // Almost nothing in common → 1.
      ["goodbye", 1],
    ] as const
  ) {
    const { body } = await scorePhrase(recognised);

    // The quality feeds the phrase's SRS schedule directly, so the bands are
    // what decide when the learner sees it again. Only 4 and 5 are accepted;
    // the lower bands schedule a repeat without calling the take a failure.
    assertEquals(body.quality, expected, `for "${recognised}"`);
  }
});

Deno.test("score-set-phrase-voice rejects a take that is not close enough", async () => {
  const { body } = await scorePhrase("no idea what to say");

  assertEquals(body.accepted, false);
});

Deno.test("score-set-phrase-voice scores the reply when asked for it", async () => {
  const { body } = await scorePhrase("I'm good, thanks!", { target: "reply" });

  // A set phrase is a call and a response; practising only the call teaches
  // half a conversation.
  assertEquals(body.canonical, "I'm good, thanks!");
  assertEquals(body.accepted, true);
});

Deno.test("score-set-phrase-voice ignores variants that are not strings", async () => {
  const { status, body } = await scorePhrase(
    "how are you today",
    {},
    aPhrase({ accepted_variants: [null, 42, { english: "x" }, "how are you doing today"] }),
  );

  // `accepted_variants` is JSON, so an admin edit can put anything in it.
  assertEquals(status, 200);
  assertEquals(body.accepted, true);
});

Deno.test("score-set-phrase-voice copes with no variants at all", async () => {
  const { status, body } = await scorePhrase(
    "how are you today",
    {},
    aPhrase({ accepted_variants: null }),
  );

  assertEquals(status, 200);
  assertEquals(body.accepted, true);
});

Deno.test("score-set-phrase-voice records the dialect from the phrase, not the request", async () => {
  const fn = await loadFunction("score-set-phrase-voice", {
    upstreams: caller({
      "api.deepgram.com": heardEnglish("no idea"),
      "/rest/v1/set_phrases": () => json(aPhrase({ dialect: "Egyptian" })),
    }),
  });
  try {
    await fn.handler(
      jsonRequest("score-set-phrase-voice", {
        audioBase64: AUDIO,
        phraseId: PHRASE_ID,
        dialect: "Gulf",
      }),
    );

    // The phrase's own dialect is authoritative — it names the learner's L1
    // bucket. Recorded errors have to land in the same bucket the learner
    // profile reads, and the client's idea of the current dialect is not it.
    for (let i = 0; i < 50; i++) {
      const write = fn.calls.find((c) => c.url.includes("learner_errors"));
      if (write) {
        assertStringIncludes(write.body ?? "", "Egyptian");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("no learner_errors write was issued");
  } finally {
    fn.restore();
  }
});

Deno.test("score-set-phrase-voice refuses a request missing either half", async () => {
  for (const body of [{ phraseId: PHRASE_ID }, { audioBase64: AUDIO }, {}]) {
    const { status, calls } = await call(
      "score-set-phrase-voice",
      body,
      caller({
        "api.deepgram.com": heardEnglish("how are you"),
        "/rest/v1/set_phrases": () => json(aPhrase()),
      }),
    );

    assertEquals(status, 400);
    assert(!calls.some((url) => url.includes("api.deepgram.com")));
  }
});

Deno.test("score-set-phrase-voice reports an unknown phrase", async () => {
  const { status, body, calls } = await call(
    "score-set-phrase-voice",
    { audioBase64: AUDIO, phraseId: PHRASE_ID },
    caller({
      "api.deepgram.com": heardEnglish("how are you"),
      "/rest/v1/set_phrases": () => json(null),
    }),
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "phrase not found");
  // Looked up before transcribing, so a bad id costs no ASR.
  assert(!calls.some((url) => url.includes("api.deepgram.com")));
});

Deno.test("score-set-phrase-voice reports a phrase with no text for the target", async () => {
  const { status, body } = await scorePhrase(
    "im good",
    { target: "reply" },
    aPhrase({ reply_english: null }),
  );

  // Not every set phrase has a reply. Asking for one that does not exist is an
  // error rather than a score against an empty string, which would come back
  // as zero and read as bad pronunciation.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "no canonical text");
});
