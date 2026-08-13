import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { LineByLineTranscript } from "./LineByLineTranscript";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { TranscriptLine, WordToken } from "@/types/transcript";

/**
 * The sentence-by-sentence view of a transcribed video.
 *
 * This is where a learner actually works through native speech: one line at a
 * time, English hidden until they have had a go, every word tappable for a
 * meaning, and a play button that replays just that line. It is the payoff for
 * the whole transcribe pipeline — everything upstream exists so this screen has
 * something to show.
 *
 * The interesting part is the word lookup. Meaning in dialect Arabic often sits
 * in a pair of words rather than in either one — a verb with its preposition, a
 * construct pair — so looking up each half gives two definitions that do not
 * add up to the sentence. Tapping two adjacent words asks for the pair instead.
 * That gesture has to coexist with the ordinary single-word tap, and the way it
 * is meant to is that one tap only selects — the definition is held back for a
 * second and a half in case a second word follows. It does not work out that
 * way, and several of the findings pinned below follow from that one collision.
 */

const aToken = (surface: string, over: Partial<WordToken> = {}): WordToken => ({
  id: `tok-${surface}-${over.gloss ?? ""}`,
  surface,
  ...over,
});

const A_LINE: TranscriptLine = {
  id: "line-1",
  arabic: "رحت السوق أمس",
  translation: "I went to the market yesterday",
  tokens: [
    aToken("رحت", { gloss: "I went" }),
    aToken("السوق", { gloss: "the market", standard: "السُّوق" }),
    aToken("أمس", { gloss: "yesterday" }),
  ],
  startMs: 1000,
  endMs: 4000,
};

const ANOTHER_LINE: TranscriptLine = {
  id: "line-2",
  arabic: "شفت صاحبي هناك",
  translation: "I saw my friend there",
  tokens: [aToken("شفت", { gloss: "I saw" }), aToken("صاحبي", { gloss: "my friend" })],
  startMs: 5000,
  endMs: 8000,
};

/** A compound the pipeline marked the legacy way: "(→ firstWord)" as the gloss. */
const LEGACY_COMPOUND: TranscriptLine = {
  ...A_LINE,
  tokens: [
    aToken("رحت", { gloss: "I went to the market" }),
    aToken("السوق", { gloss: "(→ رحت)" }),
    A_LINE.tokens[2],
  ],
};

/** The same compound marked the current way, with `compoundRef`. */
const MODERN_COMPOUND: TranscriptLine = {
  ...A_LINE,
  tokens: [
    aToken("رحت", { gloss: "I went to the market" }),
    { ...aToken("السوق"), compoundRef: "رحت" },
    A_LINE.tokens[2],
  ],
};

/** The transcript as it arrives when the pipeline could not gloss a word. */
const UNGLOSSED_LAST_WORD: TranscriptLine = {
  ...A_LINE,
  tokens: [A_LINE.tokens[0], A_LINE.tokens[1], aToken("أمس")],
};

const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;

/**
 * The component owns its `Audio` element and never exposes it, so the tests
 * reach it the only way anything else could: by watching the constructor.
 */
let audios: HTMLAudioElement[] = [];

let cleanup: (() => void) | undefined;
let root: HTMLElement;

beforeEach(() => {
  // Fake timers for the whole file, not because any test drives the clock, but
  // because the component leaves one running. Tapping a word schedules a 1.5s
  // `setSelectedIndices` and nothing cancels it on unmount, so on a slow run it
  // fires after jsdom has been torn down and takes the whole suite down with a
  // `ReferenceError: window is not defined`. That surfaced only under
  // `--coverage`, which is slow enough to lose the race — i.e. it was always a
  // latent CI failure. `shouldAdvanceTime` keeps waitFor and the rest working
  // as before; `clearAllTimers` below drops whatever is still pending.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  audios = [];
  play.mockClear();
  pause.mockClear();
  const RealAudio = window.Audio;
  vi.stubGlobal(
    "Audio",
    class extends RealAudio {
      constructor(src?: string) {
        super(src);
        audios.push(this as unknown as HTMLAudioElement);
      }
    },
  );
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

interface Options {
  lines?: TranscriptLine[];
  audioUrl?: string;
  savedWords?: Set<string>;
  vocabSectionWords?: Set<string>;
  /** Mount it the way a page with no deck attached does: nowhere to save to. */
  readOnly?: boolean;
  dialect?: string;
  seed?: (backend: SupabaseBackend) => void;
}

function render({
  lines = [A_LINE],
  audioUrl,
  savedWords,
  vocabSectionWords,
  readOnly = false,
  dialect = "Gulf",
  seed,
}: Options = {}) {
  const onAddToVocabSection = readOnly ? undefined : vi.fn();
  const onSaveToMyWords = readOnly ? undefined : vi.fn();
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderWithProviders(
    <LineByLineTranscript
      lines={lines}
      audioUrl={audioUrl}
      savedWords={savedWords}
      vocabSectionWords={vocabSectionWords}
      onAddToVocabSection={onAddToVocabSection}
      onSaveToMyWords={onSaveToMyWords}
    />,
    {
      persona: "free",
      seed: (backend) => {
        backend.stubFunction("translate-phrase", { translation: "I went to the market" });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  root = harness.container;
  return { ...harness, onAddToVocabSection, onSaveToMyWords };
}

const cards = (container: HTMLElement = root) =>
  Array.from(container.querySelectorAll<HTMLElement>("div.rounded-xl"));

/**
 * A collapsed translation is still in the DOM — it is clipped by `max-h-0` and
 * faded out rather than unmounted, so that opening it can animate. Asking
 * whether it is on screen therefore means asking about the class.
 */
const isRevealed = (card: HTMLElement) =>
  card.querySelector(".overflow-hidden")!.className.includes("opacity-100");

const sentenceOf = (card: HTMLElement) => card.querySelector<HTMLElement>('div[dir="rtl"]')!;

const showAllSwitch = () => screen.getByRole("switch", { name: "Show all translations" });
const fushaSwitch = () => screen.getByRole("switch", { name: "Show Fusha (MSA) line" });

/** The only button in a card with no label on it is the play button. */
const playButton = (card: HTMLElement) =>
  Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "");

/**
 * Taps a word in the transcript itself. Scoped, because an open popover repeats
 * the word it is defining and a bare `getByText` would find both.
 */
const tap = (word: string, lineIndex = 0) =>
  fireEvent.click(within(sentenceOf(cards()[lineIndex])).getByText(word));

const popovers = () => screen.queryAllByRole("dialog");

/** The single-word definition: the popover that is not the compound one. */
const wordPopover = () => {
  const found = popovers().filter((d) => !d.textContent?.includes("compound phrase"));
  expect(found).toHaveLength(1);
  return found[0];
};

const compoundPopover = () =>
  popovers().find((d) => d.textContent?.includes("compound phrase"));

const awaitCompound = async () => {
  await waitFor(() => expect(compoundPopover()).toBeDefined());
  return compoundPopover()!;
};

describe("showing the transcript", () => {
  it("renders nothing at all when there is no transcript", () => {
    const { container } = render({ lines: [] });

    // The parent pages render this next to a video that may still be
    // processing; an empty "Sentences" heading would read as a failure.
    expect(container).toBeEmptyDOMElement();
  });

  it("says how much there is to work through", () => {
    render({ lines: [A_LINE, ANOTHER_LINE] });

    expect(screen.getByText("2 sentences")).toBeInTheDocument();
  });

  it("counts a single sentence as one", () => {
    render();

    expect(screen.getByText("1 sentence")).toBeInTheDocument();
  });

  it("breaks the line into separately tappable words", () => {
    render();

    // The tokens are the whole point of the screen: a wall of Arabic that
    // cannot be tapped is no more useful than a screenshot.
    for (const word of ["رحت", "السوق", "أمس"]) {
      expect(screen.getByText(word)).toHaveAttribute("role", "button");
    }
  });

  it("shows the sentence as written when it was never tokenised", () => {
    render({ lines: [{ ...A_LINE, tokens: [] }] });

    // Older transcripts predate tokenisation. Losing the words entirely would
    // be worse than losing the lookups.
    expect(screen.getByText("رحت السوق أمس")).toBeInTheDocument();
  });

  it("attaches a comma to the word after it rather than the word before", () => {
    const { container } = render({
      lines: [{ ...A_LINE, tokens: [aToken("رحت", { gloss: "I went" }), aToken("،"), aToken("أمس")] }],
    });

    // Pinned: the spacing rule suppresses the space that follows a punctuation
    // token instead of the one that precedes it, so a comma arriving as its own
    // token detaches from the word it belongs to and sticks to the next —
    // "رحت ،أمس". Arabic punctuation hangs off the preceding word.
    expect(sentenceOf(cards(container)[0]).textContent).toContain("رحت ،أمس");
  });

  it("marks a line that was read off the screen rather than spoken", () => {
    render({ lines: [{ ...A_LINE, segmentType: "text_overlay" }] });

    // A burned-in caption is not speech: it has no pronunciation to imitate and
    // it is frequently in MSA even when the speaker is not.
    expect(screen.getByText("On screen")).toBeInTheDocument();
  });
});

describe("the English", () => {
  it("stays hidden until the learner has had a go", () => {
    const { container } = render();

    // Reading the English first is the single easiest way to learn nothing
    // from a transcript.
    expect(isRevealed(cards(container)[0])).toBe(false);
  });

  it("opens on a tap on the sentence and closes on the next", () => {
    const { container } = render();
    const card = cards(container)[0];

    fireEvent.click(sentenceOf(card));
    expect(isRevealed(card)).toBe(true);

    fireEvent.click(sentenceOf(card));
    expect(isRevealed(card)).toBe(false);
  });

  it("opens every line at once for a reread", () => {
    const { container } = render({ lines: [A_LINE, ANOTHER_LINE] });

    fireEvent.click(showAllSwitch());

    // Working through it line by line is the exercise; reading it straight
    // through afterwards is how a learner checks what they got.
    expect(cards(container).every(isRevealed)).toBe(true);
  });

  it("cannot hide a single line while every line is showing", () => {
    const { container } = render();
    fireEvent.click(showAllSwitch());
    const card = cards(container)[0];

    fireEvent.click(sentenceOf(card));

    // Pinned: the master switch wins outright, so the per-line tap becomes a
    // dead control rather than turning the switch off or overriding it.
    expect(isRevealed(card)).toBe(true);
  });

  it("shows the word-for-word reading beside the natural one", () => {
    render({ lines: [{ ...A_LINE, literal: "went-I the-market yesterday" }] });

    // The literal is what explains the Arabic; the natural translation is only
    // what the sentence means.
    expect(screen.getByText("went-I the-market yesterday")).toBeInTheDocument();
    expect(screen.getByText("I went to the market yesterday")).toBeInTheDocument();
  });
});

/**
 * The Fusha row: the same sentence in Modern Standard Arabic, for learners who
 * arrived from فصحى and are trying to map it onto what people actually say.
 *
 * It is the one row that is *not* a translation, so it sits with the Arabic
 * rather than inside the collapsible English — and it is off until asked for,
 * because a second Arabic sentence under every line is noise to the learners
 * who did not come from MSA.
 */
describe("the Fusha line", () => {
  const FUSHA = "ذهبت إلى السوق أمس";
  const withFusha = [{ ...A_LINE, fusha: FUSHA }];

  it("stays hidden until the learner asks for it", () => {
    render({ lines: withFusha });

    expect(screen.queryByText(FUSHA)).not.toBeInTheDocument();
  });

  it("shows the stored rendering next to the dialect line", () => {
    render({ lines: withFusha });

    fireEvent.click(fushaSwitch());

    expect(screen.getByText(FUSHA)).toBeInTheDocument();
    // Visible without opening the English: it is the same sentence, not what
    // the sentence means.
    expect(cards().every(isRevealed)).toBe(false);
  });

  it("converts lines that predate the Fusha pass", async () => {
    render({ lines: [A_LINE] });

    fireEvent.click(fushaSwitch());

    await waitFor(() => expect(screen.getByText("فصحى 1")).toBeInTheDocument());
  });

  it("says so rather than repeating a line that was already Fusha", () => {
    render({ lines: [{ ...A_LINE, fusha: A_LINE.arabic }] });

    fireEvent.click(fushaSwitch());

    // Printing the identical sentence under a فصحى heading teaches nothing;
    // "nothing changed here" is itself the answer.
    expect(screen.getByText("Already فصحى")).toBeInTheDocument();
  });

  it("offers a retry when the conversion failed", async () => {
    render({
      lines: [A_LINE],
      seed: (backend) => backend.stubFunctionFailure("convert-to-fusha", 502),
    });

    fireEvent.click(fushaSwitch());

    await waitFor(() =>
      expect(screen.getByText("Couldn't convert every line to فصحى.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("replaying a line", () => {
  const AUDIO = "https://audio.test/clip.mp3";

  it("offers no play buttons when there is no audio", () => {
    const { container } = render();

    expect(playButton(cards(container)[0])).toBeUndefined();
  });

  it("starts at the line rather than at the top of the clip", () => {
    const { container } = render({ lines: [A_LINE, ANOTHER_LINE], audioUrl: AUDIO });

    fireEvent.click(playButton(cards(container)[1])!);

    // Replaying one sentence is how a learner works out a word they misheard;
    // starting from the beginning every time makes that unusable.
    expect(audios[0].currentTime).toBe(5);
    expect(play).toHaveBeenCalled();
  });

  it("stops at the end of the line instead of running into the next", () => {
    const { container } = render({ lines: [A_LINE], audioUrl: AUDIO });
    fireEvent.click(playButton(cards(container)[0])!);
    pause.mockClear();

    audios[0].currentTime = 4.1;
    act(() => {
      audios[0].dispatchEvent(new Event("timeupdate"));
    });

    expect(pause).toHaveBeenCalled();
  });

  it("pauses when the playing line is tapped again", () => {
    const { container } = render({ lines: [A_LINE], audioUrl: AUDIO });
    fireEvent.click(playButton(cards(container)[0])!);
    act(() => {
      audios[0].dispatchEvent(new Event("play"));
    });
    pause.mockClear();

    fireEvent.click(playButton(cards(container)[0])!);

    expect(pause).toHaveBeenCalled();
  });

  it("does not leave two lines playing over each other", () => {
    const { container } = render({ lines: [A_LINE, ANOTHER_LINE], audioUrl: AUDIO });
    fireEvent.click(playButton(cards(container)[0])!);
    pause.mockClear();

    fireEvent.click(playButton(cards(container)[1])!);

    // There is one audio element for the whole transcript, so the previous
    // line's stop-at-the-end listener has to come off with it.
    expect(pause).toHaveBeenCalled();
    expect(audios[0].currentTime).toBe(5);
  });

  it("plays the whole clip for a line with no timings", () => {
    const { container } = render({
      lines: [{ ...A_LINE, startMs: undefined, endMs: undefined }],
      audioUrl: AUDIO,
    });

    fireEvent.click(playButton(cards(container)[0])!);

    expect(audios[0].currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
  });

  it("never highlights the word being spoken", () => {
    const { container } = render({ lines: [A_LINE], audioUrl: AUDIO });
    fireEvent.click(playButton(cards(container)[0])!);

    audios[0].currentTime = 1.5;
    act(() => {
      audios[0].dispatchEvent(new Event("timeupdate"));
    });

    // Pinned: the playhead is tracked and threaded down to every token, but the
    // predicate that decides which word is current returns false unconditionally,
    // so the karaoke highlight is wired end to end and permanently off.
    expect(container.querySelector(".bg-primary\\/20")).toBeNull();
  });
});

describe("looking up one word", () => {
  it("opens the definition on the very first tap", () => {
    render();

    tap("رحت");

    // Pinned: the component's own handler only *selects* the word and starts a
    // 1.5-second timer, deliberately holding the definition back so that a
    // second tap can mean "make this a phrase" instead. But the word sits
    // inside a Radix popover trigger, whose click handler runs on the same
    // event and toggles the popover open — the pause is designed and then
    // defeated, and both states are live at once: the definition is showing
    // while the hint underneath still invites a second word.
    expect(within(wordPopover()).getByText("I went")).toBeInTheDocument();
    expect(screen.getByText(/Tap an adjacent word/)).toBeInTheDocument();
  });

  it("keeps the definition open once the selection lapses", () => {
    render();
    vi.useFakeTimers();

    tap("رحت");
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // The timer's real remaining effect: it drops the selection so the phrase
    // gesture is no longer half-started.
    expect(within(wordPopover()).getByText("I went")).toBeInTheDocument();
    expect(screen.queryByText(/Tap an adjacent word/)).not.toBeInTheDocument();
  });

  it("shows the standard spelling when the dialect form differs", () => {
    render();

    tap("السوق");

    // Knowing the MSA form is what lets a learner look the word up anywhere
    // else, and it is what makes a dialect word feel like part of the language.
    expect(within(wordPopover()).getByText(/السُّوق/)).toBeInTheDocument();
  });

  it("puts the word back when it is tapped a second time", () => {
    render();
    tap("رحت");

    tap("رحت");

    expect(screen.queryByText(/Tap an adjacent word/)).not.toBeInTheDocument();
  });

  it("translates a word the transcript had no gloss for", async () => {
    const { backend } = render({
      lines: [UNGLOSSED_LAST_WORD],
      seed: (b) => b.stubFunction("translate-phrase", { translation: "yesterday" }),
    });

    tap("أمس");

    // With the sentence, because a word's meaning in isolation is regularly not
    // its meaning here.
    await waitFor(() =>
      expect(backend.lastCallTo("translate-phrase")?.body).toMatchObject({
        phrase: "أمس",
        dialect: "Gulf",
        sentenceArabic: A_LINE.arabic,
        sentenceEnglish: A_LINE.translation,
      }),
    );
    expect(within(wordPopover()).getByText("yesterday")).toBeInTheDocument();
  });

  it("offers a retry when the lookup came back empty", async () => {
    const { backend } = render({
      lines: [UNGLOSSED_LAST_WORD],
      seed: (b) => b.stubFunctionFailure("translate-phrase", 500),
    });

    tap("أمس");

    await waitFor(() =>
      expect(within(wordPopover()).getByText("No definition found")).toBeInTheDocument(),
    );
    fireEvent.click(within(wordPopover()).getByRole("button", { name: /retry translation/i }));

    // A learner who taps a word and gets nothing has no way to tell a flaky
    // network from a word the model does not know.
    await waitFor(() => expect(backend.callsTo("translate-phrase")).toHaveLength(2));
  });
});

describe("keeping a word", () => {
  it("takes the sentence along with the word", () => {
    const { onSaveToMyWords } = render();

    tap("رحت");
    fireEvent.click(within(wordPopover()).getByRole("button", { name: /save to my words/i }));

    // A word saved bare comes back in the review deck with no idea of how it
    // was used, and its audio clip needs the line's timings to exist at all.
    expect(onSaveToMyWords).toHaveBeenCalledWith({
      arabic: "رحت",
      english: "I went",
      sentenceText: A_LINE.arabic,
      sentenceEnglish: A_LINE.translation,
      startMs: 1000,
      endMs: 4000,
    });
  });

  it("adds it to the lesson's vocabulary section", () => {
    const { onAddToVocabSection } = render();

    tap("رحت");
    fireEvent.click(within(wordPopover()).getByRole("button", { name: /add to vocab section/i }));

    expect(onAddToVocabSection).toHaveBeenCalledWith(expect.objectContaining({ arabic: "رحت" }));
  });

  it("says when a word is already in the deck", () => {
    render({ savedWords: new Set(["رحت"]) });

    tap("رحت");

    // Saving the same word twice creates a duplicate review card, which is how
    // a deck becomes something a learner stops opening.
    expect(within(wordPopover()).getByRole("button", { name: /saved to my words/i })).toBeDisabled();
  });

  it("says when a word is already in the vocab section", () => {
    render({ vocabSectionWords: new Set(["رحت"]) });

    tap("رحت");

    expect(within(wordPopover()).getByRole("button", { name: /in vocab section/i })).toBeDisabled();
  });

  it("offers nothing to press when the page has nowhere to put it", () => {
    render({ readOnly: true });

    tap("رحت");

    // The transcript is also rendered read-only on pages with no deck attached.
    expect(within(wordPopover()).queryByRole("button")).toBeNull();
  });
});

describe("looking up a phrase", () => {
  it("asks for the pair when two neighbouring words are tapped", async () => {
    const { backend } = render();

    tap("رحت");
    tap("السوق");

    // Neither half means this on its own, which is the entire reason the
    // gesture exists.
    await waitFor(() =>
      expect(backend.lastCallTo("translate-phrase")?.body).toMatchObject({
        phrase: "رحت السوق",
        dialect: "Gulf",
        sentenceArabic: A_LINE.arabic,
      }),
    );
    expect(within(await awaitCompound()).getByText("I went to the market")).toBeInTheDocument();
  });

  it("shows the literal reading and the standard form of the phrase", async () => {
    render({
      seed: (b) =>
        b.stubFunction("translate-phrase", {
          translation: "I went to the market",
          literal: "went-I the-market",
          msa: "ذهبت إلى السوق",
        }),
    });

    tap("رحت");
    tap("السوق");

    await waitFor(() =>
      expect(within(compoundPopover()!).getByText(/went-I the-market/)).toBeInTheDocument(),
    );
    expect(within(compoundPopover()!).getByText(/ذهبت إلى السوق/)).toBeInTheDocument();
  });

  it("says so plainly when the phrase could not be translated", async () => {
    render({ seed: (b) => b.stubFunctionFailure("translate-phrase", 500) });

    tap("رحت");
    tap("السوق");

    await waitFor(() =>
      expect(within(compoundPopover()!).getByText("Could not translate")).toBeInTheDocument(),
    );
    // Nothing to save either — an empty card in the deck is worse than none.
    expect(within(compoundPopover()!).queryByRole("button")).toBeNull();
  });

  it("saves the phrase rather than the word it was anchored to", async () => {
    const { onSaveToMyWords } = render();

    tap("رحت");
    tap("السوق");
    await waitFor(() =>
      expect(within(compoundPopover()!).getByText("I went to the market")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(compoundPopover()!).getByRole("button", { name: /save to my words/i }),
    );

    expect(onSaveToMyWords).toHaveBeenCalledWith(
      expect.objectContaining({ arabic: "رحت السوق", english: "I went to the market" }),
    );
  });

  it("loses the phrase card to a lookup of the second word alone", async () => {
    const { backend } = render({ lines: [LEGACY_COMPOUND] });

    tap("رحت");
    tap("السوق");

    // The pipeline already worked this compound out, so no lookup of the pair
    // is requested — that part works. What arrives instead is a lookup of
    // السوق on its own, because the second tap also opens that word's popover,
    // and two popovers cannot both stay up: the phrase card is dismissed as it
    // appears. Pinned — the pre-computed compound gloss is never read by
    // anyone, and the tap costs a call it was meant to save.
    await waitFor(() => expect(backend.callsTo("translate-phrase")).toHaveLength(1));
    expect((backend.lastCallTo("translate-phrase")?.body as { phrase: string }).phrase).toBe(
      "السوق",
    );
    expect(compoundPopover()).toBeUndefined();
  });

  it("cannot read a compound marked the modern way", async () => {
    render({ lines: [MODERN_COMPOUND] });

    tap("رحت");
    tap("السوق");

    // Pinned: `getCompoundGloss` understands both the modern `compoundRef`
    // marker and the legacy "(→ …)" gloss, and finds the phrase — which is why
    // no lookup is requested. But the code that then works out how many words
    // the phrase spans counts only the legacy form, so it reports one word and
    // asks for the gloss of a zero-length span, which is nothing. The phrase
    // the component just found is reported as untranslatable.
    const compound = await awaitCompound();
    expect(compound.textContent).toContain("Could not translate");
    expect(within(compound).queryByRole("button")).toBeNull();
  });

  it("starts over when the second word is somewhere else in the line", () => {
    const { backend } = render();

    tap("رحت");
    tap("أمس");

    // Two words with a word between them are not a phrase, and joining them
    // would send the model something nobody said.
    expect(backend.callsTo("translate-phrase")).toEqual([]);
    expect(screen.getByText(/Tap an adjacent word/)).toBeInTheDocument();
  });

  it("cannot be extended to a third word", async () => {
    const { backend } = render();

    tap("رحت");
    tap("السوق");
    await waitFor(() => expect(backend.callsTo("translate-phrase")).toHaveLength(1));
    tap("أمس");

    // Pinned: the lookup supports trigrams — `getCompoundGloss` handles a span
    // of two, and the phrase length is capped at three — but the selection is
    // cleared the moment a pair is committed, so it can never hold more than
    // one word and the span can never exceed one. Three-word phrases such as
    // ما شاء الله are unreachable through the interface.
    expect(backend.callsTo("translate-phrase")).toHaveLength(1);
  });

  it("drops the selection when the second tap never comes", () => {
    render();
    vi.useFakeTimers();

    tap("رحت");
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Left highlighted, the word reads as an unfinished action the learner has
    // to undo before they can do anything else.
    expect(
      within(sentenceOf(cards()[0])).getByText("رحت").className,
    ).not.toContain("bg-secondary/20");
  });
});

// ── English-video lines (the direction flip) ─────────────────────────────────

const AN_ENGLISH_LINE: TranscriptLine = {
  id: "en-line-1",
  english: "I went to the market yesterday.",
  arabic: "رحت السوق أمس",
  fusha: "ذهبت إلى السوق أمس",
  literal: "أنا ذهبت إلى الـ سوق أمس",
  translation: "",
  tokens: [],
  startMs: 500,
  endMs: 2100,
};

describe("english-video lines", () => {
  it("renders the English as the primary, tappable text", () => {
    render({ lines: [AN_ENGLISH_LINE] });

    // Each word is its own tap target — the clickable-word → flashcard loop.
    expect(screen.getByRole("button", { name: "market" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "yesterday." })).toBeInTheDocument();
  });

  it("keeps the Arabic scaffold behind the expand, like translations always were", () => {
    render({ lines: [AN_ENGLISH_LINE] });

    // Scaffold present in the DOM but collapsed until the learner asks.
    const scaffold = screen.getByText("رحت السوق أمس");
    expect(scaffold.closest(".max-h-0")).not.toBeNull();

    fireEvent.click(screen.getAllByText("رحت السوق أمس")[0].closest("div.rounded-xl")!.querySelector("svg.lucide-chevron-down")!.closest("div")!);
    expect(screen.getByText("رحت السوق أمس").closest(".max-h-0")).toBeNull();
  });

  it("shows the literal word-order gloss with the scaffold", () => {
    render({ lines: [AN_ENGLISH_LINE] });
    expect(screen.getByText(/أنا ذهبت إلى الـ سوق أمس/)).toBeInTheDocument();
  });

  it("looks a tapped word up in the learner's dialect and saves it flipped", async () => {
    const { backend, onSaveToMyWords } = render({
      lines: [AN_ENGLISH_LINE],
      seed: (b) => b.stubFunction("translate-phrase", { translation: "سوق", msa: "سوق" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "market" }));

    await waitFor(() => expect(screen.getByText("سوق")).toBeInTheDocument());
    expect(backend.lastCallTo("translate-phrase")?.body).toMatchObject({
      phrase: "market",
      direction: "en_to_ar",
      mode: "word",
      dialect: "Gulf",
    });

    fireEvent.click(screen.getByRole("button", { name: /save to my words/i }));
    expect(onSaveToMyWords).toHaveBeenCalledWith(
      expect.objectContaining({ english: "market", arabic: "سوق" }),
    );
  });

  it("arabic-video lines still render the Arabic card", () => {
    render({ lines: [A_LINE, AN_ENGLISH_LINE] });
    // The Arabic line keeps its tokens; the English line keeps its words.
    expect(screen.getByText("رحت")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "market" })).toBeInTheDocument();
  });
});
