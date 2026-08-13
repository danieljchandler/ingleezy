import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_SECTIONS,
  isSectionVisible,
  loadHomeLayout,
  saveHomeLayout,
  type HomeLayoutState,
  type HomeSectionId,
} from "./homeLayout";

/**
 * The home page's section order and visibility.
 *
 * The interesting part is migration. This list used to carry about twenty more
 * ids than it does now — Settings let people toggle and reorder sections that
 * Index.tsx never actually gated on, so the controls did nothing. Trimming the
 * list left stored layouts full of ids that no longer exist, and will do so
 * again next time a section is added or removed.
 *
 * So `loadHomeLayout` has to survive both directions: drop what it no longer
 * knows, and append what it has not seen. A section added without that would
 * simply never appear for anyone with a saved layout.
 */

const STORAGE_KEY = "ingleezy:home-layout:v1";
const ALL_IDS = HOME_SECTIONS.map((section) => section.id);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("defaults", () => {
  it("uses the declared order when nothing is stored", () => {
    expect(loadHomeLayout()).toEqual({ order: ALL_IDS, hidden: [] });
  });

  it("hides nothing by default", () => {
    const state = loadHomeLayout();
    for (const id of ALL_IDS) {
      expect(isSectionVisible(id, state)).toBe(true);
    }
  });
});

describe("round-tripping", () => {
  it("restores a saved order", () => {
    const reversed = [...ALL_IDS].reverse();
    saveHomeLayout({ order: reversed, hidden: [] });

    expect(loadHomeLayout().order).toEqual(reversed);
  });

  it("restores hidden sections", () => {
    saveHomeLayout({ order: ALL_IDS, hidden: ["phrase-of-the-day"] });

    const state = loadHomeLayout();
    expect(state.hidden).toEqual(["phrase-of-the-day"]);
    expect(isSectionVisible("phrase-of-the-day", state)).toBe(false);
  });

  it("announces a change so the home page re-reads it", () => {
    const listener = vi.fn();
    window.addEventListener("ingleezy:home-layout-changed", listener);

    saveHomeLayout({ order: ALL_IDS, hidden: [] });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("ingleezy:home-layout-changed", listener);
  });
});

describe("migrating a stored layout", () => {
  it("drops ids that no longer exist", () => {
    // Exactly what happened when the list was trimmed: real saved layouts
    // still name discover, transcribe, meme and the rest.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        order: ["discover", "daily-queue", "transcribe", "phrase-of-the-day"],
        hidden: ["meme"],
      }),
    );

    const state = loadHomeLayout();

    expect(state.order).not.toContain("discover" as HomeSectionId);
    expect(state.order).not.toContain("transcribe" as HomeSectionId);
    expect(state.hidden).toEqual([]);
  });

  it("appends sections the stored layout has never seen", () => {
    // A new section must appear for existing users, not only for new ones.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: ["daily-queue"], hidden: [] }));

    const state = loadHomeLayout();

    expect(state.order[0]).toBe("daily-queue");
    expect([...state.order].sort()).toEqual([...ALL_IDS].sort());
  });

  it("keeps the user's ordering for the ids it does recognise", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: ["phrase-of-the-day", "unknown-thing", "daily-queue"], hidden: [] }),
    );

    const state = loadHomeLayout();

    expect(state.order.indexOf("phrase-of-the-day")).toBeLessThan(
      state.order.indexOf("daily-queue"),
    );
  });

  it("never loses or duplicates a section", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: ["daily-queue", "daily-queue", "gone"], hidden: [] }),
    );

    const state = loadHomeLayout();

    expect(new Set(state.order).size).toBe(ALL_IDS.length);
  });
});

describe("always-on sections", () => {
  it("stay visible even when stored as hidden", () => {
    // The daily queue is the point of the page. A layout that hides it —
    // whether from an old build or a hand-edited value — must not blank it.
    const state: HomeLayoutState = { order: ALL_IDS, hidden: ["daily-queue", "placement-banner"] };

    expect(isSectionVisible("daily-queue", state)).toBe(true);
    expect(isSectionVisible("placement-banner", state)).toBe(true);
  });

  it("do not protect the sections that are genuinely optional", () => {
    const state: HomeLayoutState = { order: ALL_IDS, hidden: ["phrase-of-the-day"] };

    expect(isSectionVisible("phrase-of-the-day", state)).toBe(false);
  });

  it("treats an unknown id as visible rather than hiding it", () => {
    const state: HomeLayoutState = { order: ALL_IDS, hidden: [] };

    expect(isSectionVisible("not-a-section" as HomeSectionId, state)).toBe(true);
  });
});

describe("damaged or unavailable storage", () => {
  it("falls back to the defaults on unparseable JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadHomeLayout()).toEqual({ order: ALL_IDS, hidden: [] });
  });

  it("copes with a stored object missing its fields", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    expect(loadHomeLayout()).toEqual({ order: ALL_IDS, hidden: [] });
  });

  it("returns the defaults when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(loadHomeLayout()).toEqual({ order: ALL_IDS, hidden: [] });
  });

  it("does not throw when the layout cannot be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveHomeLayout({ order: ALL_IDS, hidden: [] })).not.toThrow();
  });
});
