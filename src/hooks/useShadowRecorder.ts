/**
 * useShadowRecorder — MediaRecorder wrapper with live RMS level and
 * trailing-silence auto-stop. Optimised for short shadowing takes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface StartOptions {
  /** Hard cap in ms regardless of silence detection */
  maxDurationMs: number;
  /** Stop after this much trailing silence (default 600ms) */
  trailingSilenceMs?: number;
  /** RMS threshold considered "speech" (0-1, default 0.02) */
  speechThreshold?: number;
  /** Called when recording stops with the final blob (or null on error/empty) */
  onComplete: (blob: Blob | null, reason: "silence" | "manual" | "timeout" | "no-audio") => void;
}

export function useShadowRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const speechSeenRef = useRef(false);
  const lastSpeechAtRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const hardCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopReasonRef = useRef<"silence" | "manual" | "timeout" | "no-audio">("manual");
  const onCompleteRef = useRef<StartOptions["onComplete"] | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (hardCapRef.current) clearTimeout(hardCapRef.current);
    hardCapRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback((reason: "silence" | "manual" | "timeout" | "no-audio" = "manual") => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      stopReasonRef.current = reason;
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(
    async ({ maxDurationMs, trailingSilenceMs = 600, speechThreshold = 0.02, onComplete }: StartOptions) => {
      setError(null);
      speechSeenRef.current = false;
      stopReasonRef.current = "manual";
      chunksRef.current = [];
      onCompleteRef.current = onComplete;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
        setPermissionDenied(false);

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const reason = stopReasonRef.current;
          const finalReason = !speechSeenRef.current || blob.size < 4096 ? "no-audio" : reason;
          cleanup();
          setIsRecording(false);
          onCompleteRef.current?.(finalReason === "no-audio" ? null : blob, finalReason);
        };

        // AudioContext for live RMS
        const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyserRef.current = analyser;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        startedAtRef.current = performance.now();
        lastSpeechAtRef.current = startedAtRef.current;

        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 6));
          const now = performance.now();
          if (rms > speechThreshold) {
            speechSeenRef.current = true;
            lastSpeechAtRef.current = now;
          }
          // Trailing-silence auto-stop, only after we've heard speech and at least 500ms elapsed
          if (
            speechSeenRef.current &&
            now - startedAtRef.current > 500 &&
            now - lastSpeechAtRef.current > trailingSilenceMs
          ) {
            stop("silence");
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        hardCapRef.current = setTimeout(() => stop("timeout"), maxDurationMs);

        recorder.start();
        setIsRecording(true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const denied = /denied|permission|NotAllowed/i.test(msg);
        setPermissionDenied(denied);
        setError(denied ? "Microphone access denied" : msg);
        cleanup();
        setIsRecording(false);
      }
    },
    [cleanup, stop]
  );

  useEffect(() => cleanup, [cleanup]);

  return { start, stop, isRecording, level, error, permissionDenied };
}
