// LiveVoicePanel — push-to-talk-free voice call panel for the Conversation
// Simulator. Mic is hot whenever the session is "live"; user can mute or end.
// Streams partial transcripts inline; final turns get pushed back to the
// parent for inclusion in the saved chat log.

import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, PhoneOff, Radio, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Art } from "@/components/brand/Art";
import { useOpenAIRealtime } from "@/hooks/useOpenAIRealtime";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";

interface Props {
  dialect: string;
  difficulty: string;
  topicHint?: string;
  onTurnFinalized?: (turn: { role: "user" | "assistant"; text: string }) => void;
  onExitLive: () => void;
}

export function LiveVoicePanel({
  dialect,
  difficulty,
  topicHint,
  onTurnFinalized,
  onExitLive,
}: Props) {
  const { status, error, turns, muted, setMuted, start, stop } = useOpenAIRealtime({
    onTurnFinalized,
  });

  // Auto-start when mounted.
  useEffect(() => {
    start({ dialect, difficulty, topicHint });
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "connecting": return "جارٍ الاتصال…";
      case "live": return muted ? "الميكروفون مكتوم" : "أستمع إليك";
      case "ending": return "جارٍ الإنهاء…";
      case "error": return "انقطع الاتصال";
      default: return "في الانتظار";
    }
  }, [status, muted]);

  const handleEnd = () => {
    stop();
    onExitLive();
  };

  return (
    <section
      aria-label="مكالمة مع المعلّم"
      className="flex flex-col overflow-hidden rounded-[28px] bg-card shadow-card"
    >
      {/* The microphone over the wash, as on the Talk tab, floating while the
          tutor is listening. The status sits under it, large enough to read at
          arm's length while talking. */}
      <div className="flex flex-col items-center bg-wash-panel px-5 pb-5 pt-5 text-center">
        <Art
          name="mic"
          eager
          className={cn("h-36 w-36", status === "live" && !muted && "animate-float")}
        />
        <div className="mt-1 flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card shadow-soft",
              status === "error" ? "text-destructive" : "text-primary",
            )}
          >
            {status === "connecting" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : status === "live" ? (
              <Radio className={cn("h-5 w-5", muted ? "text-muted-foreground" : "animate-pulse")} />
            ) : status === "error" ? (
              <AlertCircle className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </span>
          <p className="font-heading text-[22px] leading-8">{statusLabel}</p>
        </div>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">مكالمة مباشرة • {dialect}</p>
      </div>

      <div className="flex flex-col gap-4 p-5 pt-4">
        {error && (
          <div className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Transcript */}
        <div className="flex min-h-[160px] max-h-[40dvh] flex-col gap-2 overflow-y-auto rounded-3xl bg-muted/60 p-3">
          {turns.length === 0 ? (
            <p className="m-auto py-8 text-center text-sm text-muted-foreground">
              {status === "live"
                ? "ابدأ الكلام بالإنجليزية…"
                : status === "connecting"
                ? "جارٍ تجهيز المكالمة…"
                : "اضغط «إنهاء المكالمة» للخروج."}
            </p>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                data-turn={t.role}
                className={cn(
                  "max-w-[85%] rounded-[20px] px-3.5 py-2.5",
                  t.role === "user"
                    ? "self-end rounded-se-md bg-tint-firoza"
                    : "self-start rounded-ss-md bg-card shadow-soft",
                  t.partial && "opacity-70",
                )}
              >
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span>{t.role === "user" ? "أنت" : "المعلّم"}</span>
                  {t.role === "assistant" && t.hasDialectDrift && (
                    <span className="rounded-full bg-tint-gold px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
                      خرج عن الإنجليزي
                    </span>
                  )}
                </div>
                {t.role === "assistant" ? (
                  <TappableEnglishText text={t.text} source="conversation-live" className="text-base leading-6" />
                ) : (
                  <div dir="auto" className="font-english text-base leading-6">{t.text}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant={muted ? "default" : "outline"}
            size="icon"
            className="h-14 w-14"
            onClick={() => setMuted(!muted)}
            disabled={status !== "live"}
            aria-label={muted ? "إلغاء الكتم" : "كتم الميكروفون"}
          >
            {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>
          <Button
            variant="destructive"
            onClick={handleEnd}
            className="h-14 flex-1 gap-2 text-base font-semibold sm:flex-none sm:px-8"
          >
            <PhoneOff className="h-5 w-5" />
            إنهاء المكالمة
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          الصوت عبر ChatGPT Realtime. الأفضل على Chrome أو Edge.
        </p>
      </div>
    </section>
  );
}
