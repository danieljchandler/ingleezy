/**
 * useShadowScore — scores a shadowing take against the ACTUAL native clip.
 *
 * Combines two clip-anchored signals (never a generic pronunciation model):
 *   1. Transcript match  — did you say the same words the native said in the
 *      clip? (Munsit ASR + normalised Arabic edit distance, server-side.)
 *   2. Acoustic match    — does your take sound like the clip? (MFCC + DTW,
 *      client-side; only when the clip's audio is downloadable.)
 *
 * Then fetches 2–3 AI coaching tips from `pronunciation-feedback` (shadow mode).
 */

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { blobToWav } from "@/lib/audioToWav";
import { acousticSimilarity } from "@/lib/acousticSimilarity";
import { useDialect } from "@/contexts/DialectContext";

export interface ShadowWordDiff {
  ref?: string;
  said?: string;
  status: "match" | "sub" | "missing" | "extra";
}

export interface ShadowScoreResult {
  /** Combined 0–100 closeness to the clip. */
  overall: number;
  /** 0–100 word/transcript match to what the native said. */
  transcriptSimilarity: number;
  /** 0–100 acoustic match, or null when clip audio wasn't available. */
  acousticSimilarity: number | null;
  /** What the ASR heard the learner say. */
  recognizedText: string;
  wordDiffs: ShadowWordDiff[];
  /** AI coaching tips (may be empty if the tips call failed). */
  tips: string[];
}

interface ScoreOptions {
  referenceText: string;
  /** Native clip audio as a WAV Blob — enables the acoustic component. */
  nativeClipWav?: Blob | null;
}

/** Weight of the transcript vs acoustic signal when both are present. */
const TRANSCRIPT_WEIGHT = 0.55;
const ACOUSTIC_WEIGHT = 0.45;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function useShadowScore() {
  // Sent to the scorer so the words the learner missed are recorded against the
  // right dialect in `learner_errors` (they feed the learner profile).
  const { activeDialect } = useDialect();
  const [result, setResult] = useState<ShadowScoreResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const score = useCallback(
    async (audioBlob: Blob, { referenceText, nativeClipWav }: ScoreOptions): Promise<ShadowScoreResult | null> => {
      if (!audioBlob || audioBlob.size === 0) {
        setError("No audio recorded");
        return null;
      }
      if (!referenceText.trim()) {
        setError("Reference text is required");
        return null;
      }

      const reqId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        // Convert the WebM/Opus recording to 16 kHz WAV once — used for both
        // the ASR call and the client-side acoustic comparison.
        const userWav = await blobToWav(audioBlob);
        const audioBase64 = await blobToBase64(userWav);

        // 1. Transcript match (server) + 2. acoustic match (client) in parallel.
        const [fnResponse, acoustic] = await Promise.all([
          supabase.functions.invoke("score-shadow-attempt", {
            body: { audioBase64, mimeType: "audio/wav", referenceText, dialect: activeDialect },
          }),
          nativeClipWav
            ? acousticSimilarity(userWav, nativeClipWav).catch(() => null)
            : Promise.resolve<number | null>(null),
        ]);

        if (reqId !== requestIdRef.current) return null;

        const { data, error: fnError } = fnResponse;
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        const transcriptSimilarity = Math.round((data.transcriptSimilarity ?? 0) * 100);
        const recognizedText: string = data.recognizedText ?? "";
        const wordDiffs: ShadowWordDiff[] = Array.isArray(data.wordDiffs) ? data.wordDiffs : [];

        const overall =
          acoustic != null
            ? Math.round(TRANSCRIPT_WEIGHT * transcriptSimilarity + ACOUSTIC_WEIGHT * acoustic)
            : transcriptSimilarity;

        // 3. AI coaching tips — best-effort; never blocks the score.
        let tips: string[] = [];
        try {
          const { data: tipData } = await supabase.functions.invoke("pronunciation-feedback", {
            body: {
              mode: "shadow",
              referenceText,
              recognizedText,
              closeness: overall,
              wordDiffs,
            },
          });
          if (Array.isArray(tipData?.tips)) tips = tipData.tips;
        } catch {
          /* tips are optional */
        }

        if (reqId !== requestIdRef.current) return null;

        const scoreResult: ShadowScoreResult = {
          overall,
          transcriptSimilarity,
          acousticSimilarity: acoustic,
          recognizedText,
          wordDiffs,
          tips,
        };
        setResult(scoreResult);
        return scoreResult;
      } catch (err: unknown) {
        if (reqId !== requestIdRef.current) return null;
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        if (reqId === requestIdRef.current) setIsLoading(false);
      }
    },
    [activeDialect],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { score, result, isLoading, error, reset };
}
