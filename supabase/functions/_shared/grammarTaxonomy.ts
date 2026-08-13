// One key space for grammar concepts.
//
// `curriculum_concepts` grew two independent writers that both produce
// `kind: 'grammar'` rows and disagree about what the key is:
//
//   - extract-concepts keys on the free-text `grammar_point` a model wrote —
//     "Negation with ما", "negation of the past tense", "Past-tense negation".
//     Three rows, one concept, and the same again for every paraphrase, every
//     approval, across grammar_exercises and discover_videos.grammar_points.
//   - record-grammar-outcome keys on the six drill category ids, because a
//     mastery ladder needs a stable rung to climb.
//
// So content got tagged with concepts that a learner's mastery could never join
// to, which defeats the point of having a concept graph at all: the coverage
// planner sees near-duplicates in `avoid`/`reinforce`, and a learner who has
// demonstrably nailed negation in drills still looks untested against every
// piece of negation content in the library.
//
// This module is the canonicaliser both writers now go through. Pure and
// dependency-free so the Vitest suite can exercise it and the React app can
// import the category list rather than keeping a third copy.

/**
 * The canonical grammar categories. These are `curriculum_concepts.key` values
 * and the ids the drill UI uses, so they are a contract — renaming one starts a
 * fresh concept and orphans the mastery recorded against the old name.
 */
export const GRAMMAR_CATEGORY_IDS = [
  "verb-conjugation",
  "pronouns",
  "negation",
  "possessives",
  "questions",
  "sentence-structure",
] as const;

export type GrammarCategoryId = (typeof GRAMMAR_CATEGORY_IDS)[number];

export const GRAMMAR_CATEGORY_SET: ReadonlySet<string> = new Set(GRAMMAR_CATEGORY_IDS);

/**
 * Keywords that identify each category in free-text grammar-point prose.
 *
 * Order is significant and deliberate: the first category with a hit wins, and
 * the list runs from most to least specific. "negation of the past tense verb"
 * teaches negation, not conjugation — but it contains both sets of words, so
 * verb-conjugation has to be checked last. Its own keywords ("verb", "tense")
 * are the ones most likely to appear incidentally in a description of something
 * else, which is exactly what makes it the weakest signal.
 *
 * Arabic terms are included because grammar points arrive in both languages.
 * They are matched after diacritic stripping, same as the rest.
 */
export const CATEGORY_KEYWORDS: { id: GrammarCategoryId; keywords: string[] }[] = [
  {
    id: "negation",
    keywords: ["negation", "negative", "negate", "negating", "نفي", "منفي"],
  },
  {
    id: "possessives",
    keywords: [
      "possessive", "possession", "possessed", "genitive",
      "idafa", "idaafa", "iḍāfa", "اضافة", "ملكية",
    ],
  },
  {
    id: "questions",
    keywords: [
      "question", "questions", "interrogative", "asking",
      "wh word", "wh words", "سؤال", "اسئلة", "استفهام",
    ],
  },
  {
    id: "pronouns",
    keywords: [
      "pronoun", "pronouns", "demonstrative", "demonstratives",
      "ضمير", "ضمائر", "اشارة",
    ],
  },
  {
    id: "sentence-structure",
    keywords: [
      "sentence structure", "word order", "syntax",
      "nominal sentence", "verbal sentence", "clause",
      "بنية الجملة", "ترتيب",
    ],
  },
  {
    id: "verb-conjugation",
    keywords: [
      "conjugation", "conjugate", "conjugating", "verb", "verbs",
      "tense", "past tense", "present tense", "future tense",
      "imperative", "imperfect", "perfect",
      "تصريف", "فعل", "افعال",
    ],
  },
];

/** Arabic diacritics (fatha…sukun, plus dagger alif). */
const ARABIC_DIACRITICS = /[ً-ْٰ]/g;

/**
 * Mechanical normalisation: what two spellings of the same phrase have in
 * common. Lower-cases, strips Arabic diacritics, and collapses every run of
 * non-alphanumeric characters (including Arabic script boundaries, hyphens,
 * and punctuation) to a single space.
 */
export function normalizeGrammarText(raw: string): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(ARABIC_DIACRITICS, "")
    .toLowerCase()
    // Keep Latin letters, digits and Arabic letters; everything else separates.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Slug form of a phrase, used when nothing in the taxonomy matches. */
export function slugifyGrammarText(raw: string): string {
  return normalizeGrammarText(raw).replace(/\s+/g, "-");
}

/**
 * The canonical category a free-text grammar point belongs to, or null when
 * none of them fits.
 *
 * Matching is on whole words against the normalised string, so "adverb" does
 * not count as "verb" and "questionnaire" does not count as "question".
 */
export function matchGrammarCategory(raw: string): GrammarCategoryId | null {
  const text = normalizeGrammarText(raw);
  if (!text) return null;

  // Already canonical — "verb-conjugation" normalises to "verb conjugation".
  for (const id of GRAMMAR_CATEGORY_IDS) {
    if (text === normalizeGrammarText(id)) return id;
  }

  const words = text.split(" ").map(wordVariants);
  for (const { id, keywords } of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      if (containsSequence(words, keyword.split(" "))) return id;
    }
  }
  return null;
}

/**
 * The forms a single word may legitimately match as.
 *
 * Arabic attaches the definite article, so "النفي" is one token that has to
 * match the keyword "نفي" — whole-word matching alone rejects it, which is how
 * an unvocalised Arabic grammar point ended up unclassified. Only the bare
 * article is stripped, and only when something is left, so "الله" or a Latin
 * word is untouched.
 */
function wordVariants(word: string): string[] {
  if (word.startsWith("ال") && word.length > 3) return [word, word.slice(2)];
  return [word];
}

/** True when `phrase` appears as consecutive words, allowing per-word variants. */
function containsSequence(words: string[][], phrase: string[]): boolean {
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (!words[i + j].includes(phrase[j])) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * The `curriculum_concepts.key` to write for a grammar concept.
 *
 * Falls back to a slug of the original text when the taxonomy has no home for
 * it. That fallback is the point of not hard-restricting the key space: a
 * genuinely new grammar point ("dual agreement", "vocative particles") should
 * still become a concept and show up in coverage, just not get silently
 * mislabelled as one of the six. It simply won't join to drill mastery, because
 * there are no drills for it — which is true, and better than pretending.
 */
export function canonicalGrammarKey(raw: string): string {
  return matchGrammarCategory(raw) ?? slugifyGrammarText(raw);
}
