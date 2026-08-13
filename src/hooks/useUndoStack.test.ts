import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUndoStack } from "./useUndoStack";
import type { UndoOperation } from "@/types/transcript";

/**
 * The undo stack behind the transcript editor.
 *
 * An admin correcting a machine transcript makes hundreds of small edits in a
 * sitting — splitting lines, retyping words, nudging timestamps — and this is
 * the only way back from any of them. The stack is what makes that editor safe
 * to work quickly in.
 *
 * Two properties carry the weight. Pushing a new operation clears the redo
 * stack, because redoing after diverging would replay an edit against text it
 * was never made on. And the stack is bounded, because these operations hold
 * whole line objects and an unbounded one grows without limit over a long
 * session.
 */

/** A real edit operation, tagged by the segment it touched. */
const anOp = (segmentId: string): UndoOperation => ({
  type: "EditTextOp",
  segmentId,
  previousText: "before",
  newText: "after",
});

/** The segment id of an operation the stack handed back. */
const idOf = (op: UndoOperation | null): string | null =>
  op && "segmentId" in op ? op.segmentId : null;

describe("an empty stack", () => {
  it("offers neither direction", () => {
    const { result } = renderHook(() => useUndoStack());

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("returns null rather than throwing", () => {
    const { result } = renderHook(() => useUndoStack());

    // The keyboard shortcut fires whether or not there is anything to undo.
    act(() => {
      expect(result.current.undo()).toBeNull();
      expect(result.current.redo()).toBeNull();
    });
  });
});

describe("undoing", () => {
  it("hands back the most recent operation", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
      result.current.push(anOp("b"));
    });

    let undone: UndoOperation | null = null;
    act(() => {
      undone = result.current.undo();
    });

    expect(idOf(undone)).toBe("b");
  });

  it("walks back through the history one step at a time", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
      result.current.push(anOp("b"));
      result.current.push(anOp("c"));
    });

    const order: string[] = [];
    act(() => {
      order.push(idOf(result.current.undo())!);
    });
    act(() => {
      order.push(idOf(result.current.undo())!);
    });
    act(() => {
      order.push(idOf(result.current.undo())!);
    });

    expect(order).toEqual(["c", "b", "a"]);
  });

  it("reports when there is nothing left to undo", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
    });
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
  });
});

describe("redoing", () => {
  it("becomes available only after an undo", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
    });
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
  });

  it("hands back the operation that was just undone", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
      result.current.push(anOp("b"));
    });
    act(() => {
      result.current.undo();
    });

    let redone: UndoOperation | null = null;
    act(() => {
      redone = result.current.redo();
    });

    expect(idOf(redone)).toBe("b");
  });

  it("round-trips a whole history", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
      result.current.push(anOp("b"));
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.redo();
    });
    act(() => {
      result.current.redo();
    });

    // Back where it started: everything undoable, nothing left to redo.
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("is discarded by a new edit", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      result.current.push(anOp("a"));
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.push(anOp("b"));
    });

    // The history has forked. Redoing "a" now would replay an edit against
    // text it was never made on.
    expect(result.current.canRedo).toBe(false);
  });
});

describe("the size limit", () => {
  it("keeps the fifty most recent operations", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      for (let i = 0; i < 60; i++) result.current.push(anOp(`op-${i}`));
    });

    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      act(() => {
        const id = idOf(result.current.undo());
        if (id) seen.push(id);
      });
    }

    // Each operation holds whole line objects; unbounded, a long editing
    // session grows without limit.
    expect(seen).toHaveLength(50);
    expect(seen[0]).toBe("op-59");
    expect(seen.at(-1)).toBe("op-10");
  });

  it("drops the oldest rather than refusing the newest", () => {
    const { result } = renderHook(() => useUndoStack());

    act(() => {
      for (let i = 0; i < 55; i++) result.current.push(anOp(`op-${i}`));
    });

    let first: UndoOperation | null = null;
    act(() => {
      first = result.current.undo();
    });

    // The most recent edit is the one most likely to need undoing, so the
    // limit must not lock the stack once it is full.
    expect(idOf(first)).toBe("op-54");
  });
});
