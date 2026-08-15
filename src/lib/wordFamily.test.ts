import { describe, expect, it } from "vitest";
import {
  buildWordFamilies,
  familyKey,
  formatFamily,
  FAMILY_MAX_LENGTH,
  FAMILY_MIN_LENGTH,
} from "./wordFamily";

/**
 * The family a card carries is whatever an AI wrote into a free-text column,
 * and the writers disagree: one path answers "act", another "Act", another
 * "to act" or "act-". The Arabic-era version of this module existed because
 * two cards from one root only ever matched if the same code path had saved
 * them both; the English version inherits exactly that risk with a different
 * set of spellings.
 *
 * So the first block is the whole feature in miniature: every spelling of one
 * base form has to collapse to one key.
 *
 * The second concern is the opposite failure. A wrong family is worse than no
 * family — a learner shown a false connection has to unlearn it — so anything
 * that is not credibly a base form is rejected outright rather than cleaned up
 * into something matchable. "Act" and "action" being one family is the point;
 * "act" and "actually" being one family would be a lie, and the module's
 * answer to that is that it never derives a family itself. It only
 * canonicalises what it was given.
 */

describe("familyKey — every spelling of one family agrees", () => {
  it("collapses case, spacing and hyphens to a single key", () => {
    for (const spelling of ["act", "Act", "ACT", " act ", "act-", "-act"]) {
      expect(familyKey(spelling)).toBe("act");
    }
  });

  it("folds an internal hyphen, so self-aware and selfaware are one family", () => {
    expect(familyKey("self-aware")).toBe(familyKey("selfaware"));
  });

  it("folds the curly apostrophe a copy-paste introduces", () => {
    expect(familyKey("don’t")).toBe(familyKey("dont"));
  });
});

describe("familyKey — refusing what is not a base form", () => {
  it("returns null for nothing at all", () => {
    expect(familyKey(null)).toBeNull();
    expect(familyKey(undefined)).toBeNull();
    expect(familyKey("")).toBeNull();
    expect(familyKey("   ")).toBeNull();
  });

  it("returns null for the empty-string sentinel, so a 'no family' row joins nothing", () => {
    // '' is written deliberately by the backfill to mean "asked, none exists".
    // It must never form a family with the other '' rows.
    expect(familyKey("")).toBeNull();
  });

  it("rejects prose answers instead of matching on them", () => {
    for (const notAFamily of ["n/a", "none", "unknown", "no family", "-"]) {
      expect(familyKey(notAFamily)).toBeNull();
    }
  });

  it("rejects a phrase, which is what a model returns when it ignores the question", () => {
    // "to act" is the shape that matters: a model handed "acted" and asked for
    // a base form will sometimes answer with the infinitive marker attached.
    expect(familyKey("to act")).toBeNull();
    expect(familyKey("the act of doing")).toBeNull();
  });

  it("rejects Arabic script and mixed script rather than laundering it", () => {
    // The column is shared with rows written before the flip. An Arabic root
    // left over from the Hakiya era must not be shown to an English learner as
    // if it were a word family.
    expect(familyKey("كتب")).toBeNull();
    expect(familyKey("ك-ت-ب")).toBeNull();
    expect(familyKey("acتب")).toBeNull();
  });

  it("rejects digits in either numeral system", () => {
    expect(familyKey("123")).toBeNull();
    expect(familyKey("١٢٣")).toBeNull();
    expect(familyKey("act2")).toBeNull();
  });

  it("holds the length boundaries", () => {
    expect(familyKey("a")).toBeNull();
    expect(familyKey("be")).toBe("be"); // FAMILY_MIN_LENGTH
    expect(familyKey("a".repeat(FAMILY_MAX_LENGTH))).toBe("a".repeat(FAMILY_MAX_LENGTH));
    expect(familyKey("a".repeat(FAMILY_MAX_LENGTH + 1))).toBeNull();
    expect(FAMILY_MIN_LENGTH).toBe(2);
    expect(FAMILY_MAX_LENGTH).toBe(20);
  });
});

describe("formatFamily", () => {
  it("renders the base form as the English word it is", () => {
    // The Arabic root it replaced was spaced out — "ك · ت · ب" — so it could
    // not be misread as a pronounceable word. An English base form IS one, and
    // reading it as a word is what makes the family land.
    expect(formatFamily("act")).toBe("act");
    expect(formatFamily("Act")).toBe("act");
  });

  it("returns null wherever familyKey would, so no surface renders an unmatchable family", () => {
    expect(formatFamily("كتب")).toBeNull();
    expect(formatFamily("")).toBeNull();
    expect(formatFamily(null)).toBeNull();
  });

  it("round-trips: what it renders, familyKey still reads", () => {
    // My Words renders a family as a chip and matches cards against the key
    // behind it; a display form the matcher could not read back would filter
    // to nothing.
    expect(familyKey(formatFamily("Act-"))).toBe("act");
  });
});

describe("buildWordFamilies", () => {
  const word = (id: string, root: string | null) => ({ id, root });

  it("puts differently-spelled families together — the regression this turns on", () => {
    const families = buildWordFamilies([
      word("a", "act"),
      word("b", "Act"),
      word("c", " ACT "),
    ]);

    expect(families).toHaveLength(1);
    expect(families[0].key).toBe("act");
    expect(families[0].display).toBe("act");
    expect(families[0].words.map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("drops singletons by default — one word is not a family", () => {
    const families = buildWordFamilies([word("a", "act"), word("b", "form")]);
    expect(families).toEqual([]);
  });

  it("keeps singletons when asked, for the per-card lookup", () => {
    const families = buildWordFamilies([word("a", "act")], { minSize: 1 });
    expect(families.map((f) => f.key)).toEqual(["act"]);
  });

  it("drops unparseable families rather than bucketing them together", () => {
    // The failure worth guarding: keying on "" would collect every word whose
    // family we could not read into one enormous fake family. The Arabic root
    // is in this list on purpose — pre-flip rows still carry them.
    const families = buildWordFamilies(
      [word("a", "n/a"), word("b", "كتب"), word("c", ""), word("d", null)],
      { minSize: 1 },
    );
    expect(families).toEqual([]);
  });

  it("leads with the largest family and breaks ties deterministically", () => {
    const families = buildWordFamilies([
      word("a", "form"),
      word("b", "Form"),
      word("c", "act"),
      word("d", "action"),
      word("e", "ACT"),
      word("f", "use"),
      word("g", "use"),
    ]);

    // "action" is its own key here: this module canonicalises what it is given
    // and never guesses that "action" belongs under "act". That guess is the
    // backfill's job, where a model can be wrong visibly rather than silently.
    expect(families.map((f) => f.key)).toEqual(["act", "form", "use"]);
    expect(families.map((f) => f.words.length)).toEqual([2, 2, 2]);
  });
});
