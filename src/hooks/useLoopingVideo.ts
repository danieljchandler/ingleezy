import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/uiPrefs";

/**
 * Playback plumbing for a decorative, silently looping <video> — the kind that
 * exists as artwork rather than as content the visitor chose to play.
 *
 * Autoplaying one of these reliably takes more than the `autoPlay` attribute,
 * and every workaround below is here for a specific browser. Shared by
 * LoadingEmblem and CaravanMedallion so the fixes live in one place.
 *
 * The caller owns the framing and the markup; this owns when the clip runs and
 * when it should be swapped for a still.
 */
export interface LoopingVideo {
  /** Attach to the <video>. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** True when the poster should be rendered instead of the video. */
  still: boolean;
  /**
   * Attach to the *last* <source> only. The browser walks the list in order,
   * so this is the one that fires when nothing playable is left. (A blocked
   * autoplay is a rejected play(), which is handled internally.)
   */
  onSourceError: () => void;
}

export function useLoopingVideo(): LoopingVideo {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reduced motion skips the video entirely rather than pausing it — no decode
  // cost, no download. The poster is the same artwork, held still.
  const still = reduced || failed;

  useEffect(() => {
    if (still) return;
    const el = videoRef.current;
    if (!el) return;

    // `muted` has to be set as a real DOM property, not just the JSX attribute,
    // or Safari's autoplay policy rejects the play(). autoPlay alone is also
    // unreliable when the element mounts inside a conditional subtree.
    el.muted = true;
    void el.play()?.catch(() => setFailed(true));

    // Most browsers pause hidden video for us; Android WebView doesn't always,
    // and a loop decoding behind a background tab is real battery.
    const onVisibility = () => {
      if (document.hidden) el.pause();
      else void el.play()?.catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [still]);

  return { videoRef, still, onSourceError: () => setFailed(true) };
}
