import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useLoopingVideo } from "@/hooks/useLoopingVideo";

/**
 * LoopingMedallion — the framed, silently looping clip used as page artwork.
 *
 * This owns the *frame*: the rounded box, the ring, and the markup that gets a
 * decorative video to autoplay everywhere and degrade to a still where it
 * can't. `useLoopingVideo` owns *when* it runs. Callers supply the clip and its
 * aspect ratio, and are expected to be thin named wrappers (CaravanMedallion,
 * CampfireMedallion) rather than to spell the paths out at the call site.
 *
 * Decorative only: `aria-hidden`. The copy beside it carries the meaning.
 */

/**
 * clip-path rather than `rounded-* overflow-hidden` on the wrapper: Safari has
 * a long-standing bug where border-radius plus overflow fails to clip a <video>,
 * leaving square corners. The radius here has to be kept in step with the
 * wrapper's `rounded-[2rem]` by hand — clip-path can't read it.
 */
const ROUNDED: CSSProperties = {
  clipPath: "inset(0 round 2rem)",
  WebkitClipPath: "inset(0 round 2rem)",
};

export interface LoopingMedallionProps {
  /** H.264 source. Listed first — see the note on the <source> order below. */
  mp4: string;
  /** VP9 source, for builds that ship without proprietary codecs. */
  webm: string;
  /** Still shown under reduced motion or when playback fails. */
  poster: string;
  /** Tailwind aspect utility matching the clip, e.g. "aspect-square". */
  aspect?: string;
  className?: string;
}

export function LoopingMedallion({
  mp4,
  webm,
  poster,
  aspect = "aspect-square",
  className,
}: LoopingMedallionProps) {
  const { videoRef, still, onSourceError } = useLoopingVideo();

  return (
    <div
      aria-hidden="true"
      className={cn(
        aspect,
        "w-full overflow-hidden rounded-[2rem]",
        "shadow-elegant ring-1 ring-desert-red/20",
        className,
      )}
    >
      {still ? (
        <img
          src={poster}
          alt=""
          className="block h-full w-full object-cover"
          style={ROUNDED}
        />
      ) : (
        <video
          ref={videoRef}
          poster={poster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          disablePictureInPicture
          tabIndex={-1}
          className="block h-full w-full object-cover"
          style={ROUNDED}
        >
          {/*
            H.264 first: every mainstream browser plays it, so almost nobody
            fetches the WebM. The VP9 sibling is for builds that ship without
            proprietary codecs — distro Chromium and Firefox on Linux, and the
            headless Chromium our e2e suite runs on. Declaring `type` means an
            unsupported source is skipped without downloading it.
          */}
          <source src={mp4} type='video/mp4; codecs="avc1.4D401E"' />
          {/* onError sits on the last candidate only — see useLoopingVideo. */}
          <source
            src={webm}
            type='video/webm; codecs="vp9"'
            onError={onSourceError}
          />
        </video>
      )}
    </div>
  );
}
