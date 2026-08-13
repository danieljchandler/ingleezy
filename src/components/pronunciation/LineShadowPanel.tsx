/**
 * LineShadowPanel — inline "repeat after the native speaker" panel shown under
 * a single Discovery transcript line.
 *
 * Flow: idle → playing-clip → recording → scoring → result. The reference is
 * ALWAYS the native clip (YouTube segment or extracted audio), and scoring is
 * anchored to that clip (transcript + acoustic match), not a generic model.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Loader2, RotateCcw, Volume2, AlertCircle, X, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipSourcePlayer, type ClipSourcePlayerHandle, type ExternalYouTubeController } from "./ClipSourcePlayer";
import { CountdownRing } from "./CountdownRing";
import { LevelMeter } from "./LevelMeter";
import { useShadowRecorder } from "@/hooks/useShadowRecorder";
import { useShadowScore } from "@/hooks/useShadowScore";
import { scoreBand } from "@/hooks/useAzurePronunciation";
import type { ShadowClip } from "@/hooks/useShadowQueue";

interface Props {
  clip: ShadowClip;
  /** Native clip audio (WAV) — enables the acoustic component when present. */
  nativeClipWav?: Blob | null;
  /** Drives an already-existing YouTube player (e.g. the page's main video) instead of a fresh hidden iframe. */
  externalYouTubeController?: ExternalYouTubeController | null;
  onClose: () => void;
}

type State = "idle" | "playing" | "recording" | "scoring" | "result" | "error";

export function LineShadowPanel({ clip, nativeClipWav, externalYouTubeController, onClose }: Props) {
  const playerRef = useRef<ClipSourcePlayerHandle>(null);
  const recorder = useShadowRecorder();
  const { score, result, isLoading, error: scoreError, reset } = useShadowScore();
  const [state, setState] = useState<State>("idle");
  const [rate, setRate] = useState<1 | 0.75 | 0.5>(1);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const clipDurationMs = Math.max(800, (clip.endSec - clip.startSec) * 1000);
  const recordWindowMs = clipDurationMs + 1500;

  useEffect(() => {
    return () => {
      recorder.stop("manual");
      playerRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const res = await score(blob, { referenceText: clip.text, nativeClipWav });
        setState(res ? "result" : "error");
      },
    });
  }, [clip.text, nativeClipWav, recordWindowMs, recorder, score]);

  const playClip = useCallback(async () => {
    setPlayerError(null);
    reset();
    setState("playing");
    const started = await playerRef.current?.play(rate);
    if (!started) setState("idle");
  }, [rate, reset]);

  const handleClipEnded = useCallback(() => {
    startRecording();
  }, [startRecording]);

  const handleLoop = useCallback(() => {
    reset();
    playClip();
  }, [playClip, reset]);

  const band = result ? scoreBand(result.overall) : null;

  return (
    <div className="mt-3 rounded-xl border-2 border-primary/30 bg-primary/[0.03] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Shadow this line</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Reference text — what the learner should repeat, always visible */}
      <div className="bg-card border-2 border-border rounded-xl p-4 text-center">
        <p className="text-2xl font-bold leading-relaxed" dir="rtl">
          {clip.text}
        </p>
        {clip.translation && <p className="text-muted-foreground text-sm mt-2">{clip.translation}</p>}
      </div>

      {/* Native source — a standalone YouTube clip needs a visible frame; audio
          and clips reusing the page's main video (no frame of their own) stay hidden */}
      <div
        className={cn(
          "w-full overflow-hidden rounded-lg border border-border bg-card",
          clip.source === "youtube" && !externalYouTubeController ? "aspect-video max-w-xs mx-auto" : "h-0 invisible",
        )}
      >
        <ClipSourcePlayer
          ref={playerRef}
          clip={clip}
          externalYouTubeController={externalYouTubeController}
          onEnded={handleClipEnded}
          onError={setPlayerError}
          className="w-full h-full"
        />
      </div>

      {/* Speed + listen */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([1, 0.75, 0.5] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={cn(
                "px-2 py-0.5 text-xs font-medium rounded-md transition-colors",
                rate === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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
          {state === "playing" ? "Listening…" : "Listen & repeat"}
        </Button>
      </div>

      {/* Mic / countdown */}
      <div className="flex flex-col items-center gap-2 py-1">
        {state === "idle" && (
          <Button size="lg" onClick={playClip} className="rounded-full h-16 w-16 p-0">
            <Volume2 className="h-6 w-6" />
          </Button>
        )}

        {state === "playing" && (
          <CountdownRing durationMs={clipDurationMs} className="w-16 h-16" colorClass="text-primary">
            <Volume2 className="h-6 w-6 text-primary" />
          </CountdownRing>
        )}

        {state === "recording" && (
          <div className="flex flex-col items-center gap-2 w-full">
            <CountdownRing durationMs={recordWindowMs} className="w-16 h-16" colorClass="text-destructive">
              <button
                onClick={() => recorder.stop("manual")}
                className="h-11 w-11 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center animate-pulse"
                aria-label="Stop recording"
              >
                <Mic className="h-5 w-5" />
              </button>
            </CountdownRing>
            <p className="text-xs text-muted-foreground">Repeat now</p>
            <div className="w-full max-w-xs">
              <LevelMeter level={recorder.level} />
            </div>
          </div>
        )}

        {(state === "scoring" || isLoading) && (
          <div className="flex flex-col items-center gap-2 py-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Comparing to the clip…</p>
          </div>
        )}

        {(playerError || recorder.error || scoreError) && state !== "recording" && (
          <div className="text-xs text-destructive text-center flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {playerError || recorder.error || scoreError}
            {recorder.permissionDenied && <span className="text-muted-foreground">— enable mic access.</span>}
          </div>
        )}
      </div>

      {/* Result */}
      {result && band && state === "result" && (
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 space-y-3">
          <div className="flex items-center justify-center gap-4">
            <div
              className={cn(
                "inline-flex items-center justify-center w-16 h-16 rounded-full border-4",
                result.overall >= 90
                  ? "border-green-500"
                  : result.overall >= 75
                    ? "border-blue-500"
                    : result.overall >= 60
                      ? "border-yellow-500"
                      : "border-red-500",
              )}
            >
              <span className={cn("text-xl font-bold", band.color)}>{Math.round(result.overall)}</span>
            </div>
            <div className="text-left">
              <p className={cn("text-sm font-semibold", band.color)}>{band.label}</p>
              <p className="text-[11px] text-muted-foreground">
                Words {result.transcriptSimilarity}
                {result.acousticSimilarity != null && ` · Sound ${result.acousticSimilarity}`}
              </p>
              {result.recognizedText && (
                <p className="text-[11px] text-muted-foreground mt-0.5 max-w-[180px] truncate" dir="rtl">
                  Heard: {result.recognizedText}
                </p>
              )}
            </div>
          </div>

          {result.tips.length > 0 && (
            <ul className="space-y-1.5">
              {result.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleLoop}>
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <Button size="sm" variant="ghost" className="flex-1" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}

      {state === "error" && !result && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleLoop}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Try again
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
