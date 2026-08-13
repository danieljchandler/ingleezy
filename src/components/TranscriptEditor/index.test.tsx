import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { Segment } from "@/types/transcript";
import TranscriptEditor from "./index";

/**
 * The transcript editor as a whole.
 *
 * Its parts are covered on their own — the toolbar, the segment list, the
 * scrubber. What is only testable here is the wiring between them: which hook's
 * state reaches which child, what the keyboard does to the segment the video is
 * currently on, and which of two possible AI suggestions the diff pane shows
 * when both exist.
 *
 * That last one is the reason this file matters. Two separate AI actions write
 * into the same preview — "suggest breaks" and the full re-segment — and if the
 * wrong one wins, an admin approves a diff of one thing and applies another.
 */

/**
 * Video position drives the active segment, and jsdom has no playback. Standing
 * `useVideoSync` in lets the keyboard tests say which segment is under the
 * playhead; the hook has its own tests.
 */
const sync = vi.hoisted(() => ({
  activeSegmentId: null as string | null,
  activeWordIndex: null as number | null,
  seekToSegment: vi.fn(),
}));
vi.mock("@/hooks/useVideoSync", () => ({
  useVideoSync: () => ({
    activeSegmentId: sync.activeSegmentId,
    activeWordIndex: sync.activeWordIndex,
    seekToSegment: sync.seekToSegment,
  }),
}));

/**
 * The card renders its Arabic from `words`, not from `text` — the per-word
 * confidence colouring is the point of that column — so a fixture with an empty
 * `words` array renders a blank line.
 */
const aSegment = (over: Partial<Segment> = {}): Segment => {
  const base = {
    id: "seg-1",
    video_id: "vid-1",
    start: 0,
    end: 2,
    text: "شلونك",
    translation: "how are you",
    confidence: 0.9,
    ...over,
  } as Segment;
  return {
    ...base,
    words:
      over.words ??
      base.text.split(" ").map((word, i, all) => ({
        word,
        start: base.start + ((base.end - base.start) * i) / all.length,
        end: base.start + ((base.end - base.start) * (i + 1)) / all.length,
        confidence: 0.9,
      })),
  };
};

const SEGMENTS: Segment[] = [
  aSegment({ id: "seg-1", start: 0, end: 2 }),
  aSegment({ id: "seg-2", start: 2, end: 4, text: "زين", translation: "good" }),
];

/** What "suggest breaks" comes back with — one line where there were two. */
const MERGED: Segment[] = [
  aSegment({ id: "seg-1", start: 0, end: 4, text: "شلونك زين", translation: "how are you, good" }),
];

/** What the full re-segment comes back with — split differently again. */
const RESEGMENTED: Segment[] = [
  aSegment({ id: "r-1", start: 0, end: 1.5, text: "شلونك", translation: "how are you" }),
  aSegment({ id: "r-2", start: 1.5, end: 4, text: "زين", translation: "good" }),
];

let cleanup: (() => void) | undefined;
let unmountEditor: (() => void) | undefined;

beforeEach(() => {
  sync.activeSegmentId = null;
  sync.activeWordIndex = null;
  sync.seekToSegment.mockReset();
});

afterEach(async () => {
  // DialectProvider (wrapped by the harness) resolves the session on a
  // macrotask; restoring the real fetch before that lands turns it into an
  // unstubbed network request.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Unmount before the harness tears down: the editor's debounced save is an
  // 800ms timer cleared on unmount, and RTL's own cleanup runs *after* this
  // block — late enough for the timer to fire into a torn-down tree.
  unmountEditor?.();
  unmountEditor = undefined;
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

interface Options {
  segments?: Segment[];
  videoUrl?: string;
  aiApiCall?: (prompt: string, signal: AbortSignal) => Promise<string>;
  onAIResegment?: (segments: Segment[]) => Promise<Segment[] | null>;
}

function render({ segments = SEGMENTS, videoUrl, aiApiCall, onAIResegment }: Options = {}) {
  const onSave = vi.fn();
  const harness = renderWithProviders(
    <TranscriptEditor
      initialSegments={segments}
      videoUrl={videoUrl}
      onSave={onSave}
      aiApiCall={aiApiCall}
      onAIResegment={onAIResegment}
    />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  unmountEditor = harness.unmount;
  return { ...harness, onSave };
}

const diff = () => screen.queryByText("AI Suggested Boundaries");
const suggestButton = () => screen.getByRole("button", { name: /suggest breaks/i });
const resegmentButton = () => screen.getByRole("button", { name: /re-?segment/i });
const acceptAll = () => screen.getByRole("button", { name: "Accept All" });
const rejectAll = () => screen.getByRole("button", { name: "Reject All" });

const card = (id: string) => document.querySelector<HTMLElement>(`[data-segment-id="${id}"]`)!;

/**
 * Arabic text as rendered in the segment list, in order. Each word is its own
 * span with no separator between them, so they are re-joined here.
 */
const lines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-segment-id]")).map((el) =>
    Array.from(el.querySelectorAll('span[dir="rtl"] > span > span[role="button"]'))
      .map((w) => w.textContent!.trim())
      .join(" "),
  );

/** Opens the inline editor on the first line by clicking one of its words. */
const openFirstLine = (container: HTMLElement) => {
  fireEvent.click(
    container.querySelector('[data-segment-id] span[dir="rtl"] span[role="button"]')!,
  );
  return container.querySelector<HTMLTextAreaElement>('textarea[dir="rtl"]')!;
};

/** Clicking a word opens the inline editor; blurring commits. */
const editFirstLine = (container: HTMLElement, value: string) => {
  const box = openFirstLine(container);
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};

/**
 * The first line's text as the editor currently holds it. The card renders from
 * `words`, which an edit never re-derives, so the inline editor is the only
 * place the live value is visible. Escape closes it without committing.
 */
const firstLineText = (container: HTMLElement) => {
  const box = openFirstLine(container);
  const value = box.value;
  fireEvent.keyDown(box, { key: "Escape" });
  return value;
};

describe("the layout", () => {
  it("puts the toolbar over the segments it acts on", () => {
    const { container } = render();

    expect(screen.getByRole("button", { name: /export srt/i })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-segment-id]")).toHaveLength(2);
  });

  it("shows the video beside the transcript when there is one", () => {
    const { container } = render({ videoUrl: "https://videos.test/clip.mp4" });

    // Editing timings without seeing the video is guesswork; the column is the
    // whole reason this is a two-pane editor.
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://videos.test/clip.mp4",
    );
  });

  it("gives the transcript the full width when there is no video", () => {
    const { container } = render();

    // Transcripts get edited from an audio-only source too, and half an empty
    // screen would be wasted on every one of them.
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".w-full.flex-1, .flex-1.min-h-0.overflow-hidden")).not.toBeNull();
  });

  it("starts with nothing to undo", () => {
    render();

    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /redo/i })).toBeDisabled();
  });
});

describe("keyboard shortcuts", () => {
  const nudge = (key: string) => fireEvent.keyDown(window, { key });

  /** The transcript as the page last received it. */
  const savedText = (onSave: ReturnType<typeof vi.fn>) =>
    (onSave.mock.calls.at(-1)?.[0] as Segment[] | undefined)?.[0]?.text;

  it("undoes and redoes an edit", () => {
    const { container } = render();
    editFirstLine(container, "شلونكم");
    expect(firstLineText(container)).toBe("شلونكم");

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(firstLineText(container)).toBe("شلونك");

    // Cmd+Shift+Z, because an editor without redo makes undo frightening to use.
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(firstLineText(container)).toBe("شلونكم");
  });

  it("undoes with Ctrl as well as Cmd", () => {
    const { container } = render();
    editFirstLine(container, "شلونكم");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    // The people doing this work are on both platforms.
    expect(firstLineText(container)).toBe("شلونك");
  });

  it("does not tell the page that an edit was undone", async () => {
    const { container, onSave } = render();
    editFirstLine(container, "شلونكم");
    await waitFor(() => expect(savedText(onSave)).toBe("شلونكم"));

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    // Pinned: undo and redo restore the editor's own state but never run the
    // debounced save, so the page keeps the version it was last told about. An
    // admin who fixes a typo, undoes it, and closes the editor has persisted the
    // typo — the screen and the saved transcript disagree.
    expect(firstLineText(container)).toBe("شلونك");
    expect(savedText(onSave)).toBe("شلونكم");
  });

  it("leaves the line on screen showing the words it had before the edit", async () => {
    const { container, onSave } = render();

    editFirstLine(container, "شلونكم");

    // Pinned: the card renders from `words`, and editing the line's `text` does
    // not re-derive them. The saved transcript has the correction; the closed
    // card still shows the old spelling, so an admin who fixes a word sees
    // nothing change and is likely to fix it again.
    await waitFor(() => expect(savedText(onSave)).toBe("شلونكم"));
    expect(lines(container)[0]).toBe("شلونك");
  });

  it("nudges the active segment's start earlier and later", () => {
    sync.activeSegmentId = "seg-2";
    render();

    act(() => nudge("["));
    expect(within(card("seg-2")).getByText("00:01.90")).toBeInTheDocument();

    act(() => nudge("]"));
    expect(within(card("seg-2")).getByText("00:02.00")).toBeInTheDocument();
  });

  it("nudges the active segment's end", () => {
    sync.activeSegmentId = "seg-2";
    render();

    act(() => nudge("}"));
    expect(within(card("seg-2")).getByText("00:04.10")).toBeInTheDocument();

    act(() => nudge("{"));
    expect(within(card("seg-2")).getByText("00:04.00")).toBeInTheDocument();
  });

  it("will not nudge a start below zero", () => {
    sync.activeSegmentId = "seg-1";
    render();

    act(() => nudge("["));

    // A negative timestamp is unrepresentable in SRT and would fail the export
    // rather than the edit.
    expect(within(card("seg-1")).getByText("00:00.00")).toBeInTheDocument();
  });

  it("will not nudge an end back past its own start", () => {
    sync.activeSegmentId = "seg-1";
    render({ segments: [aSegment({ id: "seg-1", start: 0, end: 0.15 })] });

    act(() => nudge("{"));

    // An inverted segment cannot be displayed or exported.
    expect(within(card("seg-1")).getByText("00:00.10")).toBeInTheDocument();
  });

  it("does nothing with the brackets when the video is not on a segment", () => {
    sync.activeSegmentId = null;
    render();

    act(() => nudge("]"));

    // The shortcut acts on "the line you are hearing". With nothing playing
    // there is no such line, and guessing one would edit a timestamp the admin
    // is not looking at.
    expect(within(card("seg-1")).getByText("00:00.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });

  it("stops listening once the editor is closed", () => {
    sync.activeSegmentId = "seg-2";
    const { unmount } = render();
    unmount();
    unmountEditor = undefined;

    // A shortcut still firing after the editor has gone would push edits into a
    // hook nothing is rendering.
    expect(() => act(() => nudge("]"))).not.toThrow();
  });
});

describe("suggesting better breaks", () => {
  const apiCall = (segments: Segment[]) =>
    vi.fn(async () => JSON.stringify(segments));

  it("sends the current segments to the model", async () => {
    const ai = apiCall(MERGED);
    render({ aiApiCall: ai });

    await act(async () => {
      fireEvent.click(suggestButton());
    });

    const [prompt] = ai.mock.calls[0] as unknown as [string];
    expect(prompt).toContain("شلونك");
    expect(prompt).toContain("Never break mid-phrase");
  });

  it("shows the suggestion for approval rather than applying it", async () => {
    const { container } = render({ aiApiCall: apiCall(MERGED) });

    await act(async () => {
      fireEvent.click(suggestButton());
    });

    // The model rewrites the whole transcript's segmentation. Applying that
    // unseen would be the single most destructive thing this editor can do.
    expect(diff()).toBeInTheDocument();
    expect(lines(container)).toEqual(["شلونك", "زين"]);
  });

  it("applies the suggestion when it is accepted", async () => {
    const { container } = render({ aiApiCall: apiCall(MERGED) });
    await act(async () => {
      fireEvent.click(suggestButton());
    });

    await act(async () => {
      fireEvent.click(acceptAll());
    });

    expect(lines(container)).toEqual(["شلونك زين"]);
    expect(diff()).toBeNull();
  });

  it("leaves the transcript alone when it is rejected", async () => {
    const { container } = render({ aiApiCall: apiCall(MERGED) });
    await act(async () => {
      fireEvent.click(suggestButton());
    });

    await act(async () => {
      fireEvent.click(rejectAll());
    });

    expect(diff()).toBeNull();
    expect(lines(container)).toEqual(["شلونك", "زين"]);
  });

  it("shows nothing when the model's answer could not be read", async () => {
    render({ aiApiCall: vi.fn(async () => "not json at all") });

    await act(async () => {
      fireEvent.click(suggestButton());
    });

    // A half-parsed diff is worse than none: the admin would approve segments
    // that were never really proposed.
    expect(diff()).toBeNull();
  });

  it("offers the button even with no model wired up", async () => {
    render();

    // Pinned: the re-segment button is conditional on its prop, but Suggest
    // Breaks is always rendered — `onSuggestBreaks` is passed unconditionally
    // and only checks for `aiApiCall` once clicked. On a page with no AI adapter
    // the button is live and does nothing at all when pressed: no diff, no
    // message, no busy state.
    const button = suggestButton();
    await act(async () => {
      fireEvent.click(button);
    });

    expect(diff()).toBeNull();
    expect(screen.queryByText(/AI rethinking/)).toBeNull();
  });
});

describe("re-segmenting the whole transcript", () => {
  it("is only offered when the page provides it", () => {
    render();

    expect(screen.queryByRole("button", { name: /re-?segment/i })).toBeNull();
  });

  it("hands the current segments over and previews what comes back", async () => {
    const resegment = vi.fn(async () => RESEGMENTED);
    const { container } = render({ onAIResegment: resegment });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    expect(resegment).toHaveBeenCalledWith(SEGMENTS);
    expect(diff()).toBeInTheDocument();
    expect(lines(container)).toEqual(["شلونك", "زين"]);
  });

  it("applies the new segmentation when it is accepted", async () => {
    const { container } = render({ onAIResegment: vi.fn(async () => RESEGMENTED) });
    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    await act(async () => {
      fireEvent.click(acceptAll());
    });

    expect(within(card("r-1")).getByText("00:01.50")).toBeInTheDocument();
    expect(lines(container)).toEqual(["شلونك", "زين"]);
  });

  it("shows the toolbar as busy while the model is thinking", async () => {
    let release: (segments: Segment[]) => void;
    const pending = new Promise<Segment[]>((resolve) => {
      release = resolve;
    });
    render({ onAIResegment: () => pending });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    // Re-segmenting a long transcript takes tens of seconds. Without a visible
    // busy state the admin clicks again, and again.
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();

    await act(async () => {
      release!(RESEGMENTED);
      await pending;
    });
  });

  it("takes the AI actions away while a pass is running", async () => {
    let release: (segments: Segment[]) => void;
    const pending = new Promise<Segment[]>((resolve) => {
      release = resolve;
    });
    const resegment = vi.fn(() => pending);
    render({ onAIResegment: resegment });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    // Two in-flight passes would race to fill the same preview slot, and the
    // loser's diff is what the admin ends up approving. The toolbar swaps both
    // AI buttons for Cancel rather than relying on the guard alone.
    expect(screen.queryByRole("button", { name: /re-?segment/i })).toBeNull();
    expect(resegment).toHaveBeenCalledTimes(1);

    await act(async () => {
      release!(RESEGMENTED);
      await pending;
    });
    expect(screen.getByRole("button", { name: /re-?segment/i })).toBeInTheDocument();
  });

  it("shows nothing when the model returned nothing", async () => {
    render({ onAIResegment: vi.fn(async () => null) });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    expect(diff()).toBeNull();
  });

  it("shows nothing when the model returned an empty transcript", async () => {
    render({ onAIResegment: vi.fn(async () => []) });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    // Accepting this would wipe the transcript, which is not a suggestion any
    // admin means to approve.
    expect(diff()).toBeNull();
  });

  // Not covered here: a re-segment whose promise *rejects*. `handleAIResegment`
  // has a try/finally with no catch and its result is discarded by the click
  // handler, so the rejection escapes as an unhandled promise rejection and the
  // admin is told nothing. Asserting on that would make the suite itself exit
  // non-zero, so it is recorded here rather than pinned.
});

describe("keeping one boundary the proposal removes", () => {
  /** Three lines, so a proposal can merge two and leave the third alone. */
  const THREE: Segment[] = [
    aSegment({ id: "seg-1", start: 0, end: 2, text: "شلونك", translation: "how are you" }),
    aSegment({ id: "seg-2", start: 2, end: 4, text: "زين", translation: "good" }),
    aSegment({ id: "seg-3", start: 4, end: 6, text: "تمام", translation: "fine" }),
  ];

  /** Merges the first two, keeps the third. */
  const MERGE_FIRST_TWO: Segment[] = [
    aSegment({ id: "m-1", start: 0, end: 4, text: "شلونك زين", translation: "how are you, good" }),
    aSegment({ id: "m-2", start: 4, end: 6, text: "تمام", translation: "fine" }),
  ];

  const pane = () =>
    screen.getByRole("button", { name: "Accept All" }).closest("div.rounded-lg") as HTMLElement;

  /**
   * The timing labels of the diff's rows, in the order they are rendered.
   *
   * The two kinds of row share a shape and differ only by the strike-through on
   * the removed one, so that is what tells them apart. Reading them by timing
   * rather than by text is deliberate: the whole point of the handler is which
   * *boundaries* survive.
   */
  const rows = (kind: "proposed" | "removed") =>
    Array.from(pane().querySelectorAll<HTMLElement>('[dir="rtl"]'))
      .filter((row) => (kind === "removed") === !!row.querySelector(".line-through"))
      .map((row) => row.querySelector("span.font-mono")!.textContent!.trim());

  const keepButtons = () => screen.queryAllByRole("button", { name: "Keep" });

  /** Suggest breaks on the three-line fixture, and open the diff. */
  async function suggestMerge() {
    const harness = render({
      segments: THREE,
      aiApiCall: vi.fn(async () => JSON.stringify(MERGE_FIRST_TWO)),
    });
    await act(async () => {
      fireEvent.click(suggestButton());
    });
    return harness;
  }

  it("offers a Keep on each boundary the proposal drops", async () => {
    await suggestMerge();

    // The merge deletes the 0–2 and 2–4 boundaries; 4–6 comes back unchanged.
    expect(rows("removed")).toEqual(["0.0s – 2.0s", "2.0s – 4.0s"]);
    expect(keepButtons()).toHaveLength(2);
  });

  it("puts the kept boundary back into the proposal", async () => {
    await suggestMerge();

    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });

    // Keeping 0–2 means the merged 0–4 line cannot stand: it is the line that
    // swallowed the boundary. Everything else the model proposed survives.
    expect(rows("proposed")).toEqual(["0.0s – 2.0s", "4.0s – 6.0s"]);
  });

  it("drops only the suggested lines that overlap what was kept", async () => {
    await suggestMerge();

    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });

    // 4–6 does not overlap 0–2 and must not be collateral. Comparing against a
    // tolerance rather than exact equality is what makes this hold for the real
    // timings, which are floats summed from word durations.
    expect(rows("proposed")).toContain("4.0s – 6.0s");
    expect(rows("proposed")).not.toContain("0.0s – 4.0s");
  });

  it("works on the first keep, before any amended proposal exists", async () => {
    await suggestMerge();

    // The first Keep reads the suggestion out of the AI hook — there is no
    // amended proposal yet — and every later one reads its own output. A handler
    // that only looked at the amended list would crash on this click.
    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });
    expect(rows("proposed")).toHaveLength(2);

    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });

    // Keeping both dropped boundaries restores the original segmentation, so
    // there is nothing left to keep.
    expect(rows("proposed")).toEqual(["0.0s – 2.0s", "2.0s – 4.0s", "4.0s – 6.0s"]);
    expect(keepButtons()).toHaveLength(0);
  });

  it("leaves the amended proposal in start order", async () => {
    await suggestMerge();

    // The kept line is appended and the list re-sorted; without the sort a kept
    // early boundary would render last, and Accept All would write the
    // transcript out of order.
    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });

    const proposed = rows("proposed");
    expect(proposed).toEqual([...proposed].sort());
  });

  it("applies the amended proposal, not the model's original", async () => {
    const { container } = await suggestMerge();

    await act(async () => {
      fireEvent.click(keepButtons()[0]);
    });
    await act(async () => {
      fireEvent.click(acceptAll());
    });

    // Two lines — the kept 0–2 and the untouched 4–6 — rather than the model's
    // merged pair. Keeping a boundary and then accepting has to mean the
    // amended thing the admin was looking at.
    expect(lines(container)).toEqual(["شلونك", "تمام"]);
  });
});

describe("when both AI actions have produced something", () => {
  it("shows the re-segment rather than the break suggestion", async () => {
    render({
      aiApiCall: vi.fn(async () => JSON.stringify(MERGED)),
      onAIResegment: vi.fn(async () => RESEGMENTED),
    });
    await act(async () => {
      fireEvent.click(suggestButton());
    });

    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    // Both write into the same preview. The newer, whole-transcript pass wins —
    // otherwise the pane would say one thing and Accept would apply another.
    // The re-segment proposes two lines split at 1.5s; the break suggestion was
    // a single merged line, so the row count alone tells them apart.
    expect(screen.getByText("0.0s – 1.5s")).toBeInTheDocument();
    expect(screen.queryByText("0.0s – 4.0s")).toBeNull();
  });

  it("applies the re-segment, not the older suggestion", async () => {
    const { container } = render({
      aiApiCall: vi.fn(async () => JSON.stringify(MERGED)),
      onAIResegment: vi.fn(async () => RESEGMENTED),
    });
    await act(async () => {
      fireEvent.click(suggestButton());
    });
    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    await act(async () => {
      fireEvent.click(acceptAll());
    });

    // Two lines, split at 1.5s — the re-segment. The break suggestion was one
    // merged line.
    expect(lines(container)).toHaveLength(2);
    expect(within(card("r-1")).getByText("00:01.50")).toBeInTheDocument();
  });

  it("falls back to the break suggestion once the re-segment is dismissed", async () => {
    render({
      aiApiCall: vi.fn(async () => JSON.stringify(MERGED)),
      onAIResegment: vi.fn(async () => RESEGMENTED),
    });
    await act(async () => {
      fireEvent.click(suggestButton());
    });
    await act(async () => {
      fireEvent.click(resegmentButton());
    });

    await act(async () => {
      fireEvent.click(rejectAll());
    });

    // Pinned: Reject All clears the re-segment but leaves `suggestedSegments`
    // set, so the older break suggestion is still in the hook. It is not shown —
    // `showDiff` is false — but a later re-open would surface a suggestion the
    // admin already moved past.
    expect(diff()).toBeNull();
  });
});

describe("saving", () => {
  it("reports the edited transcript back to the page", async () => {
    const { onSave, container } = render();

    editFirstLine(container, "شلونكم");

    // Debounced, because this fires on every keystroke of an Arabic sentence.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls.at(-1)![0][0].text).toBe("شلونكم");
  });
});
