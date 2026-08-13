// LiveVoicePanel — push-to-talk-free voice call panel for the Conversation
// Simulator. Mic is hot whenever the session is "live"; user can mute or end.
// Streams partial transcripts inline; final turns get pushed back to the
// parent for inclusion in the saved chat log.

import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, PhoneOff, Radio, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpenAIRealtime } from "@/hooks/useOpenAIRealtime";
import { TappableArabicText } from "@/components/shared/TappableArabicText";

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
      case "connecting": return "Connecting…";
      case "live": return muted ? "Muted" : "Listening";
      case "ending": return "Ending…";
      case "error": return "Disconnected";
      default: return "Idle";
    }
  }, [status, muted]);

  const handleEnd = () => {
    stop();
    onExitLive();
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-primary/30 bg-card p-4 shadow-md">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "connecting" ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : status === "live" ? (
            <Radio className={cn("h-4 w-4", muted ? "text-muted-foreground" : "text-primary animate-pulse")} />
          ) : status === "error" ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : null}
          <span className="text-sm font-medium">{statusLabel}</span>
        </div>
        <span className="text-xs text-muted-foreground">Live voice • {dialect}</span>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Transcript */}
      <div className="min-h-[180px] max-h-[40vh] overflow-y-auto space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
        {turns.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            {status === "live"
              ? "Just start speaking…"
              : status === "connecting"
              ? "Setting up the call…"
              : "Tap End to leave."}
          </p>
        ) : (
          turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2",
                t.role === "user"
                  ? "bg-primary/10 ml-auto max-w-[85%]"
                  : "bg-background border border-border max-w-[85%]",
                t.partial && "opacity-70",
              )}
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1.5">
                <span>{t.role === "user" ? "You" : "Tutor"}</span>
                {t.role === "assistant" && t.hasDialectDrift && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 normal-case tracking-normal">
                    used MSA
                  </span>
                )}
              </div>
              {t.role === "assistant" ? (
                <TappableArabicText text={t.text} source="conversation-live" />
              ) : (
                <div dir="auto" className="leading-snug">{t.text}</div>
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
          onClick={() => setMuted(!muted)}
          disabled={status !== "live"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Button
          variant="destructive"
          onClick={handleEnd}
          className="gap-2"
        >
          <PhoneOff className="h-4 w-4" />
          End call
        </Button>
      </div>

      <p className="text-[11px] text-center text-muted-foreground">
        Voice powered by ChatGPT Realtime. Best on Chrome or Edge.
      </p>
    </div>
  );
}
