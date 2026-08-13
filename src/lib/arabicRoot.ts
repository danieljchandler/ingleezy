import { normalizeArabic } from "@/lib/ankiImport/normalize";

/**
 * Canonical handling of Arabic roots.
 *
 * `user_vocabulary.root` is free text written by whichever AI path happened to
 * save the card. `word-enrichment` asks for "ك-ت-ب", other functions answer
 * "خ ب ر", older rows hold "كتب", and any of them can arrive with tashkeel.
 * Comparing those strings directly — which is what the sibling lookup used to
 * do — means two cards from the same root never recognise each other unless
 * they were saved by the same code path on the same day.
 *
 * So the stored value is treated as a rendering of a root, never as the root
 * itself. `rootKey` reduces any of those spellings to one comparison key, and
 * everything that asks "same root?" asks it here.
 *
 * ## The empty-string sentinel
 *
 * `root === null` means "nobody has looked yet" — the backfill will pick the
 * row up. `root === ''` means "we asked and this word has no root": loanwords,
 * particles, proper nouns, numerals. Keeping them apart is what stops the
 * backfill paying for the same hopeless word on every run. `rootKey('')` is
 * `null`, so a sentinel row can never display or join a family.
 */

/**
 * Radical counts a real root can have. Triliteral is the overwhelming norm,
 * quadriliteral (د ح ر ج) is ordinary, and five is the rare outer bound. The
 * range doubles as a garbage filter: it rejects single letters and the phrases
 * that turn up when a model answers the question in prose.
 */
export const ROOT_MIN_RADICALS = 2;
export const ROOT_MAX_RADICALS = 5;

/**
 * Separators a model might put between radicals, plus the bidi invisibles that
 * ride along when Arabic is copied out of a browser. Spelled with escapes
 * because half of these are characters you cannot see in a diff.
 */
const SEPARATORS =
  /[\s\u002D\u2010-\u2015\u00B7\u2022\u2027.,\u060C;\u061B:/\\|_()[\]{}'"\u00AB\u00BB\u200B-\u200F\u202A-\u202E\u061C]/g;

/**
 * Hamza carriers fold to alef. `normalizeArabic` already does أ إ آ; these are
 * the ones it leaves. أ-ك-ل and ء-ك-ل are one root spelled two ways, and bare
 * alef is never itself a radical — a weak root takes و or ي — so the fold
 * cannot collide two genuinely different roots.
 */
const HAMZA_CARRIERS = /[ءئؤٱ]/g;

/**
 * Arabic letters proper: ء (U+0621) through ي (U+064A). Deliberately excludes
 * Arabic-Indic digits and the Persian/Urdu extensions (پ چ گ), none of which
 * appear in an Arabic root.
 */
const ARABIC_LETTERS_ONLY = /^[ء-ي]+$/;

/**
 * The comparison key for a root: letters only, folded, no separators.
 * "ك-ت-ب", "ك ت ب", "ك·ت·ب", "كَتَبَ" and "كتب" all return "كتب".
 *
 * Returns null for anything that isn't credibly a root — the empty-string
 * sentinel, a phrase, a transliteration, "n/a", digits, one letter, six
 * letters. Callers can treat null as "this row doesn't participate".
 */
export function rootKey(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const letters = normalizeArabic(raw.normalize("NFC"))
    .replace(SEPARATORS, "")
    .replace(HAMZA_CARRIERS, "ا");

  if (!letters) return null;
  // Anything surviving that isn't an Arabic letter means the value was never a
  // root — Latin script, digits, an emoji, a stray gloss. Reject rather than
  // strip: a "root" we had to launder is not one we should match on.
  if (!ARABIC_LETTERS_ONLY.test(letters)) return null;
  if (letters.length < ROOT_MIN_RADICALS || letters.length > ROOT_MAX_RADICALS) return null;

  return letters;
}

/**
 * Display form: "ك · ت · ب". The middots space the radicals out so the thing
 * reads unmistakably as a root rather than as a word you could pronounce.
 * Render inside dir="rtl" so the first radical sits rightmost.
 *
 * Null in, null out — and garbage in, null out too, so no surface can print a
 * root that the matcher would refuse to match on.
 */
export function formatRoot(raw: string | null | undefined): string | null {
  const key = rootKey(raw);
  return key ? key.split("").join(" · ") : null;
}

export interface RootFamily<T> {
  /** `rootKey` output — the identity a filter or a sheet is keyed on. */
  key: string;
  /** `formatRoot` output, ready to render. */
  display: string;
  words: T[];
}

/**
 * Bucket rows by canonical root, largest family first.
 *
 * Rows whose root doesn't canonicalise are dropped rather than collected under
 * an empty key — a bucket of everything-we-couldn't-parse is not a family, and
 * showing it as one would be exactly the false connection this feature has to
 * avoid.
 *
 * `minSize` defaults to 2 because a family of one is just a word: it makes a
 * fine card annotation but a useless filter chip.
 */
export function buildRootFamilies<T extends { root: string | null }>(
  rows: readonly T[],
  options?: { minSize?: number },
): RootFamily<T>[] {
  const minSize = options?.minSize ?? 2;
  const buckets = new Map<string, T[]>();

  for (const row of rows) {
    const key = rootKey(row.root);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return Array.from(buckets.entries())
    .filter(([, words]) => words.length >= minSize)
    .map(([key, words]) => ({ key, display: key.split("").join(" · "), words }))
    // Size first so the biggest families lead; key breaks ties so the order is
    // stable across renders rather than depending on insertion order.
    .sort((a, b) => b.words.length - a.words.length || a.key.localeCompare(b.key));
}
