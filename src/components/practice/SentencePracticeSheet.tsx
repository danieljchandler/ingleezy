import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Square, RefreshCw, Sparkles, CheckCircle2, XCircle, Lightbulb } from "lucide-react";
import { LevelMeter } from "@/components/pronunciation/LevelMeter";
import { useShadowRecorder } from "@/hooks/useShadowRecorder";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// The learner speaks ENGLISH here; feedback comes back bilingual — natural
// English rewrites with dialect-Arabic glosses, and verdict/tips written in
// the learner's own dialect. interference_notes name the Arabic-transfer
// patterns the coach heard (the L1-aware part of the coaching).
interface Feedback {
  used_target_word?: boolean;
  understandable?: boolean;
  verdict_ar?: string;
  natural_rewrite?: string;
  natural_rewrite_arabic?: string;
  alternatives?: Array<{ english: string; arabic: string }>;
  tips_ar?: string[];
  interference_notes?: Array<{ category: string; note_ar: string }>;
  transcript?: string;
  empty?: boolean;
  message?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The English word/phrase being practised. */
  targetEnglish: string;
  /** Its gloss in the learner's dialect (scaffold). */
  targetArabic?: string;
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

export function SentencePracticeSheet({ open, onOpenChange, targetEnglish, targetArabic }: Props) {
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
            targetEnglish,
            targetArabic,
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
    [targetEnglish, targetArabic, activeDialect],
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
          setError("ما سمعنا شي — جرّب مرة ثانية بصوت أعلى.");
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
            Say an English sentence using{" "}
            <span className="font-english font-semibold text-foreground">{targetEnglish}</span>
            {targetArabic ? (
              <>
                {" "}
                (<span dir="rtl" className="font-arabic">{targetArabic}</span>)
              </>
            ) : null}
            . Speak naturally — pronunciation doesn't need to be perfect.
          </SheetDescription>
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
                    {feedback || error ? "جرّب مرة ثانية" : "ابدأ التسجيل"}
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
                    <span className="text-sm">نسمعك ونجهّز الملاحظات…</span>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {isRecording
                    ? "نسجّل — يوقف تلقائياً بعد سكتة قصيرة."
                    : "يسجّل لين ١٥ ثانية."}
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
                      <p className="font-english text-lg leading-relaxed">{feedback.transcript}</p>
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

                  {feedback.verdict_ar && (
                    <p dir="rtl" className="font-arabic text-sm text-foreground">
                      {feedback.verdict_ar}
                    </p>
                  )}

                  {feedback.natural_rewrite && (
                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                        More natural
                      </p>
                      <p className="font-english text-lg leading-relaxed">
                        {feedback.natural_rewrite}
                      </p>
                      {feedback.natural_rewrite_arabic && (
                        <p dir="rtl" className="mt-1.5 font-arabic text-sm text-muted-foreground">
                          {feedback.natural_rewrite_arabic}
                        </p>
                      )}
                    </div>
                  )}

                  {feedback.interference_notes && feedback.interference_notes.length > 0 && (
                    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                        <Lightbulb className="h-3.5 w-3.5 text-accent" />
                        From Arabic to English
                      </p>
                      <ul className="space-y-1.5 text-sm">
                        {feedback.interference_notes.map((note, i) => (
                          <li key={i} className="flex gap-2 items-baseline">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                              {note.category}
                            </span>
                            <span dir="rtl" className="font-arabic flex-1 text-right">
                              {note.note_ar}
                            </span>
                          </li>
                        ))}
                      </ul>
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
                            <p className="font-english text-base leading-relaxed">{alt.english}</p>
                            {alt.arabic && (
                              <p dir="rtl" className="mt-1 font-arabic text-xs text-muted-foreground">
                                {alt.arabic}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {feedback.tips_ar && feedback.tips_ar.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Tips
                      </p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {feedback.tips_ar.map((tip, i) => (
                          <li key={i} className="flex gap-2 flex-row-reverse">
                            <span className="text-primary">•</span>
                            <span dir="rtl" className="font-arabic flex-1 text-right">{tip}</span>
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
