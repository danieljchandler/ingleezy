import { useCallback, useEffect, useRef, useState } from 'react';
import type { Segment } from '@/types/transcript';
import { useTranscriptEditor } from '@/hooks/useTranscriptEditor';
import { useVideoSync } from '@/hooks/useVideoSync';
import { useAIAssist } from '@/hooks/useAIAssist';
import SegmentList from './SegmentList';
import Toolbar from './Toolbar';
import DiffPreview from './DiffPreview';

interface TranscriptEditorProps {
  /** Initial segments to edit. */
  initialSegments: Segment[];
  /** Optional video URL for the left-column player. */
  videoUrl?: string;
  /** Called (debounced) whenever segments change. */
  onSave?: (segments: Segment[]) => void;
  /** External API call adapter for AI features. */
  aiApiCall?: (prompt: string, signal: AbortSignal) => Promise<string>;
  /**
   * Optional handler that asks an LLM to re-segment the entire transcript
   * into thought-by-thought lines (with speaker change detection). Returns
   * the proposed Segment[] (shown in the diff preview for admin approval)
   * or null if cancelled / failed.
   */
  onAIResegment?: (segments: Segment[]) => Promise<Segment[] | null>;
}

/**
 * Main Transcript Editor — two-column layout:
 * - Left: video player
 * - Right: segment list + toolbar
 * (Stacks vertically on mobile)
 */
export default function TranscriptEditor({
  initialSegments,
  videoUrl,
  onSave,
  aiApiCall,
  onAIResegment,
}: TranscriptEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const {
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
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useTranscriptEditor(initialSegments, onSave);

  const { activeSegmentId, activeWordIndex, seekToSegment } = useVideoSync(segments, videoRef);
  const { status: aiStatus, suggestedSegments, suggestBreaks, fixArabic, cancel: cancelAI } = useAIAssist();
  const [resegmentLoading, setResegmentLoading] = useState(false);
  const [resegmentSuggestion, setResegmentSuggestion] = useState<Segment[] | null>(null);

  const [showDiff, setShowDiff] = useState(false);

  // Keyboard shortcuts: Cmd+Z / Cmd+Shift+Z, bracket keys for timestamp nudge
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if (meta && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }

      // [ ] nudge start ±100ms, { } nudge end ±100ms for active segment
      if (activeSegmentId) {
        const seg = segments.find(s => s.id === activeSegmentId);
        if (!seg) return;

        if (e.key === '[') {
          shiftTimestampRipple(seg.id, 'start', Math.max(0, seg.start - 0.1));
        }
        if (e.key === ']') {
          shiftTimestampRipple(seg.id, 'start', seg.start + 0.1);
        }
        if (e.key === '{') {
          shiftTimestampRipple(seg.id, 'end', Math.max(seg.start + 0.1, seg.end - 0.1));
        }
        if (e.key === '}') {
          shiftTimestampRipple(seg.id, 'end', seg.end + 0.1);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, activeSegmentId, segments, shiftTimestamp]);

  const handleSuggestBreaks = useCallback(async () => {
    if (!aiApiCall) return;
    const result = await suggestBreaks(segments, aiApiCall);
    if (result) setShowDiff(true);
  }, [aiApiCall, segments, suggestBreaks]);

  const handleAIResegment = useCallback(async () => {
    if (!onAIResegment || resegmentLoading) return;
    setResegmentLoading(true);
    setResegmentSuggestion(null);
    try {
      const result = await onAIResegment(segments);
      if (result && result.length > 0) {
        setResegmentSuggestion(result);
        setShowDiff(true);
      }
    } finally {
      setResegmentLoading(false);
    }
  }, [onAIResegment, resegmentLoading, segments]);

  const handleFixArabic = useCallback(
    async (segmentId: string) => {
      if (!aiApiCall) return;
      const idx = segments.findIndex(s => s.id === segmentId);
      if (idx === -1) return;
      const result = await fixArabic(
        segments[idx],
        idx > 0 ? segments[idx - 1] : null,
        idx < segments.length - 1 ? segments[idx + 1] : null,
        aiApiCall,
      );
      if (result) aiReplace(segmentId, result);
    },
    [aiApiCall, segments, fixArabic, aiReplace],
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <Toolbar
        segments={segments}
        canUndo={canUndo}
        canRedo={canRedo}
        aiStatus={resegmentLoading ? 'loading' : aiStatus}
        staleCount={staleTranslations.size}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSuggestBreaks={handleSuggestBreaks}
        onAIResegment={onAIResegment ? handleAIResegment : undefined}
        onCancelAI={cancelAI}
      />

      {/* AI Diff Preview — prefer the resegment suggestion when present */}
      {showDiff && (resegmentSuggestion ?? suggestedSegments) && (
        <DiffPreview
          original={segments}
          suggested={(resegmentSuggestion ?? suggestedSegments)!}
          onAcceptAll={() => {
            replaceAll((resegmentSuggestion ?? suggestedSegments)!);
            setShowDiff(false);
            setResegmentSuggestion(null);
          }}
          onRejectAll={() => {
            setShowDiff(false);
            setResegmentSuggestion(null);
          }}
          onAcceptOne={(index) => {
            const list = (resegmentSuggestion ?? suggestedSegments)!;
            const suggested = list[index];
            if (suggested) {
              replaceAll([
                ...segments.filter(s => s.start < suggested.start),
                suggested,
                ...segments.filter(s => s.start >= suggested.end),
              ]);
            }
          }}
          onRejectOne={() => {
            // Individual reject is a no-op — suggestion stays in diff but isn't applied
          }}
          onKeepOne={(index) => {
            // Put one original boundary back into the proposal, so Accept All
            // stops merging it away. Previously a removed line had no controls
            // at all and the only way to save one was Reject All — throwing out
            // nineteen good changes to keep one boundary.
            const list = (resegmentSuggestion ?? suggestedSegments)!;
            const kept = segments[index];
            if (!kept) return;
            // Timings are floats built by summing word durations, so a tolerance
            // rather than an exact comparison.
            const EPSILON = 1e-6;
            const overlapsKept = (s: Segment) =>
              s.start < kept.end - EPSILON && kept.start < s.end - EPSILON;
            setResegmentSuggestion(
              [...list.filter((s) => !overlapsKept(s)), kept].sort((a, b) => a.start - b.start),
            );
          }}
        />
      )}

      {/* Two-column layout */}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        {/* Left: Video player */}
        {videoUrl && (
          <div className="w-full md:w-1/2 flex-shrink-0">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full rounded-lg bg-black"
            />
          </div>
        )}

        {/* Right: Segment list */}
        <div className={`flex-1 min-h-0 overflow-hidden ${videoUrl ? '' : 'w-full'}`}>
          <SegmentList
            segments={segments}
            activeSegmentId={activeSegmentId}
            activeWordIndex={activeWordIndex}
            staleTranslations={staleTranslations}
            onSplit={split}
            onSplitAtCursor={splitAtCursor}
            onMerge={merge}
            onEditText={editText}
            onEditTranslation={editTranslation}
            onStartChange={(id, v) => shiftTimestampRipple(id, 'start', v)}
            onEndChange={(id, v) => shiftTimestampRipple(id, 'end', v)}
            onFixArabic={handleFixArabic}
            onSeek={seekToSegment}
          />
        </div>
      </div>
    </div>
  );
}
