import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeStyledInstructions,
  DEFAULT_STYLE_DESCRIPTION,
  useImageStyleLock,
} from "./useImageStyleLock";

/**
 * Keeping generated flashcard images looking like one deck.
 *
 * A learner generates images one word at a time over weeks. Without a locked
 * style the deck ends up as a watercolour cat next to a 3D-rendered chair next
 * to a photograph of bread — which is not merely ugly. Visual consistency is
 * part of what makes a card recognisable at a glance during review, and a deck
 * where every card is drawn in a different idiom makes the picture compete with
 * the word instead of supporting it.
 *
 * The lock is a description plus a numeric seed, appended to whatever the
 * learner asked for. The seed is the part that does the work: image models
 * reproduce an aesthetic far more reliably when given a stable one.
 */

const KEY = "ingleezy:imageStyleLock:v1";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("the starting point", () => {
  it("is off, with a style ready to turn on", () => {
    const { result } = renderHook(() => useImageStyleLock());

    // Off by default: a learner who has not asked for consistency should get
    // whatever the model thinks each word looks like.
    expect(result.current.enabled).toBe(false);
    expect(result.current.description).toBe(DEFAULT_STYLE_DESCRIPTION);
  });

  it("describes a plain, uncluttered photo look", () => {
    // The default has to work for every noun a learner might save, so it asks
    // for a neutral background and no text — an aesthetic that does not fight
    // the word on the card.
    expect(DEFAULT_STYLE_DESCRIPTION).toContain("neutral beige background");
    expect(DEFAULT_STYLE_DESCRIPTION).toContain("no text");
  });

  it("mints a six-digit seed", () => {
    const { result } = renderHook(() => useImageStyleLock());

    // Numeric and fixed-width because it is interpolated into a prompt as a
    // stable token; a UUID reads to the model as noise.
    expect(result.current.seed).toMatch(/^\d{6}$/);
  });
});

describe("remembering the choice", () => {
  it("persists the whole lock", async () => {
    const { result } = renderHook(() => useImageStyleLock());

    act(() => {
      result.current.setEnabled(true);
    });

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.enabled).toBe(true);
    expect(stored.seed).toBe(result.current.seed);
  });

  it("keeps the same seed across sessions", () => {
    const first = renderHook(() => useImageStyleLock());
    act(() => {
      first.result.current.setEnabled(true);
    });

    const remounted = renderHook(() => useImageStyleLock());

    // The whole point. A seed that changed on reload would give a different
    // aesthetic to every card generated in a different session, which is the
    // problem the lock exists to solve.
    expect(remounted.result.current.seed).toBe(first.result.current.seed);
    expect(remounted.result.current.enabled).toBe(true);
  });

  it("restores a description the learner wrote", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ enabled: true, description: "flat vector, two colours", seed: "123456" }),
    );

    const { result } = renderHook(() => useImageStyleLock());

    expect(result.current.description).toBe("flat vector, two colours");
  });

  it("replaces a description that is not text", () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: true, description: 42, seed: "123456" }));

    const { result } = renderHook(() => useImageStyleLock());

    // The description is concatenated into a prompt; a number would reach the
    // image model as the literal "42".
    expect(result.current.description).toBe(DEFAULT_STYLE_DESCRIPTION);
  });

  it("mints a fresh seed when the stored one is missing or empty", () => {
    localStorage.setItem(KEY, JSON.stringify({ enabled: true, description: "x", seed: "" }));

    const { result } = renderHook(() => useImageStyleLock());

    // An empty seed would interpolate as "style seed :" — a malformed
    // instruction that anchors nothing.
    expect(result.current.seed).toMatch(/^\d{6}$/);
  });

  it("falls back when the stored value cannot be parsed", () => {
    localStorage.setItem(KEY, "{not json");

    const { result } = renderHook(() => useImageStyleLock());

    expect(result.current.enabled).toBe(false);
    expect(result.current.description).toBe(DEFAULT_STYLE_DESCRIPTION);
  });

  it("still works when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() => useImageStyleLock());

    act(() => {
      result.current.setEnabled(true);
    });

    // The images generated in this session are still consistent; only the
    // consistency across sessions is lost.
    expect(result.current.enabled).toBe(true);
  });
});

describe("changing the style", () => {
  it("edits the description without disturbing the seed", () => {
    const { result } = renderHook(() => useImageStyleLock());
    const seed = result.current.seed;

    act(() => {
      result.current.setDescription("ink drawing on cream paper");
    });

    // Adjusting the wording should refine the look, not restart it — the seed
    // is what carries the continuity with everything generated so far.
    expect(result.current.description).toBe("ink drawing on cream paper");
    expect(result.current.seed).toBe(seed);
  });

  it("hands out a new seed on request", () => {
    const { result } = renderHook(() => useImageStyleLock());
    const before = result.current.seed;

    act(() => {
      result.current.regenerateSeed();
    });

    // The escape hatch for a locked-in look the learner has come to dislike.
    expect(result.current.seed).not.toBe(before);
    expect(result.current.seed).toMatch(/^\d{6}$/);
  });
});

describe("composing the instructions the generator receives", () => {
  const lock = { enabled: true, description: "ink drawing", seed: "424242" };

  it("appends the style to what the learner asked for", () => {
    const composed = composeStyledInstructions("a cat on a wall", lock);

    // The learner's own instruction comes first: the style is a constraint on
    // how it is drawn, not a replacement for what to draw.
    expect(composed).toBe(
      "a cat on a wall\nMaintain a consistent personal aesthetic (style seed 424242): ink drawing",
    );
  });

  it("sends the style alone when there is nothing else to say", () => {
    expect(composeStyledInstructions(undefined, lock)).toBe(
      "Maintain a consistent personal aesthetic (style seed 424242): ink drawing",
    );
    expect(composeStyledInstructions("   ", lock)).toBe(
      "Maintain a consistent personal aesthetic (style seed 424242): ink drawing",
    );
  });

  it("sends nothing at all when the lock is off and nothing was asked", () => {
    // Undefined rather than an empty string: the edge function branches on
    // whether custom instructions were supplied.
    expect(composeStyledInstructions(undefined, { ...lock, enabled: false })).toBeUndefined();
    expect(composeStyledInstructions("  ", { ...lock, enabled: false })).toBeUndefined();
  });

  it("passes the learner's instruction through untouched when the lock is off", () => {
    expect(composeStyledInstructions("  a cat on a wall  ", { ...lock, enabled: false })).toBe(
      "a cat on a wall",
    );
  });

  it("names the seed in the instruction rather than only the words", () => {
    const composed = composeStyledInstructions("a cat", lock)!;

    // The description alone is a style *request*; the seed is what actually
    // reproduces it, and it has to survive into the prompt to do anything.
    expect(composed).toContain("style seed 424242");
  });
});
