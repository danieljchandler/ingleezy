import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, RotateCcw, Loader2, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAzurePronunciation,
  scoreBand,
  type PronunciationResult,
  type WordResult,
} from "@/hooks/useAzurePronunciation";
import { supabase } from "@/integrations/supabase/client";

interface PronunciationButtonProps {
  /** English word/phrase the learner should say */
  word: string;
  /** Arabic meaning (used for AI coaching context) */
  gloss?: string;
  /** BCP-47 locale, default en-US — the target language is English */
  locale?: string;
}

const MAX_DURATION_MS = 5000;

export const PronunciationButton = ({
  word,
  gloss,
  locale: localeProp,
}: PronunciationButtonProps) => {
  const locale = localeProp ?? "en-US";
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // AI coaching tips state
  const [tips, setTips] = useState<string[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  // Reset when the target word changes (e.g. moving to next flashcard)
  useEffect(() => {
    reset();
    setTips([]);
  }, [word, reset]);

  // Fetch coaching tips when result arrives
  useEffect(() => {
    if (!result) {
      setTips([]);
      return;
    }

    let cancelled = false;
    const fetchTips = async () => {
      setTipsLoading(true);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "pronunciation-feedback",
          {
            body: {
              word_arabic: gloss || "",
              word_english: word,
              scores: result,
              dialect: locale,
            },
          }
        );
        if (!cancelled && !fnError && data?.tips) {
          setTips(data.tips);
        }
      } catch {
        // Silently fail — tips are optional
      } finally {
        if (!cancelled) setTipsLoading(false);
      }
    };
    fetchTips();
    return () => { cancelled = true; };
  }, [result, word, gloss, locale]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    clearTimeout(timerRef.current);
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    reset();
    setTips([]);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          await assess(blob, word, locale);
        }
      };

      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, MAX_DURATION_MS);
    } catch {
      console.error("Microphone access denied");
    }
  }, [word, locale, assess, reset]);

  const handleTryAgain = () => {
    reset();
    setTips([]);
  };

  const isSingleWord = word.trim().split(/\s+/).length === 1;
  const displayScore = result
    ? Math.round(isSingleWord ? result.accuracy : result.overall)
    : 0;
  const band = result ? scoreBand(displayScore) : null;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Mic button */}
      {!result && !isLoading && (
        <Button
          variant="outline"
          size="sm"
          onClick={isRecording ? stopRecording : startRecording}
          className={`gap-2 ${isRecording ? "border-destructive text-destructive animate-pulse" : ""}`}
        >
          {isRecording ? (
            <>
              <MicOff className="h-4 w-4" />
              إيقاف
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" />
              انطقها 🎤
            </>
          )}
        </Button>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          يتم فحص النطق…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive text-center">
          {error}
          <Button variant="ghost" size="sm" onClick={handleTryAgain} className="ms-2">
            <RotateCcw className="h-3.5 w-3.5 me-1" />
            أعد المحاولة
          </Button>
        </div>
      )}

      {/* Results */}
      {result && band && (
        <div className="w-full max-w-xs rounded-xl bg-card border border-border p-4 text-center animate-in fade-in duration-300">
          <div className="mb-2">
            <span className={`text-3xl font-bold ${band.color}`}>
              {displayScore}
            </span>
            <span className="text-sm text-muted-foreground ms-1">/ 100</span>
          </div>
          <p className={`text-sm font-medium mb-3 ${band.color}`}>{band.label}</p>

          {/* Sub-scores for phrases */}
          {!isSingleWord && (
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-4">
              <div>
                <p className="font-medium text-foreground">{Math.round(result.accuracy)}</p>
                <p>الدقة</p>
              </div>
              <div>
                <p className="font-medium text-foreground">{Math.round(result.fluency)}</p>
                <p>الطلاقة</p>
              </div>
              <div>
                <p className="font-medium text-foreground">{Math.round(result.completeness)}</p>
                <p>الاكتمال</p>
              </div>
            </div>
          )}

          {/* Per-word breakdown for phrases */}
          {!isSingleWord && result.words.length > 1 && (
            <div className="font-english flex flex-wrap justify-center gap-2 mb-4">
              {result.words.map((w: WordResult, i: number) => {
                const wb = scoreBand(w.accuracy);
                return (
                  <span
                    key={i}
                    className={`px-2 py-0.5 rounded-md text-sm font-medium bg-muted ${wb.color}`}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          )}

          {/* AI Coaching Tips */}
          {tipsLoading && (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}

          {tips.length > 0 && (
            <div className="mt-3 text-left bg-muted/50 rounded-lg p-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb className="h-3.5 w-3.5 text-yellow-500" />
                <span className="text-xs font-medium text-muted-foreground">نصائح</span>
              </div>
              <ul className="space-y-1.5">
                {tips.map((tip, i) => (
                  <li key={i} className="text-xs text-foreground leading-relaxed">
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={handleTryAgain} className="gap-1.5 mt-3">
            <RotateCcw className="h-3.5 w-3.5" />
            حاول من جديد
          </Button>
        </div>
      )}
    </div>
  );
};
