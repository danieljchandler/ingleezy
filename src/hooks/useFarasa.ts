import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ── Types (mirror edge function output) ──────────────────────────────────────

export type FarasaTask = 'diac' | 'seg' | 'pos' | 'NER' | 'parsing';

export interface FarasaDiacResult {
  /** Arabic text with full tashkeel (short vowel marks) */
  text: string;
}

export interface FarasaSegToken {
  /** Original word (boundaries removed) */
  original: string;
  /** Boundary-marked form, e.g. "ب+الكتاب" */
  segmented: string;
  /** Clitic prefixes (conjunction, preposition, determiner) */
  prefixes: string[];
  /** Core lexical stem */
  stem: string;
  /** Clitic suffixes (pronoun, plural, feminine marker) */
  suffixes: string[];
}

export interface FarasaPosToken {
  word: string;
  tag: string;
  /** Human-readable label, e.g. "Verb (past)" */
  label: string;
}

export interface FarasaNerEntity {
  text: string;
  type: string;
  /** Human-readable entity type, e.g. "Person", "Location" */
  typeLabel: string;
}

export interface FarasaDepToken {
  index: number;
  word: string;
  lemma?: string;
  pos?: string;
  /** Index of head token (0 = root) */
  head: number;
  relation: string;
  /** Human-readable dependency label, e.g. "Subject", "Object" */
  relationLabel: string;
}

/**
 * Why a task produced nothing. `invalid_api_key` means FARASA_API_KEY is unset
 * or rejected — a configuration problem, not a transient one, so retrying is
 * pointless until the secret is fixed.
 */
export type FarasaFailureReason =
  | 'invalid_api_key'
  | 'all_endpoints_failed'
  | 'timeout'
  | 'empty_input';

export interface FarasaResult {
  inputText: string;
  tasks: FarasaTask[];
  diac?: FarasaDiacResult | null;
  diacAvailable?: boolean;
  diacError?: FarasaFailureReason;
  seg?: { raw: string; tokens: FarasaSegToken[] } | null;
  segAvailable?: boolean;
  segError?: FarasaFailureReason;
  pos?: { raw: string; tokens: FarasaPosToken[] } | null;
  posAvailable?: boolean;
  posError?: FarasaFailureReason;
  NER?: { entities: FarasaNerEntity[]; raw: string } | null;
  NERAvailable?: boolean;
  NERError?: FarasaFailureReason;
  parsing?: { raw: string; tokens: FarasaDepToken[] } | null;
  parsingAvailable?: boolean;
  parsingError?: FarasaFailureReason;
  /** Per-task failure reasons, keyed by task name. */
  errors?: Partial<Record<FarasaTask, FarasaFailureReason>>;
  /** Present when every requested task failed for the same configuration reason. */
  configHint?: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useFarasa — Arabic NLP analysis via the QCRI Farasa REST API.
 * Tasks run in parallel. Requires the FARASA_API_KEY secret on the edge
 * function — without it every task returns `<task>Available: false` with
 * `<task>Error: 'invalid_api_key'`.
 *
 * Quick-start:
 *   const { analyze, diacritize, isLoading, result } = useFarasa();
 *
 *   // Add vowels to unvoweled Arabic (feed to ElevenLabs TTS):
 *   const voweled = await diacritize('وين رحت البارحة');
 *
 *   // Show word structure in a vocabulary card:
 *   const { seg } = await analyze('وبالكتاب', ['seg']);
 *   // → seg.tokens[0] = { prefixes: ['و','ب','ال'], stem: 'كتاب', suffixes: [] }
 *
 *   // Tag speech for grammar lesson display:
 *   const { pos } = await analyze('ذهب الولد إلى المدرسة', ['pos']);
 *
 *   // Detect named entities in a video transcript:
 *   const { NER } = await analyze(transcript, ['NER']);
 *
 *   // Show learner how the sentence is structured:
 *   const { parsing } = await analyze('يحب الطفل الكتاب', ['parsing']);
 *
 * Available tasks:
 *   diac    — tashkeel (short vowels). Best for TTS pronunciation.
 *   seg     — morphological segmentation. Best for vocabulary word cards.
 *   pos     — part-of-speech tags. Best for grammar lesson annotations.
 *   NER     — named entity recognition. Best for transcript entity highlighting.
 *   parsing — dependency tree. Best for advanced grammar structure display.
 */
export function useFarasa() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<FarasaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (
      text: string,
      tasks: FarasaTask[] = ['diac'],
    ): Promise<FarasaResult | null> => {
      if (!text?.trim()) return null;
      setIsLoading(true);
      setError(null);
      setResult(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke('farasa', {
          body: { text: text.trim(), tasks },
        });
        if (fnError) throw new Error(fnError.message);
        setResult(data as FarasaResult);
        return data as FarasaResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'farasa call failed';
        setError(msg);
        console.error('useFarasa:', msg);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /** Add tashkeel to Arabic text. Returns the diacritized string or null. */
  const diacritize = useCallback(
    async (text: string): Promise<string | null> => {
      const res = await analyze(text, ['diac']);
      return res?.diac?.text ?? null;
    },
    [analyze],
  );

  /** Morphological segmentation — prefix/stem/suffix breakdown per word. */
  const segment = useCallback(
    async (text: string): Promise<FarasaSegToken[] | null> => {
      const res = await analyze(text, ['seg']);
      return res?.seg?.tokens ?? null;
    },
    [analyze],
  );

  /** Part-of-speech tags with human-readable labels. */
  const tagPOS = useCallback(
    async (text: string): Promise<FarasaPosToken[] | null> => {
      const res = await analyze(text, ['pos']);
      return res?.pos?.tokens ?? null;
    },
    [analyze],
  );

  /** Named entity recognition — persons, locations, organizations. */
  const recognizeEntities = useCallback(
    async (text: string): Promise<FarasaNerEntity[] | null> => {
      const res = await analyze(text, ['NER']);
      return res?.NER?.entities ?? null;
    },
    [analyze],
  );

  /** Dependency parse tree — grammatical relations between words. */
  const parseDependencies = useCallback(
    async (text: string): Promise<FarasaDepToken[] | null> => {
      const res = await analyze(text, ['parsing']);
      return res?.parsing?.tokens ?? null;
    },
    [analyze],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    /** Run any combination of Farasa tasks in parallel */
    analyze,
    /** Add tashkeel — use before ElevenLabs TTS */
    diacritize,
    /** Prefix/stem/suffix breakdown — use in vocabulary word cards */
    segment,
    /** Part-of-speech tags — use in grammar lesson annotations */
    tagPOS,
    /** Named entity recognition — use in transcript analysis */
    recognizeEntities,
    /** Dependency tree — use in advanced grammar display */
    parseDependencies,
    isLoading,
    result,
    error,
    reset,
  };
}
