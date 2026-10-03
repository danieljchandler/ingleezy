import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectExamples, type Dialect } from "../_shared/dialectHelpers.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildLearnerProfile } from "../_shared/learnerProfile.ts";

/**
 * The day's short challenge: English is what is practised, the learner's
 * dialect is the scaffold.
 *
 * Until 2026-10-03 this still ran Hakiya's direction — "You are a Gulf Arabic
 * language challenge generator" — so an Arabic speaker learning English was
 * asked to unscramble Arabic letters and translate English into their own
 * dialect. Nothing errored, because the prompt, the fixtures and the page all
 * agreed with each other.
 *
 * The question shape is the one `curriculum-chat` already writes for the
 * published pool, so the page reads one format whichever source it came from.
 * Keys are Arabic-era where the pool fixed them:
 * - prompt          — what the learner reads first: the dialect for translate,
 *                     spelling and culture; the English word for speed
 * - sentence        — fill_blank: the English sentence, one `___` in it
 * - sentenceEnglish — fill_blank: that sentence's meaning in the DIALECT
 * - scrambled       — unscramble: the answer's words, shuffled here rather than
 *                     by the model, so the tiles always rebuild the answer
 * - hint            — a few words of the dialect
 * - arabic/english  — match: the dialect meaning and the English word
 */
interface ChallengeQuestion {
  prompt?: string;
  sentence?: string;
  sentenceEnglish?: string;
  scrambled?: string;
  hint?: string;
  answer?: string;
  options?: string[];
  arabic?: string;
  english?: string;
}

type ChallengeType = "translate" | "fill_blank" | "unscramble" | "match" | "dictation" | "culture" | "speed";

/** Sunday first, the order `Date.getDay()` counts in. */
const CHALLENGE_TYPES: ChallengeType[] = ["translate", "fill_blank", "unscramble", "match", "dictation", "culture", "speed"];

const TITLES: Record<ChallengeType, { title: string; titleArabic: string }> = {
  translate: { title: "Say it in English", titleArabic: "قولها بالإنجليزي" },
  fill_blank: { title: "Fill the Gap", titleArabic: "أكمل الفراغ" },
  unscramble: { title: "Word Order", titleArabic: "رتّب الجملة" },
  match: { title: "Match Pairs", titleArabic: "وصّل الكلمات" },
  dictation: { title: "Spelling", titleArabic: "إملاء اليوم" },
  culture: { title: "Everyday English", titleArabic: "إنجليزي الحياة اليومية" },
  speed: { title: "Speed Round", titleArabic: "جولة سريعة" },
};

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The shared examples are written dialect-first; the prompt reads English-first. */
function englishFirst(examples: string): string {
  return examples
    .split(", ")
    .map((pair) => pair.replace(/^(.+) \((.+)\)$/, "$2 ($1)"))
    .join(", ");
}

/** The words of an English sentence, without its closing punctuation. */
function wordsOf(sentence: string): string[] {
  return sentence.trim().replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffle that is never the answer itself, which would be no puzzle at all. */
function scramble(words: string[]): string[] {
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = shuffle(words);
    if (out.some((w, i) => w !== words[i])) return out;
  }
  return [...words].reverse();
}

const filled = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/**
 * Keep only the questions a learner can actually answer, in the shape the
 * page reads. Model output is a draft: an answer missing from its own options,
 * or a gap sentence with no gap, is a question nobody can get right.
 */
function usableQuestions(type: ChallengeType, raw: unknown): ChallengeQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ChallengeQuestion[] = [];
  for (const item of raw as ChallengeQuestion[]) {
    if (!item || typeof item !== "object") continue;

    if (type === "match") {
      if (filled(item.arabic) && filled(item.english)) {
        out.push({ arabic: item.arabic.trim(), english: item.english.trim() });
      }
      continue;
    }

    if (!filled(item.answer)) continue;
    const answer = item.answer.trim();
    const hint = filled(item.hint) ? item.hint.trim() : undefined;

    if (type === "unscramble") {
      const words = wordsOf(answer);
      if (words.length < 3) continue;
      out.push({ scrambled: scramble(words).join(" "), answer, hint });
      continue;
    }

    const options = Array.from(
      new Set((Array.isArray(item.options) ? item.options : []).filter(filled).map((o) => o.trim())),
    );
    if (!options.includes(answer)) options.push(answer);
    if (options.length < 2) continue;

    if (type === "fill_blank") {
      if (!filled(item.sentence) || !item.sentence.includes("___")) continue;
      out.push({
        sentence: item.sentence.trim(),
        sentenceEnglish: filled(item.sentenceEnglish) ? item.sentenceEnglish.trim() : undefined,
        answer,
        options: shuffle(options),
        hint,
      });
      continue;
    }

    if (!filled(item.prompt)) continue;
    out.push({ prompt: item.prompt.trim(), answer, options: shuffle(options), hint });
  }
  return out;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "daily-challenge", 20, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { userVocab = [], streakDays = 0, dialect = "Gulf", difficulty = "beginner", challengeType } = await req.json();

    const dialectLabel = getDialectLabel(dialect);

    // The weekday picks the type; an explicit request overrides it. That is
    // for retrying a specific challenge — and it is what lets the tests pin
    // the word-sourcing chain without inheriting a hidden dependence on which
    // day of the week they ran (Friday is culture day, the one prompt that
    // uses no vocabulary at all).
    const todayType: ChallengeType = CHALLENGE_TYPES.includes(challengeType)
      ? (challengeType as ChallengeType)
      : CHALLENGE_TYPES[new Date().getDay()];

    // Source the challenge words from the learner's own deck rather than the
    // client-supplied `userVocab`, which was the whole curriculum shuffled
    // (useAllWords) — so the "daily challenge" routinely quizzed words the
    // learner had never studied. Weak and in-progress words come first: those
    // are the ones worth spending a daily challenge on.
    const learnerWords: string[] = [];
    try {
      const profile = await buildLearnerProfile({
        userId: cap.userId,
        dialect,
        budget: { known: 10, learning: 10, weak: 8 },
      });
      // Weak words also appear in known/learning by design, so dedupe —
      // otherwise duplicates eat the 15 prompt slots. On the English, which is
      // the word being learned: two English words can share a gloss.
      const seen = new Set<string>();
      for (const w of [...profile.weak, ...profile.learning, ...profile.known]) {
        const key = w.english.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        learnerWords.push(`${w.english} (${w.arabic})`);
      }
    } catch (e) {
      console.warn("daily-challenge: learner profile unavailable, using defaults:", e);
    }

    const vocabContext = learnerWords.length > 0
      ? learnerWords.slice(0, 15).join(", ")
      : userVocab.length > 0
      ? userVocab.slice(0, 15).map((w: any) => `${w.word_english} (${w.word_arabic})`).join(", ")
      : englishFirst(getDialectExamples(dialect));

    const streakMultiplier = streakDays >= 7 ? 2.0 : streakDays >= 3 ? 1.5 : 1.0;

    const levelGuidance = difficulty === "advanced"
      ? "Use complex sentences, idioms and phrasal verbs."
      : difficulty === "intermediate"
      ? "Use everyday sentences with some less common words."
      : "Use short sentences and the commonest words.";
    const cefr = difficulty === "advanced" ? "B2" : difficulty === "intermediate" ? "B1" : "A2";

    const systemExtra = `You write today's short English challenge for a native ${dialectLabel} speaker who is learning English.
- The English is what is being practised: natural, contemporary spoken English at CEFR ${cefr}. ${levelGuidance}
- Every Arabic string is ${dialectLabel} as people say it, never MSA. It is the learner's own language: the scaffold, not the task.
- Build the questions around the words the learner is studying (English, then its ${dialectLabel} meaning): ${vocabContext}
- Wrong options are mistakes an Arabic speaker really makes in English: a dropped "is/are", a missing or extra "the", a preposition carried over from Arabic, b/p and f/v swapped, Arabic word order. Never nonsense, and only one option may be right.
- Exactly 5 questions. Return them via the provided tool only.`;

    const prompts: Record<ChallengeType, string> = {
      translate: `Write 5 "how do you say this in English?" questions. prompt: something a person says every day, asked in ${dialectLabel} (for example: كيف تقول «وين الحمام؟» بالإنجليزي؟). answer: the natural English. options: 3 English versions, the answer and two an Arabic speaker would produce. hint: the key word, in ${dialectLabel}.`,
      fill_blank: `Write 5 English fill-in-the-blank sentences. sentence: an English sentence with exactly one ___ where a word is missing. Aim the gap at what Arabic speakers get wrong: articles, prepositions, is/are, do/does. sentenceEnglish: the whole sentence's meaning in ${dialectLabel}. answer: the missing English word. options: 3 English words, the answer among them.`,
      unscramble: `Write 5 word-order questions. answer: a short, natural English sentence of 4 to 7 words, built on the learner's words. hint: what the sentence means, in ${dialectLabel}. No options and no scrambled field: the words are shuffled for the learner afterwards.`,
      match: `Write 5 pairs for a matching game. english: a word or short phrase from the learner's words. arabic: what it means, in ${dialectLabel}. No meaning may fit two of the English words.`,
      dictation: `Write 5 spelling questions. prompt: in ${dialectLabel}, ask how an English word is spelt, giving what it means and how it sounds written in Arabic letters (for example: كيف تنكتب «بيوتفل»؟ يعني حلو). answer: the correct English spelling. options: 3 spellings, the answer and two misspellings an Arabic speaker would make (b/p, f/v, a dropped or swapped vowel, a doubled letter).`,
      culture: `Write 5 everyday-English situations from English-speaking life and manners: small talk, how people answer "How are you?", saying sorry or no politely, ordering at a café, asking for help at an airport. prompt: the situation and the question, in ${dialectLabel}. answer: the natural English thing to say. options: 3 English replies, the answer and two that would be understood but sound wrong or rude to a native speaker.`,
      speed: `Write 5 quick-fire meaning questions. prompt: one English word or short phrase from the learner's words. answer: what it means, in ${dialectLabel}. options: 3 meanings in ${dialectLabel}, the answer among them.`,
    };

    let raw: unknown;
    try {
      const brain = await askBrain<{ questions: unknown }>({
        purpose: "daily_challenge",
        dialect: dialect as Dialect,
        target: "english",
        cefr,
        systemPromptExtra: systemExtra,
        userPrompt: prompts[todayType],
        maxTokens: 2048,
        temperature: 0.8,
        tool: {
          name: "emit_daily_challenge",
          description: `Five English challenge questions with ${dialectLabel} scaffolding.`,
          parameters: {
            type: "object",
            properties: {
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    prompt: { type: "string" },
                    sentence: { type: "string" },
                    sentenceEnglish: { type: "string" },
                    hint: { type: "string" },
                    answer: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                    arabic: { type: "string" },
                    english: { type: "string" },
                  },
                },
              },
            },
            required: ["questions"],
          },
        },
      });
      raw = brain.output?.questions;
    } catch (e: any) {
      console.error("daily-challenge brain error:", e?.status, e?.message);
      if (e?.status === 402) return json({ error: "Not enough AI credits." }, 402, corsHeaders);
      if (e?.status === 429) return json({ error: "Rate limit exceeded." }, 429, corsHeaders);
      return json({ error: e?.message ?? "Challenge generation failed" }, 500, corsHeaders);
    }

    const questions = usableQuestions(todayType, raw);
    // No stand-in quiz. A two-question "hello / thank you" fallback once filled
    // this gap, and a learner could keep a streak alive on it; an error the
    // page can show and retry is the honest answer.
    if (questions.length === 0) {
      console.error("daily-challenge: no usable questions in", JSON.stringify(raw)?.slice(0, 500));
      return json({ error: "The challenge came back unusable." }, 502, corsHeaders);
    }

    return json(
      { challenge: { type: todayType, ...TITLES[todayType], questions }, streakMultiplier, baseXP: 15 },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("daily-challenge error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500, corsHeaders);
  }
});
