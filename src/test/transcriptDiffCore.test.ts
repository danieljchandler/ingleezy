import { describe, expect, it } from "vitest";
import {
  diffTranscriptLines,
  MAX_PAIRS_PER_SAVE,
  normalizeDialect,
} from "../../supabase/functions/_shared/transcriptDiffCore";

/**
 * The transcript-correction diff — the flywheel's "hours of audio" source.
 * What matters here is not finding every change but never fabricating one: a
 * wrongly paired before/after is worse training data than none, so ambiguous
 * situations (splits, merges, duplicate identities) must yield nothing.
 */

const line = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  arabic: "الليلة نروح إلى السوق",
  translation: "Tonight we go to the market",
  startMs: 41_200,
  endMs: 44_700,
  ...over,
});

describe("pairing", () => {
  it("captures an Arabic edit as an asr pair with the line's audio span", () => {
    const pairs = diffTranscriptLines(
      [line()],
      [line({ arabic: "الليلة بنروح السوق" })],
    );

    expect(pairs).toEqual([
      {
        kind: "asr",
        before: "الليلة نروح إلى السوق",
        after: "الليلة بنروح السوق",
        startMs: 41_200,
        endMs: 44_700,
        counterpart: "Tonight we go to the market",
      },
    ]);
  });

  it("captures a translation edit separately, carrying the Arabic as context", () => {
    const pairs = diffTranscriptLines(
      [line()],
      [line({ translation: "We're off to the souq tonight" })],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      kind: "translation",
      before: "Tonight we go to the market",
      after: "We're off to the souq tonight",
      counterpart: "الليلة نروح إلى السوق",
    });
  });

  it("yields both pairs when both halves changed", () => {
    const pairs = diffTranscriptLines(
      [line()],
      [line({ arabic: "الليلة بنروح السوق", translation: "We go to the souq tonight" })],
    );

    expect(pairs.map((p) => p.kind)).toEqual(["asr", "translation"]);
  });

  it("matches by start time when lines carry no id", () => {
    const pairs = diffTranscriptLines(
      [line({ id: undefined })],
      [line({ id: undefined, arabic: "الليلة بنروح السوق" })],
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe("asr");
  });
});

describe("what must NOT become a pair", () => {
  it("ignores an untouched line", () => {
    expect(diffTranscriptLines([line()], [line()])).toEqual([]);
  });

  it("ignores pure whitespace reflow", () => {
    // Reflowing a line while scrubbing timestamps is not a correction.
    const pairs = diffTranscriptLines(
      [line()],
      [line({ arabic: "الليلة نروح  إلى \n السوق" })],
    );
    expect(pairs).toEqual([]);
  });

  it("yields nothing for a line that only exists on one side", () => {
    // Splits, merges and deletions have no stable before/after identity.
    const pairs = diffTranscriptLines(
      [line()],
      [line({ id: "L2", arabic: "نص جديد تماما" })],
    );
    expect(pairs).toEqual([]);
  });

  it("refuses to pair against a duplicated identity", () => {
    // Two stored lines with the same id: pairing against either twin could
    // fabricate a correction, so the first wins deterministically and the
    // comparison is only made against it.
    const pairs = diffTranscriptLines(
      [line({ arabic: "النسخة الأولى" }), line({ arabic: "النسخة الثانية" })],
      [line({ arabic: "النسخة الأولى" })],
    );
    expect(pairs).toEqual([]);
  });

  it("ignores a line whose stored half was empty", () => {
    // Filling in a blank is authorship, not correction — there is no machine
    // output to learn from.
    const pairs = diffTranscriptLines(
      [line({ arabic: "" })],
      [line({ arabic: "الليلة بنروح السوق" })],
    );
    expect(pairs).toEqual([]);
  });

  it("returns nothing for non-array inputs", () => {
    expect(diffTranscriptLines(null, [line()])).toEqual([]);
    expect(diffTranscriptLines([line()], "lines")).toEqual([]);
  });
});

describe("the cap", () => {
  it("stops at the per-save maximum", () => {
    const olds = Array.from({ length: 300 }, (_, i) =>
      line({ id: `L${i}`, arabic: `سطر رقم ${i}` }),
    );
    const news = olds.map((l) => ({ ...l, arabic: `${l.arabic} معدل` }));

    const pairs = diffTranscriptLines(olds, news);

    // 300 changed lines is a regeneration, not an edit session.
    expect(pairs).toHaveLength(MAX_PAIRS_PER_SAVE);
  });
});

describe("normalizeDialect", () => {
  it("passes the three training dialects through", () => {
    expect(normalizeDialect("Gulf")).toBe("Gulf");
    expect(normalizeDialect("Egyptian")).toBe("Egyptian");
    expect(normalizeDialect("Yemeni")).toBe("Yemeni");
  });

  it("collapses regional Gulf labels onto Gulf", () => {
    for (const regional of ["Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani"]) {
      expect(normalizeDialect(regional)).toBe("Gulf");
    }
  });

  it("returns null for anything unrecognised — skip beats mislabel", () => {
    expect(normalizeDialect("MSA")).toBeNull();
    expect(normalizeDialect("")).toBeNull();
    expect(normalizeDialect(undefined)).toBeNull();
  });
});
