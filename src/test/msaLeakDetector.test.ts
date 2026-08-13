import { describe, it, expect } from "vitest";
import {
  ALWAYS_ALLOWED,
  detectMsaLeaks,
  normalizeArabic,
} from "../../supabase/functions/_shared/msaLeakDetector";

// A short, ordinary, fully vocalized Gulf passage of the kind reading-passage
// asks the model for. Nothing here is a dialect failure.
const GULF_PASSAGE = [
  "رُحْتُ السُّوق هٰذَا الصُّبْح مَعَ رِفِيجِي.",
  "شِرِينَا خُضَار وَفَوَاكِه طَازَجَة.",
  "هٰذِه أَوَّل مَرَّة أَرُوح لِهٰذَا السُّوق.",
  "عِنْدَمَا وِصَلْنَا كَان الزِّحَام وَاجِد.",
].join(" ");

describe("detectMsaLeaks", () => {
  // This passage used to report three leaks — هذا, هذه, عندما — all of them
  // ordinary Gulf. Every generated passage therefore tripped the detector and
  // paid for a rewrite pass that could never clear them, because the model kept
  // writing the same words: they were never wrong. That was the bulk of the
  // reading-practice latency.
  it("does not flag ordinary Gulf demonstratives", () => {
    const result = detectMsaLeaks(GULF_PASSAGE, "Gulf");
    expect(result.leaks).toEqual([]);
    expect(result.severity).toBe("none");
  });

  it("still flags them for Egyptian, where ده/دي is the norm", () => {
    const result = detectMsaLeaks("هَذَا الْبَيْت كِبِير", "Egyptian");
    expect(result.leaks).toContain("هذا");
  });

  it("catches genuine cross-dialect drift in Gulf", () => {
    // Egyptian-only forms have no business in a Gulf passage.
    const result = detectMsaLeaks("أَنَا عَايِز أَرُوح دِلْوَقْتِي", "Gulf");
    expect(result.leaks).toEqual(expect.arrayContaining(["عايز", "دلوقتي"]));
  });

  it("still catches unambiguous MSA in Gulf", () => {
    const result = detectMsaLeaks("سَوْفَ أَذْهَبُ إِلَى الْبَيْتِ الَّذِي هُنَاك", "Gulf");
    expect(result.leaks).toEqual(expect.arrayContaining(["سوف"]));
  });

  it("matches whole words only, not substrings", () => {
    // هذاك is a Gulf demonstrative in its own right; it must not match هذا.
    const result = detectMsaLeaks("شِفْت هَذَاكْ الرِّيَال", "Egyptian");
    expect(result.leaks).not.toContain("هذا");
  });

  it("reports nothing for empty input", () => {
    expect(detectMsaLeaks("", "Gulf")).toEqual({ leaks: [], severity: "none" });
  });
});

// The Yemeni whitelist was audited 2026-08 against the Lisan corpus
// (docs/yemeni/lexicon-full.json, ~801k tokens). The rule the audit applied:
// whitelist an MSA form only when the dialectal alternative does NOT dominate
// it in real Yemeni text. These tests pin both halves of that decision.
describe("detectMsaLeaks — Yemeni", () => {
  const YEMENI_PASSAGE = [
    "هٰذَا الصُّبْح رُحْت السُّوق مَعَ صَاحِبِي.",
    "هٰذِه أَوَّل مَرَّة أَشْتِي أَشْرَب قَهْوَة هِنِي.",
    "عِنْدَمَا وِصَلْنَا كَان فِيه زِحَام.",
  ].join(" ");

  it("does not flag ordinary Yemeni demonstratives", () => {
    // هذا outnumbers ذا 17:1 in the corpus, هذه outnumbers ذي 8:1 — flagging
    // them bought the same unclearable rewrite pass Gulf used to pay for.
    const result = detectMsaLeaks(YEMENI_PASSAGE, "Yemeni");
    expect(result.leaks).toEqual([]);
    expect(result.severity).toBe("none");
  });

  it("still flags MSA forms whose Yemeni alternative dominates", () => {
    // اللي 4,406 > الذي 2,259;  ايش 1,067 > ماذا 258;  ليش 775 > لماذا 364.
    // Steering the model toward the dialectal form is the point of the detector.
    const result = detectMsaLeaks(
      "سَوْفَ أَذْهَب إِلَى الْبَيْت الَّذِي هُنَاك، لِمَاذَا لَيْسَ مَعَك؟",
      "Yemeni",
    );
    expect(result.leaks).toEqual(
      expect.arrayContaining(["سوف", "الذي", "لماذا", "ليس"]),
    );
  });

  it("catches genuine cross-dialect drift in Yemeni", () => {
    // Attested in Yemeni tweets through code-switching, but still wrong for
    // generated Yemeni content — these stay on DIALECT_EXTRA.Yemeni.
    const result = detectMsaLeaks("أَنَا عَايِز أَرُوح دِلْوَقْتِي كِدَه", "Yemeni");
    expect(result.leaks).toEqual(
      expect.arrayContaining(["عايز", "دلوقتي", "كده"]),
    );
  });

  it("does not flag attested Yemeni vocabulary", () => {
    const result = detectMsaLeaks(
      "بَس اللِّي مِعَاي مُش زَي ذَا، عَشَان كِذَا طَيِّب شْوَي",
      "Yemeni",
    );
    expect(result.leaks).toEqual([]);
  });
});

// ADMIN_ALWAYS_ALLOWED in the admin UI is a hand-maintained copy of
// ALWAYS_ALLOWED. Nothing enforced that they agreed, so a whitelist change
// could silently leave admins seeing different guidance than the runtime
// applies. Parsed rather than imported because the page is a React component.
describe("admin whitelist mirror", () => {
  it("stays in sync with the runtime ALWAYS_ALLOWED", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const src = await readFile(
      resolve("src/pages/admin/AdminDialectRules.tsx"),
      "utf8",
    );
    const block = src.match(
      /const ADMIN_ALWAYS_ALLOWED[^=]*=\s*\{([\s\S]*?)\n\};/,
    );
    expect(block).not.toBeNull();

    for (const dialect of ["Gulf", "Egyptian", "Yemeni"] as const) {
      const row = block![1].match(new RegExp(`${dialect}:\\s*\\[([^\\]]*)\\]`));
      expect(row, `${dialect} row missing from the admin mirror`).not.toBeNull();
      const mirrored = [...row![1].matchAll(/'([^']+)'/g)].map((m) =>
        normalizeArabic(m[1]),
      );
      const runtime = ALWAYS_ALLOWED[dialect];
      const missing = mirrored.filter((w) => !runtime.has(w));
      expect(missing, `${dialect}: in admin mirror but not runtime`).toEqual([]);
    }
  });
});
