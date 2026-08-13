import { describe, it, expect } from "vitest";
import {
  LOADING_DECKS,
  arabicCompanionFor,
  getDeck,
  type LoadingTask,
} from "@/data/loadingMessages";

const TASKS: LoadingTask[] = [
  "passage",
  "story",
  "episode",
  "episodeAudio",
  "transcribeAnalysis",
  "pronunciation",
  "grammarDrill",
  "scrape",
  "analyze",
  "quiz",
  "image",
  "generic",
];

const ARABIC = /[؀-ۿ]/;
const HARAKAT = /[ً-ْ]/;
const LATIN = /[A-Za-z]/;

describe("loading message decks", () => {
  it("covers every task, with no strays", () => {
    expect(Object.keys(LOADING_DECKS).sort()).toEqual([...TASKS].sort());
  });

  it.each(TASKS)("%s is a usable deck", (task) => {
    const deck = LOADING_DECKS[task];
    expect(deck.length).toBeGreaterThan(0);
    for (const m of deck) {
      expect(m.ar.trim()).not.toBe("");
      expect(m.en.trim()).not.toBe("");
      expect(m.ar).toMatch(ARABIC);
      expect(m.ar).not.toMatch(LATIN);
      expect(m.en).not.toMatch(ARABIC);
    }
  });

  // These strings are chrome, not study material — see the file header.
  it.each(TASKS)("%s carries no harakat", (task) => {
    for (const m of LOADING_DECKS[task]) {
      expect(m.ar).not.toMatch(HARAKAT);
    }
  });

  it.each(TASKS)("%s does not repeat itself", (task) => {
    const deck = LOADING_DECKS[task];
    expect(new Set(deck.map((m) => m.en)).size).toBe(deck.length);
    expect(new Set(deck.map((m) => m.ar)).size).toBe(deck.length);
  });

  // Long lines wrap badly at 360px, and the rotation gives you ~4 seconds.
  it.each(TASKS)("%s stays short enough to read", (task) => {
    for (const m of LOADING_DECKS[task]) {
      expect(m.ar.split(/\s+/).length).toBeLessThanOrEqual(6);
      expect(m.en.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("getDeck", () => {
  it("returns the matching deck", () => {
    expect(getDeck("passage")).toBe(LOADING_DECKS.passage);
  });

  it("falls back to generic for an unknown task", () => {
    expect(getDeck("nope" as LoadingTask)).toBe(LOADING_DECKS.generic);
  });
});

describe("arabicCompanionFor", () => {
  it("matches the tutor upload stage labels", () => {
    expect(arabicCompanionFor("Uploading audio…")).toBe("نرفع التسجيل");
    expect(arabicCompanionFor("Transcribing audio…")).toBe("نفرغ الكلام");
    expect(arabicCompanionFor("Saving flashcards…")).toBe("نحفظ البطاقات");
  });

  it("matches the dynamic image label by prefix", () => {
    expect(arabicCompanionFor("Generating images (3 of 12)…")).toBe(
      "الرسام يرسم",
    );
  });

  it("falls back rather than returning nothing", () => {
    const fallback = arabicCompanionFor("Something entirely new");
    expect(fallback).toMatch(ARABIC);
  });
});
