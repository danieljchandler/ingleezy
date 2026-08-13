import { useCallback, useState } from 'react';
import type { Segment } from '@/types/transcript';
import { cn } from '@/lib/utils';
import WordConfidence from './WordConfidence';
import TimestampScrubber from './TimestampScrubber';
import { AskAISentence } from '@/components/shared/AskAISentence';

interface SegmentCardProps {
  segment: Segment;
  index: number;
  isActive?: boolean;
  activeWordIndex?: number;
  isStaleTranslation?: boolean;
  prevSegmentEnd?: number;
  nextSegmentStart?: number;
  onSplit: (segmentId: string, splitAfterWordIndex: number) => void;
  onSplitAtCursor: (segmentId: string, cursorPos: number, currentText: string) => void;
  onEditText: (segmentId: string, newText: string) => void;
  onEditTranslation: (segmentId: string, newTranslation: string) => void;
  onStartChange: (segmentId: string, value: number) => void;
  onEndChange: (segmentId: string, value: number) => void;
  onFixArabic?: (segmentId: string) => void;
  onRetranslate?: (segmentId: string) => void;
  onSeek?: (segmentId: string) => void;
}

function confidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.85) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (confidence >= 0.65) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
}

/**
 * Renders a single transcript segment with:
 * - RTL Arabic text with per-word confidence coloring
 * - Inline editing via contentEditable
 * - Confidence badge
 * - Timestamp scrubber with ripple support
 * - Split (✂) on word boundary hover
 * - Enter key in edit mode to split at cursor position
 * - AI Fix Arabic and Re-translate buttons
 */
export default function SegmentCard({
  segment,
  index,
  isActive = false,
  activeWordIndex = -1,
  isStaleTranslation = false,
  prevSegmentEnd,
  nextSegmentStart,
  onSplit,
  onSplitAtCursor,
  onEditText,
  onEditTranslation,
  onStartChange,
  onEndChange,
  onFixArabic,
  onRetranslate,
  onSeek,
}: SegmentCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(segment.text);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [translationValue, setTranslationValue] = useState(segment.translation);
  const [hoveredBoundary, setHoveredBoundary] = useState<number | null>(null);

  const handleWordClick = useCallback(
    (wordIndex: number) => {
      if (editing) return;
      // Enter edit mode. This used to guess at a split by checking whether that
      // boundary happened to be hovered, because the scissors reported itself
      // through this same callback with the same index — which misread a click
      // on a word whose own boundary was under the pointer. WordConfidence now
      // reports the two separately.
      void wordIndex;
      setEditValue(segment.text);
      setEditing(true);
    },
    [editing, segment.text],
  );

  const handleSplitAt = useCallback(
    (wordIndex: number) => {
      if (editing) return;
      onSplit(segment.id, wordIndex);
    },
    [editing, onSplit, segment.id],
  );

  const handleEditDone = useCallback(() => {
    setEditing(false);
    if (editValue.trim() !== segment.text) {
      onEditText(segment.id, editValue.trim());
    }
  }, [editValue, onEditText, segment.id, segment.text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Plain Enter = split segment at cursor position
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const cursorPos = e.currentTarget.selectionStart ?? 0;
        const textBefore = editValue.slice(0, cursorPos).trim();
        const textAfter = editValue.slice(cursorPos).trim();
        if (textBefore && textAfter) {
          setEditing(false);
          onSplitAtCursor(segment.id, cursorPos, editValue);
        }
        return;
      }
      // Cmd/Ctrl+Enter to commit edit
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleEditDone();
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        setEditing(false);
        setEditValue(segment.text);
      }
    },
    [handleEditDone, segment.id, segment.text, editValue, onSplitAtCursor],
  );

  return (
    <div
      data-segment-id={segment.id}
      className={cn(
        'rounded-lg border p-3 transition-all',
        isActive
          ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
          <span
            className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', confidenceBadgeColor(segment.confidence))}
          >
            {(segment.confidence * 100).toFixed(0)}%
          </span>
          {segment.speaker && (
            <span className="text-[10px] text-muted-foreground">{segment.speaker}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {segment.text && (
            <AskAISentence
              arabic={segment.text}
              english={segment.translation}
              variant="chip"
              className="h-6 px-2 text-[10px]"
            />
          )}
          {onFixArabic && segment.confidence < 0.85 && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 transition-colors"
              onClick={() => onFixArabic(segment.id)}
              title="AI Fix Arabic"
            >
              Fix Arabic
            </button>
          )}
          {onRetranslate && isStaleTranslation && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-purple-100 hover:bg-purple-200 text-purple-800 transition-colors"
              onClick={() => onRetranslate(segment.id)}
              title="Re-translate"
            >
              Re-translate
            </button>
          )}
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
            onClick={() => onSeek?.(segment.id)}
            title="Seek video to this segment"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Arabic text (RTL) */}
      {editing ? (
        <div>
          <textarea
            dir="rtl"
            className="w-full text-right font-cairo text-base rounded border border-blue-400 p-1.5 bg-white dark:bg-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleEditDone}
            onKeyDown={handleKeyDown}
            rows={2}
            autoFocus
          />
          <p className="text-[9px] text-muted-foreground mt-0.5">
            Enter — split here &nbsp;·&nbsp; ⌘Enter — save &nbsp;·&nbsp; Esc — cancel
          </p>
        </div>
      ) : (
        <div className="min-h-[2em]">
          <WordConfidence
            words={segment.words}
            activeWordIndex={activeWordIndex}
            onWordClick={handleWordClick}
            onSplitAt={handleSplitAt}
            onWordBoundaryHover={setHoveredBoundary}
            hoveredBoundary={hoveredBoundary}
          />
        </div>
      )}

      {/* Translation (click to edit) */}
      <div className="mt-1 text-sm text-muted-foreground flex items-start gap-1">
        {isStaleTranslation && (
          <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Translation may be stale" />
        )}
        {editingTranslation ? (
          <textarea
            dir="ltr"
            className="flex-1 text-left text-sm rounded border border-blue-400 p-1.5 bg-white dark:bg-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-foreground"
            value={translationValue}
            onChange={e => setTranslationValue(e.target.value)}
            onBlur={() => {
              setEditingTranslation(false);
              const next = translationValue.trim();
              if (next !== (segment.translation ?? '')) {
                onEditTranslation(segment.id, next);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setTranslationValue(segment.translation);
                setEditingTranslation(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                (e.currentTarget as HTMLTextAreaElement).blur();
              }
            }}
            rows={2}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="flex-1 text-left cursor-text hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 transition-colors"
            onClick={() => {
              setTranslationValue(segment.translation ?? '');
              setEditingTranslation(true);
            }}
            title="Click to edit translation"
          >
            {segment.translation || <em aria-label="Missing translation">(no translation — click to add)</em>}
          </button>
        )}
      </div>

      {/* Timestamp scrubber with ripple enabled */}
      <TimestampScrubber
        start={segment.start}
        end={segment.end}
        minStart={prevSegmentEnd ?? 0}
        maxEnd={nextSegmentStart}
        allowRipple
        onStartChange={v => onStartChange(segment.id, v)}
        onEndChange={v => onEndChange(segment.id, v)}
      />
    </div>
  );
}
