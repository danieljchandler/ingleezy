import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Square, RefreshCw, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { LevelMeter } from "@/components/pronunciation/LevelMeter";
import { useShadowRecorder } from "@/hooks/useShadowRecorder";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Feedback {
  used_target_word?: boolean;
  understandable?: boolean;
  verdict?: string;
  natural_rewrite?: string;
  natural_rewrite_english?: string;
  alternatives?: Array<{ arabic: string; english: string }>;
  tips?: string[];
  transcript?: string;
  empty?: boolean;
  message?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetArabic: string;
  targetEnglish?: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function SentencePracticeSheet({ open, onOpenChange, targetArabic, targetEnglish }: Props) {
  const { activeDialect } = useDialect();
  const { start, stop, isRecording, level, permissionDenied } = useShadowRecorder();
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(open);

  useEffect(() => {
    activeRef.current = open;
    if (!open) {
      setFeedback(null);
      setError(null);
    }
  }, [open]);

  const submitAudio = useCallback(
    async (blob: Blob) => {
      setLoading(true);
      setError(null);
      try {
        const audioBase64 = await blobToBase64(blob);
        const { data, error: fnErr } = await supabase.functions.invoke("practice-sentence-coach", {
          body: {
            audioBase64,
            mimeType: blob.type,
            targetArabic,
            targetEnglish,
            dialect: activeDialect,
          },
        });
        if (fnErr) throw fnErr;
        if ((data as { error?: string })?.error) {
          throw new Error((data as { error: string }).error);
        }
        setFeedback(data as Feedback);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[SentencePractice] failed:", err);
        setError(msg);
        toast.error("Couldn't get feedback — try again");
      } finally {
        setLoading(false);
      }
    },
    [targetArabic, targetEnglish, activeDialect],
  );

  const beginRecord = useCallback(() => {
    setFeedback(null);
    setError(null);
    start({
      maxDurationMs: 15_000,
      trailingSilenceMs: 1200,
      onComplete: (blob, reason) => {
        if (!activeRef.current) return;
        if (!blob || reason === "no-audio") {
          setError("We didn't catch any speech — try again a little louder.");
          return;
        }
        submitAudio(blob);
      },
    });
  }, [start, submitAudio]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Practice a sentence
          </SheetTitle>
          <SheetDescription>
            Say a sentence using{" "}
            <span
              dir="rtl"
              className="font-semibold text-foreground"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
            >
              {targetArabic}
            </span>
            {targetEnglish ? <> ({targetEnglish})</> : null}. Speak naturally — pronunciation doesn't
            need to be perfect.
          </SheetDescription>
          <div className="flex justify-start pt-1">
            <AskAISentence arabic={targetArabic} english={targetEnglish} variant="chip" />
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Recorder */}
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            {permissionDenied ? (
              <p className="text-sm text-destructive">
                Microphone access denied. Enable it in your browser settings.
              </p>
            ) : (
              <>
                <LevelMeter level={level} className="mb-4" />
                {!isRecording && !loading && (
                  <Button onClick={beginRecord} size="lg" className="gap-2">
                    <Mic className="h-5 w-5" />
                    {feedback || error ? "Try again" : "Start recording"}
                  </Button>
                )}
                {isRecording && (
                  <Button onClick={() => stop("manual")} size="lg" variant="secondary" className="gap-2">
                    <Square className="h-5 w-5" />
                    Stop
                  </Button>
                )}
                {loading && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Listening and coaching…</span>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {isRecording
                    ? "Recording — will auto-stop after a short pause."
                    : "Records up to 15 seconds."}
                </p>
              </>
            )}
          </div>

          {error && !loading && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Feedback */}
          {feedback && !loading && (
            <div className="space-y-4">
              {feedback.empty ? (
                <p className="text-sm text-muted-foreground">{feedback.message}</p>
              ) : (
                <>
                  {feedback.transcript && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        You said
                      </p>
                      <div
                        dir="rtl"
                        className="text-lg leading-relaxed"
                        style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      >
                        <TappableArabicText text={feedback.transcript} source="sentence-practice" />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      {feedback.used_target_word ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      Used target word
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {feedback.understandable ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      Understandable
                    </span>
                  </div>

                  {feedback.verdict && (
                    <p className="text-sm text-foreground">{feedback.verdict}</p>
                  )}

                  {feedback.natural_rewrite && (
                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        More natural in {activeDialect}
                      </p>
                      <div
                        dir="rtl"
                        className="text-lg leading-relaxed"
                        style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      >
                        <TappableArabicText
                          text={feedback.natural_rewrite}
                          source="sentence-practice-rewrite"
                        />
                      </div>
                      {feedback.natural_rewrite_english && (
                        <p className="mt-1.5 text-xs text-muted-foreground italic">
                          {feedback.natural_rewrite_english}
                        </p>
                      )}
                    </div>
                  )}

                  {feedback.alternatives && feedback.alternatives.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Other ways to say it
                      </p>
                      <div className="space-y-2">
                        {feedback.alternatives.map((alt, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-border bg-background/50 p-2.5"
                          >
                            <div
                              dir="rtl"
                              className="text-base leading-relaxed"
                              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                            >
                              <TappableArabicText
                                text={alt.arabic}
                                source="sentence-practice-alt"
                              />
                            </div>
                            {alt.english && (
                              <p className="mt-1 text-xs text-muted-foreground italic">
                                {alt.english}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {feedback.tips && feedback.tips.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Tips
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {feedback.tips.map((tip, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-primary">•</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="pt-2">
                    <Button variant="ghost" size="sm" onClick={beginRecord} className="gap-1.5">
                      <RefreshCw className="h-4 w-4" />
                      Try another sentence
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
