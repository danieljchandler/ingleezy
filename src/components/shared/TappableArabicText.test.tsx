import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { MarkUnknownsProvider } from "@/contexts/MarkUnknownsContext";
import { TappableArabicText } from "./TappableArabicText";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { Persona } from "@/test/support/personas";

/**
 * Tappable Arabic — the app's single most-used interaction.
 *
 * Every passage, transcript, story and news article renders through this. A
 * learner reading native-speed Arabic meets an unknown word every few lines,
 * and the whole difference between "I can read this" and "I gave up" is whether
 * looking one up costs a tap or a trip to a dictionary.
 *
 * The subtle part is the phrase mode. Arabic meaning frequently sits in a pair
 * of words — a verb with its preposition, a construct pair — and looking up
 * either half separately gives two definitions that do not add up to what the
 * sentence says. Long-pressing switches every word into a selection toggle so
 * the learner can take the span they actually did not understand.
 */

const TEXT = "رحت السوق أمس";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
  vi.useRealTimers();
});

interface Options {
  text?: string;
  vocabulary?: Array<{
    word_arabic: string;
    word_english: string;
    msa_form?: string | null;
    msa_note?: string | null;
  }>;
  persona?: Persona;
  seed?: (backend: SupabaseBackend) => void;
  marking?: boolean;
}

async function render({ text = TEXT, vocabulary, persona = "free", seed, marking }: Options = {}) {
  const element = (
    <TappableArabicText text={text} vocabulary={vocabulary} sentenceContext={{ arabic: text }} />
  );
  const harness = renderWithProviders(
    marking ? <MarkUnknownsProvider>{element}</MarkUnknownsProvider> : element,
    {
      persona,
      seed: (backend) => {
        backend.stubFunction("word-enrichment", {
          definition: "market",
          root: "س و ق",
          transliteration: "sooq",
          uses: [{ arabic: "سوق شعبي", english: "traditional market" }],
        });
        backend.stubFunction("generate-sample-sentences", {
          sentences: [{ arabic: "رحت السوق", english: "I went to the market" }],
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  // The prefs and bridge-mode hooks resolve a tick after mount, so a
  // synchronous assertion would race a re-render already on its way.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return harness;
}

const wordButton = (word: string) => screen.getByRole("button", { name: `ابحث عن «${word}»` });

describe("rendering the passage", () => {
  it("makes every word its own target", async () => {
    await render();

    // Word-level rather than sentence-level: the learner knows which word they
    // did not understand, and asking them to select it by hand on a phone is
    // the friction this replaces.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(wordButton("رحت")).toBeInTheDocument();
    expect(wordButton("السوق")).toBeInTheDocument();
  });

  it("lays the passage out right to left", async () => {
    const { container } = await render();

    expect(container.querySelector("p")).toHaveAttribute("dir", "rtl");
  });

  it("keeps punctuation in the text but out of the lookup", async () => {
    await render({ text: "رحت السوق، أمس؟" });

    // The learner sees the sentence as written; the dictionary is asked about
    // the word, and "السوق،" is not a word.
    expect(screen.getByRole("button", { name: "ابحث عن «السوق»" })).toHaveTextContent("السوق،");
  });

  it("strips the vowels when the learner has turned them off", async () => {
    localStorage.setItem(
      "ingleezy:display-prefs",
      JSON.stringify({ showArabic: true, showTashkil: false, showFormal: false, showEnglish: false }),
    );

    await render({ text: "رَحْت" });

    // Reading unvocalised text is the skill; leaving the vowels on for someone
    // who asked for them off removes the exercise.
    expect(screen.getByRole("button", { name: "ابحث عن «رحت»" })).toHaveTextContent("رحت");
  });
});

describe("looking a word up", () => {
  it("asks for a definition in the learner's dialect", async () => {
    const { backend } = await render();

    fireEvent.click(wordButton("السوق"));

    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));
    // The sentence goes with the word: "رحت" alone is ambiguous, and in context
    // it is not.
    expect(backend.lastCallTo("word-enrichment")?.body).toMatchObject({
      word: "السوق",
      dialect: "Gulf",
      sentenceArabic: TEXT,
      isPhrase: false,
    });
  });

  it("does not ask twice for the same word", async () => {
    const { backend } = await render();

    fireEvent.click(wordButton("السوق"));
    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));
    fireEvent.click(wordButton("السوق"));

    // A learner rereads a line several times; paying for the same lookup on
    // every pass would be the bulk of this feature's cost.
    await act(async () => {});
    expect(backend.callsTo("word-enrichment")).toHaveLength(1);
  });

  it("marks a word that has been looked up", async () => {
    await render();

    fireEvent.click(wordButton("السوق"));

    // The underline is a reading aid in itself — it shows which words the
    // learner needed help with on this pass.
    await waitFor(() => expect(wordButton("السوق").className).toContain("underline"));
  });

  it("ignores a tap on punctuation alone", async () => {
    const { backend } = await render({ text: "رحت ، السوق" });

    fireEvent.click(screen.getByRole("button", { name: "ابحث عن «»" }));

    await act(async () => {});
    expect(backend.callsTo("word-enrichment")).toEqual([]);
  });

  it("can be reached from the keyboard", async () => {
    const { backend } = await render();

    fireEvent.keyDown(wordButton("السوق"), { key: "Enter" });

    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));
  });

  it("still shows the passage when enrichment fails", async () => {
    const { backend } = await render({
      seed: (b) => b.stubFunctionFailure("word-enrichment", 500),
    });

    fireEvent.click(wordButton("السوق"));

    // A failed lookup must not take the passage down; the learner keeps
    // reading and can tap again.
    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));
    expect(wordButton("السوق")).toBeInTheDocument();
  });
});

describe("selecting a phrase", () => {
  const longPress = (word: string) => {
    vi.useFakeTimers();
    fireEvent.pointerDown(wordButton(word));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
  };

  it("turns every word into a selection toggle", async () => {
    await render();

    longPress("رحت");

    // The whole passage becomes selectable, because the learner does not know
    // where the phrase ends until they have read to the end of it.
    expect(screen.getByRole("button", { name: "مدّد التحديد إلى «السوق»" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ابحث عن «السوق»" })).not.toBeInTheDocument();
  });

  it("takes the whole span between the two ends", async () => {
    await render();
    longPress("رحت");

    fireEvent.click(screen.getByRole("button", { name: "مدّد التحديد إلى «أمس»" }));

    // Contiguous by construction: a phrase with a hole in it is not a phrase,
    // and picking two ends is fewer taps than picking every word between them.
    expect(screen.getByText("رحت السوق أمس")).toBeInTheDocument();
  });

  it("translates the selection as one unit", async () => {
    const { backend } = await render();
    longPress("رحت");
    fireEvent.click(screen.getByRole("button", { name: "مدّد التحديد إلى «السوق»" }));

    fireEvent.click(screen.getByRole("button", { name: /translate/i }));

    // `isPhrase` is what tells the model to read it as an expression rather
    // than gloss two words — which is the entire reason phrase mode exists.
    await waitFor(() =>
      expect(backend.lastCallTo("word-enrichment")?.body).toMatchObject({
        word: "رحت السوق",
        isPhrase: true,
      }),
    );
  });

  it("refuses to save a phrase nobody has translated", async () => {
    const { backend } = await render();
    longPress("رحت");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // A flashcard with an Arabic front and a blank back is unreviewable, and
    // the learner would not find out until it came up in a session.
    await act(async () => {});
    expect(backend.db.writesTo("user_vocabulary")).toEqual([]);
  });

  it("saves the phrase once it has a meaning", async () => {
    const { backend } = await render();
    longPress("رحت");
    fireEvent.click(screen.getByRole("button", { name: /translate/i }));
    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(backend.db.lastWriteTo("user_vocabulary")?.payload[0]).toMatchObject({
        word_arabic: "رحت",
        word_english: "market",
        // The sentence travels with the card, so review shows the phrase in the
        // context the learner met it in.
        sentence_text: TEXT,
      }),
    );
  });

  it("goes back to looking words up when cancelled", async () => {
    await render();
    longPress("رحت");

    fireEvent.click(screen.getByRole("button", { name: /ألغِ العبارة|×/ }));

    expect(screen.getByRole("button", { name: "ابحث عن «السوق»" })).toBeInTheDocument();
  });

  it("does not look the word up on the way into phrase mode", async () => {
    const { backend } = await render();

    longPress("رحت");

    // Holding a word means "I want more than this one"; paying for its
    // definition on the way past would be a lookup nobody asked for, on every
    // phrase the learner selects.
    await act(async () => {});
    expect(backend.callsTo("word-enrichment")).toEqual([]);
  });
});

describe("marking what you did not understand", () => {
  it("leaves lookups alone until marking is switched on", async () => {
    await render({ marking: true });

    // The provider is present but the mode is off, which is the state every
    // reading screen starts in.
    expect(wordButton("السوق")).toBeInTheDocument();
  });
});

describe("saving a single word", () => {
  it("refuses for a signed-out visitor", async () => {
    const { backend } = await render({ persona: "anonymous" });

    fireEvent.click(wordButton("السوق"));
    await waitFor(() => expect(backend.callsTo("word-enrichment")).toHaveLength(1));

    // Reading and looking words up are open to anyone; keeping one needs
    // somewhere to keep it.
    expect(backend.db.writesTo("user_vocabulary")).toEqual([]);
  });
});
