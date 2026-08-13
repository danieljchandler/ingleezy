import { useCallback, useRef, useState } from 'react';
import type { UndoOperation } from '@/types/transcript';

const MAX_UNDO = 50;

/**
 * Client-side undo/redo stack.
 * Keeps up to 50 operations and supports Cmd+Z / Cmd+Shift+Z.
 */
export function useUndoStack() {
  const [undoStack, setUndoStack] = useState<UndoOperation[]>([]);
  const [redoStack, setRedoStack] = useState<UndoOperation[]>([]);
  const undoRef = useRef(undoStack);
  const redoRef = useRef(redoStack);
  undoRef.current = undoStack;
  redoRef.current = redoStack;

  const push = useCallback((op: UndoOperation) => {
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), op]);
    setRedoStack([]);
  }, []);

  const undo = useCallback((): UndoOperation | null => {
    const stack = undoRef.current;
    if (stack.length === 0) return null;
    const op = stack[stack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, op]);
    return op;
  }, []);

  const redo = useCallback((): UndoOperation | null => {
    const stack = redoRef.current;
    if (stack.length === 0) return null;
    const op = stack[stack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, op]);
    return op;
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
