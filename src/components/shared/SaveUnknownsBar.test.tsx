import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { UnknownWord } from "@/contexts/MarkUnknownsContext";
import { SaveUnknownsBar } from "./SaveUnknownsBar";

/**
 * "I did not know these words" — the bar that turns marking into a deck.
 *
 * Reading with mark-mode on is the fastest way a learner produces vocabulary,
 * and the value is entirely in what gets saved *with* the word: the sentence it
 * appeared in. A bare word list is a dictionary; a word with the line it came
 * from is a flashcard that can be answered without translating.
 *
 * Enrichment — the definition, root and transliteration — is best-effort by
 * design, one call per word. A word whose lookup fails is still saved, because
 * losing the mark would cost the learner the reading pass that produced it.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const marks = vi.hoisted(() => ({
  unknowns: new Map<string, unknown>(),
  clear: vi.fn(),
  setEnabled: vi.fn(),
  toggle: vi.fn(),
}));
vi.mock("@/contexts/MarkUnknownsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/MarkUnknownsContext")>();
  return {
    ...actual,
    useMarkUnknowns: () => ({
      enabled: true,
      setEnabled: marks.setEnabled,
      unknowns: marks.unknowns,
      isMarked: () => false,
      toggle: marks.toggle,
      clear: marks.clear,
    }),
  };
});

const anUnknown = (over: Partial<UnknownWord> = {}): UnknownWord =>
  ({
    arabic: "مطعم",
    sentence_text: "رحنا المطعم أمس",
    sentence_english: "We went to the restaurant yesterday",
    ...over,
  }) as UnknownWord;

const TWO_WORDS = new Map<string, unknown>([
  ["مطعم", anUnknown()],
  ["قائمة", anUnknown({ arabic: "قائمة", sentence_text: "عطني القائمة" })],
]);

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  marks.clear.mockReset();
  marks.setEnabled.mockReset();
  marks.unknowns = new Map(TWO_WORDS);
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  persona?: "free" | "anonymous";
  seed?: (backend: SupabaseBackend) => void;
}

function render({ persona = "free", seed }: Options = {}) {
  const harness = renderWithProviders(<SaveUnknownsBar source="reading" />, {
    persona,
    seed: (backend) => {
      backend.stubFunction("word-enrichment", {
        definition: "restaurant",
        word_family: "ط ع م",
        transliteration: "mat'am",
      });
      seed?.(backend);
    },
  });
  cleanup = harness.cleanup;
  return harness;
}

const saveButton = () => screen.getByRole("button", { name: /^Save \d+$/ });
const cancel = () => screen.getByRole("button", { name: "إلغاء" });

/**
 * `useAuth` resolves the session on a macrotask, and `handleSave` refuses
 * outright when there is no user — so a click fired on the same tick as the
 * render takes the signed-out path regardless of the persona.
 */
const settleAuth = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const save = async () => {
  await settleAuth();
  await act(async () => {
    fireEvent.click(saveButton());
  });
};

const saved = (backend: SupabaseBackend) =>
  backend.db.writesTo("user_vocabulary").flatMap((w) => w.payload);

describe("the bar itself", () => {
  it("stays out of sight until something is marked", async () => {
    marks.unknowns = new Map();
    const { container } = render();
    await settleAuth();

    // It is a fixed bar over the reading surface; showing an empty one would
    // cover the text it exists to serve.
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many words are waiting", async () => {
    render();
    await settleAuth();

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/words marked/)).toBeInTheDocument();
    expect(saveButton()).toHaveTextContent("Save 2");
  });

  it("counts one word in the singular", async () => {
    marks.unknowns = new Map([["مطعم", anUnknown()]]);
    render();
    await settleAuth();

    expect(screen.getByText(/word marked/)).toBeInTheDocument();
    expect(screen.queryByText(/words marked/)).toBeNull();
  });

  it("throws the marks away and leaves mark-mode", async () => {
    render();
    await settleAuth();

    fireEvent.click(cancel());

    // Leaving mark-mode on after cancelling would keep every subsequent tap
    // marking words the learner has decided against.
    expect(marks.clear).toHaveBeenCalled();
    expect(marks.setEnabled).toHaveBeenCalledWith(false);
  });
});

describe("saving", () => {
  it("keeps each word with the sentence it came from", async () => {
    const { backend } = render();

    await save();

    // The sentence is the whole point: it is what lets the card be answered in
    // Arabic rather than by recalling an English gloss.
    await waitFor(() => expect(saved(backend)).toHaveLength(2));
    expect(saved(backend)[0]).toMatchObject({
      user_id: TEST_USER_ID,
      word_arabic: "مطعم",
      sentence_text: "رحنا المطعم أمس",
      sentence_english: "We went to the restaurant yesterday",
      source: "reading",
      dialect: "Gulf",
    });
  });

  it("looks each word up in the sentence's context", async () => {
    const { backend } = render();

    await save();

    // مطعم means one thing on a menu and another in a review; the sentence is
    // what makes the definition the right one. The lookups run in parallel, so
    // they are matched by word rather than by position.
    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(2));
    const bodies = backend
      .callsTo("word-enrichment")
      .map((c) => c.body as Record<string, unknown>);
    expect(bodies.find((b) => b.word === "مطعم")).toMatchObject({
      dialect: "Gulf",
      sentenceArabic: "رحنا المطعم أمس",
      sentenceEnglish: "We went to the restaurant yesterday",
    });
    expect(bodies.find((b) => b.word === "قائمة")).toMatchObject({
      sentenceArabic: "عطني القائمة",
    });
  });

  it("stores what the lookup found", async () => {
    const { backend } = render();

    await save();

    await waitFor(() => expect(saved(backend)).toHaveLength(2));
    expect(saved(backend)[0]).toMatchObject({
      word_english: "restaurant",
      transliteration: "mat'am",
    });
    // The word family is derived from the English side by enrich-word-roots,
    // and that backfill only ever fills rows where root IS NULL. Writing
    // anything here — as this path used to, with the Arabic root the lookup
    // returned — would lock the card out of ever getting a real family.
    expect(saved(backend)[0].word_family).toBeNull();
  });

  it("saves the word anyway when the lookup fails", async () => {
    const { backend } = render({
      seed: (b) => b.stubFunctionFailure("word-enrichment", 500),
    });

    await save();

    // Enrichment is a convenience; the mark is the thing the learner produced.
    // Dropping the word because a lookup failed would waste the reading pass.
    await waitFor(() => expect(saved(backend)).toHaveLength(2));
    expect(saved(backend)[0]).toMatchObject({ word_arabic: "مطعم", word_english: "" });
  });

  it("copes with a lookup that came back with nothing useful", async () => {
    const { backend } = render({ seed: (b) => b.stubFunction("word-enrichment", {}) });

    await save();

    await waitFor(() => expect(saved(backend)).toHaveLength(2));
    expect(saved(backend)[0]).toMatchObject({ word_english: "", word_family: null, transliteration: null });
  });

  it("says how many landed", async () => {
    render();

    await save();

    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Saved 2 words to My Words"),
    );
  });

  it("counts a single word in the singular", async () => {
    marks.unknowns = new Map([["مطعم", anUnknown()]]);
    render();

    await save();

    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Saved 1 word to My Words"),
    );
  });

  it("clears the marks and leaves mark-mode once saved", async () => {
    render();

    await save();

    // Leaving them marked would have the learner save the same words again on
    // the next page.
    await waitFor(() => expect(marks.clear).toHaveBeenCalled());
    expect(marks.setEnabled).toHaveBeenCalledWith(false);
  });

  it("keeps the marks when the save failed", async () => {
    render({ seed: (b) => b.db.failInserts("user_vocabulary") });

    await save();

    // The marks are the only record of what the learner picked out. Clearing
    // them on failure would lose the reading pass entirely.
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(marks.clear).not.toHaveBeenCalled();
    expect(marks.setEnabled).not.toHaveBeenCalledWith(false);
  });

  it("can be tried again after a failure", async () => {
    render({ seed: (b) => b.db.failInserts("user_vocabulary") });

    await save();

    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(cancel()).toBeEnabled();
  });
});

describe("when nobody is signed in", () => {
  it("says so rather than failing silently", async () => {
    render({ persona: "anonymous" });

    await save();

    // Mark-mode works signed out — it is on the reading surface, which is
    // public. The refusal has to name the reason or the button looks broken.
    expect(toasts.error).toHaveBeenCalledWith("سجّل دخولك عشان تحفظ الكلمات");
  });

  it("keeps the marks so they survive signing in", async () => {
    const { backend } = render({ persona: "anonymous" });

    await save();

    expect(marks.clear).not.toHaveBeenCalled();
    expect(saved(backend)).toHaveLength(0);
  });
});

describe("while saving", () => {
  it("locks both buttons and shows it is working", async () => {
    const { backend } = render();
    await settleAuth();

    // The backend's function handlers are synchronous, so the request is held
    // open at the transport instead. `inner` is read after render, or it would
    // be the real fetch rather than the harness backend.
    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("word-enrichment")) await held;
      return inner(input as RequestInfo, init);
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    // A second click while the first save is in flight would upsert the same
    // rows twice and double-count what was saved.
    expect(saveButton()).toBeDisabled();
    expect(cancel()).toBeDisabled();
    expect(document.querySelector(".animate-spin")).not.toBeNull();

    await act(async () => {
      release!();
      await held;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(saved(backend)).toHaveLength(2));
    vi.unstubAllGlobals();
  });
});
