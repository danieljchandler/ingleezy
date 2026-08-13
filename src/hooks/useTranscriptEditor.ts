import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';
import { splitSegment, mergeSegments, splitSegmentAtCursor } from '@/lib/transcriptOps';
import { useUndoStack } from './useUndoStack';

const DEFAULT_DEBOUNCE_MS = 800;

/**
 * Core state management for the transcript editor.
 * Handles split, merge, text edit, and timestamp changes
 * with debounced persistence and undo support.
 */
export function useTranscriptEditor(
  initialSegments: Segment[],
  onSave?: (segments: Segment[]) => void,
  debounceMs = DEFAULT_DEBOUNCE_MS,
) {
  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [staleTranslations, setStaleTranslations] = useState<Set<string>>(new Set());
  const { push, undo, redo, canUndo, canRedo } = useUndoStack();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Sync with prop changes
  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

  // Clean up the debounced save timer on unmount to prevent firing after
  // the component has been destroyed.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const debounceSave = useCallback(
    (segs: Segment[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onSave?.(segs);
      }, debounceMs);
    },
    [onSave],
  );

  /** Split a segment at a word boundary. */
  const split = useCallback(
    (segmentId: string, splitAfterWordIndex: number) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const original = prev[idx];
        const [a, b] = splitSegment(original, splitAfterWordIndex);
        push({ type: 'SplitOp', originalSegment: original, resultSegments: [a, b] });

        const next = [...prev.slice(0, idx), a, b, ...prev.slice(idx + 1)];
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /** Merge segment at `index` with segment at `index + 1`. */
  const merge = useCallback(
    (index: number) => {
      setSegments(prev => {
        if (index < 0 || index >= prev.length - 1) return prev;

        const a = prev[index];
        const b = prev[index + 1];
        const merged = mergeSegments(a, b);
        push({ type: 'MergeOp', originalSegments: [a, b], resultSegment: merged });

        const next = [...prev.slice(0, index), merged, ...prev.slice(index + 2)];
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /** Update the Arabic text of a segment. */
  const editText = useCallback(
    (segmentId: string, newText: string) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const old = prev[idx];
        push({ type: 'EditTextOp', segmentId, previousText: old.text, newText });

        const updated = { ...old, text: newText };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];

        setStaleTranslations(s => new Set(s).add(segmentId));
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /** Update the English translation of a segment. */
  const editTranslation = useCallback(
    (segmentId: string, newTranslation: string) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;
        const old = prev[idx];
        if (old.translation === newTranslation) return prev;
        const updated = { ...old, translation: newTranslation };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
        // Manual edit means translation is no longer "stale" relative to Arabic
        setStaleTranslations(s => {
          const n = new Set(s);
          n.delete(segmentId);
          return n;
        });
        debounceSave(next);
        return next;
      });
    },
    [debounceSave],
  );

  /** Shift a timestamp (start or end) on a segment. */
  const shiftTimestamp = useCallback(
    (segmentId: string, field: 'start' | 'end', newValue: number) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const old = prev[idx];
        push({ type: 'ShiftTimestampOp', segmentId, field, previousValue: old[field], newValue });

        const updated = { ...old, [field]: newValue };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /**
   * Shift a timestamp and ripple to neighboring segments if needed.
   * When extending segment[i]'s end past segment[i+1]'s start, pushes
   * segment[i+1].start forward (cascading right). When pulling segment[i]'s
   * start before segment[i-1]'s end, pushes segment[i-1].end backward
   * (cascading left). All changes are recorded in a single RippleTimestampOp
   * so undo reverses the entire cascade atomically.
   */
  const shiftTimestampRipple = useCallback(
    (segmentId: string, field: 'start' | 'end', newValue: number) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const next = prev.map(s => ({ ...s }));
        const changes: Array<{ segmentId: string; field: 'start' | 'end'; previousValue: number; newValue: number }> = [];

        const record = (i: number, f: 'start' | 'end', oldVal: number, newVal: number) => {
          changes.push({ segmentId: next[i].id, field: f, previousValue: oldVal, newValue: newVal });
          next[i] = { ...next[i], [f]: newVal };
        };

        record(idx, field, prev[idx][field], newValue);

        if (field === 'end') {
          // Ripple right: push subsequent segments' starts if they overlap.
          for (let i = idx + 1; i < next.length; i++) {
            if (next[i].start < next[i - 1].end) {
              const oldStart = next[i].start;
              record(i, 'start', oldStart, Math.round(next[i - 1].end * 1000) / 1000);
            } else {
              break;
            }
          }
        } else {
          // Ripple left: push preceding segments' ends if they overlap.
          for (let i = idx - 1; i >= 0; i--) {
            if (next[i].end > next[i + 1].start) {
              const oldEnd = next[i].end;
              record(i, 'end', oldEnd, Math.round(next[i + 1].start * 1000) / 1000);
            } else {
              break;
            }
          }
        }

        push({ type: 'RippleTimestampOp', changes });
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /**
   * Split a segment at a cursor position within the edited text.
   * Uses word-level timing when possible; falls back to interpolation.
   */
  const splitAtCursor = useCallback(
    (segmentId: string, cursorPos: number, currentText: string) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const original = prev[idx];
        const [a, b] = splitSegmentAtCursor(original, cursorPos, currentText);
        push({ type: 'SplitOp', originalSegment: original, resultSegments: [a, b] });

        const next = [...prev.slice(0, idx), a, b, ...prev.slice(idx + 1)];
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /** Replace Arabic text via AI (records as AIReplaceOp). */
  const aiReplace = useCallback(
    (segmentId: string, newText: string) => {
      setSegments(prev => {
        const idx = prev.findIndex(s => s.id === segmentId);
        if (idx === -1) return prev;

        const old = prev[idx];
        push({ type: 'AIReplaceOp', segmentId, previousText: old.text, newText });

        const updated = { ...old, text: newText };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];

        setStaleTranslations(s => new Set(s).add(segmentId));
        debounceSave(next);
        return next;
      });
    },
    [push, debounceSave],
  );

  /** Replace all segments at once (e.g. after AI suggest-breaks). */
  const replaceAll = useCallback(
    (newSegments: Segment[]) => {
      setSegments(newSegments);
      debounceSave(newSegments);
    },
    [debounceSave],
  );

  /** Mark a translation as fresh after re-translating. */
  const markTranslationFresh = useCallback((segmentId: string) => {
    setStaleTranslations(prev => {
      const next = new Set(prev);
      next.delete(segmentId);
      return next;
    });
  }, []);

  /** Apply undo — reverse the last operation. */
  const handleUndo = useCallback(() => {
    const op = undo();
    if (!op) return;

    setSegments(prev => {
      switch (op.type) {
        case 'SplitOp': {
          const idx = prev.findIndex(s => s.id === op.resultSegments[0].id);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), op.originalSegment, ...prev.slice(idx + 2)];
        }
        case 'MergeOp': {
          const idx = prev.findIndex(s => s.id === op.resultSegment.id);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), ...op.originalSegments, ...prev.slice(idx + 1)];
        }
        case 'EditTextOp':
        case 'AIReplaceOp': {
          const idx = prev.findIndex(s => s.id === op.segmentId);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], text: op.previousText }, ...prev.slice(idx + 1)];
        }
        case 'ShiftTimestampOp': {
          const idx = prev.findIndex(s => s.id === op.segmentId);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], [op.field]: op.previousValue }, ...prev.slice(idx + 1)];
        }
        case 'RippleTimestampOp': {
          return prev.map(seg => {
            const change = op.changes.find(c => c.segmentId === seg.id);
            return change ? { ...seg, [change.field]: change.previousValue } : seg;
          });
        }
        default:
          return prev;
      }
    });
  }, [undo]);

  /** Apply redo — reapply the last undone operation. */
  const handleRedo = useCallback(() => {
    const op = redo();
    if (!op) return;

    setSegments(prev => {
      switch (op.type) {
        case 'SplitOp': {
          const idx = prev.findIndex(s => s.id === op.originalSegment.id);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), ...op.resultSegments, ...prev.slice(idx + 1)];
        }
        case 'MergeOp': {
          const idx = prev.findIndex(s => s.id === op.originalSegments[0].id);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), op.resultSegment, ...prev.slice(idx + 2)];
        }
        case 'EditTextOp':
        case 'AIReplaceOp': {
          const idx = prev.findIndex(s => s.id === op.segmentId);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], text: op.newText }, ...prev.slice(idx + 1)];
        }
        case 'ShiftTimestampOp': {
          const idx = prev.findIndex(s => s.id === op.segmentId);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), { ...prev[idx], [op.field]: op.newValue }, ...prev.slice(idx + 1)];
        }
        case 'RippleTimestampOp': {
          return prev.map(seg => {
            const change = op.changes.find(c => c.segmentId === seg.id);
            return change ? { ...seg, [change.field]: change.newValue } : seg;
          });
        }
        default:
          return prev;
      }
    });
  }, [redo]);

  return {
    segments,
    staleTranslations,
    split,
    merge,
    editText,
    editTranslation,
    shiftTimestamp,
    shiftTimestampRipple,
    splitAtCursor,
    aiReplace,
    replaceAll,
    markTranslationFresh,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  };
}
