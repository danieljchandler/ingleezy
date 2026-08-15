import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID, vocabId } from "@/test/support/factories";
import { SuggestFlashcardsDialog } from "./SuggestFlashcardsDialog";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * "Suggest me ten words about X" — the way into a deck when a learner knows the
 * situation they need but not the vocabulary.
 *
 * The part that makes it worth a dialog rather than a prompt box is the
 * exclusion: it sends the words the learner already has so the model does not
 * suggest ten cards they have been reviewing for a month. And every suggestion
 * arrives ticked, because a learner who asked for ten words about restaurants
 * wants most of them — the checkboxes are for pruning, not for choosing from
 * scratch.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const aSuggestion = (over: Record<string, unknown> = {}) => ({
  word_arabic: "مطعم",
  word_english: "restaurant",
  transliteration: "mat'am",
  example_arabic: "رحنا المطعم أمس",
  example_english: "We went to the restaurant yesterday",
  ...over,
});

const ANOTHER = aSuggestion({
  word_arabic: "قائمة",
  word_english: "menu",
  transliteration: "qa'ima",
  example_arabic: "عطني القائمة",
  example_english: "Give me the menu",
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

interface Options {
  dialect?: string;
  owned?: string[];
  seed?: (backend: SupabaseBackend) => void;
}

async function render({ dialect = "Gulf", owned = [], seed }: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const onOpenChange = vi.fn();
  const harness = renderWithProviders(
    <SuggestFlashcardsDialog open onOpenChange={onOpenChange} />,
    {
      persona: "free",
      // DialectProvider syncs from the profile on mount and overwrites what is
      // in localStorage, so the profile has to agree or the dialog settles back
      // on the profile's dialect a tick after render.
      personaOptions: { profile: { preferred_dialect: dialect } },
      seed: (backend) => {
        backend.db.seed(
          "user_vocabulary",
          owned.map((word, index) =>
            aUserVocabulary({ id: vocabId(index), user_id: TEST_USER_ID, word_arabic: word }),
          ),
        );
        backend.stubFunction("suggest-flashcards", {
          flashcards: [aSuggestion(), ANOTHER],
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  // The dialog's own hooks resolve a tick after mount, so a synchronous
  // assertion would race a re-render already on its way.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { ...harness, onOpenChange };
}

const topicBox = () => screen.getByPlaceholderText(/ordering food at a restaurant/);
const generateButton = () => screen.getByRole("button", { name: /ولّد اقتراحات/ });

const generate = async (topic = "ordering food") => {
  fireEvent.change(topicBox(), { target: { value: topic } });
  await act(async () => {
    fireEvent.click(generateButton());
  });
};

const savedWords = (backend: SupabaseBackend) =>
  backend.db.writesTo("user_vocabulary").flatMap((write) => write.payload);

describe("asking for suggestions", () => {
  it("says what it will produce and in which dialect", async () => {
    await render({ dialect: "Egyptian" });

    expect(screen.getByText(/suggest 10 Egyptian Arabic words you don't already have/)).toBeInTheDocument();
  });

  it("will not generate without a topic", async () => {
    await render();

    // The one thing the model needs. The button says so by staying dead rather
    // than by complaining after the fact.
    expect(generateButton()).toBeDisabled();
  });

  it("sends the topic, the dialect and how many to produce", async () => {
    const { backend } = await render({ dialect: "Yemeni" });

    await generate("  ordering food at a restaurant  ");

    expect(backend.lastCallTo("suggest-flashcards")?.body).toMatchObject({
      topic: "ordering food at a restaurant",
      dialect: "Yemeni",
      count: 10,
    });
  });

  it("sends the words the learner already has, so it does not suggest them again", async () => {
    const { backend } = await render({ owned: ["مطعم", "قائمة"] });

    // The deck loads behind auth. Generating before it lands sends an empty
    // exclusion list, which is a real race in the product too — just not the
    // thing this test is about.
    await waitFor(() =>
      expect(backend.db.readsOf("user_vocabulary").length).toBeGreaterThan(0),
    );
    await generate();

    // Without this the dialog cheerfully offers ten cards the learner has been
    // reviewing for a month.
    expect(backend.lastCallTo("suggest-flashcards")?.body).toMatchObject({
      existingWords: expect.arrayContaining(["مطعم", "قائمة"]),
    });
  });

  it("says so when there was nothing new to suggest", async () => {
    await render({ seed: (b) => b.stubFunction("suggest-flashcards", { flashcards: [] }) });

    await generate();

    // A learner who owns everything on the topic needs to be told to pick
    // another one, not shown an empty list.
    expect(toasts.error).toHaveBeenCalledWith("ما رجعت اقتراحات جديدة. جرّب موضوعاً ثانياً.");
  });

  it("reports a generation that failed", async () => {
    await render({ seed: (b) => b.stubFunctionFailure("suggest-flashcards", 500) });

    await generate();

    expect(toasts.error).toHaveBeenCalled();
    expect(screen.queryByText("restaurant")).toBeNull();
  });
});

describe("choosing from the suggestions", () => {
  it("shows each word with everything needed to judge it", async () => {
    await render();

    await generate();

    expect(screen.getByText("مطعم")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("restaurant")).toBeInTheDocument();
    expect(screen.getByText("mat'am")).toBeInTheDocument();
    // The example is what shows whether the word is the one the learner meant.
    expect(screen.getByText("رحنا المطعم أمس")).toBeInTheDocument();
  });

  it("arrives with everything ticked", async () => {
    await render();

    await generate();

    // Somebody who asked for ten words about restaurants wants most of them.
    // The checkboxes are for pruning.
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toBeChecked();
    }
  });

  it("counts down as words are unticked", async () => {
    await render();
    await generate();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("offers nothing to save once everything is unticked", async () => {
    await render();
    await generate();

    for (const box of screen.getAllByRole("checkbox")) {
      fireEvent.click(box);
    }

    expect(screen.getByRole("button", { name: /احفظ في كلماتي/ })).toBeDisabled();
  });
});

describe("saving the chosen words", () => {
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /احفظ في كلماتي/ }));
    });
  };

  it("keeps each one with its example sentence", async () => {
    const { backend } = await render();
    await generate();

    await save();

    await waitFor(() => expect(savedWords(backend)).toHaveLength(2));
    expect(savedWords(backend)[0]).toMatchObject({
      word_arabic: "مطعم",
      word_english: "restaurant",
      source: "ai-suggest",
      sentence_text: "رحنا المطعم أمس",
      sentence_english: "We went to the restaurant yesterday",
      dialect: "Gulf",
    });
  });

  it("leaves the unticked ones out", async () => {
    const { backend } = await render();
    await generate();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await save();

    await waitFor(() => expect(savedWords(backend)).toHaveLength(1));
    expect(savedWords(backend)[0].word_arabic).toBe("قائمة");
  });

  it("says how many landed", async () => {
    await render();
    await generate();

    await save();

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Added 2 words"));
  });

  it("counts the ones it could not add", async () => {
    await render({ seed: (b) => b.db.failInserts("user_vocabulary") });
    await generate();

    await save();

    // Duplicates are the ordinary reason one is skipped, so the count has to be
    // real rather than assumed.
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Added 0 words (2 skipped)"),
    );
  });

  it("closes and clears itself once saved", async () => {
    const { onOpenChange } = await render();
    await generate();

    await save();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("throws the suggestions away even when none of them saved", async () => {
    const { onOpenChange } = await render({ seed: (b) => b.db.failInserts("user_vocabulary") });
    await generate();

    await save();

    // Pinned: the dialog closes and resets on the same path whether every word
    // was added or none was. A learner whose inserts all failed loses the whole
    // generated set — which cost a model call — and has to think of the topic
    // again.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
