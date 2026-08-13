import { describe, it, expect } from 'vitest';
import { analyseGaps, runPublishChecklist } from './gapAnalysis';
import type { Segment } from '@/types/transcript';

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: 'seg',
    video_id: 'v1',
    start: 0,
    end: 3,
    text: 'test',
    translation: 'test',
    confidence: 0.9,
    words: [],
    ...overrides,
  };
}

describe('analyseGaps', () => {
  it('returns no warnings for well-formed segments', () => {
    const segs = [
      seg({ id: 'a', start: 0, end: 3 }),
      seg({ id: 'b', start: 3, end: 6 }),
    ];
    expect(analyseGaps(segs)).toHaveLength(0);
  });

  it('detects overlap between segments', () => {
    const segs = [
      seg({ id: 'a', start: 0, end: 3 }),
      seg({ id: 'b', start: 2.5, end: 5 }),
    ];
    const warnings = analyseGaps(segs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('overlap');
    expect(warnings[0].severity).toBe('error');
  });

  it('detects gap > 2s', () => {
    const segs = [
      seg({ id: 'a', start: 0, end: 3 }),
      seg({ id: 'b', start: 5.5, end: 8 }),
    ];
    const warnings = analyseGaps(segs);
    expect(warnings.some(w => w.type === 'gap')).toBe(true);
  });

  it('detects too-short segment', () => {
    const segs = [seg({ start: 0, end: 0.3 })];
    const warnings = analyseGaps(segs);
    expect(warnings.some(w => w.type === 'too-short')).toBe(true);
  });

  it('detects too-long segment', () => {
    const segs = [seg({ start: 0, end: 8 })];
    const warnings = analyseGaps(segs);
    expect(warnings.some(w => w.type === 'too-long')).toBe(true);
  });

  it('returns no warnings for empty array', () => {
    expect(analyseGaps([])).toHaveLength(0);
  });
});

describe('runPublishChecklist', () => {
  it('passes all checks for good segments', () => {
    const segs = [
      seg({ start: 0, end: 3, confidence: 0.9, translation: 'Hello' }),
      seg({ id: 'b', start: 3, end: 6, confidence: 0.85, translation: 'World' }),
    ];
    const items = runPublishChecklist(segs);
    expect(items.every(i => i.passed)).toBe(true);
  });

  it('fails on overlap', () => {
    const segs = [
      seg({ start: 0, end: 3 }),
      seg({ id: 'b', start: 2, end: 5 }),
    ];
    const items = runPublishChecklist(segs);
    expect(items.find(i => i.label.includes('overlapping'))?.passed).toBe(false);
  });

  it('fails on missing translation', () => {
    const segs = [seg({ translation: '' })];
    const items = runPublishChecklist(segs);
    expect(items.find(i => i.label.includes('translation'))?.passed).toBe(false);
  });

  it('fails on low average confidence', () => {
    const segs = [seg({ confidence: 0.5 }), seg({ id: 'b', start: 3, end: 6, confidence: 0.6 })];
    const items = runPublishChecklist(segs);
    expect(items.find(i => i.label.includes('confidence > 0.70'))?.passed).toBe(false);
  });

  it('fails on red-confidence segment', () => {
    const segs = [seg({ confidence: 0.5 })];
    const items = runPublishChecklist(segs);
    expect(items.find(i => i.label.includes('red-confidence'))?.passed).toBe(false);
  });

  it('fails on segment > 8 seconds', () => {
    const segs = [seg({ start: 0, end: 9 })];
    const items = runPublishChecklist(segs);
    expect(items.find(i => i.label.includes('> 8 seconds'))?.passed).toBe(false);
  });
});
