/**
 * useAzurePronunciation — React hook for Azure Cognitive Services Pronunciation Assessment.
 *
 * Sends a recorded audio blob + Arabic reference text to the azure-pronunciation
 * edge function and returns granular pronunciation scores.
 *
 * Usage:
 *   const { assess, result, isLoading, error, reset } = useAzurePronunciation();
 *
 *   // After recording a Blob from MediaRecorder:
 *   const scores = await assess(audioBlob, 'How are you today?');
 *   // scores.overall => 0–100 overall pronunciation score
 *   // scores.words   => per-word accuracy + error type + phoneme breakdown
 *
 * Gulf Arabic locales (pass as third arg):
 *   'ar-SA' Saudi Arabia (default)
 *   'ar-QA' Qatar
 *   'ar-KW' Kuwait
 *   'ar-BH' Bahrain
 *   'ar-AE' UAE
 *   'ar-OM' Oman
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { blobToWav } from '@/lib/audioToWav';

export interface PhonemeResult {
  /** IPA-like phoneme symbol returned by Azure */
  phoneme: string;
  /** 0–100 accuracy score for this phoneme */
  accuracy: number;
  /**
   * Top alternative phonemes Azure heard instead of the target (IPA) — what
   * turns "accuracy 62" into "you said /b/ where /p/ goes".
   */
  nbest?: Array<{ phoneme: string; accuracy: number }>;
}

export interface WordResult {
  /** Arabic word token */
  word: string;
  /** 0–100 accuracy score for this word */
  accuracy: number;
  /** Pronunciation error classification */
  errorType: 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';
  /** Per-phoneme scores (available when Granularity = Phoneme) */
  phonemes: PhonemeResult[];
}

export interface PronunciationResult {
  /** Overall pronunciation score (PronScore) 0–100 */
  overall: number;
  /** Phoneme-level accuracy 0–100 */
  accuracy: number;
  /** Speaking rate / pause naturalness 0–100 */
  fluency: number;
  /** Fraction of reference words spoken 0–100 */
  completeness: number;
  /**
   * Prosody (stress/intonation/rhythm) 0–100 — present when Azure returns it.
   * The one suprasegmental signal in the app; requested with
   * EnableProsodyAssessment server-side.
   */
  prosody?: number;
  /** Per-word breakdown */
  words: WordResult[];
  /** What Azure actually recognised (may differ from referenceText) */
  recognizedText: string;
  /** BCP-47 locale used for assessment */
  locale: string;
}

export interface PhonemeSubstitution {
  /** The word the substitution happened in (as recognised) */
  word: string;
  /** The phoneme the reference asked for (IPA) */
  target: string;
  /** The phoneme Azure actually heard (IPA) */
  heard: string;
}

/**
 * Extract "you said X where Y goes" pairs from the per-phoneme nbest data:
 * a phoneme scored low whose top alternative is a DIFFERENT phoneme is a
 * substitution Azure is confident about. Capped and deduped — three concrete
 * swaps teach; a wall of them numbs.
 */
export function phonemeSubstitutions(
  words: WordResult[],
  { threshold = 60, limit = 3 }: { threshold?: number; limit?: number } = {},
): PhonemeSubstitution[] {
  const out: PhonemeSubstitution[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    for (const p of w.phonemes) {
      if (p.accuracy >= threshold) continue;
      const heard = p.nbest?.[0]?.phoneme;
      if (!heard || !p.phoneme || heard === p.phoneme) continue;
      const key = `${p.phoneme}→${heard}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ word: w.word, target: p.phoneme, heard });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Score band labels for UI display */
export function scoreBand(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'ممتاز', color: 'text-green-600' };
  if (score >= 75) return { label: 'جيد', color: 'text-blue-600' };
  if (score >= 60) return { label: 'مقبول', color: 'text-yellow-600' };
  return { label: 'يحتاج تدريباً', color: 'text-red-600' };
}

/** Convert a Blob to base64 string */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  // Process in chunks to avoid call-stack overflow on large files
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function useAzurePronunciation() {
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  /**
   * Assess pronunciation of an audio recording against Arabic reference text.
   *
   * @param audioBlob     - Blob from MediaRecorder (WebM/Opus)
   * @param referenceText - Arabic text the learner was asked to say
   * @param locale        - BCP-47 locale for assessment, default 'ar-SA'
   * @returns PronunciationResult or null on error
   */
  const assess = useCallback(
    async (
      audioBlob: Blob,
      referenceText: string,
      locale = 'en-US',
      dialect?: string,
    ): Promise<PronunciationResult | null> => {
      // Fail-fast guard for empty inputs
      if (!audioBlob || audioBlob.size === 0) {
        setError('No audio recorded');
        setIsLoading(false);
        return null;
      }
      if (!referenceText.trim()) {
        setError('Reference text is required');
        setIsLoading(false);
        return null;
      }

      // Capture request ID to guard against stale responses from overlapping calls
      const reqId = ++requestIdRef.current;

      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        // Convert to WAV (PCM 16-bit 16kHz) — Azure pronunciation assessment
        // returns 0 scores with WebM/Opus input
        const wavBlob = await blobToWav(audioBlob);
        const audioBase64 = await blobToBase64(wavBlob);

        if (reqId !== requestIdRef.current) return null;

        const audioMimeType = 'audio/wav';

        const { data, error: fnError } = await supabase.functions.invoke(
          'azure-pronunciation',
          {
            body: { audioBase64, referenceText, locale, audioMimeType, dialect },
          }
        );

        if (reqId !== requestIdRef.current) return null;

        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        const pronunciationResult = data as PronunciationResult;
        setResult(pronunciationResult);
        return pronunciationResult;
      } catch (err: unknown) {
        if (reqId !== requestIdRef.current) return null;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        if (reqId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  /** Reset state (call before a new recording attempt) */
  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { assess, result, isLoading, error, reset, scoreBand };
}
