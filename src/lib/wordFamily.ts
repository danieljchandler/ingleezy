/**
 * Canonical handling of English word families.
 *
 * This is the flipped descendant of Hakiya's Arabic-root module, and the flip
 * is a change of linguistics, not just of alphabet. Arabic builds a whole
 * vocabulary from a consonantal root — ك-ت-ب gives كتب, كتاب, مكتب — so the
 * root is a real, derivable thing and three letters identify it. English has
 * no such generator. What it has instead is the word family: a base word plus
 * everything derived from it, `act → action, active, actor, react, reaction`.
 *
 * That is still the same teaching move — "you already know four of these" —
 * and still worth the column, so `user_vocabulary.root` carries over with its
 * name and its meaning replaced. It now holds the family's **base form**:
 * lowercase, one word, no affixes. Everything that asks "same family?" asks
 * it here.
 *
 * The consequences of the different linguistics show up in the rules below:
 *
 * - **Length.** An Arabic root is 2-5 radicals, which doubles as a garbage
 *   filter. An English base is an ordinary word, so the bound is looser and
 *   catches only real nonsense: a phrase, a sentence, an empty string.
 * - **No display transform.** "ك · ت · ب" spaced the radicals out so the root
 *   could not be mistaken for a pronounceable word. An English base *is* a
 *   pronounceable word — that is the whole point — so it renders as itself.
 * - **Case and hyphens fold.** "Act", "act" and "ACT" are one family. So are
 *   "self-aware" and "selfaware", because a model asked for a base form will
 *   hyphenate inconsistently and two spellings of one family is exactly the
 *   failure this module exists to prevent.
 *
 * ## The empty-string sentinel
 *
 * Carried over unchanged, because it solves the same problem. `root === null`
 * means "nobody has looked yet" — the backfill will pick the row up.
 * `root === ''` means "we asked and this word has no family worth showing":
 * function words, proper nouns, numerals, an unanalysable loan. Keeping them
 * apart is what stops the backfill paying for the same hopeless word on every
 * run. `familyKey('')` is `null`, so a sentinel row can never display or join
 * a family.
 */

/**
 * Bounds on a base form. Two letters is the shortest real English base ("go"
 * is three, "be" and "do" are two); twenty is comfortably past the longest
 * ordinary one and rejects the sentence a model returns when it decides to
 * explain itself rather than answer.
 */
export const FAMILY_MIN_LENGTH = 2;
export const FAMILY_MAX_LENGTH = 20;

/**
 * Separators a model might put inside a base form, plus the invisibles that
 * ride along when text is copied out of a browser. Hyphens fold rather than
 * split: "self-aware" and "selfaware" are one family, and a family that
 * disagrees with itself about punctuation is two families to the matcher.
 *
 * Written with escapes because the second half of this class is characters you
 * cannot see in a diff — and, written literally, ones ESLint reads as stray
 * whitespace in the source.
 */
const FOLDABLE =
  /[\u002D\u2010-\u2015\u2019\u0027\u00B7\u2022\u200B-\u200F\u202A-\u202E\u061C]/g;

/** Latin letters only. Digits, Arabic script and punctuation all disqualify. */
const LATIN_LETTERS_ONLY = /^[a-z]+$/;

/**
 * The ways a model declines to answer, written as ordinary words.
 *
 * The Arabic version got these for free: "none" and "unknown" are not Arabic
 * letters, so the script check rejected them. In English they are perfectly
 * well-formed base forms, and accepting them would collect every word the
 * model could not analyse into one enormous fake family — the exact failure
 * this module exists to prevent. The empty-string sentinel is the supported
 * way to say "no family"; these are not.
 */
const NON_ANSWERS = new Set(["na", "none", "nil", "null", "undefined", "unknown", "unclear"]);

/**
 * The comparison key for a word family: lowercase Latin letters, nothing else.
 * "Act", "act", "ACT" and "act-" all return "act"; "self-aware" returns
 * "selfaware".
 *
 * Returns null for anything that isn't credibly a base form — the empty-string
 * sentinel, a phrase, Arabic script, "n/a", digits, one letter, a sentence.
 * Callers can treat null as "this row doesn't participate".
 */
export function familyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const letters = raw.normalize("NFC").trim().toLowerCase().replace(FOLDABLE, "");

  if (!letters) return null;
  // Anything surviving that isn't a Latin letter means the value was never a
  // base form — a space, a digit, Arabic script, an emoji. Reject rather than
  // strip: a family we had to launder is not one we should match on.
  if (!LATIN_LETTERS_ONLY.test(letters)) return null;
  if (letters.length < FAMILY_MIN_LENGTH || letters.length > FAMILY_MAX_LENGTH) return null;
  if (NON_ANSWERS.has(letters)) return null;

  return letters;
}

/**
 * Display form. Unlike the Arabic root it replaces, a base form needs no
 * transform to be readable — it is an English word, and showing it as one is
 * what makes "act, action, active" land as a family rather than as a code.
 *
 * Null in, null out — and garbage in, null out too, so no surface can print a
 * family that the matcher would refuse to match on.
 */
export function formatFamily(raw: string | null | undefined): string | null {
  return familyKey(raw);
}

export interface WordFamily<T> {
  /** `familyKey` output — the identity a filter or a sheet is keyed on. */
  key: string;
  /** `formatFamily` output, ready to render. */
  display: string;
  words: T[];
}

/**
 * Bucket rows by canonical family, largest family first.
 *
 * Rows whose family doesn't canonicalise are dropped rather than collected
 * under an empty key — a bucket of everything-we-couldn't-parse is not a
 * family, and showing it as one would be exactly the false connection this
 * feature has to avoid.
 *
 * `minSize` defaults to 2 because a family of one is just a word: it makes a
 * fine card annotation but a useless filter chip.
 */
export function buildWordFamilies<T extends { root: string | null }>(
  rows: readonly T[],
  options?: { minSize?: number },
): WordFamily<T>[] {
  const minSize = options?.minSize ?? 2;
  const buckets = new Map<string, T[]>();

  for (const row of rows) {
    const key = familyKey(row.root);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return Array.from(buckets.entries())
    .filter(([, words]) => words.length >= minSize)
    .map(([key, words]) => ({ key, display: key, words }))
    // Size first so the biggest families lead; key breaks ties so the order is
    // stable across renders rather than depending on insertion order.
    .sort((a, b) => b.words.length - a.words.length || a.key.localeCompare(b.key));
}
