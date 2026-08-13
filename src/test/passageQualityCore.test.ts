import { describe, it, expect } from "vitest";
import {
  measureTashkeelCoverage,
  readingPassageGate,
  TASHKEEL_FLOOR,
} from "../../supabase/functions/_shared/passageQualityCore";

// A fully vocalized Gulf line, of the shape the generator is asked to produce.
const VOCALIZED = "رُحْتُ السُّوقِ الْيَوْمِ";
const BARE = "رحت السوق اليوم";

const line = (over: Record<string, unknown> = {}) => ({
  arabic: VOCALIZED,
  transliteration: "ruHt as-suug al-yoom",
  english: "I went to the market today.",
  literal: "went-I the-market the-day",
  ...over,
});

const passage = (over: Record<string, unknown> = {}) => ({
  title: VOCALIZED,
  titleEnglish: "At the market",
  lines: [line(), line()],
  vocabulary: [{ arabic: "السُّوق", english: "the market" }],
  questions: [
    {
      question: VOCALIZED,
      questionEnglish: "Where did the writer go?",
      options: [
        { text: "السُّوق", textEnglish: "The market", correct: true },
        { text: "الْبَيْت", textEnglish: "Home", correct: false },
      ],
    },
  ],
  ...over,
});

describe("measureTashkeelCoverage", () => {
  it("is zero for unvocalized Arabic", () => {
    expect(measureTashkeelCoverage(BARE)).toBe(0);
  });

  it("is zero for empty or non-Arabic input", () => {
    expect(measureTashkeelCoverage("")).toBe(0);
    expect(measureTashkeelCoverage("hello world")).toBe(0);
  });

  it("clears the floor for fully vocalized Arabic", () => {
    expect(measureTashkeelCoverage(VOCALIZED)).toBeGreaterThan(TASHKEEL_FLOOR);
  });

  it("never reports more than full coverage", () => {
    expect(measureTashkeelCoverage(VOCALIZED)).toBeLessThanOrEqual(1);
  });
});

describe("readingPassageGate", () => {
  it("passes a complete passage, so the critic pass can be skipped", () => {
    expect(readingPassageGate(passage())).toBeNull();
  });

  // The regression this guards: an "intermediate" passage came back with two
  // sentences. The gate only rejected an empty lines array, so it shipped.
  it("rejects a passage shorter than its difficulty requires", () => {
    const draft = passage({ lines: [line(), line()] });
    expect(readingPassageGate(draft, { minLines: 5 })).toBe("too short: 2 lines, need 5");
  });

  it("accepts a passage that meets the length requirement", () => {
    const draft = passage({ lines: [line(), line(), line(), line(), line()] });
    expect(readingPassageGate(draft, { minLines: 5 })).toBeNull();
  });

  it("defaults to requiring only one line when no minimum is given", () => {
    expect(readingPassageGate(passage({ lines: [line()] }))).toBeNull();
  });

  // Each of these is a reason the expensive rewrite still has to run — the
  // learner is promised all of them, so none may be silently shipped missing.
  it.each([
    ["missing title", passage({ title: "" })],
    ["no lines", passage({ lines: [] })],
    ["line missing arabic", passage({ lines: [line({ arabic: "" })] })],
    ["line missing translation", passage({ lines: [line({ english: "  " })] })],
    ["line missing transliteration", passage({ lines: [line({ transliteration: undefined })] })],
    ["line missing literal gloss", passage({ lines: [line({ literal: undefined })] })],
    ["no vocabulary", passage({ vocabulary: [] })],
    ["no questions", passage({ questions: [] })],
  ])("flags %s", (reason, draft) => {
    expect(readingPassageGate(draft)).toBe(reason);
  });

  it("flags a question with only one option", () => {
    const draft = passage({
      questions: [{ question: VOCALIZED, options: [{ text: "a", correct: true }] }],
    });
    expect(readingPassageGate(draft)).toBe("question missing options");
  });

  it("flags a question no answer is marked correct on", () => {
    const draft = passage({
      questions: [
        {
          question: VOCALIZED,
          options: [
            { text: "a", correct: false },
            { text: "b", correct: false },
          ],
        },
      ],
    });
    expect(readingPassageGate(draft)).toBe("question has no correct answer");
  });

  it("flags an unvocalized passage, since it would mispronounce under TTS", () => {
    const draft = passage({ title: BARE, lines: [line({ arabic: BARE })] });
    expect(readingPassageGate(draft)).toMatch(/^tashkeel coverage /);
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], {}]) {
      expect(typeof readingPassageGate(junk)).toBe("string");
    }
  });
});

// ── englishPassageGate: the direction-flipped gate ───────────────────────────

import { englishPassageGate } from "../../supabase/functions/_shared/passageQualityCore";

describe("englishPassageGate", () => {
  const anEnglishDraft = (over: Record<string, unknown> = {}) => ({
    title: "At the cafe",
    lines: [
      { english: "I went to the cafe.", arabic: "رحت المقهى.", literal: "أنا رحت إلى الـ مقهى." },
      { english: "I ordered a coffee.", arabic: "طلبت قهوة.", literal: "أنا طلبت قهوة." },
      { english: "It was busy.", arabic: "كان زحمة.", literal: "كان هو زحمة." },
    ],
    vocabulary: [{ english: "cafe", arabic: "مقهى" }],
    questions: [
      { question: "Where?", options: [{ text: "Cafe", correct: true }, { text: "Home", correct: false }] },
    ],
    ...over,
  });

  it("passes a complete English draft", () => {
    expect(englishPassageGate(anEnglishDraft(), { minLines: 3 })).toBeNull();
  });

  it("rejects a line without its English", () => {
    const draft = anEnglishDraft();
    (draft.lines as Array<Record<string, unknown>>)[1].english = " ";
    expect(englishPassageGate(draft, { minLines: 3 })).toBe("line missing english");
  });

  it("rejects a line without its Arabic gloss or literal", () => {
    const draft = anEnglishDraft();
    (draft.lines as Array<Record<string, unknown>>)[0].arabic = "";
    expect(englishPassageGate(draft, { minLines: 3 })).toBe("line missing arabic gloss");
    const draft2 = anEnglishDraft();
    delete (draft2.lines as Array<Record<string, unknown>>)[2].literal;
    expect(englishPassageGate(draft2, { minLines: 3 })).toBe("line missing literal gloss");
  });

  it("still enforces the length floor", () => {
    expect(englishPassageGate(anEnglishDraft(), { minLines: 5 })).toContain("too short");
  });

  it("has no tashkeel floor — the scaffold Arabic is read, never voiced", () => {
    // The Arabic in the fixture above carries no tashkeel at all; the Arabic
    // gate would refuse it, this one must not.
    expect(englishPassageGate(anEnglishDraft(), { minLines: 3 })).toBeNull();
  });
});
