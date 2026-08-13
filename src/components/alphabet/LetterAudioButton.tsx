import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { cn } from "@/lib/utils";

interface LetterAudioButtonProps {
  text: string;
  /** If true, play the Fusha (MSA) pronunciation regardless of active dialect. */
  forceMsa?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  label?: string;
}

/** MSA voice used for the Fusha button — a formal, MSA-style Arabic voice. */
const MSA_VOICE = "ar-SA-HamedNeural";

/**
 * Round speaker button. Wraps useAzureTTS to fetch and play a short clip.
 * `forceMsa` plays the Fusha voice; otherwise it follows the user's active dialect.
 */
export const LetterAudioButton = ({
  text,
  forceMsa = false,
  className,
  size = "md",
  autoplay = false,
  label,
}: LetterAudioButtonProps) => {
  // Fusha: force Azure MSA voice. Dialect: let the hook route (Munsit for Gulf,
  // auto-selected Azure voice for Egyptian/Yemeni).
  const dialectProp = forceMsa ? "MSA" : undefined;
  const voice = forceMsa ? MSA_VOICE : undefined;

  /**
   * Synthesise on demand, not on render.
   *
   * `useAzureTTS` was called with no `skip`, so every one of these buttons
   * synthesised the moment it appeared. The alphabet grid puts twenty-eight on
   * one screen and the letter detail view adds a Fusha button beside each
   * dialect one, so opening a page fired a TTS request per button whether or
   * not the learner ever tapped one — and held every response as a blob for the
   * life of the page. `bible/VerseAudioButton` had already solved this by
   * arming on the first tap.
   *
   * Keyed on the letter rather than a bare flag so a button reused for the next
   * letter goes back to waiting instead of speaking unasked.
   */
  const [armedFor, setArmedFor] = useState<string | null>(autoplay ? text : null);
  const armed = armedFor === text;
  const { ttsUrl, isLoading } = useAzureTTS({
    text,
    dialect: dialectProp,
    voice,
    skip: !armed || !text?.trim(),
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const autoplayedRef = useRef(false);
  /** A tap that arrived before the clip did, waiting for it to land. */
  const pendingTapRef = useRef(false);

  // Reset the autoplay guard whenever the letter (text) changes so the next
  // letter's audio actually plays instead of being silently skipped.
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
    // Autoplay goes through the same path as a tap, so the ring that says
    // "this is the sound you are hearing" appears either way. It used to build
    // its own Audio and touch neither `playing` nor `onended`, which left the
    // button looking idle for the whole clip on the letter tour — where
    // autoplay is the entire point.
    if (autoplay && !autoplayedRef.current) {
      autoplayedRef.current = true;
      play(ttsUrl);
      return;
    }
    // Armed by a tap that arrived before the clip did.
    if (pendingTapRef.current) {
      pendingTapRef.current = false;
      play(ttsUrl);
    }
  }, [ttsUrl, armed, autoplay]);

  // Nothing stopped the clip on unmount, so tapping a letter and going straight
  // back left it being pronounced over the next screen — and on the letter tour
  // every skipped letter kept playing.
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
    // First tap: ask for the clip and play it when it lands.
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
      // Only once it is actually fetching. Gating on `!ttsUrl` as well would
      // leave a lazily-armed button permanently disabled and untappable, since
      // there is no clip until the first tap asks for one.
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
