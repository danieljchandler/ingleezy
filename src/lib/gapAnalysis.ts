import type { GapWarning, PublishCheckItem, Segment } from '@/types/transcript';

// ── Thresholds ──────────────────────────────────────────────────────
const MIN_DURATION_S = 0.5;
const MAX_DURATION_S = 7;
const MAX_GAP_S = 2;
const MAX_SEGMENT_FOR_PUBLISH_S = 8;
const MIN_AVG_CONFIDENCE = 0.7;
const RED_CONFIDENCE = 0.65;

/**
 * Analyse an ordered array of segments for timing issues.
 *
 * Checks:
 * - Gap > 2 s between consecutive segments → amber warning
 * - Overlap (seg.end > next.start) → red error (blocks export)
 * - Duration < 0.5 s → warning (too short)
 * - Duration > 7 s → warning (too long)
 */
export function analyseGaps(segments: Segment[]): GapWarning[] {
  const warnings: GapWarning[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const duration = seg.end - seg.start;

    if (duration < MIN_DURATION_S) {
      warnings.push({
        type: 'too-short',
        severity: 'warning',
        message: `Segment ${i + 1} is too short (${duration.toFixed(2)}s)`,
        segmentIndex: i,
      });
    }

    if (duration > MAX_DURATION_S) {
      warnings.push({
        type: 'too-long',
        severity: 'warning',
        message: `Segment ${i + 1} is too long (${duration.toFixed(2)}s)`,
        segmentIndex: i,
      });
    }

    if (i < segments.length - 1) {
      const next = segments[i + 1];
      const gap = next.start - seg.end;

      if (gap < 0) {
        warnings.push({
          type: 'overlap',
          severity: 'error',
          message: `Segments ${i + 1} and ${i + 2} overlap by ${Math.abs(gap).toFixed(2)}s`,
          segmentIndex: i,
          segmentIndexB: i + 1,
        });
      } else if (gap > MAX_GAP_S) {
        warnings.push({
          type: 'gap',
          severity: 'warning',
          message: `Gap of ${gap.toFixed(2)}s between segments ${i + 1} and ${i + 2}`,
          segmentIndex: i,
          segmentIndexB: i + 1,
        });
      }
    }
  }

  return warnings;
}

/**
 * Run the publish checklist against the current segments.
 *
 * Rules:
 * - No overlapping segments
 * - No segment longer than 8 seconds
 * - All segments have a translation
 * - Average confidence > 0.70
 * - No unreviewed red-confidence (< 0.65) segments
 */
export function runPublishChecklist(segments: Segment[]): PublishCheckItem[] {
  const warnings = analyseGaps(segments);
  const hasOverlap = warnings.some(w => w.type === 'overlap');
  const hasLongSegment = segments.some(s => s.end - s.start > MAX_SEGMENT_FOR_PUBLISH_S);
  const allTranslated = segments.every(s => s.translation && s.translation.trim().length > 0);
  const avgConfidence =
    segments.length > 0
      ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
      : 0;
  const hasRedConfidence = segments.some(s => s.confidence < RED_CONFIDENCE);

  return [
    { label: 'No overlapping segments', passed: !hasOverlap },
    { label: 'No segment > 8 seconds', passed: !hasLongSegment },
    { label: 'All segments have a translation', passed: allTranslated },
    { label: 'Average confidence > 0.70', passed: avgConfidence > MIN_AVG_CONFIDENCE },
    { label: 'No unreviewed red-confidence segments', passed: !hasRedConfidence },
  ];
}
