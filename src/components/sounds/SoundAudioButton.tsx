import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { cn } from "@/lib/utils";

interface SoundAudioButtonProps {
  /** English text to speak — a sound's keyword or an example word. */
  text: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  label?: string;
}

/** The one English voice this journey speaks in — see persist-word-audio for the same default. */
const ENGLISH_VOICE = "en-US-JennyNeural";

/**
 * Round speaker button for the English Sounds journey — the mirror of
 * Hakiya's LetterAudioButton, but always English.
 *
 * `useAzureTTS` picks Munsit (Arabic ASR-adjacent voice) whenever the active
 * dialect is a Gulf one, because every other caller in the app is playing
 * Arabic back to the learner. This is the one surface playing the TARGET
 * language, so it passes a `dialect` that is deliberately not in Munsit's
 * routing set — "English" — to force the Azure path regardless of which
 * Arabic dialect module the learner has active, and pins the voice rather
 * than letting the hook pick a dialect-matched Arabic one.
 */
export const SoundAudioButton = ({
  text,
  className,
  size = "md",
  autoplay = false,
  label,
}: SoundAudioButtonProps) => {
  /**
   * Synthesise on demand, not on render — same reasoning as LetterAudioButton:
   * a lesson step can put several of these on screen at once, and arming only
   * on the first tap (or an explicit `autoplay`) avoids firing a TTS request
   * for every one of them on page load.
   */
  const [armedFor, setArmedFor] = useState<string | null>(autoplay ? text : null);
  const armed = armedFor === text;
  const { ttsUrl, isLoading } = useAzureTTS({
    text,
    dialect: "English",
    voice: ENGLISH_VOICE,
    skip: !armed || !text?.trim(),
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const autoplayedRef = useRef(false);
  const pendingTapRef = useRef(false);

  useEffect(() => {
    autoplayedRef.current = false;
    if (autoplay) setArmedFor(text);
  }, [text, autoplay]);

  const play = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    setPlaying(true);
    a.onended = () => setPlaying(false);
    a.onpause = () => setPlaying(false);
    a.play().catch(() => setPlaying(false));
  };

  useEffect(() => {
    if (!ttsUrl || !armed) return;
    if (autoplay && !autoplayedRef.current) {
      autoplayedRef.current = true;
      play(ttsUrl);
      return;
    }
    if (pendingTapRef.current) {
      pendingTapRef.current = false;
      play(ttsUrl);
    }
  }, [ttsUrl, armed, autoplay]);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.src = "";
      }
    };
  }, []);

  const handlePlay = () => {
    if (ttsUrl && armed) {
      play(ttsUrl);
      return;
    }
    pendingTapRef.current = true;
    setArmedFor(text);
  };

  const sizeCls =
    size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const iconCls = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={isLoading || !text?.trim()}
      aria-label={label ?? `Play ${text}`}
      className={cn(
        "rounded-full bg-primary text-primary-foreground flex items-center justify-center",
        "shadow-md transition-all duration-200 active:scale-95",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        playing && "ring-2 ring-primary/40 ring-offset-2",
        sizeCls,
        className,
      )}
    >
      <Volume2 className={iconCls} />
    </button>
  );
};
