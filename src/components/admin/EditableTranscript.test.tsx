import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { EditableTranscript } from "./EditableTranscript";
import type { TranscriptLine } from "@/types/transcript";

/**
 * The admin-side transcript editor.
 *
 * Machine transcription of dialect Arabic is wrong often enough that every
 * video is read line by line before it reaches a learner, and this is the tool
 * that gets used for it. Everything here is optimised for the person doing that
 * for an hour: click the text to fix it, click a word to gloss it, Enter to
 * commit, Escape to abandon. Nothing is behind a menu — though one of those
 * four, as pinned below, cannot actually be reached.
 *
 * The component owns no data. It is handed the lines and reports every change
 * back, which is what lets the page above it decide when to save — so the
 * assertions here are mostly about what it hands back, not what it keeps.
 */

const A_LINE: TranscriptLine = {
  id: "line-1",
  arabic: "رحت السوق",
  translation: "I went to the market",
  tokens: [
    { id: "t1", surface: "رحت", gloss: "I went" },
    { id: "t2", surface: "السوق" },
  ],
  startMs: 1000,
  endMs: 4000,
};

const ANOTHER_LINE: TranscriptLine = {
  id: "line-2",
  arabic: "شفت صاحبي",
  translation: "I saw my friend",
  tokens: [],
  startMs: 5000,
  endMs: 8000,
};

const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;

let audios: HTMLAudioElement[] = [];
let cleanup: (() => void) | undefined;
let root: HTMLElement;

beforeEach(() => {
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
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The component is controlled, so the tests supply the state it edits — the
 * same arrangement the admin page uses, and the only way a sequence of edits
 * behaves the way it does in the product.
 */
function Editor({
  initial,
  audioUrl,
  report,
}: {
  initial: TranscriptLine[];
  audioUrl?: string;
  report: (lines: TranscriptLine[]) => void;
}) {
  const [lines, setLines] = useState(initial);
  return (
    <EditableTranscript
      lines={lines}
      audioUrl={audioUrl}
      onChange={(next) => {
        setLines(next);
        report(next);
      }}
    />
  );
}

function render(initial: TranscriptLine[] = [A_LINE], audioUrl?: string) {
  const report = vi.fn();
  const harness = renderWithProviders(
    <Editor initial={initial} audioUrl={audioUrl} report={report} />,
  );
  cleanup = harness.cleanup;
  root = harness.container;
  return { ...harness, report, lastLines: () => report.mock.calls.at(-1)?.[0] as TranscriptLine[] };
}

const cards = () => Array.from(root.querySelectorAll<HTMLElement>("div.rounded-xl"));

const buttonsIn = (card: HTMLElement) => Array.from(card.querySelectorAll("button"));
const playButton = (card: HTMLElement) =>
  buttonsIn(card).find((b) => b.className.includes("rounded-full"));
const deleteButton = (card: HTMLElement) =>
  buttonsIn(card).find((b) => b.className.includes("text-destructive"))!;

/** The tick beside whichever field is open for editing. */
const confirmFor = (input: HTMLElement) => input.parentElement!.querySelector("button")!;

const editArabic = (card = cards()[0]) =>
  fireEvent.click(card.querySelector<HTMLElement>('div[dir="rtl"]')!);

describe("the shape of the transcript", () => {
  it("says how many sentences there are", () => {
    render([A_LINE, ANOTHER_LINE]);

    expect(screen.getByText("Sentences (2)")).toBeInTheDocument();
    expect(screen.getByText("2 sentences")).toBeInTheDocument();
  });

  it("numbers the lines from one", () => {
    render([A_LINE, ANOTHER_LINE]);

    // The editor and whoever reported the bad line have to be talking about the
    // same number.
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("adds an empty sentence to the end", () => {
    const { lastLines } = render();

    fireEvent.click(screen.getByRole("button", { name: /add sentence/i }));

    // Transcription misses whole utterances, usually short ones over music, so
    // there has to be a way to add a line that was never there.
    expect(lastLines()).toHaveLength(2);
    expect(lastLines()[1]).toMatchObject({ arabic: "", translation: "", tokens: [] });
  });

  it("gives two sentences added in the same millisecond the same id", () => {
    vi.useFakeTimers();
    const { lastLines } = render();

    fireEvent.click(screen.getByRole("button", { name: /add sentence/i }));
    fireEvent.click(screen.getByRole("button", { name: /add sentence/i }));

    // Pinned: new lines are identified by `Date.now()`, which is also the React
    // key. Two clicks inside one millisecond — or one automated fill — produce
    // two lines that React cannot tell apart, so edits to one land on the other.
    expect(lastLines()).toHaveLength(3);
    expect(lastLines()[1].id).toBe(lastLines()[2].id);
  });

  it("deletes the line that was pointed at", () => {
    const { lastLines } = render([A_LINE, ANOTHER_LINE]);

    // One click, no confirmation and no undo in this component: the page above
    // it holds the only copy until it is saved.
    fireEvent.click(deleteButton(cards()[0]));

    expect(lastLines().map((l) => l.id)).toEqual(["line-2"]);
  });
});

describe("fixing the Arabic", () => {
  it("opens the sentence for editing on a click", () => {
    render();

    editArabic();

    expect(screen.getByDisplayValue("رحت السوق")).toBeInTheDocument();
  });

  it("commits on Enter", () => {
    const { lastLines } = render();
    editArabic();

    const input = screen.getByDisplayValue("رحت السوق");
    fireEvent.change(input, { target: { value: "رحت السوق أمس" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Reaching for a mouse between every line is most of the cost of reading a
    // four-hundred-line transcript.
    expect(lastLines()[0].arabic).toBe("رحت السوق أمس");
  });

  it("commits on the tick as well", () => {
    const { lastLines } = render();
    editArabic();

    const input = screen.getByDisplayValue("رحت السوق");
    fireEvent.change(input, { target: { value: "رحت السوق أمس" } });
    fireEvent.click(confirmFor(input));

    expect(lastLines()[0].arabic).toBe("رحت السوق أمس");
  });

  it("abandons the edit on Escape", () => {
    const { report } = render();
    editArabic();

    const input = screen.getByDisplayValue("رحت السوق");
    fireEvent.change(input, { target: { value: "nonsense" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(report).not.toHaveBeenCalled();
    expect(screen.getByText("رحت")).toBeInTheDocument();
  });

  it("leaves the old words behind when the sentence changes", () => {
    const { lastLines } = render();
    editArabic();

    const input = screen.getByDisplayValue("رحت السوق");
    fireEvent.change(input, { target: { value: "رحت المطعم" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Pinned: the tokens are not re-derived from the corrected sentence, so the
    // line now says المطعم while the word list still says السوق — and the word
    // list is what the learner taps and what the vocabulary section is built
    // from.
    expect(lastLines()[0].arabic).toBe("رحت المطعم");
    expect(lastLines()[0].tokens.map((t) => t.surface)).toEqual(["رحت", "السوق"]);
  });

  it("shows the sentence as one piece when it has no words", () => {
    render([ANOTHER_LINE]);

    expect(screen.getByText("شفت صاحبي")).toBeInTheDocument();
  });

  it("follows the sentence when the page changes it underneath", () => {
    const onChange = vi.fn();
    const { rerender } = rtlRender(
      <EditableTranscript lines={[A_LINE]} onChange={onChange} />,
    );

    rerender(
      <EditableTranscript lines={[{ ...A_LINE, arabic: "رحت المطعم" }]} onChange={onChange} />,
    );
    fireEvent.click(document.querySelector<HTMLElement>('div[dir="rtl"]')!);

    // The page runs its own repairs — a re-translate, an AI fix — while a line
    // is on screen. Opening it afterwards has to show what is there now.
    expect(screen.getByDisplayValue("رحت المطعم")).toBeInTheDocument();
  });
});

describe("glossing a word", () => {
  it("marks the words that still need one", () => {
    render();

    // Which words are left is the only progress indicator the job has.
    expect(screen.getByText("السوق").className).toContain("text-foreground/60");
    expect(screen.getByText("رحت").className).not.toContain("text-foreground/60");
    expect(screen.getByText("السوق")).toHaveAttribute("title", "Click to add gloss");
  });

  it("shows the gloss and the standard spelling on hover", () => {
    render([
      {
        ...A_LINE,
        tokens: [{ id: "t1", surface: "رحت", gloss: "I went", standard: "ذهبت" }],
      },
    ]);

    expect(screen.getByText("رحت")).toHaveAttribute("title", "I went (ذهبت)");
  });

  it("opens the whole sentence instead of the word that was clicked", () => {
    render();

    fireEvent.click(screen.getByText("السوق"));

    // Pinned: each word carries its own inline gloss editor — an input, a tick,
    // Enter to commit, Escape to abandon — and none of it can be reached. The
    // click that is supposed to open it also reaches the sentence behind, which
    // swaps the words out for a single text field on the same click. So glossing
    // a word one at a time, which is what this component is for, is not possible;
    // the untranslated words rendered in grey have no way to stop being grey.
    expect(screen.getByDisplayValue("رحت السوق")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("English gloss")).toBeNull();
  });
});

describe("the timings", () => {
  it("shows the range in minutes and seconds", () => {
    render();

    // Milliseconds are how they are stored and unreadable as a range; an editor
    // is comparing them against a scrubber.
    expect(screen.getByRole("button", { name: /0:01\.0 → 0:04\.0/ })).toBeInTheDocument();
  });

  it("says so when a line has no timings at all", () => {
    render([{ ...A_LINE, startMs: undefined, endMs: undefined }]);

    expect(screen.getByRole("button", { name: /— → —/ })).toBeInTheDocument();
  });

  it("accepts a minutes-and-seconds range", () => {
    const { lastLines } = render();
    fireEvent.click(screen.getByRole("button", { name: /0:01\.0/ }));

    fireEvent.change(screen.getByPlaceholderText("0:00.0"), { target: { value: "1:05.5" } });
    fireEvent.change(screen.getByPlaceholderText("0:05.0"), { target: { value: "1:09.0" } });
    const row = screen.getByPlaceholderText("0:00.0").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[0]);

    expect(lastLines()[0]).toMatchObject({ startMs: 65500, endMs: 69000 });
  });

  it("accepts a bare number of seconds", () => {
    const { lastLines } = render();
    fireEvent.click(screen.getByRole("button", { name: /0:01\.0/ }));

    fireEvent.change(screen.getByPlaceholderText("0:00.0"), { target: { value: "12.5" } });
    const row = screen.getByPlaceholderText("0:00.0").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[0]);

    // Reading a number off a waveform is faster than formatting it.
    expect(lastLines()[0].startMs).toBe(12500);
  });

  it("clears a timing that was emptied", () => {
    const { lastLines } = render();
    fireEvent.click(screen.getByRole("button", { name: /0:01\.0/ }));

    fireEvent.change(screen.getByPlaceholderText("0:00.0"), { target: { value: "" } });
    const row = screen.getByPlaceholderText("0:00.0").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[0]);

    expect(lastLines()[0].startMs).toBeUndefined();
  });

  it("stores a nonsense minute-and-second value as Not-a-Number", () => {
    const { lastLines } = render();
    fireEvent.click(screen.getByRole("button", { name: /0:01\.0/ }));

    fireEvent.change(screen.getByPlaceholderText("0:00.0"), { target: { value: "1:xx" } });
    const row = screen.getByPlaceholderText("0:00.0").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[0]);

    // Pinned: a value with no colon is checked for NaN and rejected, but one
    // with a colon is not — so a typo becomes a NaN timestamp, which survives
    // into the saved transcript and makes the line unplayable rather than
    // visibly wrong.
    expect(lastLines()[0].startMs).toBeNaN();
  });

  it("puts the range back when the edit is cancelled", () => {
    const { report } = render();
    fireEvent.click(screen.getByRole("button", { name: /0:01\.0/ }));

    fireEvent.change(screen.getByPlaceholderText("0:00.0"), { target: { value: "9:99" } });
    const row = screen.getByPlaceholderText("0:00.0").parentElement!;
    fireEvent.click(row.querySelectorAll("button")[1]);

    expect(report).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /0:01\.0 → 0:04\.0/ })).toBeInTheDocument();
  });
});

describe("the English", () => {
  it("opens for editing on a click and commits on Enter", () => {
    const { lastLines } = render();

    fireEvent.click(screen.getByText("I went to the market"));
    const input = screen.getByDisplayValue("I went to the market");
    fireEvent.change(input, { target: { value: "I went to the souq" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(lastLines()[0].translation).toBe("I went to the souq");
  });

  it("abandons on Escape", () => {
    const { report } = render();

    fireEvent.click(screen.getByText("I went to the market"));
    const input = screen.getByDisplayValue("I went to the market");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(report).not.toHaveBeenCalled();
    expect(screen.getByText("I went to the market")).toBeInTheDocument();
  });

  it("invites one when the line has none", () => {
    render([{ ...A_LINE, translation: "" }]);

    // An empty row reads as a rendering fault; saying so makes it a task.
    expect(screen.getByText("Click to add translation")).toBeInTheDocument();
  });

  it("can be folded away", () => {
    render();
    const card = cards()[0];
    const english = card.querySelector(".mt-3.pt-3")!;
    expect(english.className).not.toContain("hidden");

    fireEvent.click(card.querySelector(".justify-center.cursor-pointer")!);

    // Checking timings against a scrubber means wanting the lines short; the
    // English is not what is being checked then.
    expect(english.className).toContain("hidden");
  });
});

describe("replaying a line", () => {
  const AUDIO = "https://audio.test/clip.mp3";

  it("offers no play button without audio", () => {
    render();

    expect(playButton(cards()[0])).toBeUndefined();
  });

  it("starts at the line rather than the top of the clip", () => {
    render([A_LINE, ANOTHER_LINE], AUDIO);

    fireEvent.click(playButton(cards()[1])!);

    // Checking a correction means hearing that one sentence again, repeatedly.
    expect(audios[0].currentTime).toBe(5);
    expect(play).toHaveBeenCalled();
  });

  it("stops at the end of the line", () => {
    render([A_LINE], AUDIO);
    fireEvent.click(playButton(cards()[0])!);
    pause.mockClear();

    audios[0].currentTime = 4.2;
    fireEvent(audios[0], new Event("timeupdate"));

    expect(pause).toHaveBeenCalled();
  });

  it("pauses when the playing line is clicked again", () => {
    render([A_LINE], AUDIO);
    fireEvent.click(playButton(cards()[0])!);
    fireEvent(audios[0], new Event("play"));
    pause.mockClear();

    fireEvent.click(playButton(cards()[0])!);

    expect(pause).toHaveBeenCalled();
  });

  it("plays from the start for a line with no timings", () => {
    render([{ ...A_LINE, startMs: undefined, endMs: undefined }], AUDIO);

    fireEvent.click(playButton(cards()[0])!);

    expect(audios[0].currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
  });
});
