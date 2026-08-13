import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertCircle, Crown, Loader2, Mic, MicOff, Phone, PhoneOff, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useOpenAIRealtime } from "@/hooks/useOpenAIRealtime";
import { buildPagePayload, serializePagePayload } from "@/lib/pageAiContext";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { cn } from "@/lib/utils";

/**
 * Live voice mode of the Ask AI assistant — subscribers only (the server
 * enforces it; the gate here is the honest UI for everyone else). Unlike the
 * conversation-practice panel this does NOT auto-start: a voice call costs
 * real money per minute, so it waits for an explicit tap.
 */
export function VoiceTab() {
  const { seed, pageContext } = useAiAssistant();
  const { activeDialect } = useDialect();
  const { user, loading: authLoading } = useAuth();
  const { subscribed, loading: subLoading } = useSubscription();
  const { pathname } = useLocation();
  const { status, error, turns, muted, setMuted, start, stop, remainingSeconds } = useOpenAIRealtime();

  // Closing the panel or switching tabs unmounts this component; the call must
  // not keep running (and billing) with no UI attached to it.
  useEffect(() => () => stop(), [stop]);

  const contextString = useMemo(() => {
    const page = serializePagePayload(buildPagePayload(pathname, pageContext));
    return seed
      ? `The learner opened this call about the sentence: ${seed.arabic}${seed.english ? ` (${seed.english})` : ""}\n${page}`
      : page;
  }, [pathname, pageContext, seed]);

  if (!user && !authLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">Sign in to talk to the AI tutor.</p>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!subscribed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Crown className="h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium">Live voice is a premium feature</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Talk to the AI tutor about anything on your screen — real conversation, in dialect,
          hands-free. Available on any paid plan.
        </p>
        <Button asChild size="sm">
          <Link to="/pricing">See plans</Link>
        </Button>
      </div>
    );
  }

  const live = status === "live";
  const connecting = status === "connecting";

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {turns.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {live
              ? "Just start speaking…"
              : connecting
              ? "Setting up the call…"
              : "Start a call and ask about anything on this page."}
          </p>
        ) : (
          turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2",
                t.role === "user"
                  ? "ml-auto max-w-[85%] bg-primary/10"
                  : "max-w-[85%] border border-border bg-background",
                t.partial && "opacity-70",
              )}
            >
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t.role === "user" ? "You" : "Tutor"}
              </div>
              {t.role === "assistant" ? (
                <TappableArabicText text={t.text} source="ask-ai-voice" />
              ) : (
                <div dir="auto" className="leading-snug">{t.text}</div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t p-3">
        <div className="flex items-center justify-center gap-3">
          {live || connecting ? (
            <>
              <Button
                variant={muted ? "default" : "outline"}
                size="icon"
                onClick={() => setMuted(!muted)}
                disabled={!live}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              <Button variant="destructive" onClick={() => stop()} className="gap-2">
                <PhoneOff className="h-4 w-4" />
                End call
              </Button>
            </>
          ) : (
            <Button
              onClick={() =>
                start({
                  dialect: activeDialect,
                  difficulty: "intermediate",
                  mode: "assistant",
                  context: contextString,
                })
              }
              className="gap-2"
            >
              <Phone className="h-4 w-4" />
              Start voice call
            </Button>
          )}
          {connecting && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {live && (
            <Radio className={cn("h-4 w-4", muted ? "text-muted-foreground" : "animate-pulse text-primary")} />
          )}
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          {typeof remainingSeconds === "number" && (
            <>
              <span className={cn(remainingSeconds < 300 && "font-medium text-amber-600 dark:text-amber-500")}>
                {Math.floor(remainingSeconds / 60)} min left this month
              </span>
              {" · "}
            </>
          )}
          The tutor knows what's on your screen. Voice powered by ChatGPT Realtime.
        </p>
      </div>
    </>
  );
}
