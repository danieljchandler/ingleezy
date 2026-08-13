// The daily vocabulary story's generation core, extracted from
// generate-daily-story so two callers can share it byte-for-byte:
//
//   generate-daily-story  the learner-facing HTTP shell (cap, auth, cache)
//   pregenerate-daily     the nightly batch (B3) that pre-builds stories for
//                         recently-active learners, so the story is instant
//                         on open instead of a 20-second generation the
//                         learner pays for in latency
//
// Everything here runs under the service role and is parameterized by
// (userId, dialect); the callers own authentication and caching policy.
import { askBrain } from "./aiBrain.ts";
import type { Dialect } from "./dialectHelpers.ts";

// ── Minimal structural type for the PostgREST client ─────────────────────────
// Same pattern as learnerProfile.ts: typed structurally rather than as
// SupabaseClient<Database>, because the generated frontend types are not
// available to edge functions and `any` would lose the response shapes.
// Callers cast their service-role client once: `admin as unknown as DailyStoryDb`.
interface DbResponse {
  data: unknown;
  error?: { message: string } | null;
}

interface Query extends PromiseLike<DbResponse> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Query;
  single(): Query;
  upsert(values: Record<string, unknown>, opts?: { onConflict?: string }): Query;
}

export interface DailyStoryDb {
  from(table: string): Query;
}

export interface VocabRow {
  word_arabic: string;
  word_english: string;
  stage: string;
  interval_days: number;
}

// Cold-start fallback: a small curated starter set per dialect so a brand-new
// user (with fewer than 3 saved words) still gets a story on day one instead
// of a "not enough vocab" wall.
export const STARTER_WORDS: Record<string, VocabRow[]> = {
  Gulf: [
    { word_arabic: "بيت", word_english: "house", stage: "NEW", interval_days: 0 },
    { word_arabic: "أكل", word_english: "food", stage: "NEW", interval_days: 0 },
    { word_arabic: "صديق", word_english: "friend", stage: "NEW", interval_days: 0 },
    { word_arabic: "شغل", word_english: "work", stage: "NEW", interval_days: 0 },
    { word_arabic: "زين", word_english: "good", stage: "NEW", interval_days: 0 },
  ],
  Egyptian: [
    { word_arabic: "بيت", word_english: "house", stage: "NEW", interval_days: 0 },
    { word_arabic: "أكل", word_english: "food", stage: "NEW", interval_days: 0 },
    { word_arabic: "صاحب", word_english: "friend", stage: "NEW", interval_days: 0 },
    { word_arabic: "شغل", word_english: "work", stage: "NEW", interval_days: 0 },
    { word_arabic: "كويس", word_english: "good", stage: "NEW", interval_days: 0 },
  ],
  Yemeni: [
    { word_arabic: "بيت", word_english: "house", stage: "NEW", interval_days: 0 },
    { word_arabic: "أكل", word_english: "food", stage: "NEW", interval_days: 0 },
    { word_arabic: "صاحب", word_english: "friend", stage: "NEW", interval_days: 0 },
    { word_arabic: "شغل", word_english: "work", stage: "NEW", interval_days: 0 },
    { word_arabic: "زين", word_english: "good", stage: "NEW", interval_days: 0 },
  ],
};

/** One card in the reader: an ENGLISH sentence with its Arabic scaffold. */
export interface StorySentence {
  /** The sentence as the learner reads it — English is the story now. */
  english: string;
  /** Dialect-Arabic translation (the scaffold). */
  arabic?: string;
  /** Word-for-word Arabic gloss preserving the English word order. */
  literal?: string;
}

/** Non-whitespace characters, for comparing a split against the body it came from. */
const dense = (text: string) => text.replace(/\s+/g, "");

/**
 * The model's sentence split, reduced to what is safe to store.
 *
 * Entries without English are dropped — the ENGLISH is the story now; a card
 * with none is nothing to read — and blank scaffolds become absent rather
 * than empty strings, so the reader can tell "no translation" from "a
 * translation that is empty".
 *
 * The whole split is discarded unless it accounts for nearly all of the
 * story: a model that quietly skipped a sentence would otherwise produce a
 * story the learner reads a shortened version of, with no sign that anything
 * is missing. Dropping it costs only the per-sentence scaffolds, since the
 * page falls back to splitting the body on punctuation.
 */
export function cleanStorySentences(raw: unknown, bodyEnglish: string): StorySentence[] {
  if (!Array.isArray(raw)) return [];

  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const sentences: StorySentence[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const english = text(row.english);
    if (!english) continue;
    sentences.push({
      english,
      arabic: text(row.arabic),
      literal: text(row.literal),
    });
  }

  if (sentences.length === 0) return [];
  const covered = dense(sentences.map((s) => s.english).join(""));
  if (covered.length < dense(bodyEnglish).length * 0.95) return [];
  return sentences;
}

export function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** The cached story for (user, date, dialect), or null. */
export async function existingStory(
  admin: DailyStoryDb,
  userId: string,
  dialect: string,
  date: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from("daily_vocab_stories")
    .select("*")
    .eq("user_id", userId)
    .eq("story_date", date)
    .eq("dialect", dialect)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export class DailyStoryError extends Error {
  constructor(
    public code: "ai_failed" | "empty_story" | "save_failed",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Generate and store the story for (user, date, dialect). Throws
 * DailyStoryError on failure; returns the saved row. Callers decide whether
 * to check the cache first — this always generates.
 */
export async function generateDailyStoryFor(
  admin: DailyStoryDb,
  userId: string,
  dialect: string,
  date: string,
): Promise<Record<string, unknown>> {
  // 1. Pick vocab from the user's deck
  const { data: matureRows } = await admin
    .from("user_vocabulary")
    .select("word_arabic, word_english, stage, interval_days")
    .eq("user_id", userId)
    .eq("dialect", dialect)
    .gte("interval_days", 7)
    .order("interval_days", { ascending: false })
    .limit(15);

  const { data: newRows } = await admin
    .from("user_vocabulary")
    .select("word_arabic, word_english, stage, interval_days")
    .eq("user_id", userId)
    .eq("dialect", dialect)
    .eq("stage", "NEW")
    .order("created_at", { ascending: false })
    .limit(5);

  const mature = (matureRows ?? []) as VocabRow[];
  let fresh = (newRows ?? []) as VocabRow[];

  // Cold start: pad with a small built-in starter set so a brand-new user
  // still gets a story instead of hitting a wall on day one.
  if (mature.length + fresh.length < 3) {
    const starters = STARTER_WORDS[dialect] ?? STARTER_WORDS.Gulf;
    const known = new Set([...mature, ...fresh].map((w) => w.word_arabic));
    fresh = [...fresh, ...starters.filter((w) => !known.has(w.word_arabic))];
  }

  // English-first rendering: the studied word leads, its Arabic rides along.
  const matureList = mature.map((w) => `${w.word_english} (${w.word_arabic})`).join(", ");
  const newList = fresh.map((w) => `${w.word_english} (${w.word_arabic})`).join(", ");

  // 2. Ask the brain for a ~200-word ENGLISH story (english-target: the
  // interference rulebook steers it toward the patterns worth modeling).
  // The Arabic scaffold (dialect translation + literal gloss) is produced in
  // the same call — one generation, so the scaffold is not separately
  // dialect-guarded; acceptable for support text a learner reads alongside
  // the English rather than studies as Arabic.
  const systemExtra = `You are a creative English short-story writer for Arabic-speaking learners.
Write a vivid, self-contained micro-story of about 180-220 English words as body_english.
Weave in as many of the learner's MATURE words as feels natural, and gently introduce each of the NEW words at least once (use them in context so meaning is inferable).
Reading level: matched to the learner. Short sentences, concrete imagery, one clear arc, natural SPOKEN English.

Also provide:
- body_arabic: a natural ${dialect} dialect Arabic translation of the whole story (the learner's own dialect — NOT Modern Standard Arabic).
- body_english_literal: a word-for-word ARABIC gloss of the story preserving the ENGLISH word order, so the learner sees how the English is built. Stiffness is expected.
- sentences: the story split one entry per sentence, in order — the learner reads a sentence at a time. The english values joined back together must be body_english, unchanged. Each entry carries its ${dialect} Arabic translation as arabic and its word-order Arabic gloss as literal.

Return ONLY the structured fields via the provided tool.`;

  const userPrompt = `MATURE words (review-anchored): ${matureList || "(none yet)"}\nNEW words to gently introduce: ${newList || "(none yet)"}`;

  let brain;
  try {
    brain = await askBrain<{
      title: string;
      body_english: string;
      body_arabic: string;
      body_english_literal: string;
      sentences: StorySentence[];
      used_mature: string[];
      used_new: string[];
    }>({
      purpose: "story",
      dialect: dialect as Dialect,
      target: "english",
      strategy: "draft_critic",
      // Uses MODEL_LINEUPS.CONTENT (Gemini 3.5 Flash drafts, Claude Sonnet 4.5 critiques)
      // from _shared/modelRegistry.ts. Do not hardcode model IDs here.
      systemPromptExtra: systemExtra,
      userPrompt,
      maxTokens: 3072,
      temperature: 0.7,
      tool: {
        name: "emit_story",
        description: "Return the daily vocabulary story in English with Arabic scaffolding.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short evocative English title" },
            body_english: { type: "string", description: "The story in natural spoken English, ~200 words" },
            body_arabic: { type: "string", description: "Natural dialect-Arabic translation of the whole story (the learner's dialect, never MSA)" },
            body_english_literal: { type: "string", description: "Word-for-word Arabic gloss of the story preserving the English word order (may sound stiff; shows how sentences are built)" },
            sentences: {
              type: "array",
              description: "body_english split into its individual sentences, in order, each with its dialect-Arabic translation and word-order Arabic gloss",
              items: {
                type: "object",
                properties: {
                  english: { type: "string", description: "One sentence of body_english, unchanged" },
                  arabic: { type: "string", description: "Dialect-Arabic translation of this sentence" },
                  literal: { type: "string", description: "Word-for-word Arabic gloss of this sentence, preserving the English word order" },
                },
                required: ["english", "arabic"],
              },
            },
            used_mature: { type: "array", items: { type: "string" } },
            used_new: { type: "array", items: { type: "string" } },
          },
          required: ["title", "body_english", "body_arabic", "used_mature", "used_new"],
        },
      },
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error("daily-story brain error", err?.status, err?.message);
    throw new DailyStoryError("ai_failed", String(err?.message ?? e).slice(0, 400));
  }

  const parsed = brain.output;
  const title = String(parsed.title ?? "").slice(0, 160) || "Today's story";
  const bodyEnglish = String(parsed.body_english ?? "").trim();
  const bodyArabic = String(parsed.body_arabic ?? "").trim();
  const bodyEnglishLiteral = String(parsed.body_english_literal ?? "").trim();
  if (!bodyEnglish) {
    throw new DailyStoryError("empty_story", brain.raw.slice(0, 400));
  }

  const sentences = cleanStorySentences(parsed.sentences, bodyEnglish);
  const vocabUsed = Array.isArray(parsed.used_mature) ? parsed.used_mature : [];
  const newUsed = Array.isArray(parsed.used_new) ? parsed.used_new : [];

  // 3. Upsert
  const { data: saved, error: saveErr } = await admin
    .from("daily_vocab_stories")
    .upsert(
      {
        user_id: userId,
        story_date: date,
        dialect,
        title,
        // Column roles after the direction flip: body_english is the story
        // (primary), body_arabic its dialect scaffold. body_transliteration
        // is retired — an Arabic speaker needs no romanization of Arabic.
        body_english: bodyEnglish,
        body_arabic: bodyArabic || null, // nullable since 20260813170000
        body_transliteration: null,
        body_english_literal: bodyEnglishLiteral || null,
        sentences: sentences.length > 0 ? sentences : null,
        vocab_used: vocabUsed,
        new_words: newUsed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,story_date,dialect" },
    )
    .select("*")
    .single();

  if (saveErr) {
    console.error("daily-story save error", saveErr);
    throw new DailyStoryError("save_failed", saveErr.message);
  }
  return saved as Record<string, unknown>;
}
