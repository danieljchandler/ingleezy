import type { Segment } from '@/types/transcript';

/**
 * Format a time in seconds to SRT timestamp format `HH:MM:SS,mmm`.
 *
 * @param seconds - Time in seconds (e.g. 65.123).
 * @returns Formatted SRT time string.
 */
export function formatSRTTime(seconds: number): string {
  // Round to nearest millisecond first to avoid carry issues.
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Convert an array of segments to an SRT subtitle string.
 * Each subtitle block includes both Arabic text and English translation.
 *
 * @param segments - Ordered array of segments to export.
 * @returns The complete SRT file content.
 */
export function toSRT(segments: Segment[]): string {
  return segments
    .map((seg, i) => {
      return `${i + 1}\n${formatSRTTime(seg.start)} --> ${formatSRTTime(seg.end)}\n${seg.text}\n${seg.translation}`;
    })
    .join('\n\n');
}
