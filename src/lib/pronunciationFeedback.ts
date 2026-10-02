import { ENGLISH_SOUNDS, type EnglishSound } from "@/data/englishSounds";
import type { PronunciationResult } from "@/hooks/useAzurePronunciation";

/**
 * Turning a pronunciation score into something a learner can act on.
 *
 * The scorer returns numbers per word and per phoneme (in IPA). On their own
 * those say "73" and "/p/ 41". What helps is the sound that went wrong, why an
 * Arabic speaker gets it wrong, and the pair of words that makes the
 * difference audible — and the English Sounds journey (`src/data/
 * englishSounds.ts`) already has all three for the sounds that matter.
 */

/** A phoneme scores below this when it is worth pointing at. */
export const WEAK_PHONEME = 70;

/**
 * IPA as the scorer writes it, folded to how the sounds data writes it: length
 * and stress marks dropped, the American r (ɹ) and the IPA g (ɡ) to plain
 * letters.
 */
export function normalizePhoneme(phoneme: string): string {
  return phoneme
    .replace(/[ːˈˌ/]/g, "")
    .replace(/ɹ/g, "r")
    .replace(/ɡ/g, "g")
    .trim();
}

const SOUND_BY_PHONEME = (() => {
  const map = new Map<string, EnglishSound>();
  for (const sound of ENGLISH_SOUNDS) {
    // "/p/", or "/iː/ vs /ɪ/" for the vowel-pair stops.
    for (const [, ipa] of sound.ipa.matchAll(/\/([^/]+)\//g)) {
      const key = normalizePhoneme(ipa);
      if (key && !map.has(key)) map.set(key, sound);
    }
  }
  return map;
})();

/** The English Sounds stop that teaches `phoneme`, if there is one. */
export function soundForPhoneme(phoneme: string): EnglishSound | undefined {
  return SOUND_BY_PHONEME.get(normalizePhoneme(phoneme));
}

export interface WeakSound {
  phoneme: string;
  accuracy: number;
  /** The word it was in. */
  word: string;
  /** The stop that teaches it, when the journey covers it. */
  sound?: EnglishSound;
}

/**
 * The phoneme that went worst, when one went badly enough to mention. Ties go
 * to the one a learner can be taught (it has a sound stop), then to the first.
 */
export function weakestSound(result: Pick<PronunciationResult, "words">): WeakSound | null {
  let worst: WeakSound | null = null;
  for (const word of result.words) {
    for (const p of word.phonemes ?? []) {
      if (!p.phoneme || p.accuracy >= WEAK_PHONEME) continue;
      const candidate = { phoneme: p.phoneme, accuracy: p.accuracy, word: word.word, sound: soundForPhoneme(p.phoneme) };
      if (
        !worst ||
        candidate.accuracy < worst.accuracy ||
        (candidate.accuracy === worst.accuracy && candidate.sound && !worst.sound)
      ) {
        worst = candidate;
      }
    }
  }
  return worst;
}

/** Text compared as a listener would: case, punctuation and spacing ignored. */
const asHeard = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What the scorer heard, when it is not what the learner was asked to say —
 * "we heard bark, not park". Null when they match or nothing was heard.
 */
export function heardInstead(reference: string, recognized: string | null | undefined): string | null {
  const heard = asHeard(recognized ?? "");
  if (!heard || heard === asHeard(reference)) return null;
  return (recognized ?? "").trim();
}
