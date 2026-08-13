import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";

type DialectHint = "Gulf" | "Egyptian" | "Yemeni" | string | null | undefined;

interface UseAzureTTSOptions {
  /** The Arabic text to synthesise. */
  text: string;
  /** Whether to skip generation (e.g. when a stored audio_url exists). */
  skip?: boolean;
  /**
   * Optional dialect hint. When set to "Gulf" (or any Gulf country —
   * Saudi/Kuwaiti/UAE/Bahraini/Qatari/Omani), playback is routed through
   * Munsit's Arabic-native voice instead of Azure for higher fidelity on
   * Khaleeji pronunciation. All other dialects continue to use Azure.
   */
  dialect?: DialectHint;
  /**
   * Optional explicit Azure voice name (e.g. "ar-SA-HamedNeural" for MSA,
   * "ar-EG-ShakirNeural" for Egyptian). Ignored by Munsit routing.
   */
  voice?: string;
  /**
   * Optional callback invoked once per successful generation with the raw
   * audio blob. Call sites use this to upload the blob to storage and
   * persist a URL on the flashcard so we never re-synthesize the same text.
   * Errors thrown by the callback are caught and logged.
   */
  persist?: (blob: Blob) => Promise<void> | void;
}

interface UseAzureTTSResult {
  /** Blob URL of the generated audio, or null while loading / on error. */
  ttsUrl: string | null;
  /** True while the TTS request is in flight. */
  isLoading: boolean;
  /** Re-trigger generation (e.g. after an error). */
  regenerate: () => void;
}

// Dialects routed through Munsit (Arabic-native voice) instead of Azure.
const MUNSIT_DIALECT_LABELS = new Set([
  "gulf", "khaleeji",
  "saudi", "kuwaiti", "uae", "emirati", "bahraini", "qatari", "omani",
]);

function isMunsitDialect(dialect: DialectHint): boolean {
  if (!dialect) return false;
  return MUNSIT_DIALECT_LABELS.has(String(dialect).toLowerCase());
}

// Default Azure voice per non-Gulf dialect, used whenever a caller doesn't
// pass an explicit `voice`. Without this, callers that omit `voice` (most of
// them — VocabularyCard, QuizCard, ReviewImageQuizCard, etc.) silently fell
// back to azure-tts's hardcoded Gulf default voice for every dialect.
const DEFAULT_AZURE_VOICE: Record<string, string> = {
  egyptian: "ar-EG-ShakirNeural",
  egypt: "ar-EG-ShakirNeural",
  // Real native Yemeni neural voices — more authentic than routing Yemeni
  // through Munsit's Gulf/Khaleeji voice.
  yemeni: "ar-YE-MaryamNeural",
  yemen: "ar-YE-MaryamNeural",
};

function defaultAzureVoiceFor(dialect: DialectHint): string | undefined {
  if (!dialect) return undefined;
  return DEFAULT_AZURE_VOICE[String(dialect).toLowerCase()];
}

// Hard ceiling on any single TTS request. Also the safety valve for the munsit
// serial queue below — see tryFetch for why an unbounded request is dangerous.
const TTS_FETCH_TIMEOUT_MS = 12_000;

// Module-level serial queue for Munsit requests. Munsit's plan caps concurrent
// requests (and we want to avoid 429s entirely), so we funnel every munsit-tts
// fetch through a single-slot mutex. Azure has no such limit and is unaffected.
let munsitChain: Promise<unknown> = Promise.resolve();
function runOnMunsit<T>(task: () => Promise<T>): Promise<T> {
  const next = munsitChain.then(task, task);
  munsitChain = next.catch(() => {});
  return next;
}


/**
 * Hook that generates speech from Arabic text via the appropriate TTS edge
 * function: `munsit-tts` for Gulf words (Arabic-native voice), `azure-tts`
 * for everything else.
 *
 * Returns a stable blob URL that is automatically revoked on unmount or when
 * the text/dialect changes.  Skips the request when `skip` is true.
 */
export function useAzureTTS({ text, skip = false, dialect, voice, persist }: UseAzureTTSOptions): UseAzureTTSResult {
  const { activeDialect } = useDialect();
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  // Latest persist callback — read inside generate() so we don't restart on
  // identity changes of the function passed in by the caller.
  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; }, [persist]);

  // Explicit `dialect` prop wins; otherwise fall back to the global active dialect
  // so all Gulf playback automatically routes through Munsit.
  const effectiveDialect = dialect ?? activeDialect;
  const useMunsit = isMunsitDialect(effectiveDialect);
  // Explicit `voice` prop wins; otherwise auto-select a dialect-correct Azure
  // voice so non-Gulf playback isn't silently voiced in azure-tts's Gulf default.
  const effectiveVoice = voice ?? defaultAzureVoiceFor(effectiveDialect);

  const revokePreviousUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const generate = useCallback(async (reqId: number) => {
    setIsLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? anonKey;

      const endpoint = useMunsit ? "munsit-tts" : "azure-tts";

      // Always bound the request. Munsit calls are serialized through a
      // single-slot module mutex (runOnMunsit); without a timeout a single hung
      // fetch would leave that chain pending forever and deadlock ALL Gulf TTS
      // for the rest of the session. The abort guarantees the task settles.
      const tryFetch = async (fnName: string) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);
        try {
          return await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: anonKey,
            },
            body: JSON.stringify(
              fnName === "azure-tts" && effectiveVoice ? { text, voice: effectiveVoice } : { text },
            ),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };

      let response = useMunsit
        ? await runOnMunsit(() => tryFetch(endpoint))
        : await tryFetch(endpoint);

      // Munsit may return 200 with { fallback: true } on quota/rate-limit errors.
      let shouldFallback = !response.ok;
      if (response.ok && useMunsit) {
        const ct = response.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try {
            const j = await response.clone().json();
            if (j?.fallback) shouldFallback = true;
          } catch { /* ignore */ }
        }
      }

      if (shouldFallback && useMunsit) {
        console.warn(`munsit-tts unavailable (${response.status}); falling back to azure-tts`);
        response = await tryFetch("azure-tts");
      }


      if (reqId !== requestIdRef.current) return;

      if (response.ok && (response.headers.get("content-type") ?? "").startsWith("audio/")) {
        const blob = await response.blob();
        revokePreviousUrl();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setTtsUrl(url);
        // Persist to storage so we never resynthesize this text again.
        const cb = persistRef.current;
        if (cb) {
          Promise.resolve()
            .then(() => cb(blob))
            .catch((err) => console.error("TTS persist failed:", err));
        }
      }
    } catch (err) {
      console.error("TTS generation failed:", err);
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [text, useMunsit, effectiveVoice, revokePreviousUrl]);

  useEffect(() => {
    if (skip || !text) {
      revokePreviousUrl();
      setTtsUrl(null);
      return;
    }

    const reqId = ++requestIdRef.current;
    generate(reqId);

    return () => {
      requestIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, skip, useMunsit, effectiveVoice]);

  useEffect(() => {
    return () => {
      revokePreviousUrl();
    };
  }, [revokePreviousUrl]);

  const regenerate = useCallback(() => {
    const reqId = ++requestIdRef.current;
    generate(reqId);
  }, [generate]);

  return { ttsUrl, isLoading, regenerate };
}

