// =============================================================================
// Shared ASR configuration — Soniox model pin + dialect-aware context biasing.
// Used by both the standalone soniox-transcribe function and the inline copy
// in process-approved-video so the two stay in sync.
// =============================================================================

// stt-async-v4 was retired 2026-06-30; requests were already being silently
// rerouted to v5. Pin v5 explicitly so we get its documented request/response
// contract (context biasing, diarization, per-token language) on purpose.
export const SONIOX_MODEL = "stt-async-v5";

/**
 * Munsit ASR model.
 *
 * `munsit` — the model this pipeline used to send — is degraded upstream: it
 * answers 200 with a handful of characters for *any* payload, including a
 * synthetic sine tone and clips five other engines transcribe in full (0 / 7 /
 * 187 chars on the last four uploads). `munsit-en-ar` on the exact same bytes
 * returned 1048 chars against Soniox's 1179, so the fault is the model, not the
 * container, sample rate, chunking or noise floor.
 *
 * Default to the code-switch model everywhere; MUNSIT_ASR_MODEL still overrides
 * it without a redeploy, and callers retry with MUNSIT_ASR_FALLBACK_MODEL when
 * the first answer comes back empty/truncated.
 */
export const MUNSIT_ASR_MODEL = "munsit-en-ar";
export const MUNSIT_ASR_FALLBACK_MODEL = "munsit";

/**
 * Resolved primary model, honouring the MUNSIT_ASR_MODEL secret override.
 * Reads the env off `globalThis` so this module still typechecks when the
 * frontend test suite imports it outside Deno.
 */
export function munsitModel(): string {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("MUNSIT_ASR_MODEL")?.trim() || MUNSIT_ASR_MODEL;
}

/** The other Munsit model, used as a retry when the primary returns nothing. */
export function munsitFallbackModel(primary: string): string {
  return primary === MUNSIT_ASR_FALLBACK_MODEL ? MUNSIT_ASR_MODEL : MUNSIT_ASR_FALLBACK_MODEL;
}

/** Word-level timing, in seconds. Shared shape across every ASR engine. */
export interface AsrWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/**
 * What one ASR leg of the parallel fan-out returns. Every leg resolves rather
 * than rejects — a failed engine reports `error` and the pipeline continues on
 * the others. Engine-specific extras are optional so all legs share one type.
 */
export interface AsrLegResult {
  text: string | null;
  words?: AsrWord[];
  latencyMs?: number;
  error?: string;
  /** Soniox: whether the leg actually produced a usable transcription. */
  sonioxUsed?: boolean;
  /** Soniox: free AR→EN baseline translation. */
  translationText?: string | null;
  /** Soniox: mean per-token confidence over the transcript. */
  avgConfidence?: number | null;
  /** Azure: the locale the request was routed to. */
  locale?: string;
}

/**
 * Roughly the slowest rate at which continuous Arabic speech produces
 * characters. Real speech runs 8-15 chars/sec; this sits far below that so a
 * clip that is genuinely sparse — a few words over a long take, music, silence
 * — is not mistaken for a broken engine.
 */
const MIN_CHARS_PER_SECOND = 2;

/** Below this, a clip is too short for the rate to mean anything. */
const MIN_DURATION_FOR_CHECK_SEC = 5;

/**
 * Does this transcript look truncated for the audio it came from?
 *
 * An engine that accepts a payload it cannot decode may answer 200 with a
 * near-empty transcription rather than an error — Munsit returned 7 characters
 * for a clip on which five other engines each produced 200-440. Length alone
 * cannot prove truncation, but against a known duration it separates "the clip
 * was quiet" from "the decoder gave up after the first frame".
 *
 * Returns false whenever the duration is unknown or too short to judge, so this
 * only ever fires on evidence.
 */
export function looksTruncated(text: string, durationSec: number): boolean {
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_FOR_CHECK_SEC) return false;
  return text.trim().length < durationSec * MIN_CHARS_PER_SECOND;
}

export type DialectModule = "Gulf" | "Egyptian" | "Yemeni";

// Characteristic dialect function words / markers. Fed to Soniox `context.terms`
// to bias recognition toward dialectal spellings instead of MSA normalization.
export const DIALECT_ASR_TERMS: Record<DialectModule, string[]> = {
  Gulf: [
    "شلونك", "وين", "هالحين", "يالله", "ليش", "واجد", "يبي", "يبغى",
    "شنو", "وش", "چذي", "شفيك", "زين", "خوش", "عيل", "توني", "مب", "شسمه",
  ],
  Egyptian: [
    "إزيك", "إزاي", "فين", "دلوقتي", "عايز", "عايزة", "كويس", "ماشي",
    "يلا", "النهارده", "بتاع", "خالص", "أوي", "كده", "ليه", "معلش", "خلاص",
  ],
  Yemeni: [
    "كيفك", "وين", "ذحين", "بغيت", "زين", "قات", "مفرج", "بيش",
    "كيفش", "ذي", "ذا", "عاد", "قدك", "شوية", "طيب",
  ],
};

/**
 * Build the Soniox v5 `context` object for a transcription request.
 * Gulf/Egyptian/Yemeni social video is heavily code-switched with English,
 * so callers should pair this with language_hints ["ar", "en"].
 */
export function buildSonioxContext(
  dialect: DialectModule,
  title?: string | null,
): Record<string, unknown> {
  return {
    general: [
      { key: "domain", value: "Arabic language learning — social media video" },
      { key: "dialect", value: `${dialect} Arabic (colloquial, not MSA)` },
      ...(title ? [{ key: "video_title", value: String(title).slice(0, 200) }] : []),
    ],
    text:
      `Colloquial ${dialect} Arabic speech from a short social-media video. ` +
      `Speakers may code-switch between ${dialect} Arabic and English. ` +
      `Transcribe dialectal words as pronounced — do not normalize toward Modern Standard Arabic.`,
    terms: DIALECT_ASR_TERMS[dialect],
  };
}
