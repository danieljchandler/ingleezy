import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Segment, TranscriptLine, WordToken } from "@/types/transcript";
import { renderWithProviders } from "@/test/support/react/harness";
import { AdminTranscriptEditor } from "./AdminTranscriptEditor";

/**
 * The adapter between the admin transcript data model and the editor's.
 *
 * Two different shapes meet here: admin lines are milliseconds with glossed
 * tokens, the editor's segments are seconds with timed words. Nothing else in
 * the app performs this conversion, and it is lossy in both directions unless
 * the adapter is careful — which is what these cases are about. The editor
 * itself is covered by TranscriptEditor/index.test.tsx; here it is a stub, so
 * the conversion is visible rather than buried under a real editor's state.
 */

const editorProps = vi.hoisted(() => ({
  current: null as null | {
    initialSegments: Segment[];
    videoUrl?: string;
    onSave?: (segments: Segment[]) => void;
    onAIResegment?: (segments: Segment[]) => Promise<Segment[] | null>;
  },
}));

vi.mock("@/components/TranscriptEditor", () => ({
  default: (props: NonNullable<typeof editorProps.current>) => {
    editorProps.current = props;
    return <div data-testid="editor-stub" />;
  },
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast, toasts: [] }) }));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  editorProps.current = null;
  toast.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const token = (over: Partial<WordToken> & { surface: string }): WordToken => ({
  id: `tok-${over.surface}`,
  ...over,
});

const aLine = (over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  id: "line-1",
  arabic: "مرحبا بك",
  translation: "Welcome",
  tokens: [token({ surface: "مرحبا", gloss: "hello" }), token({ surface: "بك", gloss: "to you" })],
  startMs: 1000,
  endMs: 3000,
  ...over,
});

function render(lines: TranscriptLine[] = [aLine()], audioUrl?: string) {
  const onChange = vi.fn();
  const harness = renderWithProviders(
    <AdminTranscriptEditor lines={lines} onChange={onChange} audioUrl={audioUrl} />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onChange };
}

/** The props the adapter handed down, asserted non-null so the tests stay readable. */
function props() {
  const p = editorProps.current;
  if (!p) throw new Error("editor never rendered");
  return p;
}

describe("AdminTranscriptEditor — lines in", () => {
  it("converts milliseconds to the seconds the editor works in", () => {
    render([aLine({ startMs: 1500, endMs: 4250 })]);
    expect(props().initialSegments[0]).toMatchObject({ start: 1.5, end: 4.25 });
  });

  it("carries the line's id, text and translation across unchanged", () => {
    render([aLine({ id: "abc", arabic: "كيف حالك", translation: "How are you" })]);
    expect(props().initialSegments[0]).toMatchObject({
      id: "abc",
      text: "كيف حالك",
      translation: "How are you",
    });
  });

  it("treats a line with no timings as starting at zero", () => {
    render([aLine({ startMs: undefined, endMs: undefined })]);
    expect(props().initialSegments[0]).toMatchObject({ start: 0, end: 0 });
  });

  it("gives every segment full confidence", () => {
    // Admin lines are hand-edited, so there is no ASR score left to carry —
    // anything less would make the editor's low-confidence styling fire on
    // text a human already approved.
    render();
    expect(props().initialSegments[0].confidence).toBe(1);
    expect(props().initialSegments[0].words.every((w) => w.confidence === 1)).toBe(true);
  });

  it("converts every line, in order", () => {
    render([aLine({ id: "a" }), aLine({ id: "b" }), aLine({ id: "c" })]);
    expect(props().initialSegments.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("renders an empty transcript without complaint", () => {
    render([]);
    expect(props().initialSegments).toEqual([]);
  });

  it("passes the audio url down as the player source", () => {
    render([aLine()], "https://cdn.example/clip.mp3");
    expect(props().videoUrl).toBe("https://cdn.example/clip.mp3");
  });

  it("leaves the player unset when there is no audio", () => {
    render();
    expect(props().videoUrl).toBeUndefined();
  });
});

describe("AdminTranscriptEditor — word timings", () => {
  it("spreads the words evenly across the line", () => {
    // Real per-word timings do not exist in the admin model. Even distribution
    // is the stand-in, and it matters: AI re-segmentation rebuilds each
    // segment's start and end from its words, so words all sharing one
    // timestamp would collapse every proposed line to zero length.
    render([
      aLine({
        startMs: 0,
        endMs: 4000,
        tokens: [token({ surface: "a" }), token({ surface: "b" }), token({ surface: "c" })],
      }),
    ]);
    expect(props().initialSegments[0].words).toEqual([
      { word: "a", start: 0, end: 4 / 3, confidence: 1 },
      { word: "b", start: 4 / 3, end: 8 / 3, confidence: 1 },
      { word: "c", start: 8 / 3, end: 4, confidence: 1 },
    ]);
  });

  it("offsets the spread by the line's own start", () => {
    render([
      aLine({ startMs: 10_000, endMs: 12_000, tokens: [token({ surface: "a" }), token({ surface: "b" })] }),
    ]);
    expect(props().initialSegments[0].words.map((w) => w.start)).toEqual([10, 11]);
  });

  it("makes the last word end exactly where the line does", () => {
    render([aLine({ startMs: 1000, endMs: 8000 })]);
    const words = props().initialSegments[0].words;
    expect(words.at(-1)?.end).toBeCloseTo(8, 10);
  });

  it("produces no words for a line with no tokens", () => {
    render([aLine({ tokens: [] })]);
    expect(props().initialSegments[0].words).toEqual([]);
  });

  it("clamps a line whose end precedes its start to zero length", () => {
    // Timestamp editing can invert a line. A negative duration would give
    // every word a start later than its end and put the editor's scrubber into
    // reverse, so the duration floors at zero and the words stack.
    render([aLine({ startMs: 5000, endMs: 2000 })]);
    const words = props().initialSegments[0].words;
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [5, 5],
      [5, 5],
    ]);
  });
});

describe("AdminTranscriptEditor — segments back out", () => {
  const save = (segments: Segment[]) => act(() => props().onSave?.(segments));

  const aSegment = (over: Partial<Segment> = {}): Segment => ({
    id: "line-1",
    video_id: "",
    start: 1,
    end: 3,
    text: "مرحبا بك",
    translation: "Welcome",
    confidence: 1,
    words: [
      { word: "مرحبا", start: 1, end: 2, confidence: 1 },
      { word: "بك", start: 2, end: 3, confidence: 1 },
    ],
    ...over,
  });

  it("converts seconds back to milliseconds", () => {
    const { onChange } = render();
    save([aSegment({ start: 1.5, end: 4.25 })]);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ startMs: 1500, endMs: 4250 });
  });

  it("rounds a fractional millisecond rather than truncating it", () => {
    const { onChange } = render();
    save([aSegment({ start: 1.00049, end: 3.00051 })]);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ startMs: 1000, endMs: 3001 });
  });

  it("maps the segment's text back onto the line's arabic", () => {
    const { onChange } = render();
    save([aSegment({ text: "أهلا", translation: "Hi" })]);
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ arabic: "أهلا", translation: "Hi" });
  });

  it("rebuilds one token per word, in order", () => {
    const { onChange } = render();
    save([aSegment()]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.surface)).toEqual([
      "مرحبا",
      "بك",
    ]);
  });

  it("restores the gloss the incoming line carried", () => {
    // The whole reason for the ref map. The editor's Segment has no room for a
    // gloss, so a round trip through it would erase every one an admin had
    // written if they were not stashed on the way in.
    const { onChange } = render();
    save([aSegment()]);
    expect(onChange.mock.calls[0][0][0].tokens).toEqual([
      expect.objectContaining({ id: "tok-مرحبا", surface: "مرحبا", gloss: "hello" }),
      expect.objectContaining({ id: "tok-بك", surface: "بك", gloss: "to you" }),
    ]);
  });

  it("restores the standard spelling and compound reference too", () => {
    const { onChange } = render([
      aLine({
        tokens: [
          token({ surface: "مرحبا", standard: "مَرْحَبًا", compoundRef: "مرحبا بك" }),
          token({ surface: "بك" }),
        ],
      }),
    ]);
    save([aSegment()]);
    expect(onChange.mock.calls[0][0][0].tokens[0]).toMatchObject({
      standard: "مَرْحَبًا",
      compoundRef: "مرحبا بك",
    });
  });

  it("mints a fresh id for a word that was not in the incoming line", () => {
    const { onChange } = render();
    save([
      aSegment({
        words: [{ word: "جديد", start: 1, end: 3, confidence: 1 }],
      }),
    ]);
    const [tok] = onChange.mock.calls[0][0][0].tokens;
    expect(tok.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tok.gloss).toBeUndefined();
  });

  it("keeps the two glosses apart when the same word appears twice", () => {
    // The map key carries the index for exactly this case: without it the
    // second "في" would overwrite the first and both would read back the same
    // gloss.
    const { onChange } = render([
      aLine({
        tokens: [
          token({ surface: "في", id: "t0", gloss: "in" }),
          token({ surface: "في", id: "t1", gloss: "at" }),
        ],
      }),
    ]);
    save([
      aSegment({
        words: [
          { word: "في", start: 1, end: 2, confidence: 1 },
          { word: "في", start: 2, end: 3, confidence: 1 },
        ],
      }),
    ]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.gloss)).toEqual(["in", "at"]);
  });

  it("keeps the glosses of every word after a deletion", () => {
    // Glosses used to be keyed by position, so deleting one word renumbered
    // the rest and each looked up a key that no longer existed. An admin who
    // fixed a typo in the first word of a ten-word line silently discarded
    // nine hand-written glosses.
    const { onChange } = render([
      aLine({
        tokens: [
          token({ surface: "و", gloss: "and" }),
          token({ surface: "مرحبا", gloss: "hello" }),
          token({ surface: "بك", gloss: "to you" }),
        ],
      }),
    ]);
    save([
      aSegment({
        words: [
          { word: "مرحبا", start: 1, end: 2, confidence: 1 },
          { word: "بك", start: 2, end: 3, confidence: 1 },
        ],
      }),
    ]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.gloss)).toEqual([
      "hello",
      "to you",
    ]);
  });

  it("keeps the ids of the surviving words too", () => {
    // A fresh id would make the token read as brand new downstream, which is
    // how the lost glosses went unnoticed for so long.
    const { onChange } = render([
      aLine({
        tokens: [
          token({ surface: "و", gloss: "and" }),
          token({ surface: "مرحبا", gloss: "hello" }),
          token({ surface: "بك", gloss: "to you" }),
        ],
      }),
    ]);
    save([
      aSegment({
        words: [
          { word: "مرحبا", start: 1, end: 2, confidence: 1 },
          { word: "بك", start: 2, end: 3, confidence: 1 },
        ],
      }),
    ]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.id)).toEqual([
      "tok-مرحبا",
      "tok-بك",
    ]);
  });

  it("keeps the glosses of the words around an insertion", () => {
    const { onChange } = render();
    save([
      aSegment({
        words: [
          { word: "مرحبا", start: 1, end: 2, confidence: 1 },
          { word: "جدا", start: 2, end: 2.5, confidence: 1 },
          { word: "بك", start: 2.5, end: 3, confidence: 1 },
        ],
      }),
    ]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.gloss)).toEqual([
      "hello",
      undefined,
      "to you",
    ]);
  });

  it("keeps the glosses of a segment the editor gave a new id", () => {
    // splitSegment gives one of the two halves a fresh id, so its words have
    // no line of their own to look in and fall back to the transcript's pool.
    const { onChange } = render();
    save([aSegment({ id: "line-1-split-2" })]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.gloss)).toEqual([
      "hello",
      "to you",
    ]);
  });

  it("gives each half of a split its own glosses rather than the same one twice", () => {
    const { onChange } = render();
    save([
      aSegment({
        id: "line-1",
        words: [{ word: "مرحبا", start: 1, end: 2, confidence: 1 }],
      }),
      aSegment({
        id: "line-1-split-2",
        words: [{ word: "بك", start: 2, end: 3, confidence: 1 }],
      }),
    ]);
    const [first, second] = onChange.mock.calls[0][0];
    expect(first.tokens.map((t: WordToken) => t.gloss)).toEqual(["hello"]);
    expect(second.tokens.map((t: WordToken) => t.gloss)).toEqual(["to you"]);
  });

  it("does not hand the same gloss to two occurrences of a word", () => {
    // Each cached token is claimed once, which is what the old positional key
    // was really protecting.
    const { onChange } = render([
      aLine({
        tokens: [
          token({ surface: "في", id: "t0", gloss: "in" }),
          token({ surface: "في", id: "t1", gloss: "at" }),
        ],
      }),
    ]);
    save([
      aSegment({
        id: "renamed",
        words: [
          { word: "في", start: 1, end: 2, confidence: 1 },
          { word: "في", start: 2, end: 3, confidence: 1 },
        ],
      }),
    ]);
    expect(onChange.mock.calls[0][0][0].tokens.map((t: WordToken) => t.gloss)).toEqual(["in", "at"]);
  });

  it("keeps the glosses of a word whose spelling was corrected out of reach", () => {
    // Surface is part of the key, so correcting a spelling detaches the gloss
    // from the word it described. Arguably right — the gloss may no longer
    // apply — but it happens silently either way.
    const { onChange } = render();
    save([
      aSegment({
        words: [
          { word: "مرحباً", start: 1, end: 2, confidence: 1 },
          { word: "بك", start: 2, end: 3, confidence: 1 },
        ],
      }),
    ]);
    const tokens = onChange.mock.calls[0][0][0].tokens as WordToken[];
    expect(tokens[0].gloss).toBeUndefined();
    expect(tokens[1].gloss).toBe("to you");
  });

  it("saves every segment the editor hands back", () => {
    const { onChange } = render([aLine({ id: "a" }), aLine({ id: "b" })]);
    save([aSegment({ id: "a" }), aSegment({ id: "b" })]);
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });
});

describe("AdminTranscriptEditor — AI re-segmentation", () => {
  const segments: Segment[] = [
    {
      id: "line-1",
      video_id: "",
      start: 0,
      end: 3,
      text: "مرحبا بك",
      translation: "Welcome",
      confidence: 1,
      words: [],
    },
  ];

  const proposed: Segment[] = [
    { ...segments[0], id: "new-1", text: "مرحبا" },
    { ...segments[0], id: "new-2", text: "بك" },
  ];

  it("sends the current segments to the re-segmentation function", async () => {
    const { backend } = render();
    backend.stubFunction("ai-resegment-transcript", { segments: proposed });

    await act(async () => {
      await props().onAIResegment?.(segments);
    });

    expect(backend.lastCallTo("ai-resegment-transcript")?.body).toEqual({ segments });
  });

  it("returns the proposal for the editor to preview", async () => {
    const { backend } = render();
    backend.stubFunction("ai-resegment-transcript", { segments: proposed });

    let result: Segment[] | null = null;
    await act(async () => {
      result = (await props().onAIResegment?.(segments)) ?? null;
    });

    expect(result).toEqual(proposed);
  });

  it("says how many lines came back so the admin knows what to review", async () => {
    const { backend } = render();
    backend.stubFunction("ai-resegment-transcript", { segments: proposed });

    await act(async () => {
      await props().onAIResegment?.(segments);
    });

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "AI proposed a new segmentation",
          description: "Review the 2 suggested lines and accept or reject.",
        }),
      ),
    );
  });

  it("refuses an empty proposal rather than wiping the transcript", async () => {
    // Accepting this would replace a hand-edited transcript with nothing, and
    // the editor applies whatever it is handed.
    const { backend } = render();
    backend.stubFunction("ai-resegment-transcript", { segments: [] });

    let result: Segment[] | null | undefined;
    await act(async () => {
      result = await props().onAIResegment?.(segments);
    });

    expect(result).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "AI re-segmentation returned no lines",
        variant: "destructive",
      }),
    );
  });

  it("refuses a response with no segments field at all", async () => {
    const { backend } = render();
    backend.stubFunction("ai-resegment-transcript", { ok: true });

    let result: Segment[] | null | undefined;
    await act(async () => {
      result = await props().onAIResegment?.(segments);
    });

    expect(result).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "AI re-segmentation returned no lines" }),
    );
  });

  it("reports a failed call without throwing into the editor", async () => {
    const { backend } = render();
    backend.stubFunctionFailure("ai-resegment-transcript", 500);

    let result: Segment[] | null | undefined;
    await act(async () => {
      result = await props().onAIResegment?.(segments);
    });

    expect(result).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "AI re-segmentation failed",
        variant: "destructive",
      }),
    );
  });

  it("shows what the function actually said", async () => {
    // supabase-js raises FunctionsHttpError with the fixed message "Edge
    // Function returned a non-2xx status code" for every non-2xx, so a 429
    // over-quota, a 400 bad request and a 500 crash all reached the admin as
    // the same opaque line. The status and body are on `error.context`.
    const { backend } = render();
    backend.stubFunctionFailure("ai-resegment-transcript", 429, {
      error: "rate_limited",
      message: "Too many re-segmentation requests, try again in an hour",
    });

    await act(async () => {
      await props().onAIResegment?.(segments);
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "429: Too many re-segmentation requests, try again in an hour",
      }),
    );
  });

  it("distinguishes one failure from another", async () => {
    const { backend } = render();
    backend.stubFunctionFailure("ai-resegment-transcript", 400, {
      error: "transcript_too_long",
    });

    await act(async () => {
      await props().onAIResegment?.(segments);
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "400: transcript_too_long" }),
    );
  });

  it("falls back to the status when the body says nothing useful", async () => {
    const { backend } = render();
    backend.stubFunctionFailure("ai-resegment-transcript", 500, {});

    await act(async () => {
      await props().onAIResegment?.(segments);
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "The server returned 500." }),
    );
  });
});
