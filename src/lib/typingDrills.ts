/**
 * The Arabic typing trainer's drill logic (written production, C3).
 *
 * Progressive key introduction tied to the Alphabet Journey: the same 28
 * letters, in the same order, grouped into the same four stages the Journey's
 * checkpoints use. A stage's drill teaches its seven letters first, then has
 * the learner type real example words drawn from the alphabet data — but only
 * words spellable with letters introduced so far, so stage 1 never demands a
 * key the learner has not met.
 *
 * Pure module: the keyboard layout, the drill builder and the scoring are all
 * data-in data-out, tested in src/lib/typingDrills.test.ts. Rendering lives in
 * src/components/writing/ArabicKeyboard.tsx and the WritingPractice page.
 */
import { ARABIC_LETTERS, CHECKPOINT_INDICES, type ArabicLetter } from "@/data/arabicAlphabet";

// ── Keyboard layout ──────────────────────────────────────────────────────────

export interface ArabicKey {
  /** The Arabic character this key produces (base layer). */
  char: string;
  /** The physical QWERTY key that produces it, for the key-cap hint. */
  qwerty: string;
}

/**
 * The standard Arabic (101) layout's letter keys, base layer only, row by row.
 * Every one of the 28 alphabet letters is typable without shift on this
 * layout — ذ sits on the backtick, which is why the top row has 13 keys.
 */
export const KEYBOARD_ROWS: ArabicKey[][] = [
  [
    { char: "ذ", qwerty: "`" },
    { char: "ض", qwerty: "Q" },
    { char: "ص", qwerty: "W" },
    { char: "ث", qwerty: "E" },
    { char: "ق", qwerty: "R" },
    { char: "ف", qwerty: "T" },
    { char: "غ", qwerty: "Y" },
    { char: "ع", qwerty: "U" },
    { char: "ه", qwerty: "I" },
    { char: "خ", qwerty: "O" },
    { char: "ح", qwerty: "P" },
    { char: "ج", qwerty: "[" },
    { char: "د", qwerty: "]" },
  ],
  [
    { char: "ش", qwerty: "A" },
    { char: "س", qwerty: "S" },
    { char: "ي", qwerty: "D" },
    { char: "ب", qwerty: "F" },
    { char: "ل", qwerty: "G" },
    { char: "ا", qwerty: "H" },
    { char: "ت", qwerty: "J" },
    { char: "ن", qwerty: "K" },
    { char: "م", qwerty: "L" },
    { char: "ك", qwerty: ";" },
    { char: "ط", qwerty: "'" },
  ],
  [
    { char: "ئ", qwerty: "Z" },
    { char: "ء", qwerty: "X" },
    { char: "ؤ", qwerty: "C" },
    { char: "ر", qwerty: "V" },
    { char: "ى", qwerty: "N" },
    { char: "ة", qwerty: "M" },
    { char: "و", qwerty: "," },
    { char: "ز", qwerty: "." },
    { char: "ظ", qwerty: "/" },
  ],
];

const KEY_BY_CHAR = new Map<string, ArabicKey>(
  KEYBOARD_ROWS.flat().map((key) => [key.char, key]),
);

/** The key that types this character, or undefined for off-layout characters. */
export const keyForChar = (char: string): ArabicKey | undefined =>
  KEY_BY_CHAR.get(normalizeChar(char));

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Fold a typed or target character to its base-layer key.
 *
 * Hamza-carrier forms need shift (أ) or do not exist as single base keys (آ),
 * and diacritics have no letter key at all. The trainer teaches the 28 base
 * letters, so أ/إ/آ fold to ا and harakat vanish — a learner who types ا for
 * أرنب is typing the right key.
 */
const CHAR_FOLD: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
};

const DIACRITICS = /[ً-ْٰ]/g;

export function normalizeChar(char: string): string {
  return CHAR_FOLD[char] ?? char;
}

/** A word reduced to the sequence of base-layer keys that type it. */
export function typingTarget(word: string): string {
  return word
    .replace(DIACRITICS, "")
    .split("")
    .map((c) => normalizeChar(c))
    .filter((c) => c === " " || KEY_BY_CHAR.has(c))
    .join("");
}

// ── Stages ───────────────────────────────────────────────────────────────────

export interface TypingStage {
  /** 0..3, mirroring the Alphabet Journey's four checkpoints. */
  index: number;
  title: string;
  letters: ArabicLetter[];
}

/** The Journey's four checkpoint groups: letters 0-6, 7-13, 14-20, 21-27. */
export const TYPING_STAGES: TypingStage[] = CHECKPOINT_INDICES.map((end, i) => {
  const start = i === 0 ? 0 : CHECKPOINT_INDICES[i - 1] + 1;
  const letters = ARABIC_LETTERS.slice(start, end + 1);
  return {
    index: i,
    title: `${letters[0].name_translit} – ${letters[letters.length - 1].name_translit}`,
    letters,
  };
});

/** Every letter introduced in stages 0..stageIndex, as base-layer characters. */
export function lettersThrough(stageIndex: number): Set<string> {
  const known = new Set<string>();
  for (const stage of TYPING_STAGES.slice(0, stageIndex + 1)) {
    for (const letter of stage.letters) known.add(normalizeChar(letter.isolated));
  }
  return known;
}

/**
 * Which of the 28 base letters a character *counts as* for word coverage.
 *
 * The variant glyphs are real keys the learner will press (ة is on M), but
 * they are taught as variants of a base letter in the Journey, not as letters
 * of their own — so a word containing ة is only "spellable so far" once ه has
 * been introduced. Distinct from normalizeChar, which folds to the key that
 * must physically be pressed.
 */
const COVERAGE_BASE: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ء": "ا", // hamza is introduced alongside alif
  "ة": "ه",
  "ى": "ي",
  "ئ": "ي",
  "ؤ": "و",
};

export function coverageBase(char: string): string {
  return COVERAGE_BASE[char] ?? char;
}

// ── Drills ───────────────────────────────────────────────────────────────────

export interface DrillItem {
  /** What the learner must type, already folded to base-layer keys. */
  target: string;
  /** What to display above the input (the unfolded original). */
  display: string;
  translit: string;
  english?: string;
  kind: "letter" | "word";
}

/**
 * The drill for one stage: its seven letters in Journey order, then every
 * example word (from this stage's letters) spellable with keys introduced so
 * far. Deterministic — same stage, same drill — so a learner can retry a run
 * and progress is comparable.
 */
export function buildDrill(stageIndex: number): DrillItem[] {
  const stage = TYPING_STAGES[stageIndex];
  if (!stage) return [];

  const known = lettersThrough(stageIndex);

  const letters: DrillItem[] = stage.letters.map((letter) => ({
    target: normalizeChar(letter.isolated),
    display: letter.isolated,
    translit: letter.name_translit,
    kind: "letter",
  }));

  const words: DrillItem[] = stage.letters
    .flatMap((letter) => letter.examples)
    .map((example) => ({ example, target: typingTarget(example.ar) }))
    .filter(({ target }) => target.length >= 2)
    .filter(({ target }) => [...target].every((c) => c === " " || known.has(coverageBase(c))))
    .map(({ example, target }) => ({
      target,
      display: example.ar,
      translit: example.translit,
      english: example.en,
      kind: "word" as const,
    }));

  return [...letters, ...words];
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface DrillScore {
  typed: number;
  errors: number;
  /** 0-100, whole number. 100 with nothing typed yet. */
  accuracy: number;
}

export function scoreDrill(typed: number, errors: number): DrillScore {
  const accuracy = typed === 0 ? 100 : Math.round(((typed - Math.min(errors, typed)) / typed) * 100);
  return { typed, errors, accuracy };
}

/**
 * Does this keystroke match the expected character? Forgiving across the fold:
 * typing ا satisfies أ, and either member of a folded pair satisfies the other.
 */
export function keystrokeMatches(typedChar: string, expectedChar: string): boolean {
  return normalizeChar(typedChar) === normalizeChar(expectedChar);
}
