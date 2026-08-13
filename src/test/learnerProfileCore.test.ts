import { describe, it, expect } from "vitest";
import {
  classifyRows,
  dedupe,
  renderProfileForPrompt,
  sample,
  MATURE_INTERVAL_DAYS,
  type LearnerProfile,
  type ScheduleRow,
} from "../../supabase/functions/_shared/learnerProfileCore";

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  arabic: "بيت",
  english: "house",
  intervalDays: 30,
  repetitions: 5,
  lapses: 0,
  isLeech: false,
  ...over,
});

describe("classifyRows", () => {
  it("treats a well-spaced, reviewed card as known", () => {
    const { known, learning, weak } = classifyRows([row()]);
    expect(known).toEqual([{ arabic: "بيت", english: "house" }]);
    expect(learning).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });

  it("treats a never-reviewed card as learning even with a long interval", () => {
    // repetitions === 0 means the interval is a default, not an earned schedule.
    const { known, learning } = classifyRows([row({ repetitions: 0, intervalDays: 30 })]);
    expect(known).toHaveLength(0);
    expect(learning).toHaveLength(1);
  });

  it("treats a short interval as learning", () => {
    const { known, learning } = classifyRows([
      row({ intervalDays: MATURE_INTERVAL_DAYS - 1 }),
    ]);
    expect(known).toHaveLength(0);
    expect(learning).toHaveLength(1);
  });

  it("marks a leech weak while still counting it in the lexicon", () => {
    const { known, weak } = classifyRows([row({ isLeech: true })]);
    expect(known).toHaveLength(1);
    expect(weak).toHaveLength(1);
  });

  it("marks repeat lapses weak", () => {
    const { weak } = classifyRows([row({ lapses: 2 })]);
    expect(weak).toHaveLength(1);
  });

  it("does not mark a single lapse weak", () => {
    const { weak } = classifyRows([row({ lapses: 1 })]);
    expect(weak).toHaveLength(0);
  });

  it("marks a word weak from a production error even on a comfortable schedule", () => {
    // The case SRS state alone cannot see: recognised reliably, but the learner
    // cannot actually say it.
    const { known, weak } = classifyRows([row()], new Set(["بيت"]));
    expect(known).toHaveLength(1);
    expect(weak).toEqual([{ arabic: "بيت", english: "house" }]);
  });

  it("treats null lapses/isLeech as unknown rather than as struggling", () => {
    // word_reviews rows carry neither field; they must not all come back weak.
    const { weak } = classifyRows([row({ lapses: null, isLeech: null })]);
    expect(weak).toHaveLength(0);
  });

  it("skips rows missing either side of the pair", () => {
    const { known, learning, weak } = classifyRows([
      row({ arabic: null }),
      row({ english: "  " }),
      row({ arabic: "" }),
    ]);
    expect([...known, ...learning, ...weak]).toHaveLength(0);
  });

  it("trims surrounding whitespace", () => {
    const { known } = classifyRows([row({ arabic: " بيت ", english: " house " })]);
    expect(known).toEqual([{ arabic: "بيت", english: "house" }]);
  });

  it("deduplicates a word present in both decks", () => {
    const { known } = classifyRows([row(), row()]);
    expect(known).toHaveLength(1);
  });

  it("does not put the same word in both known and learning", () => {
    // The same word can sit in both decks at different maturities. Without the
    // cross-bucket filter the prompt would tell the model a word is
    // simultaneously mastered and in need of reinforcement.
    const { known, learning } = classifyRows([
      row({ intervalDays: 30, repetitions: 5 }),
      row({ intervalDays: 1, repetitions: 0 }),
    ]);
    expect(known.map((w) => w.arabic)).toEqual(["بيت"]);
    expect(learning).toHaveLength(0);
  });

  it("filters the overlap even when the immature row comes first", () => {
    const { known, learning } = classifyRows([
      row({ intervalDays: 1, repetitions: 0 }),
      row({ intervalDays: 30, repetitions: 5 }),
    ]);
    expect(known.map((w) => w.arabic)).toEqual(["بيت"]);
    expect(learning).toHaveLength(0);
  });
});

describe("dedupe", () => {
  it("keeps first occurrence order", () => {
    expect(
      dedupe([
        { arabic: "a", english: "1" },
        { arabic: "b", english: "2" },
        { arabic: "a", english: "3" },
      ]),
    ).toEqual([
      { arabic: "a", english: "1" },
      { arabic: "b", english: "2" },
    ]);
  });
});

describe("sample", () => {
  it("returns everything when under budget", () => {
    expect(sample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("returns nothing for a zero budget", () => {
    expect(sample([1, 2, 3], 0)).toEqual([]);
  });

  it("keeps the head deterministically and fills the rest from the tail", () => {
    // rng() === 0 makes the shuffle deterministic so the head bias is testable.
    const out = sample([1, 2, 3, 4, 5, 6], 4, () => 0);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2)).toEqual([1, 2]);
    expect(new Set(out).size).toBe(4);
  });

  it("never returns more than the budget", () => {
    for (let n = 1; n <= 10; n++) {
      expect(sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n).length).toBe(n);
    }
  });
});

const profile = (over: Partial<LearnerProfile> = {}): LearnerProfile => ({
  userId: "u1",
  dialect: "Gulf",
  dialectLabel: "Gulf Arabic",
  level: "A2",
  reason: null,
  interests: [],
  known: [{ arabic: "بيت", english: "house" }],
  learning: [],
  weak: [],
  knownTotal: 1,
  weakGrammar: [],
  ...over,
});

describe("renderProfileForPrompt", () => {
  it("returns an empty string for a learner we know nothing about", () => {
    // Callers concatenate unconditionally, so a cold-start user must add nothing.
    const out = renderProfileForPrompt(
      profile({ level: null, known: [], knownTotal: 0 }),
    );
    expect(out).toBe("");
  });

  it("includes level, lexicon size and known words", () => {
    const out = renderProfileForPrompt(profile());
    expect(out).toContain("CEFR level: A2");
    expect(out).toContain("roughly 1 words");
    expect(out).toContain("بيت (house)");
    expect(out).toContain("Gulf Arabic");
  });

  it("omits the weak list when includeWeak is false", () => {
    const p = profile({ weak: [{ arabic: "شغل", english: "work" }] });
    expect(renderProfileForPrompt(p)).toContain("شغل (work)");
    expect(renderProfileForPrompt(p, { includeWeak: false })).not.toContain("شغل (work)");
  });

  it("omits reason and interests when includeInterests is false", () => {
    const p = profile({ reason: "working in Dubai", interests: ["food"] });
    expect(renderProfileForPrompt(p)).toContain("working in Dubai");
    const without = renderProfileForPrompt(p, { includeInterests: false });
    expect(without).not.toContain("working in Dubai");
    expect(without).not.toContain("food");
  });

  it("tells the model not to leak the profile into the output", () => {
    expect(renderProfileForPrompt(profile())).toContain("Never list these words");
  });

  // English-target rendering: same profile, flipped presentation. The decks
  // are bilingual, so this must be a pure re-render — English side primary
  // (it is the word being learned), and the lexicon named "English" because
  // the dialect is the learner's L1 there, not the subject.
  it("english target renders the English side first", () => {
    const out = renderProfileForPrompt(profile(), { target: "english" });
    expect(out).toContain("house (بيت)");
    expect(out).not.toContain("بيت (house)");
  });

  it("english target names the lexicon English, not the dialect", () => {
    const out = renderProfileForPrompt(profile(), { target: "english" });
    expect(out).toContain("Active English vocabulary");
    expect(out).not.toContain("Gulf Arabic vocabulary");
  });

  it("arabic remains the default direction", () => {
    expect(renderProfileForPrompt(profile())).toContain("بيت (house)");
  });

  const shaky = {
    conceptKey: "negation",
    label: "Negation",
    exposures: 8,
    correct: 2,
    incorrect: 6,
    ease: 2.1,
    strength: "learning" as const,
    nextDueAt: null,
    lastSeenAt: null,
  };

  it("names weak grammar separately from weak vocabulary", () => {
    const out = renderProfileForPrompt(
      profile({ weak: [{ arabic: "شغل", english: "work" }], weakGrammar: [shaky] }),
    );
    // Two different problems: a shaky word wants another exposure, a shaky
    // structure wants the correct form modelled. They must not share a line.
    expect(out).toContain("Negation (25% correct over 8 attempts)");
    const grammarLine = out.split("\n").find((l) => l.includes("Negation"));
    expect(grammarLine).not.toContain("شغل");
  });

  it("says nothing about grammar the learner has never got wrong", () => {
    const solid = { ...shaky, conceptKey: "pronouns", label: "Pronouns", correct: 8, incorrect: 0 };
    expect(renderProfileForPrompt(profile({ weakGrammar: [solid] }))).not.toContain("Pronouns");
  });

  it("omits weak grammar when includeWeak is false", () => {
    const p = profile({ weakGrammar: [shaky] });
    expect(renderProfileForPrompt(p)).toContain("Negation");
    expect(renderProfileForPrompt(p, { includeWeak: false })).not.toContain("Negation");
  });
});
