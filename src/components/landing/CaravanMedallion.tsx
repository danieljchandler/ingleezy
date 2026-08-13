import { cn } from "@/lib/utils";
import { LoopingMedallion } from "@/components/media/LoopingMedallion";

/**
 * CaravanMedallion — the looping caravan clip.
 *
 * A watercolour desert of Arabic-text dunes at sunset, with a camel train
 * crossing it. The caravan enters a couple of seconds in and is gone again by
 * the end, so the loop reads as a road that keeps being walked rather than as a
 * clip that restarts.
 *
 * It anchors the placement quiz — "no matter where you are in your journey" —
 * and echoes the caravan language the Alphabet Journey already uses.
 *
 * The source is square (1440x1440, downscaled to 720), which is why this asks
 * LoopingMedallion for an aspect-square box rather than a fixed height.
 */

const CARAVAN_MP4 = "/assets/caravan-hero.mp4";
const CARAVAN_WEBM = "/assets/caravan-hero.webm";
const CARAVAN_POSTER = "/assets/caravan-hero-poster.webp";

export interface CaravanMedallionProps {
  className?: string;
}

export function CaravanMedallion({ className }: CaravanMedallionProps) {
  return (
    <LoopingMedallion
      mp4={CARAVAN_MP4}
      webm={CARAVAN_WEBM}
      poster={CARAVAN_POSTER}
      aspect="aspect-square"
      className={cn("max-w-[300px]", className)}
    />
  );
}
