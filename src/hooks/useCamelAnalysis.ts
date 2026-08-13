import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type CamelAction = 'diacritize' | 'segment' | 'pos' | 'dialect';

export interface PosToken {
  word: string;
  tag: string;
  tagDescription: string;
}

export interface MorphSegment {
  raw: string;
  prefixes: string[];
  stem: string;
  suffixes: string[];
}

export interface DialectPrediction {
  code: string;
  dialect: string;
  score: number;
}

export interface DialectResult {
  code: string;
  dialect: string;
  country: string;
  confidence: number;
  isGulf: boolean;
  topPredictions: DialectPrediction[];
  source: 'camel-hf' | 'unavailable';
}

export interface CamelAnalysisResult {
  inputText: string;
  actions: CamelAction[];
  /** Arabic text with full tashkeel (short vowels) added */
  diacritized?: string | null;
  diacritizeAvailable?: boolean;
  /** Raw Farasa segmentation output */
  segmentedRaw?: string;
  /** Parsed morphological segments */
  segments?: MorphSegment[] | null;
  /** Raw Farasa POS output */
  posTaggedRaw?: string;
  /** Parsed POS tokens */
  posTokens?: PosToken[] | null;
  /** CAMeL-Lab dialect identification result */
  dialect?: DialectResult | null;
  dialectError?: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useCamelAnalysis — Arabic text analysis via Farasa + CAMeL-Lab models.
 *
 * Usage:
 *   const { analyze, isLoading, result, error } = useCamelAnalysis();
 *
 *   // Diacritize only (default):
 *   await analyze('وين رحت');
 *
 *   // All features:
 *   await analyze('وين رحت', ['diacritize', 'segment', 'pos', 'dialect']);
 *
 * Use cases in Arabic Buddy:
 *   diacritize — add vowels before passing text to ElevenLabs TTS
 *   segment    — show learners prefix/stem/suffix breakdown in word cards
 *   pos        — label parts of speech in lesson vocabulary
 *   dialect    — validate generated lesson content is genuine Gulf Arabic
 */
export function useCamelAnalysis() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CamelAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (
      text: string,
      actions: CamelAction[] = ['diacritize'],
    ): Promise<CamelAnalysisResult | null> => {
      if (!text?.trim()) return null;

      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke('camel-analyze', {
          body: { text: text.trim(), actions },
        });

        if (fnError) throw new Error(fnError.message);

        setResult(data as CamelAnalysisResult);
        return data as CamelAnalysisResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'camel-analyze failed';
        setError(msg);
        console.error('useCamelAnalysis:', msg);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /** Convenience: diacritize a single Arabic string. Returns the voweled text or null. */
  const diacritize = useCallback(
    async (text: string): Promise<string | null> => {
      const res = await analyze(text, ['diacritize']);
      return res?.diacritized ?? null;
    },
    [analyze],
  );

  /** Convenience: identify the Gulf dialect variant of a text snippet. */
  const identifyDialect = useCallback(
    async (text: string): Promise<DialectResult | null> => {
      const res = await analyze(text, ['dialect']);
      return res?.dialect ?? null;
    },
    [analyze],
  );

  /** Convenience: morphological breakdown — useful for vocabulary word cards. */
  const segmentWord = useCallback(
    async (text: string): Promise<MorphSegment[] | null> => {
      const res = await analyze(text, ['segment']);
      return res?.segments ?? null;
    },
    [analyze],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    /** Run any combination of: diacritize, segment, pos, dialect */
    analyze,
    /** Add short vowels (tashkeel) to unvoweled Arabic text */
    diacritize,
    /** Identify Gulf dialect sub-variant (Kuwaiti, Emirati, Saudi, etc.) */
    identifyDialect,
    /** Get morphological prefix/stem/suffix breakdown */
    segmentWord,
    isLoading,
    result,
    error,
    reset,
  };
}
