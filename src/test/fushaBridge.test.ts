import { describe, expect, it } from "vitest";
import {
  alignFushaLines,
  buildFushaSystemPrompt,
  FUSHA_LINE_RULE,
  fushaDiffers,
  fushaSchema,
  normalizeFushaCompare,
  sanitizeFushaLine,
} from "../../supabase/functions/_shared/fushaBridge";

/**
 * The Fusha row is the one place in the app where an Arabic line is shown that
 * nobody spoke. Everything here guards the two ways that goes wrong:
 *
 *   - a model answers in English, and an English sentence renders RTL under a
 *     فصحى heading as if it were Arabic;
 *   - a model returns fewer renderings than there were lines, and every
 *     subsequent line's Fusha sits under the wrong dialect sentence — a
 *     mistake a learner cannot possibly catch, because catching it is what
 *     they came to learn.
 */

const DIALECT = "شلونك اليوم يا خوي";
const FUSHA = "كيف حالك اليوم يا أخي";

describe("sanitizeFushaLine", () => {
  it("keeps an Arabic rendering as-is", () => {
    expect(sanitizeFushaLine(FUSHA)).toBe(FUSHA);
  });

  it("drops an English answer rather than showing it as Arabic", () => {
    expect(sanitizeFushaLine("How are you today, brother?")).toBe("");
  });

  it("drops non-strings and blanks", () => {
    expect(sanitizeFushaLine(null)).toBe("");
    expect(sanitizeFushaLine(42)).toBe("");
    expect(sanitizeFushaLine("   ")).toBe("");
  });

  it("strips the label a model prefixes its answer with", () => {
    expect(sanitizeFushaLine(`الفصحى: ${FUSHA}`)).toBe(FUSHA);
    expect(sanitizeFushaLine(`MSA: ${FUSHA}`)).toBe(FUSHA);
    expect(sanitizeFushaLine(`3. ${FUSHA}`)).toBe(FUSHA);
  });

  it("strips one layer of wrapping quotes", () => {
    expect(sanitizeFushaLine(`"${FUSHA}"`)).toBe(FUSHA);
    expect(sanitizeFushaLine(`«${FUSHA}»`)).toBe(FUSHA);
  });

  it("keeps a line whose Arabic carries a Latin loanword", () => {
    // Rejecting anything with Latin letters would drop legitimate renderings.
    expect(sanitizeFushaLine("ذهبت إلى شركة Google")).toBe("ذهبت إلى شركة Google");
  });
});

describe("alignFushaLines", () => {
  it("reads the fusha array and aligns it by index", () => {
    expect(alignFushaLines({ fusha: [FUSHA, "ماذا تريد"] }, 2)).toEqual([FUSHA, "ماذا تريد"]);
  });

  it("accepts a bare array and a lines array", () => {
    expect(alignFushaLines([FUSHA], 1)).toEqual([FUSHA]);
    expect(alignFushaLines({ lines: [FUSHA] }, 1)).toEqual([FUSHA]);
  });

  it("accepts per-line objects", () => {
    expect(alignFushaLines({ fusha: [{ fusha: FUSHA }, { text: "ماذا تريد" }] }, 2)).toEqual([
      FUSHA,
      "ماذا تريد",
    ]);
  });

  it("pads a short answer instead of sliding it into place", () => {
    // The model merged two lines. Padding leaves line 3 without a Fusha row;
    // shifting would put line 3's Fusha under line 2 and be invisible.
    expect(alignFushaLines({ fusha: [FUSHA, "ماذا تريد"] }, 3)).toEqual([
      FUSHA,
      "ماذا تريد",
      "",
    ]);
  });

  it("trims an over-long answer to the line count", () => {
    expect(alignFushaLines({ fusha: [FUSHA, "ماذا تريد", "زائد"] }, 2)).toHaveLength(2);
  });

  it("survives junk", () => {
    expect(alignFushaLines(null, 2)).toEqual(["", ""]);
    expect(alignFushaLines({ translations: ["hello"] }, 1)).toEqual([""]);
    expect(alignFushaLines({ fusha: ["not arabic at all"] }, 1)).toEqual([""]);
  });
});

describe("fushaDiffers", () => {
  it("is true when the conversion changed something", () => {
    expect(fushaDiffers(DIALECT, FUSHA)).toBe(true);
  });

  it("is false for an empty or missing rendering", () => {
    expect(fushaDiffers(DIALECT, "")).toBe(false);
    expect(fushaDiffers(DIALECT, undefined)).toBe(false);
    expect(fushaDiffers(DIALECT, null)).toBe(false);
  });

  it("is false when the line was already Fusha", () => {
    expect(fushaDiffers(FUSHA, FUSHA)).toBe(false);
  });

  it("ignores tashkeel and punctuation the two rows never share", () => {
    // The dialect line comes back from Farasa vocalised; the Fusha pass does
    // not vocalise. Identical sentences must not read as a conversion.
    expect(fushaDiffers("كَيْفَ حَالُكَ؟", "كيف حالك")).toBe(false);
  });

  it("still counts a restored hamza as a change", () => {
    // The one thing the normalizer must not fold: hamza spelling is a real
    // Fusha correction, not noise.
    expect(fushaDiffers("اروح السوق", "أروح السوق")).toBe(true);
  });
});

describe("normalizeFushaCompare", () => {
  it("collapses whitespace and strips tatweel", () => {
    expect(normalizeFushaCompare("  كيف   حــال  ")).toBe("كيف حال");
  });
});

describe("prompt surface", () => {
  it("tells the model this is a conversion, not a translation", () => {
    expect(FUSHA_LINE_RULE).toContain("not a translation");
    expect(FUSHA_LINE_RULE).toContain('"fusha" field');
  });

  it("names the dialect it is converting from", () => {
    const prompt = buildFushaSystemPrompt("Yemeni Arabic");
    expect(prompt).toContain("Yemeni Arabic");
    expect(prompt).toContain('{"fusha"');
    expect(prompt).toContain("Never output English");
  });

  it("describes the field for tool-calling generators", () => {
    expect(fushaSchema().description).toContain("of the line");
    expect(fushaSchema("caption").description).toContain("of the caption");
    expect(fushaSchema().type).toBe("string");
  });
});
