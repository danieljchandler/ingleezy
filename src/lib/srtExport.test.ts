import { describe, it, expect } from 'vitest';
import { formatSRTTime, toSRT } from './srtExport';
import type { Segment } from '@/types/transcript';

describe('formatSRTTime', () => {
  it('formats zero', () => {
    expect(formatSRTTime(0)).toBe('00:00:00,000');
  });

  it('formats seconds with milliseconds', () => {
    expect(formatSRTTime(1.5)).toBe('00:00:01,500');
  });

  it('formats minutes and seconds', () => {
    expect(formatSRTTime(65.123)).toBe('00:01:05,123');
  });

  it('formats hours', () => {
    expect(formatSRTTime(3661.0)).toBe('01:01:01,000');
  });

  it('rounds milliseconds', () => {
    expect(formatSRTTime(1.9999)).toBe('00:00:02,000');
  });
});

describe('toSRT', () => {
  it('returns empty string for no segments', () => {
    expect(toSRT([])).toBe('');
  });

  it('formats a single segment', () => {
    const seg: Segment = {
      id: '1',
      video_id: 'v1',
      start: 0,
      end: 2.5,
      text: 'مرحبا',
      translation: 'Hello',
      confidence: 0.9,
      words: [],
    };

    const result = toSRT([seg]);
    expect(result).toBe(
      '1\n00:00:00,000 --> 00:00:02,500\nمرحبا\nHello',
    );
  });

  it('formats multiple segments with blank line separators', () => {
    const segs: Segment[] = [
      {
        id: '1', video_id: 'v1', start: 0, end: 2, text: 'أول',
        translation: 'First', confidence: 0.9, words: [],
      },
      {
        id: '2', video_id: 'v1', start: 2, end: 4, text: 'ثاني',
        translation: 'Second', confidence: 0.8, words: [],
      },
    ];

    const result = toSRT(segs);
    const blocks = result.split('\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('1\n');
    expect(blocks[1]).toContain('2\n');
  });
});
