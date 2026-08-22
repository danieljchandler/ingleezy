import type { MemoryDb } from "../postgrest/store";

/**
 * Edge-function responses.
 *
 * The predecessor to this module returned `{}` for every `/functions/v1/*`
 * call. That is worse than returning nothing: a test asserting "the mnemonic
 * appears" passed whether or not the function was called, because the component
 * fell through to its empty branch and the assertion was written to match. Here
 * an unregistered function returns **501 and is recorded**, so a spec that
 * depends on one has to say so.
 */

export interface FunctionCall {
  name: string;
  body: unknown;
  headers: Record<string, string>;
  at: number;
}

export interface FunctionContext {
  db: MemoryDb;
  userId: string | null;
  body: unknown;
}

export interface FunctionResponse {
  status: number;
  body: unknown;
  /**
   * Set for the handful of functions the app consumes as an SSE stream.
   *
   * Each entry becomes one `data:` frame, JSON-encoded. Objects rather than
   * strings, because the three streaming callers all parse OpenAI's delta
   * shape — `parsed.choices[0].delta.content` — so a frame carrying a bare
   * string would be silently skipped by every one of them. `[DONE]` is
   * appended by the transport.
   */
  stream?: unknown[];
  /**
   * Set for functions that answer with a binary body rather than JSON.
   *
   * `body` is ignored when this is present. Only the TTS trio needs it today:
   * they return raw audio and their caller pipes `res.blob()` into an `<audio>`
   * element, so a JSON body would arrive as an unplayable source.
   */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export type FunctionHandler = (context: FunctionContext) => FunctionResponse | unknown;

const ok = (body: unknown): FunctionResponse => ({ status: 200, body });

/**
 * An SSE response streaming `pieces` as OpenAI-shaped deltas.
 *
 * The three streaming callers — culture guide, the conversation simulator and
 * the ask-about-this-sentence panel — all read
 * `parsed.choices[0].delta.content` and ignore anything else, so this is the
 * only frame shape that reaches them. Splitting a sentence across several
 * pieces is the point: the incremental append is the behaviour under test, and
 * a single-chunk stream would pass even if the accumulation were broken.
 */
export const streaming = (...pieces: string[]): FunctionResponse => ({
  status: 200,
  body: null,
  stream: pieces.map((content) => ({ choices: [{ delta: { content } }] })),
});

/**
 * A short, genuinely decodable silent clip.
 *
 * A zero-length buffer would satisfy `res.blob()` and then fail in the media
 * element, which is the failure the old JSON fixture produced. This is a real
 * 44-byte WAV header describing 0 samples of 8kHz mono PCM — Chromium parses
 * it, reports a duration and fires `ended`, so playback state in the page
 * advances the way it does in production.
 */
function silentWav(): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36, true); // chunk size: header only, no samples
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 16000, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, 0, true); // no sample data
  return bytes;
}

/**
 * The jingle functions' answer: base64 audio in a JSON envelope.
 *
 * Deliberately not raw bytes. `functions.invoke` coerces a binary body through
 * UTF-8 in some environments, which turns an MP3 into white noise — the base64
 * round trip is what keeps the audio intact, and the caller decodes it.
 */
const aJingle = () => ({
  audioBase64: btoa(String.fromCharCode(...silentWav())),
  mimeType: "audio/wav",
  extension: "wav",
  lyrics: "la la la",
});

/**
 * A binary audio response, as the TTS functions actually send one.
 *
 * The content type is the one each function declares, because the caller hands
 * the blob straight to an `<audio>` element and the type is what decides
 * whether it plays.
 */
const audio = (contentType: string): FunctionResponse => ({
  status: 200,
  body: null,
  bytes: silentWav(),
  headers: { "content-type": contentType },
});

/**
 * The shape each function returns on success, minimal but valid.
 *
 * Derived from each function's own response literal. They are intentionally
 * boring — a test that cares about the content overrides them.
 */
export const defaultFunctions: Record<string, FunctionHandler> = {
  // `tier`, not `subscription_tier`: the function names it `tier` and
  // `useSubscription` reads `data.tier`. A fixture using the other spelling
  // reports every subscriber as untiered while still looking subscribed.
  "check-subscription": () =>
    ok({ subscribed: false, tier: null, product_id: null, subscription_end: null }),
  "create-checkout": () => ok({ url: "https://checkout.stripe.test/session" }),
  "customer-portal": () => ok({ url: "https://billing.stripe.test/portal" }),
  // Fresh account, nothing on sale: the page renders its empty state and the
  // dark-until-configured purchase button stays hidden.
  "native-feedback": () =>
    ok({ balance: 0, requests: [], credits_per_pack: 5, purchase_enabled: false }),
  // Both of the writing page's calls, told apart by action: the prompt it
  // fetches on mount, and the review of whatever the spec typed.
  "writing-coach": (ctx) =>
    (ctx.body as { action?: string } | null)?.action === "prompt"
      ? ok({
          prompt: {
            scenario_arabic: "صاحبك يرتب لنهاية الأسبوع.",
            message_english: "hey, what do you think about heading to the beach tomorrow?",
            message_arabic: "هلا، وش رايك نروح البحر بكرة؟",
          },
        })
      : ok({
          review: {
            understandable: true,
            verdict_arabic: "حلو — بس تصحيح صغير.",
            corrected_english: "Yes, let's go",
            corrected_arabic: "ايه، يلا نروح",
            corrections: [],
            tips: [],
          },
        }),

  "generate-mnemonic": () => ok({ mnemonic: "a memorable hook" }),
  "generate-flashcard-image": () => ok({ imageUrl: "https://cdn.test/flashcard.png" }),
  // Base64 audio plus the type and extension the caller needs to store it —
  // not a URL. `MyWordsReview` decodes `audioBase64`, uploads it with
  // `mimeType` and names the file from `extension`, so the earlier
  // `{ audioUrl }` matched nothing it reads and every jingle upload failed on
  // an undefined blob.
  "generate-word-jingle": () => ok(aJingle()),
  "generate-phrase-jingle": () => ok(aJingle()),
  "persist-word-audio": () => ok({ audioUrl: "https://cdn.test/word.mp3" }),

  // Raw audio, not JSON. All three return `new Response(audioBuffer)` with an
  // audio content type, and every caller pipes `res.blob()` through
  // `URL.createObjectURL` into an `<audio>` element. The `{ audioContent: "" }`
  // these used to answer was invented — nothing in the app reads that field —
  // and it made every playback log a media error while still looking stubbed.
  "azure-tts": () => audio("audio/mpeg"),
  "munsit-tts": () => audio("audio/wav"),
  "elevenlabs-tts": () => audio("audio/mpeg"),

  // Per-sentence, with the detected dialect alongside the requested one —
  // `useTranslateText` reads all three and Translate.tsx renders the detected
  // dialect as a badge. A flat `{ translation }` matched nothing it reads.
  "translate-text": () =>
    ok({ detected_dialect: "Gulf", sentences: [], used_dialect: "auto" }),
  // `msa` and `literal`, not `transliteration`. The word popover shows the MSA
  // equivalent and the word-for-word gloss; there is no transliteration in this
  // response at all, so the old fixture named a field nothing reads and omitted
  // the two that are rendered.
  "translate-phrase": () => ok({ translation: "translated", msa: "", literal: "" }),
  // Echoes one Fusha rendering per line asked for, so a caller that mis-aligns
  // the response fails instead of quietly rendering the first line's Arabic
  // under every sentence.
  "convert-to-fusha": ({ body }) => {
    const lines = (body as { lines?: unknown })?.lines;
    const count = Array.isArray(lines) ? lines.length : 0;
    return ok({
      fusha: Array.from({ length: count }, (_, i) => `فصحى ${i + 1}`),
      model: "test-model",
    });
  },
  "how-do-i-say": () => ok({ arabic: "كيف", english: "how", transliteration: "kayf" }),

  "grammar-drill": () => ok({ questions: [] }),
  "record-grammar-outcome": () => ok({ recorded: true }),
  "listening-quiz": () => ok({ questions: [] }),
  "daily-challenge": () => ok({ challenge: null }),
  // `history: []` serves the Profile level card's never-placed state; the
  // quiz shapes serve everything the quiz flow itself doesn't override.
  "placement-quiz": () => ok({ questions: [], level: "A2", history: [] }),
  "reading-passage": () => ok({ passage: "", questions: [] }),
  "reading-qa": () => ok({ answer: "" }),
  "phrase-of-the-day": () => ok({ phrase: null }),

  // One word in, one word's detail out — not a list. `TappableArabicText` reads
  // `definition`, `literal`, `root`, `transliteration` and `uses` off the top
  // level; the earlier `{ words: [] }` matched none of them, so every word
  // popover rendered blank while the call looked successful.
  "word-enrichment": () =>
    ok({
      definition: null,
      literal: null,
      root: null,
      transliteration: null,
      uses: [],
    }),
  "suggest-flashcards": () => ok({ suggestions: [] }),
  "generate-sample-sentences": () => ok({ sentences: [] }),

  // `items`, plus the cold-start flag and the seed the shuffle was built from.
  // `useDiscoverFeed` reads all three; the earlier `{ videos: [] }` matched none
  // of them, so the feed rendered empty and always claimed a warm start.
  "discover-feed": () =>
    ok({ items: [], cold_start: false, seed: 1, active_dialect: "Gulf", cefr: null }),
  "extract-grammar-points": () => ok({ points: [] }),

  "score-shadow-attempt": () => ok({ score: 80, feedback: "" }),
  "pronunciation-feedback": () => ok({ feedback: "" }),
  // The flat result the function normalises Azure's response into. `words` and
  // `recognizedText` are not optional extras — the page renders the per-word
  // breakdown from one and the "what Azure heard" line from the other, and the
  // earlier `{ accuracyScore }` here matched no field the hook reads, so every
  // score rendered as zero while the call looked successful.
  "azure-pronunciation": () =>
    ok({
      overall: 80,
      accuracy: 80,
      fluency: 80,
      completeness: 100,
      words: [],
      recognizedText: "",
      locale: "ar-SA",
    }),
  "score-set-phrase-voice": () => ok({ score: 80 }),

  // The four ASR engines Transcribe fires in parallel. Every one of them
  // answers `text` — an earlier `{ transcript, segments }` here was invented,
  // and since the page reads `data.text` it made a silent engine look like a
  // successful one. The `*Used` flags are the real gating: Fanar and Soniox
  // return 200 with `text: null` when they are unconfigured or out of budget,
  // so "responded" and "transcribed" are genuinely different states.
  "deepgram-transcribe": () => ok({ text: "", words: [] }),
  "munsit-transcribe": () => ok({ text: null, error: "no transcript" }),
  "soniox-transcribe": () => ok({ text: null, sonioxUsed: false, reason: "api_key_not_configured" }),
  "fanar-transcribe": () =>
    ok({ text: null, fanarUsed: false, fanarAvailable: false, reason: "api_key_not_configured", budgetRemaining: 0 }),
  // `audioBase64` has to be non-empty: the page treats a falsy one as "no audio
  // file found" and aborts, so a zero-length default would make every caller
  // look like a failed download.
  "download-media": () =>
    ok({ audioBase64: "bWVkaWE=", contentType: "audio/mpeg", filename: "media.mp3", size: 5 }),
  "extract-visual-context": () =>
    ok({ success: true, result: { onScreenTextSegments: [], sceneContext: "", culturalContext: "" } }),

  // Called on page mount, so the route sweep needs them to resolve.
  "generate-daily-story": () => ok({ story: null, scenes: [] }),
  // `items`, not `questions`: useGenerateQuiz reads `data?.items ?? []`, so the
  // other spelling made every quiz look empty regardless of what was seeded.
  "generate-set-phrase-quiz": () => ok({ items: [] }),
  "souq-news": () => ok({ articles: [] }),
  "souq-news-quiz": () => ok({ questions: [] }),
  "suggest-stories": () => ok({ suggestions: [] }),
  // `body_english`, plus the author the model may or may not know. The old
  // `{ text: "" }` left useGenerateStoryText destructuring undefined, so the
  // reading-library import could never complete.
  "generate-suggested-story-text": () =>
    ok({ body_english: "Once upon a time", author: null }),
  "request-situation-phrases": () => ok({ phrases: [] }),
  "practice-sentence-coach": () => ok({ feedback: "" }),
  "culture-guide": () => ok({ answer: "" }),
  "free-chat": () => ok({ reply: "" }),
  "assistant-chat": () => streaming(""),
  "analyze-meme": () => ok({ analysis: "" }),
  // Transcribe's analyser. It reports failure in-band as `success: false`
  // rather than a non-2xx, so the default has to carry the flag.
  "analyze-gulf-arabic": () =>
    ok({ success: true, result: { lines: [], vocabulary: [], grammarPoints: [] } }),
  // Learn-from-X's analyser: same in-band `success` flag, English-first result.
  "analyze-english-text": () =>
    ok({ success: true, result: { lines: [], vocabulary: [], grammarPoints: [] } }),
  "scrape-x-post": () => ok({ text: "" }),
  "camel-analyze": () => ok({ dialect: "Gulf", confidence: 1 }),
  "farasa": () => ok({ segments: [] }),
  "hf-chat": () => ok({ reply: "" }),
  "translate-story-dialect": () => ok({ lines: [] }),
  "generate-listen-script": () => ok({ lines: [] }),
  "generate-listen-audio": () => ok({ audioUrl: "https://cdn.test/listen.mp3" }),
  "generate-listen-line-audio": () => ok({ audioUrl: "https://cdn.test/line.mp3" }),
  // `client_secret` is a *string* here, not `{ value }`. The function emits the
  // key under both `value` and `client_secret` as flat strings; the nested form
  // is only one of three fallbacks the client tolerates for older payloads, so
  // a fixture using it exercised the fallback and never the real shape.
  "realtime-session-token": () =>
    ok({
      value: "fixture-token",
      client_secret: "fixture-token",
      expires_at: Math.floor(Date.now() / 1000) + 60,
      model: "gpt-realtime-2",
      voice: "ballad",
      session_id: "sess_fixture",
    }),
  // `summary` is an array of `{ occasion, inserted }`, one entry per occasion.
  // The fixture used to answer `{ inserted: 0 }`, which the admin page joined
  // into the toast "Seeded: undefined" — a success message describing nothing.
  "seed-set-phrases": () => ok({ summary: [{ occasion: "Greetings", inserted: 10 }] }),
  "suggest-stories-admin": () => ok({ suggestions: [] }),

  // Admin pipelines.
  // The admin page reads `candidates` to upsert, and `candidates_found` plus
  // `region_summary` for its toast — all three come back together.
  "discover-trending-videos": () =>
    ok({ success: true, candidates_found: 0, candidates: [], region_summary: {} }),
  "process-approved-video": () => ok({ processed: true }),
  "process-english-video": () => ok({ success: true, lines: 0 }),
  "rate-video-cefr": () => ok({ cefr: "A2" }),
  "extract-concepts": () => ok({ concepts: [] }),
  "curriculum-chat": () => ok({ reply: "", proposals: [] }),
  // Drafting is queued rather than synchronous: the response carries the
  // message the admin toast shows, and the rules appear in the Draft tab
  // minutes later. `{ rules: [] }` named a field nothing reads.
  "draft-dialect-rules": () =>
    ok({
      queued: true,
      dialect: "Gulf",
      category: null,
      message: "Council is drafting rules in the background.",
    }),
  // A rollup, not a list. The panel reads `totals.all` directly, so the old
  // `{ violations: [] }` threw on the first render rather than showing zero.
  "dialect-violations-digest": () =>
    ok({
      windowDays: 7,
      totals: { all: 0, byDialect: {} },
      topTokens: [],
      topFunctions: [],
      samples: [],
    }),
  // `inserted` is how many draft rules were written, and the metrics page reads
  // nothing else. The old `{ insight: "" }` made every teach-AI call report
  // "AI returned no proposals" regardless of what happened.
  "learn-from-metric": () => ok({ inserted: 1, rules: [] }),
  // The admin page reads `story.id` to navigate to the new story's editor and
  // throws when it is missing, so a null story made the happy path unreachable.
  "import-authentic-story": () =>
    ok({ story: { id: "bbbbbbbb-0000-4000-8000-000000000000", title: "A story" } }),
  "generate-story": () => ok({ story: null }),
  "generate-story-preview-audio": () => ok({ audioUrl: "https://cdn.test/preview.mp3" }),
  "generate-story-full-audio": () => ok({ audioUrl: "https://cdn.test/full.mp3" }),
  "generate-story-video": () => ok({ videoUrl: "https://cdn.test/story.mp4" }),
  "generate-story-video-full": () => ok({ videoUrl: "https://cdn.test/story-full.mp4" }),
  "edit-story-scene-image": () => ok({ imageUrl: "https://cdn.test/scene.png" }),
  "ai-resegment-transcript": () => ok({ segments: [] }),
  "classify-tutor-segments": () => ok({ segments: [] }),
  "backfill-literal-translations": () => ok({ updated: 0 }),
  "notify-due-reviews": () => ok({ sent: 0 }),
};

/** The 429 an over-quota free user gets, exactly as `_shared/usageCap.ts` sends it. */
export function capLimited(): FunctionResponse {
  return {
    status: 429,
    body: {
      error: "daily_limit_reached",
      message: "You've hit today's free limit.",
      limit: 20,
      upgrade_url: "/pricing",
    },
  };
}

/** The 401 an anonymous caller gets from a capped function. */
export function authRequired(): FunctionResponse {
  return { status: 401, body: { error: "auth_required", message: "Sign in to use this feature." } };
}

export function unregistered(name: string): FunctionResponse {
  return {
    status: 501,
    body: {
      error: "not_stubbed",
      message:
        `The in-memory backend has no response registered for the edge function "${name}".\n` +
        `Register one for this test, or add a default in ` +
        `src/test/support/server/functions.ts. Returning an empty object instead ` +
        `would let this test pass without the function ever being exercised.`,
    },
  };
}

export function normalise(result: FunctionResponse | unknown): FunctionResponse {
  if (
    result !== null &&
    typeof result === "object" &&
    "status" in result &&
    "body" in result
  ) {
    return result as FunctionResponse;
  }
  return { status: 200, body: result };
}
