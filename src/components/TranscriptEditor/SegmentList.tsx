import { useEffect, useRef } from 'react';
import type { Segment } from '@/types/transcript';
import { cn } from '@/lib/utils';
import SegmentCard from './SegmentCard';

interface SegmentListProps {
  segments: Segment[];
  activeSegmentId?: string | null;
  activeWordIndex?: number;
  staleTranslations: Set<string>;
  onSplit: (segmentId: string, splitAfterWordIndex: number) => void;
  onSplitAtCursor: (segmentId: string, cursorPos: number, currentText: string) => void;
  onMerge: (index: number) => void;
  onEditText: (segmentId: string, newText: string) => void;
  onEditTranslation: (segmentId: string, newTranslation: string) => void;
  onStartChange: (segmentId: string, value: number) => void;
  onEndChange: (segmentId: string, value: number) => void;
  onFixArabic?: (segmentId: string) => void;
  onRetranslate?: (segmentId: string) => void;
  onSeek?: (segmentId: string) => void;
}

/**
 * Scrollable list of SegmentCards with always-visible gap indicators and merge
 * buttons between segments. Active segment auto-scrolls into view.
 */
export default function SegmentList({
  segments,
  activeSegmentId,
  activeWordIndex,
  staleTranslations,
  onSplit,
  onSplitAtCursor,
  onMerge,
  onEditText,
  onEditTranslation,
  onStartChange,
  onEndChange,
  onFixArabic,
  onRetranslate,
  onSeek,
}: SegmentListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active segment into view
  useEffect(() => {
    if (!activeSegmentId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-segment-id="${activeSegmentId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeSegmentId]);

  return (
    <div ref={listRef} className="space-y-0.5 overflow-y-auto">
      {segments.map((seg, i) => (
        <div key={seg.id}>
          <SegmentCard
            segment={seg}
            index={i}
            isActive={seg.id === activeSegmentId}
            activeWordIndex={seg.id === activeSegmentId ? activeWordIndex : -1}
            isStaleTranslation={staleTranslations.has(seg.id)}
            prevSegmentEnd={i > 0 ? segments[i - 1].end : undefined}
            nextSegmentStart={i < segments.length - 1 ? segments[i + 1].start : undefined}
            onSplit={onSplit}
            onSplitAtCursor={onSplitAtCursor}
            onEditText={onEditText}
            onEditTranslation={onEditTranslation}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
            onFixArabic={onFixArabic}
            onRetranslate={onRetranslate}
            onSeek={onSeek}
          />

          {/* Between-segment divider: gap indicator + merge button */}
          {i < segments.length - 1 && (() => {
            const gap = segments[i + 1].start - seg.end;
            // Half a millisecond, not zero. Timestamps here are seconds derived
            // by dividing milliseconds, by summing word durations, or by a
            // drag, so two lines meant to touch routinely differ by ~1e-16 in
            // whichever direction. An exact `gap < 0` turned the divider red
            // whenever the sign happened to land negative and announced
            // "⚠ overlap 0.00s" — an alarm about a defect whose own reported
            // size is zero. A transcript from the AI re-segmentation path is
            // full of these, because that path rebuilds every boundary by
            // summing word timings.
            const isOverlap = gap < -0.0005;
            const isLargeGap = gap > 2;
            // Clamped so noise below the epsilon reads as "gap 0.00s" rather
            // than "gap -0.00s": toFixed keeps the sign of a negative zero.
            const gapLabel = isOverlap
              ? `⚠ overlap ${Math.abs(gap).toFixed(2)}s`
              : `gap ${Math.max(gap, 0).toFixed(2)}s${isLargeGap ? ' ⚠' : ''}`;

            return (
              <div className="flex items-center gap-2 py-1 px-1 group/divider">
                <div
                  className={cn(
                    'flex-1 h-px',
                    isOverlap ? 'bg-red-300 dark:bg-red-700' : isLargeGap ? 'bg-amber-300 dark:bg-amber-700' : 'bg-gray-200 dark:bg-gray-700',
                  )}
                />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={cn(
                      'text-[9px] font-mono tabular-nums',
                      isOverlap ? 'text-red-600 dark:text-red-400' : isLargeGap ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70',
                    )}
                  >
                    {gapLabel}
                  </span>
                  <button
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                    onClick={() => onMerge(i)}
                    title={`Merge segments ${i + 1} and ${i + 2}`}
                  >
                    Merge ↕
                  </button>
                </div>
                <div
                  className={cn(
                    'flex-1 h-px',
                    isOverlap ? 'bg-red-300 dark:bg-red-700' : isLargeGap ? 'bg-amber-300 dark:bg-amber-700' : 'bg-gray-200 dark:bg-gray-700',
                  )}
                />
              </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
