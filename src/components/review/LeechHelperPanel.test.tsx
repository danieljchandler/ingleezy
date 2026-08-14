import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  aUserPhrase,
  aUserVocabulary,
  aWordReview,
  phraseId,
  reviewId,
  TEST_USER_ID,
  vocabId,
} from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { LeechHelperPanel, type LeechKind } from "./LeechHelperPanel";

/**
 * The rescue offered on a card the learner keeps failing.
 *
 * A leech is the failure mode that quietly ruins a spaced-repetition deck: one
 * card that will not stick comes back every day, costs a review slot every
 * time, and teaches nothing. The two ways out are a memory hook or an admission
 * that the card is not worth the fight — so the panel offers exactly those two,
 * and nothing else.
 *
 * The awkward part is that "the card" is three different rows depending on which
 * deck it came from, and a mnemonic is personal, so a curriculum word's hook is
 * written to the learner's own review row rather than to the shared word.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

const ROW_ID: Record<LeechKind, string> = {
  word: vocabId(0),
  phrase: phraseId(0),
  curriculum: reviewId(0),
};

interface Options {
  kind?: LeechKind;
  mnemonic?: string | null;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ kind = "word", mnemonic = null, seed }: Options = {}) {
  const harness = renderWithProviders(
    <LeechHelperPanel
      kind={kind}
      rowId={ROW_ID[kind]}
      arabic="مطعم"
      english="restaurant"
      transliteration="mat'am"
      dialect="Gulf"
      mnemonic={mnemonic}
      invalidateKeys={[["due-words"]]}
    />,
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.db.seed("user_phrases", [
          aUserPhrase({ id: phraseId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.db.seed("word_reviews", [
          aWordReview({ id: reviewId(0), user_id: TEST_USER_ID, is_leech: true, lapses: 7 }),
        ]);
        backend.stubFunction("generate-mnemonic", {
          mnemonic: "مطعم sounds like 'mat' — picture a welcome mat outside a restaurant.",
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

/** `useAuth` resolves the session on a macrotask. */
const settleAuth = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const generateButton = () => screen.getByRole("button", { name: /ولّد وسيلة تذكّر/ });
const regenerateButton = () => screen.getByRole("button", { name: "أعد التوليد" });
const clearButton = () => screen.getByRole("button", { name: /أزل العلامة/ });

const click = async (button: HTMLElement) => {
  await settleAuth();
  await act(async () => {
    fireEvent.click(button);
  });
};

const updatesTo = (backend: SupabaseBackend, table: string) =>
  backend.db.writesTo(table).flatMap((w) => w.payload);

describe("what the panel says", () => {
  it("names the problem without blaming the learner", async () => {
    render();
    await settleAuth();

    // A learner who has failed the same card seven times is already frustrated;
    // the copy has to read as an offer of help rather than a scolding.
    expect(screen.getByText("متعثر مع هذه البطاقة؟")).toBeInTheDocument();
    expect(screen.getByText(/دع الذكاء الاصطناعي يساعدك/)).toBeInTheDocument();
  });

  it("offers to make a memory hook when there is none", async () => {
    render();
    await settleAuth();

    expect(generateButton()).toBeInTheDocument();
    expect(screen.queryByText("وسيلة تذكّر")).toBeNull();
  });

  it("shows the hook the card already has", async () => {
    render({ mnemonic: "picture a welcome mat" });
    await settleAuth();

    // Once there is a hook, the panel's job is to keep it in front of the
    // learner on every failed attempt.
    expect(screen.getByText("picture a welcome mat")).toBeInTheDocument();
    expect(screen.getByText("وسيلة تذكّر")).toBeInTheDocument();
    expect(regenerateButton()).toBeInTheDocument();
  });

  it("follows the card when the deck moves on", async () => {
    const { rerender } = render({ mnemonic: "picture a welcome mat" });
    await settleAuth();

    act(() => {
      rerender(
        <LeechHelperPanel
          kind="word"
          rowId={vocabId(1)}
          arabic="قائمة"
          english="menu"
          dialect="Gulf"
          mnemonic="think of a queue"
        />,
      );
    });

    // The panel is rendered inside the review card, which is reused between
    // cards. A stale mnemonic would be attached to the wrong word.
    expect(screen.getByText("think of a queue")).toBeInTheDocument();
    expect(screen.queryByText("picture a welcome mat")).toBeNull();
  });
});

describe("making a memory hook", () => {
  it("sends the word with everything needed to hook it", async () => {
    const { backend } = render();

    await click(generateButton());

    // The transliteration is what most English-language mnemonics are built on —
    // "mat'am sounds like mat" only works if the model is given it.
    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({
      arabic: "مطعم",
      english: "restaurant",
      transliteration: "mat'am",
      dialect: "Gulf",
      kind: "word",
    });
  });

  it("calls a curriculum card a word", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(generateButton());

    // The function interpolates this into its prompt. "curriculum" would ask
    // for a mnemonic for an Arabic curriculums, which is not a thing.
    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({ kind: "word" });
  });

  it("calls a phrase a phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(generateButton());

    expect(backend.lastCallTo("generate-mnemonic")?.body).toMatchObject({ kind: "phrase" });
  });

  it("shows the hook and keeps it", async () => {
    const { backend } = render();

    await click(generateButton());

    await waitFor(() => expect(screen.getByText(/welcome mat/)).toBeInTheDocument());
    // Kept, or the learner pays for a fresh generation on every failed attempt.
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({
      mnemonic: expect.stringContaining("welcome mat"),
    });
    expect(toasts.success).toHaveBeenCalledWith("جاهزة! وسيلة تذكّر جديدة");
  });

  it("keeps a curriculum hook on the learner's own row", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(generateButton());

    // A memory hook is personal. Writing it to vocabulary_words would put one
    // learner's association in front of everybody.
    await waitFor(() => expect(updatesTo(backend, "word_reviews")).toHaveLength(1));
    expect(backend.db.writesTo("vocabulary_words")).toHaveLength(0);
  });

  it("keeps a phrase's hook on the phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(generateButton());

    await waitFor(() => expect(updatesTo(backend, "user_phrases")).toHaveLength(1));
  });

  it("can be asked for a different one", async () => {
    const { backend } = render({ mnemonic: "a hook that never helped" });

    await click(regenerateButton());

    // A mnemonic that does not land for this learner is worse than none — it is
    // a second thing to remember.
    await waitFor(() => expect(screen.getByText(/welcome mat/)).toBeInTheDocument());
    expect(backend.callsTo("generate-mnemonic")).toHaveLength(1);
  });

  it("says it is working", async () => {
    render();
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
      if (url.includes("generate-mnemonic")) await held;
      return inner(input as RequestInfo, init);
    });

    await act(async () => {
      fireEvent.click(generateButton());
    });

    expect(screen.getByRole("button", { name: /جارٍ التوليد/ })).toBeDisabled();

    await act(async () => {
      release!();
      await held;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    vi.unstubAllGlobals();
  });

  it.each([429, 402])("reports a %i as a generic failure", async (status) => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", status) });

    await click(generateButton());

    // Pinned: the handler branches on `err.message.includes("429")` and
    // `("402")`, but supabase-js raises a FunctionsHttpError whose message is
    // the fixed "Edge Function returned a non-2xx status code" — the status is
    // on `error.context`, not in the text. So both branches are unreachable
    // through the real client and a rate limit reads as a fault, which is the
    // one case where "try again shortly" would have been the right advice.
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("تعذّر توليد وسيلة التذكّر"),
    );
    expect(toasts.error).not.toHaveBeenCalledWith("طلبات كثيرة — حاول بعد قليل");
    expect(toasts.error).not.toHaveBeenCalledWith("نفد رصيد الذكاء الاصطناعي");
  });

  it("falls back to a plain failure", async () => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", 500) });

    await click(generateButton());

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("تعذّر توليد وسيلة التذكّر"),
    );
  });

  it("treats an empty answer as a failure", async () => {
    const { backend } = render({ seed: (b) => b.stubFunction("generate-mnemonic", {}) });

    await click(generateButton());

    // Saving an empty mnemonic would replace the offer to make one with a blank
    // box that cannot be regenerated from.
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(updatesTo(backend, "user_vocabulary")).toHaveLength(0);
    expect(generateButton()).toBeInTheDocument();
  });

  it("can be tried again after a failure", async () => {
    render({ seed: (b) => b.stubFunctionFailure("generate-mnemonic", 500) });

    await click(generateButton());

    await waitFor(() => expect(generateButton()).toBeEnabled());
  });
});

describe("saying the card is not stuck after all", () => {
  it("clears the flag and the failure count", async () => {
    const { backend } = render();

    await click(clearButton());

    // Resetting the count matters as much as the flag: leaving lapses at seven
    // would re-flag the card on the very next miss.
    await waitFor(() => expect(updatesTo(backend, "user_vocabulary")).toHaveLength(1));
    expect(updatesTo(backend, "user_vocabulary")[0]).toMatchObject({
      is_leech: false,
      lapses: 0,
      production_lapses: 0,
    });
    expect(toasts.success).toHaveBeenCalledWith("تم — لن نعلّم هذه البطاقة بعد الآن.");
  });

  it("clears the production count on a curriculum card too", async () => {
    const { backend } = render({ kind: "curriculum" });

    await click(clearButton());

    await waitFor(() => expect(updatesTo(backend, "word_reviews")).toHaveLength(1));
    expect(updatesTo(backend, "word_reviews")[0]).toMatchObject({ production_lapses: 0 });
  });

  it("leaves the production count alone on a phrase", async () => {
    const { backend } = render({ kind: "phrase" });

    await click(clearButton());

    // Phrases are only ever recognised, never produced — the column does not
    // exist on that table and writing it would fail the whole update.
    await waitFor(() => expect(updatesTo(backend, "user_phrases")).toHaveLength(1));
    expect(updatesTo(backend, "user_phrases")[0]).not.toHaveProperty("production_lapses");
  });

  it("keeps the panel on screen after clearing", async () => {
    render();

    await click(clearButton());

    // Pinned: clearing the flag writes to the row but the panel keeps rendering
    // as though the card were still a leech — it is the parent's refetch that
    // eventually removes it. Until that lands, the learner sees the same
    // "Stuck on this one?" prompt they just dismissed.
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(screen.getByText("متعثر مع هذه البطاقة؟")).toBeInTheDocument();
  });
});
