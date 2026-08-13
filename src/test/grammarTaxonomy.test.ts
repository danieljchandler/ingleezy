import { describe, it, expect } from "vitest";
import {
  canonicalGrammarKey,
  CATEGORY_KEYWORDS,
  GRAMMAR_CATEGORY_IDS,
  matchGrammarCategory,
  normalizeGrammarText,
  slugifyGrammarText,
} from "../../supabase/functions/_shared/grammarTaxonomy";

describe("normalizeGrammarText", () => {
  it("lower-cases and collapses punctuation to single spaces", () => {
    expect(normalizeGrammarText("Verb Conjugation — Past Tense!")).toBe(
      "verb conjugation past tense",
    );
  });

  it("strips Arabic diacritics so vocalised and bare text agree", () => {
    expect(normalizeGrammarText("النَّفْي")).toBe(normalizeGrammarText("النفي"));
  });

  it("is empty for input with nothing in it", () => {
    expect(normalizeGrammarText("  —  ")).toBe("");
    expect(normalizeGrammarText("")).toBe("");
  });
});

describe("matchGrammarCategory", () => {
  it("recognises the canonical ids themselves", () => {
    for (const id of GRAMMAR_CATEGORY_IDS) {
      expect(matchGrammarCategory(id)).toBe(id);
    }
  });

  it("collapses the paraphrases that fragmented the key space", () => {
    // These are three rows in curriculum_concepts today, and one concept.
    const forms = [
      "Negation with ما",
      "negation of the past tense",
      "Past-tense negation",
      "Negative sentences",
      "النفي",
    ];
    for (const form of forms) {
      expect(matchGrammarCategory(form)).toBe("negation");
    }
  });

  it("prefers the specific category over incidental verb wording", () => {
    // "negation of the past tense verb" contains both sets of keywords. What is
    // being taught is negation; verb-conjugation is checked last precisely
    // because its words show up in descriptions of everything else.
    expect(matchGrammarCategory("negation of the past tense verb")).toBe("negation");
    expect(matchGrammarCategory("question forms using the present tense verb")).toBe("questions");
    expect(matchGrammarCategory("possessive suffixes on verbs")).toBe("possessives");
  });

  it("still reaches verb-conjugation when nothing more specific applies", () => {
    expect(matchGrammarCategory("Past tense conjugation")).toBe("verb-conjugation");
    expect(matchGrammarCategory("تصريف الأفعال")).toBe("verb-conjugation");
  });

  it("matches whole words only", () => {
    // "adverb" contains "verb"; "questionnaire" contains "question".
    expect(matchGrammarCategory("adverb placement")).toBeNull();
    expect(matchGrammarCategory("questionnaire design")).toBeNull();
  });

  it("matches multi-word keywords as a sequence, not as loose words", () => {
    expect(matchGrammarCategory("word order in nominal sentences")).toBe("sentence-structure");
    // "order" and "word" both present but not adjacent in that order.
    expect(matchGrammarCategory("order of the words")).toBeNull();
  });

  it("returns null for a grammar point the taxonomy has no home for", () => {
    expect(matchGrammarCategory("dual agreement")).toBeNull();
    expect(matchGrammarCategory("vocative particles")).toBeNull();
  });

  it("returns null for empty input rather than guessing", () => {
    expect(matchGrammarCategory("")).toBeNull();
    expect(matchGrammarCategory("   ")).toBeNull();
  });
});

describe("canonicalGrammarKey", () => {
  it("maps recognised prose onto the canonical id", () => {
    expect(canonicalGrammarKey("Negation with ما")).toBe("negation");
    expect(canonicalGrammarKey("Possessive suffixes")).toBe("possessives");
  });

  it("slugs an unrecognised point instead of dropping or mislabelling it", () => {
    // A genuinely new grammar point should still become a concept and show up
    // in coverage — it just won't join to drill mastery, because there are no
    // drills for it. That is true, and better than pretending otherwise.
    expect(canonicalGrammarKey("Dual agreement")).toBe("dual-agreement");
    expect(canonicalGrammarKey("Vocative particles!")).toBe("vocative-particles");
  });

  it("gives one key for spellings that differ only in case or punctuation", () => {
    expect(canonicalGrammarKey("Dual  Agreement")).toBe(canonicalGrammarKey("dual-agreement"));
  });

  it("never returns a key that collides with a category by accident", () => {
    // slugify must not produce one of the six unless the match path chose it.
    expect(slugifyGrammarText("dual agreement")).not.toBe("negation");
  });
});

describe("Arabic definite article", () => {
  it("matches a keyword carrying the attached article", () => {
    // Arabic attaches al-, so "النفي" is one token that must still match "نفي".
    expect(matchGrammarCategory("النفي")).toBe("negation");
    expect(matchGrammarCategory("الضمائر")).toBe("pronouns");
  });

  it("does not strip the article off a word that is nothing without it", () => {
    // Guards the rule from becoming "chop two characters off anything".
    expect(matchGrammarCategory("الله")).toBeNull();
  });
});

describe("the migration's keyword table stays in step with this module", () => {
  // 20260801150000 re-keys existing curriculum_concepts rows onto the same
  // taxonomy, which means it carries a copy of CATEGORY_KEYWORDS in SQL. A copy
  // that silently drifts would re-key old rows one way and new writes another —
  // recreating exactly the split the migration exists to fix. So the copy is
  // pinned here rather than trusted.
  it("lists the same (priority, category, keyword) triples", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    // Vitest runs from the repo root; import.meta.url is not a file URL here.
    const sql = await readFile(
      resolve("supabase/migrations/20260801150000_unify_grammar_concept_keys.sql"),
      "utf8",
    );

    const block = sql.match(
      /INSERT INTO _grammar_kw \(priority, category, keyword\) VALUES\n([\s\S]*?);/,
    );
    expect(block, "keyword VALUES block not found in the migration").not.toBeNull();

    const fromSql = [...block![1].matchAll(/\(\s*(\d+),\s*'([^']*)',\s*'([^']*)'\s*\)/g)]
      .map((m) => [Number(m[1]), m[2], m[3]] as const);

    const expected: (readonly [number, string, string])[] = [];
    let priority = 0;
    for (const { id, keywords } of CATEGORY_KEYWORDS) {
      for (const keyword of keywords) expected.push([++priority, id, keyword] as const);
    }

    expect(fromSql).toEqual(expected);
  });
});
