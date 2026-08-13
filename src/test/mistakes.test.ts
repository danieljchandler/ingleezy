import { describe, it, expect } from "vitest";
import {
  describeMistake,
  groupMistakes,
  labelForKind,
  labelForSource,
  type LearnerErrorRow,
} from "@/lib/mistakes";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let seq = 0;
const row = (over: Partial<LearnerErrorRow> = {}): LearnerErrorRow => ({
  id: `e${seq++}`,
  dialect: "Gulf",
  source: "pronunciation",
  target_arabic: "شغل",
  produced_arabic: null,
  error_kind: "mispronunciation",
  created_at: daysAgo(1),
  ...over,
});

describe("groupMistakes", () => {
  it("collapses repeated errors on the same target into one group", () => {
    const groups = groupMistakes([
      row({ created_at: daysAgo(3) }),
      row({ created_at: daysAgo(2) }),
      row({ created_at: daysAgo(1) }),
    ]);
    // Six rows for one word is one problem, not six.
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].ids).toHaveLength(3);
  });

  it("keeps the same word in different dialects apart", () => {
    const groups = groupMistakes([
      row({ dialect: "Gulf" }),
      row({ dialect: "Egyptian" }),
    ]);
    // A word can be right in one dialect and wrong in another; merging them
    // would hide which one is the problem.
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.dialect).sort()).toEqual(["Egyptian", "Gulf"]);
  });

  it("ranks by count, then by recency", () => {
    const groups = groupMistakes([
      row({ target_arabic: "twice-old", created_at: daysAgo(9) }),
      row({ target_arabic: "twice-old", created_at: daysAgo(8) }),
      row({ target_arabic: "twice-new", created_at: daysAgo(1) }),
      row({ target_arabic: "twice-new", created_at: daysAgo(2) }),
      row({ target_arabic: "thrice", created_at: daysAgo(20) }),
      row({ target_arabic: "thrice", created_at: daysAgo(21) }),
      row({ target_arabic: "thrice", created_at: daysAgo(22) }),
    ]);
    expect(groups.map((g) => g.target)).toEqual(["thrice", "twice-new", "twice-old"]);
  });

  it("lists attempts newest first and without duplicates", () => {
    const groups = groupMistakes([
      row({ produced_arabic: "شغلة", created_at: daysAgo(3) }),
      row({ produced_arabic: "شغال", created_at: daysAgo(1) }),
      row({ produced_arabic: "شغلة", created_at: daysAgo(2) }),
    ]);
    expect(groups[0].attempts).toEqual(["شغال", "شغلة"]);
  });

  it("records lastAt as the most recent occurrence regardless of input order", () => {
    const groups = groupMistakes([
      row({ created_at: daysAgo(1) }),
      row({ created_at: daysAgo(30) }),
    ]);
    expect(groups[0].lastAt).toBe(daysAgo(1));
  });

  it("collects distinct sources and kinds", () => {
    const groups = groupMistakes([
      row({ source: "pronunciation", error_kind: "mispronunciation" }),
      row({ source: "shadow", error_kind: "omission" }),
      row({ source: "shadow", error_kind: "omission" }),
    ]);
    expect(groups[0].sources).toEqual(["pronunciation", "shadow"]);
    expect(groups[0].kinds).toEqual(["mispronunciation", "omission"]);
  });

  it("skips rows with no target rather than making a blank group", () => {
    expect(groupMistakes([row({ target_arabic: "   " }), row()])).toHaveLength(1);
  });

  it("returns nothing for a learner with a clean record", () => {
    expect(groupMistakes([])).toEqual([]);
  });
});

describe("describeMistake", () => {
  const group = (count: number, lastAt: string) =>
    groupMistakes(
      Array.from({ length: count }, () => row({ created_at: lastAt })),
    )[0];

  it("uses the singular for a one-off", () => {
    expect(describeMistake(group(1, daysAgo(0)), NOW)).toBe("Once · last today");
  });

  it("counts repeats and names the day", () => {
    expect(describeMistake(group(4, daysAgo(1)), NOW)).toBe("4 times · last yesterday");
    expect(describeMistake(group(2, daysAgo(5)), NOW)).toBe("2 times · last 5 days ago");
  });
});

describe("labels", () => {
  it("gives readable wording for the known values", () => {
    expect(labelForSource("sentence_coach")).toBe("Sentence practice");
    expect(labelForKind("msa_leak")).toBe("Slipped into MSA");
  });

  it("passes unknown values through instead of dropping them", () => {
    // error_kind is deliberately free text so a new scorer needs no migration;
    // an unrecognised value must still render as something.
    expect(labelForKind("some_new_taxonomy")).toBe("some_new_taxonomy");
    expect(labelForSource("brand_new_surface")).toBe("brand_new_surface");
  });
});
