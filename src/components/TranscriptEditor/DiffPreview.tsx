import type { Segment } from '@/types/transcript';

interface DiffPreviewProps {
  original: Segment[];
  suggested: Segment[];
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptOne: (index: number) => void;
  onRejectOne: (index: number) => void;
  /**
   * Keep one original boundary the proposal deletes, by index into `original`.
   *
   * Without it, a removed line has no controls at all, so the only way to hold
   * on to one is Reject All: an admin who likes nineteen of twenty changes but
   * wants to keep a single boundary the model merged away has to throw the
   * whole proposal out and redo the split by hand.
   */
  onKeepOne?: (index: number) => void;
}

/**
 * A boundary as a pair of whole milliseconds.
 *
 * These numbers come out of arithmetic — the re-segmentation path rebuilds each
 * segment's start and end by summing word durations — so a boundary that is
 * conceptually unchanged comes back as 1.2000000000000002 against the
 * original's 1.2. Comparing the raw values as strings made every such line read
 * as new: the diff turned entirely green, every original line was listed as
 * removed, and a proposal that changed two boundaries claimed it had changed
 * all forty. Milliseconds are finer than anything the editor can express and
 * far coarser than float noise.
 */
const boundaryKey = (s: Segment) => `${Math.round(s.start * 1000)}-${Math.round(s.end * 1000)}`;

/**
 * Shows a diff between original and AI-suggested segment boundaries.
 * Green = new boundaries, Red = removed boundaries.
 */
export default function DiffPreview({
  original,
  suggested,
  onAcceptAll,
  onRejectAll,
  onAcceptOne,
  onRejectOne,
  onKeepOne,
}: DiffPreviewProps) {
  // Build a set of boundary times for comparison
  const origBoundaries = new Set(original.map(boundaryKey));
  const sugBoundaries = new Set(suggested.map(boundaryKey));

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">AI Suggested Boundaries</h3>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
            onClick={onAcceptAll}
          >
            Accept All
          </button>
          <button
            className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
            onClick={onRejectAll}
          >
            Reject All
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {suggested.map((seg, i) => {
          const key = boundaryKey(seg);
          const isNew = !origBoundaries.has(key);

          return (
            <div
              key={`${key}-${i}`}
              dir="rtl"
              className={`flex items-start gap-2 rounded p-2 text-sm ${
                isNew
                  ? 'bg-green-50 dark:bg-green-900/20 border-l-2 border-green-500'
                  : 'bg-gray-50 dark:bg-gray-800/50'
              }`}
            >
              <div className="flex-1 text-right font-cairo">
                <div className="flex items-center justify-end gap-2" dir="ltr">
                  {seg.speaker && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-semibold uppercase tracking-wide">
                      Speaker {seg.speaker}
                    </span>
                  )}
                  <span className="text-muted-foreground text-xs font-mono">
                    {seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s
                  </span>
                </div>
                <p className="mt-0.5">{seg.text}</p>
                {seg.translation && (
                  <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">{seg.translation}</p>
                )}
              </div>
              {isNew && (
                <div className="flex flex-col gap-1" dir="ltr">
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-green-800 transition-colors"
                    onClick={() => onAcceptOne(i)}
                  >
                    ✓
                  </button>
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-800 transition-colors"
                    onClick={() => onRejectOne(i)}
                  >
                    ✗
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Show removed boundaries */}
        {original
          .map((seg, index) => ({ seg, index }))
          .filter(({ seg }) => !sugBoundaries.has(boundaryKey(seg)))
          .map(({ seg, index }) => (
            <div
              key={`removed-${index}`}
              dir="rtl"
              className="flex items-start gap-2 rounded p-2 text-sm bg-red-50 dark:bg-red-900/20 border-l-2 border-red-500 opacity-60"
            >
              <div className="flex-1 text-right font-cairo line-through">
                <span className="text-muted-foreground text-xs font-mono ltr:inline-block" dir="ltr">
                  {seg.start.toFixed(1)}s – {seg.end.toFixed(1)}s
                </span>
                <p className="mt-0.5">{seg.text}</p>
              </div>
              {onKeepOne && (
                <div className="flex flex-col gap-1" dir="ltr">
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 transition-colors"
                    onClick={() => onKeepOne(index)}
                    title="Keep this boundary"
                  >
                    Keep
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
