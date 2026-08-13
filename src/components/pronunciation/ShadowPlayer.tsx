/**
 * ShadowPlayer — orchestrates one shadowing take:
 *   idle → playing-clip → echo-window (recording) → scoring → result
 *
 * Pure UI + state. Reference audio is ALWAYS the native clip — never TTS.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, RotateCcw, ArrowRight, Volume2, Gauge, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipSourcePlayer, type ClipSourcePlayerHandle } from "./ClipSourcePlayer";
import { CountdownRing } from "./CountdownRing";
import { LevelMeter } from "./LevelMeter";
import { useShadowRecorder } from "@/hooks/useShadowRecorder";
import { useAzurePronunciation, scoreBand } from "@/hooks/useAzurePronunciation";
import type { ShadowClip } from "@/hooks/useShadowQueue";

interface Props {
  clip: ShadowClip;
  threshold: number;
  autoAdvance: boolean;
  showEnglish: boolean;
  onResult: (overall: number) => void;
  onNext: () => void;
}

type State = "idle" | "playing" | "recording" | "scoring" | "result" | "error";

export function ShadowPlayer({ clip, threshold, autoAdvance, showEnglish, onResult, onNext }: Props) {
  const playerRef = useRef<ClipSourcePlayerHandle>(null);
  const recorder = useShadowRecorder();
  const { assess, result, isLoading, error: scoreError, reset } = useAzurePronunciation();
  const [state, setState] = useState<State>("idle");
  const [rate, setRate] = useState<1 | 0.75 | 0.5>(1);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipDurationMs = Math.max(800, (clip.endSec - clip.startSec) * 1000);
  const recordWindowMs = clipDurationMs + 1500;

  // Reset on clip change
  useEffect(() => {
    reset();
    setState("idle");
    setPlayerError(null);
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
      recorder.stop("manual");
      playerRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const startRecording = useCallback(() => {
    setState("recording");
    recorder.start({
      maxDurationMs: recordWindowMs,
      trailingSilenceMs: 600,
      onComplete: async (blob, reason) => {
        if (!blob) {
          setState("error");
          setPlayerError(reason === "no-audio" ? "We didn't hear you — try again." : "Recording failed");
          return;
        }
        setState("scoring");
        const res = await assess(blob, clip.text, clip.locale);
        if (res) {
          setState("result");
          onResult(res.overall);
          if (autoAdvance && res.overall >= threshold) {
            autoAdvanceTimerRef.current = setTimeout(onNext, 1400);
          }
        } else {
          setState("error");
        }
      },
    });
  }, [assess, autoAdvance, clip.locale, clip.text, onNext, onResult, recordWindowMs, recorder, threshold]);

  const playClip = useCallback(async () => {
    setPlayerError(null);
    reset();
    setState("playing");
    const started = await playerRef.current?.play(rate);
    if (!started) setState("idle");
  }, [rate, reset]);

  const handleClipEnded = useCallback(() => {
    // Auto-open mic the moment the native source has paused
    startRecording();
  }, [startRecording]);

  const handleLoop = useCallback(() => {
    reset();
    playClip();
  }, [playClip, reset]);

  const band = result ? scoreBand(result.overall) : null;
  const passed = result && result.overall >= threshold;

  return (
    <div className="space-y-4">
      {/* Source player — invisible iframe wrapped for layout; YouTube needs to mount */}
      <div className={cn(
        "w-full overflow-hidden rounded-xl border-2 border-border bg-card",
        clip.source === "youtube" ? "aspect-video" : "h-0 invisible"
      )}>
        <ClipSourcePlayer ref={playerRef} clip={clip} onEnded={handleClipEnded} onError={setPlayerError} className="w-full h-full" />
      </div>

      {/* Reference text card */}
      <div className="bg-card border-2 border-border rounded-2xl p-6 text-center">
        <p className="text-3xl font-bold leading-relaxed" dir="rtl">{clip.text}</p>
        {showEnglish && clip.translation && (
          <p className="text-muted-foreground text-base mt-3 animate-in fade-in">{clip.translation}</p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-3 truncate">
          {clip.dialect} · {clip.sourceTitle}
        </p>
      </div>

      {/* Speed + listen controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([1, 0.75, 0.5] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                rate === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r === 1 ? "1×" : r === 0.75 ? "0.75×" : "0.5×"}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={playClip}
          disabled={state === "playing" || state === "recording" || state === "scoring"}
          className="gap-2"
        >
          <Volume2 className="h-4 w-4" />
          {state === "playing" ? "Listening…" : "Listen"}
        </Button>
      </div>

      {/* Mic / countdown area */}
      <div className="flex flex-col items-center gap-3 py-2">
        {state === "idle" && (
          <Button size="lg" onClick={playClip} className="rounded-full h-20 w-20 p-0">
            <Volume2 className="h-7 w-7" />
          </Button>
        )}

        {state === "playing" && (
          <div className="flex flex-col items-center gap-2">
            <CountdownRing durationMs={clipDurationMs} className="w-20 h-20" colorClass="text-primary">
              <Volume2 className="h-7 w-7 text-primary" />
            </CountdownRing>
            <p className="text-xs text-muted-foreground">Listen carefully…</p>
          </div>
        )}

        {state === "recording" && (
          <div className="flex flex-col items-center gap-2 w-full">
            <CountdownRing durationMs={recordWindowMs} className="w-20 h-20" colorClass="text-destructive">
              <button
                onClick={() => recorder.stop("manual")}
                className="h-14 w-14 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center animate-pulse"
                aria-label="Stop recording"
              >
                <Mic className="h-6 w-6" />
              </button>
            </CountdownRing>
            <p className="text-xs text-muted-foreground">Repeat now</p>
            <div className="w-full max-w-xs">
              <LevelMeter level={recorder.level} />
            </div>
          </div>
        )}

        {(state === "scoring" || isLoading) && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scoring…</p>
          </div>
        )}

        {(playerError || recorder.error || scoreError) && state !== "recording" && (
          <div className="text-sm text-destructive text-center flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {playerError || recorder.error || scoreError}
            {recorder.permissionDenied && (
              <span className="text-muted-foreground">— enable mic access in your browser.</span>
            )}
          </div>
        )}
      </div>

      {/* Result + actions */}
      {result && band && state === "result" && (
        <div className="bg-card border-2 border-border rounded-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className={cn(
              "inline-flex items-center justify-center w-20 h-20 rounded-full border-4",
              result.overall >= 90 ? "border-green-500" :
              result.overall >= 75 ? "border-blue-500" :
              result.overall >= 60 ? "border-yellow-500" : "border-red-500"
            )}>
              <span className={cn("text-2xl font-bold", band.color)}>{Math.round(result.overall)}</span>
            </div>
            <div>
              <p className={cn("text-base font-semibold", band.color)}>{band.label}</p>
              <p className="text-xs text-muted-foreground">
                Acc {Math.round(result.accuracy)} · Flu {Math.round(result.fluency)} · Comp {Math.round(result.completeness)}
              </p>
              {passed && autoAdvance && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1"><Gauge className="h-3 w-3" /> Advancing…</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 gap-1.5" onClick={handleLoop}>
              <RotateCcw className="h-4 w-4" />
              Loop
            </Button>
            <Button className="flex-1 gap-1.5" onClick={() => { if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current); onNext(); }}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {state === "error" && !result && (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleLoop}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Try again
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onNext}>
            Skip <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
