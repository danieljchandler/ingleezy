import { useCallback, useState } from 'react';
import type { Segment } from '@/types/transcript';

type AIStatus = 'idle' | 'loading' | 'error';

/** Dialect-specific prompting context for transcript editing. */
const DIALECT_PROMPT: Record<string, { label: string; errors: string }> = {
  Gulf: {
    label: 'Gulf Arabic (Khaleeji)',
    errors: 'mishearing particles (لي، لك، عليه، ما), dropped final vowels, dialect words mistranscribed as MSA equivalents.',
  },
  Egyptian: {
    label: 'Egyptian Arabic (مصري)',
    errors: 'mishearing particles (ده، دي، بتاع), Egyptian ج→g sounds, dialect words mistranscribed as MSA equivalents.',
  },
  Yemeni: {
    label: 'Yemeni Arabic (يمني)',
    errors: 'mishearing particles (ما، حق), Yemeni ق→g sounds, dialect words mistranscribed as MSA or Gulf equivalents.',
  },
};

/**
 * AI assistant hooks for transcript editing.
 * All features are user-triggered and cancellable.
 */
export function useAIAssist() {
  const [status, setStatus] = useState<AIStatus>('idle');
  const [suggestedSegments, setSuggestedSegments] = useState<Segment[] | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortController?.abort();
    setAbortController(null);
    setStatus('idle');
  }, [abortController]);

  /**
   * Feature 1: Suggest natural sentence breaks.
   * Sends current segments to Claude and returns restructured segments.
   */
  const suggestBreaks = useCallback(
    async (segments: Segment[], apiCall: (prompt: string, signal: AbortSignal) => Promise<string>, dialect: string = 'Gulf') => {
      const controller = new AbortController();
      setAbortController(controller);
      setStatus('loading');
      setSuggestedSegments(null);

      const dialectInfo = DIALECT_PROMPT[dialect] ?? DIALECT_PROMPT.Gulf;

      const prompt = `You are editing Arabic subtitles for a ${dialectInfo.label} video.
Below are the current transcript segments as JSON.

Rules for good subtitle breaks:
- Each subtitle should be 3–7 seconds long
- Break at natural sentence or clause boundaries
- Never break mid-phrase or mid-word
- Preserve all original words exactly — do not paraphrase or translate
- You may split or merge segments but timestamps must come from the original words[] data
- Return ONLY a JSON array of {id, text, start, end} — no explanation

Segments: ${JSON.stringify(segments)}`;

      try {
        const result = await apiCall(prompt, controller.signal);
        const parsed = JSON.parse(result) as Segment[];
        setSuggestedSegments(parsed);
        setStatus('idle');
        return parsed;
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setStatus('idle');
          return null;
        }
        setStatus('error');
        return null;
      }
    },
    [],
  );

  /**
   * Feature 2: Fix Arabic for a single segment using surrounding context.
   */
  const fixArabic = useCallback(
    async (
      segment: Segment,
      prevSeg: Segment | null,
      nextSeg: Segment | null,
      apiCall: (prompt: string, signal: AbortSignal) => Promise<string>,
      dialect: string = 'Gulf',
    ) => {
      const controller = new AbortController();
      setAbortController(controller);
      setStatus('loading');

      const dialectInfo = DIALECT_PROMPT[dialect] ?? DIALECT_PROMPT.Gulf;

      const prompt = `The following is a ${dialectInfo.label} subtitle segment transcribed by ASR.
Confidence score: ${segment.confidence.toFixed(2)}

Previous segment: "${prevSeg?.text ?? ''}"
Next segment: "${nextSeg?.text ?? ''}"

Common ${dialectInfo.label} ASR errors to look for: ${dialectInfo.errors}

Current text: "${segment.text}"

Return ONLY the corrected Arabic text. If no correction is needed, return the
original unchanged. Do not explain.`;

      try {
        const result = await apiCall(prompt, controller.signal);
        setStatus('idle');
        return result.trim();
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setStatus('idle');
          return null;
        }
        setStatus('error');
        return null;
      }
    },
    [],
  );

  return {
    status,
    suggestedSegments,
    suggestBreaks,
    fixArabic,
    cancel,
  };
}
