import { describe, expect, it } from "vitest";
import {
  buildRootFamilies,
  formatRoot,
  rootKey,
  ROOT_MAX_RADICALS,
  ROOT_MIN_RADICALS,
} from "./arabicRoot";

/**
 * The root a card carries is whatever an AI wrote into a free-text column, and
 * the writers disagree: `word-enrichment` is prompted for "ك-ت-ب", other
 * functions answer "خ ب ر", older rows hold bare "كتب". For years the sibling
 * lookup compared those strings with `.eq()`, so two cards from one root only
 * ever matched if the same code path had saved them both.
 *
 * That is the bug these tests exist for. The first block is the whole feature
 * in miniature: every spelling of ك-ت-ب has to collapse to one key.
 *
 * The second concern is the opposite failure. A wrong family is worse than no
 * family — a learner who is shown a false connection has to unlearn it — so
 * anything that is not credibly a root has to be rejected outright rather than
 * cleaned up into something matchable.
 */

describe("rootKey — every spelling of one root agrees", () => {
  it("collapses separators, spacing and diacritics to a single key", () => {
    for (const spelling of ["ك-ت-ب", "ك ت ب", "ك·ت·ب", "ك.ت.ب", "كتب", "كَتَبَ", " ك ت ب "]) {
      expect(rootKey(spelling)).toBe("كتب");
    }
  });

  it("strips tatweel, which survives a copy-paste out of a rendered page", () => {
    expect(rootKey("كــتــب")).toBe("كتب");
  });

  it("folds every hamza carrier onto alef, so أ-ك-ل and ء-ك-ل are one root", () => {
    expect(rootKey("ء ك ل")).toBe(rootKey("أ ك ل"));
    expect(rootKey("س ئ ل")).toBe(rootKey("س أ ل"));
    expect(rootKey("ب ؤ س")).toBe(rootKey("ب أ س"));
  });

  it("leaves waw and ya alone — they are real radicals, not hamza carriers", () => {
    // ق و ل (said) and ق ي ل must not be folded into each other or into ق ا ل.
    expect(rootKey("ق و ل")).toBe("قول");
    expect(rootKey("ق ي ل")).toBe("قيل");
    expect(rootKey("ق و ل")).not.toBe(rootKey("ق ي ل"));
  });

  it("folds ya-maqsura and ta-marbuta the way the rest of the app does", () => {
    expect(rootKey("ر م ى")).toBe(rootKey("ر م ي"));
  });
});

describe("rootKey — refusing what is not a root", () => {
  it("returns null for nothing at all", () => {
    expect(rootKey(null)).toBeNull();
    expect(rootKey(undefined)).toBeNull();
    expect(rootKey("")).toBeNull();
    expect(rootKey("   ")).toBeNull();
  });

  it("returns null for the empty-string sentinel, so a 'no root' row joins nothing", () => {
    // '' is written deliberately by the backfill to mean "asked, none exists".
    // It must never form a family with the other '' rows.
    expect(rootKey("")).toBeNull();
  });

  it("rejects prose answers instead of matching on them", () => {
    for (const notARoot of ["n/a", "none", "unknown", "root unknown", "no root", "-"]) {
      expect(rootKey(notARoot)).toBeNull();
    }
  });

  it("rejects a phrase, which is what a model returns when it ignores the question", () => {
    expect(rootKey("من الكتاب")).toBeNull();
  });

  it("rejects transliteration and mixed script rather than laundering it", () => {
    expect(rootKey("kataba")).toBeNull();
    expect(rootKey("كtب")).toBeNull();
  });

  it("rejects digits in either numeral system", () => {
    expect(rootKey("123")).toBeNull();
    expect(rootKey("١٢٣")).toBeNull();
  });

  it("rejects non-Arabic letters that merely look close", () => {
    // پ چ گ are Persian/Urdu; no Arabic root contains them.
    expect(rootKey("پ ر س")).toBeNull();
  });

  it("holds the radical-count boundaries", () => {
    expect(rootKey("ك")).toBeNull();
    expect(rootKey("ك ت")).toBe("كت"); // ROOT_MIN_RADICALS
    expect(rootKey("د ح ر ج")).toBe("دحرج"); // quadriliteral — ordinary
    expect(rootKey("ك ت ب ر س")).toBe("كتبرس"); // ROOT_MAX_RADICALS
    expect(rootKey("ك ت ب ر س م")).toBeNull();
    expect(ROOT_MIN_RADICALS).toBe(2);
    expect(ROOT_MAX_RADICALS).toBe(5);
  });
});

describe("formatRoot", () => {
  it("spaces the radicals so the root cannot be misread as a word", () => {
    expect(formatRoot("كتب")).toBe("ك · ت · ب");
    expect(formatRoot("ك-ت-ب")).toBe("ك · ت · ب");
  });

  it("returns null wherever rootKey would, so no surface renders an unmatchable root", () => {
    expect(formatRoot("kataba")).toBeNull();
    expect(formatRoot("")).toBeNull();
    expect(formatRoot(null)).toBeNull();
  });

  it("round-trips: what it renders, rootKey still reads", () => {
    // The middot separator has to be one the matcher strips. My Words renders
    // a root as a chip and matches cards against the key behind it; a display
    // form the matcher could not read back would filter to nothing.
    expect(rootKey(formatRoot("ك-ت-ب"))).toBe("كتب");
  });
});

describe("buildRootFamilies", () => {
  const word = (id: string, root: string | null) => ({ id, root });

  it("puts differently-spelled roots in one family — the regression this feature turns on", () => {
    const families = buildRootFamilies([
      word("a", "ك-ت-ب"),
      word("b", "ك ت ب"),
      word("c", "كَتَبَ"),
    ]);

    expect(families).toHaveLength(1);
    expect(families[0].key).toBe("كتب");
    expect(families[0].display).toBe("ك · ت · ب");
    expect(families[0].words.map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("drops singletons by default — one word is not a family", () => {
    const families = buildRootFamilies([word("a", "ك ت ب"), word("b", "د ر س")]);
    expect(families).toEqual([]);
  });

  it("keeps singletons when asked, for the per-card lookup", () => {
    const families = buildRootFamilies([word("a", "ك ت ب")], { minSize: 1 });
    expect(families.map((f) => f.key)).toEqual(["كتب"]);
  });

  it("drops unparseable roots rather than bucketing them together", () => {
    // The failure worth guarding: keying on "" would collect every word whose
    // root we could not read into one enormous fake family.
    const families = buildRootFamilies(
      [word("a", "n/a"), word("b", "kataba"), word("c", ""), word("d", null)],
      { minSize: 1 },
    );
    expect(families).toEqual([]);
  });

  it("leads with the largest family and breaks ties deterministically", () => {
    const families = buildRootFamilies([
      word("a", "د ر س"),
      word("b", "د ر س"),
      word("c", "ك ت ب"),
      word("d", "ك ت ب"),
      word("e", "ك ت ب"),
      word("f", "ء ك ل"),
      word("g", "أ ك ل"),
    ]);

    expect(families.map((f) => f.key)).toEqual(["كتب", "اكل", "درس"]);
    expect(families.map((f) => f.words.length)).toEqual([3, 2, 2]);
  });
});
