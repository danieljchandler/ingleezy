import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptEditor } from "./useTranscriptEditor";
import type { Segment } from "@/types/transcript";

/**
 * The editing model behind the transcript screen.
 *
 * Correcting machine transcription of dialect Arabic is slow, detailed work —
 * splitting a run-on line at the right word, nudging a timestamp by a tenth of
 * a second, retyping a particle the recogniser turned into its MSA cousin. An
 * editor doing that for an hour needs two things above all: nothing is lost if
 * they close the tab, and every action is reversible.
 *
 * Hence the debounce (a save per keystroke would be a request per keystroke)
 * and the undo stack, which records the inverse of each operation rather than
 * snapshotting the whole transcript.
 *
 * The third thing is the staleness set. Editing the Arabic invalidates the
 * English under it, and an editor who does not notice ships a subtitle whose
 * translation describes the sentence that used to be there.
 */

const aWord = (word: string, start: number, end: number) => ({
  word,
  start,
  end,
  confidence: 0.9,
});

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "seg-1",
  video_id: "vid-1",
  start: 0,
  end: 2,
  text: "شلونك اليوم",
  translation: "how are you today",
  confidence: 0.9,
  words: [aWord("شلونك", 0, 1), aWord("اليوم", 1, 2)],
  ...over,
});

const THREE: Segment[] = [
  aSegment({ id: "a", start: 0, end: 2, words: [aWord("شلونك", 0, 1), aWord("اليوم", 1, 2)] }),
  aSegment({ id: "b", start: 2, end: 4, text: "زين", words: [aWord("زين", 2, 4)] }),
  aSegment({ id: "c", start: 4, end: 6, text: "الحمدلله", words: [aWord("الحمدلله", 4, 6)] }),
];

/**
 * A pair with no gap between them, for the rounding case.
 *
 * Hoisted to a constant rather than built inline in the test, because the hook
 * re-syncs from `initialSegments` on every identity change — a fresh array per
 * render would set state, re-render, and build another fresh array forever.
 */
const TWO_ADJACENT: Segment[] = [
  aSegment({ id: "a", start: 0, end: 1 }),
  aSegment({ id: "b", start: 1, end: 3 }),
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the debounce elapse. */
const settle = (ms = 800) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("holding the transcript", () => {
  it("starts from the segments it was given", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    expect(result.current.segments.map((segment) => segment.id)).toEqual(["a", "b", "c"]);
  });

  it("adopts a transcript that arrives later", () => {
    const { result, rerender } = renderHook(({ segs }) => useTranscriptEditor(segs), {
      initialProps: { segs: [] as Segment[] },
    });

    rerender({ segs: THREE });

    // The transcript is fetched, so the editor mounts before it exists.
    expect(result.current.segments).toHaveLength(3);
  });
});

describe("saving", () => {
  it("waits for the editor to stop typing", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useTranscriptEditor(THREE, onSave));

    act(() => {
      result.current.editText("a", "شلونك");
    });

    // A save per keystroke is a request per keystroke on a screen where an
    // editor types for an hour.
    expect(onSave).not.toHaveBeenCalled();
    settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of edits into one save", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useTranscriptEditor(THREE, onSave));

    act(() => {
      result.current.editText("a", "ش");
      result.current.editText("a", "شل");
      result.current.editText("a", "شلونك");
    });
    settle();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0][0].text).toBe("شلونك");
  });

  it("honours a caller's own debounce", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useTranscriptEditor(THREE, onSave, 2000));

    act(() => {
      result.current.editText("a", "شلونك");
    });
    settle(800);
    expect(onSave).not.toHaveBeenCalled();

    settle(1200);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not fire after the editor has closed", () => {
    const onSave = vi.fn();
    const { result, unmount } = renderHook(() => useTranscriptEditor(THREE, onSave));
    act(() => {
      result.current.editText("a", "شلونك");
    });

    unmount();
    settle();

    // A save landing after the screen is gone would write from a component that
    // no longer knows what the editor did next.
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("splitting and merging", () => {
  it("splits a line at a word boundary", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.split("a", 0);
    });

    // Two lines where there was one, in place — the rest of the transcript must
    // keep its order.
    expect(result.current.segments).toHaveLength(4);
    expect(result.current.segments[2].id).toBe("b");
  });

  it("merges a line with the one after it", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.merge(0);
    });

    expect(result.current.segments).toHaveLength(2);
    expect(result.current.segments[0].text).toContain("زين");
  });

  it("refuses to merge the last line with nothing", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.merge(2);
      result.current.merge(-1);
    });

    expect(result.current.segments).toHaveLength(3);
  });

  it("ignores an operation on a line that is not there", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.split("gone", 0);
      result.current.editText("gone", "x");
      result.current.shiftTimestamp("gone", "end", 9);
    });

    // Segments are merged and split constantly, so a stale id from a render a
    // moment ago is ordinary rather than exceptional.
    expect(result.current.segments).toEqual(THREE);
  });

  it("splits at the cursor inside the edited text", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.splitAtCursor("a", 5, "شلونك اليوم");
    });

    // The editor is typing when they decide a line is two lines; making them
    // find the word index first would break the flow.
    expect(result.current.segments).toHaveLength(4);
  });
});

describe("keeping the translation honest", () => {
  it("marks the English stale when the Arabic changes", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.editText("a", "شخبارك اليوم");
    });

    // Nothing else would tell the editor that the English underneath now
    // describes a sentence that is no longer there.
    expect(result.current.staleTranslations.has("a")).toBe(true);
  });

  it("marks it stale when AI rewrites the Arabic", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.aiReplace("a", "شخبارك اليوم");
    });

    expect(result.current.staleTranslations.has("a")).toBe(true);
  });

  it("clears the mark when the editor rewrites the English", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.editText("a", "شخبارك اليوم");
    });

    act(() => {
      result.current.editTranslation("a", "how's it going today");
    });

    // A human writing the translation is the strongest possible resolution of
    // the mismatch.
    expect(result.current.staleTranslations.has("a")).toBe(false);
  });

  it("clears the mark when a re-translation lands", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.editText("a", "شخبارك اليوم");
    });

    act(() => {
      result.current.markTranslationFresh("a");
    });

    expect(result.current.staleTranslations.has("a")).toBe(false);
  });

  it("ignores a translation edit that changes nothing", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useTranscriptEditor(THREE, onSave));

    act(() => {
      result.current.editText("a", "شخبارك اليوم");
    });
    act(() => {
      result.current.editTranslation("a", THREE[0].translation);
    });
    settle();

    // One save for the Arabic edit, none for the no-op. A blur event fires on
    // every field an editor tabs through; saving on those would be a write per
    // line visited.
    expect(onSave).toHaveBeenCalledTimes(1);

    // Pinned. The early return skips the staleness clear as well as the save,
    // so an editor who re-reads the English, decides it still fits and leaves
    // it unchanged is not believed: the line stays flagged as needing a
    // translation it already has.
    expect(result.current.staleTranslations.has("a")).toBe(true);
  });
});

describe("moving a timestamp", () => {
  it("shifts one edge on its own", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.shiftTimestamp("a", "end", 1.5);
    });

    expect(result.current.segments[0].end).toBe(1.5);
    expect(result.current.segments[1].start).toBe(2);
  });

  it("pushes the following lines out of the way", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.shiftTimestampRipple("a", "end", 5);
    });

    // Overlapping subtitles render on top of each other, so extending a line
    // past the next one moves that one out of the way.
    expect(result.current.segments[1].start).toBe(5);

    // Pinned. It moves the neighbour's `start` and never its `end`, so the
    // segment is left inverted — starting at 5 and ending at 4, a subtitle of
    // negative duration that will never display. The cascade then stops,
    // because the next comparison reads that untouched `end`: the third line
    // keeps its original timing and the transcript is silently broken in the
    // middle rather than shifted.
    expect(result.current.segments[1].end).toBe(4);
    expect(result.current.segments[2].start).toBe(4);
  });

  it("stops rippling as soon as there is room", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.shiftTimestampRipple("a", "end", 2.5);
    });

    // Only the neighbour that actually overlapped moves; cascading further
    // would rewrite timings the editor had already set deliberately.
    expect(result.current.segments[1].start).toBe(2.5);
    expect(result.current.segments[2].start).toBe(4);
  });

  it("pulls the preceding lines back", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.shiftTimestampRipple("c", "start", 1);
    });

    expect(result.current.segments[1].end).toBe(1);
    // Same inversion in the other direction: the neighbour now ends before it
    // starts, and the cascade halts against its unchanged `start`.
    expect(result.current.segments[1].start).toBe(2);
    expect(result.current.segments[0].end).toBe(2);
  });

  it("keeps the cascade to millisecond precision", () => {
    const { result } = renderHook(() => useTranscriptEditor(TWO_ADJACENT));

    act(() => {
      result.current.shiftTimestampRipple("a", "end", 2.123456789);
    });

    // Subtitle timings are milliseconds; a float tail would serialise into the
    // database and back out as a slightly different number every round trip.
    expect(result.current.segments[1].start).toBe(2.123);
  });
});

describe("undo and redo", () => {
  it("has nothing to undo before anything happens", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("puts a split back together", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.split("a", 0);
    });

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.segments.map((segment) => segment.id)).toEqual(["a", "b", "c"]);
    expect(result.current.canRedo).toBe(true);
  });

  it("splits a merge back apart", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.merge(0);
    });

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.segments.map((segment) => segment.id)).toEqual(["a", "b", "c"]);
  });

  it("restores the text an edit replaced", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.editText("a", "شخبارك");
    });

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.segments[0].text).toBe("شلونك اليوم");
  });

  it("restores the text an AI rewrite replaced", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.aiReplace("a", "شخبارك");
    });

    act(() => {
      result.current.handleUndo();
    });

    // The commonest reason to undo on this screen: the model's suggestion read
    // worse than what the recogniser heard.
    expect(result.current.segments[0].text).toBe("شلونك اليوم");
  });

  it("puts a moved timestamp back", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.shiftTimestamp("a", "end", 1.5);
    });

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.segments[0].end).toBe(2);
  });

  it("reverses a whole cascade in one step", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.shiftTimestampRipple("a", "end", 5);
    });

    act(() => {
      result.current.handleUndo();
    });

    // The cascade is one action as far as the editor is concerned. Undoing it a
    // segment at a time would leave the transcript in states they never chose.
    expect(result.current.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });

  it("reapplies what was undone", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.editText("a", "شخبارك");
    });
    act(() => {
      result.current.handleUndo();
    });

    act(() => {
      result.current.handleRedo();
    });

    expect(result.current.segments[0].text).toBe("شخبارك");
  });

  it("reapplies a cascade in one step", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.shiftTimestampRipple("a", "end", 5);
    });
    act(() => {
      result.current.handleUndo();
    });

    act(() => {
      result.current.handleRedo();
    });

    expect(result.current.segments[1].start).toBe(5);
    expect(result.current.segments[2].start).toBe(4);
  });

  it("walks back through several operations", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));
    act(() => {
      result.current.editText("a", "one");
    });
    act(() => {
      result.current.editText("b", "two");
    });

    // One `act` each: the stack pointer is state, so two calls in the same
    // batch would both pop the same operation.
    act(() => {
      result.current.handleUndo();
    });
    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.segments[0].text).toBe("شلونك اليوم");
    expect(result.current.segments[1].text).toBe("زين");
    expect(result.current.canUndo).toBe(false);
  });

  it("is harmless when there is nothing left to undo", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    expect(() =>
      act(() => {
        result.current.handleUndo();
        result.current.handleRedo();
      }),
    ).not.toThrow();
  });
});

describe("applying an AI restructure", () => {
  it("replaces the whole transcript and saves it", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useTranscriptEditor(THREE, onSave));
    const restructured = [aSegment({ id: "new" })];

    act(() => {
      result.current.replaceAll(restructured);
    });
    settle();

    expect(result.current.segments.map((segment) => segment.id)).toEqual(["new"]);
    expect(onSave).toHaveBeenCalledWith(restructured);
  });

  it("cannot be undone", () => {
    const { result } = renderHook(() => useTranscriptEditor(THREE));

    act(() => {
      result.current.replaceAll([aSegment({ id: "new" })]);
    });

    // Pinned. `replaceAll` is the only mutation that records nothing on the
    // undo stack, and it is the most destructive one: applying the AI's
    // suggested breaks discards every split, merge and retimed boundary the
    // editor made, with Ctrl-Z doing nothing. Worse, an undo afterwards
    // reverses an operation from *before* the replacement against segments that
    // no longer exist.
    expect(result.current.canUndo).toBe(false);
  });
});
