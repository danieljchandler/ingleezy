import { cn } from "@/lib/utils";
import { LoopingMedallion } from "@/components/media/LoopingMedallion";

/**
 * CampfireMedallion — the looping campfire clip that anchors the landing hero.
 *
 * Three men sitting round a fire in the dunes at night, one of them mid-story:
 * his speech bubble is a sadu panel, and a camel waits in the dark behind them.
 * It is the literal picture of حكاية — a story, told out loud, to people who
 * came to listen. That is the name of the app, so it is what the front door
 * shows.
 *
 * The source is 16:9 (1280x720, downscaled to 960), hence aspect-video. The
 * clip cross-fades its own tail back into its head, so the speech bubble
 * doesn't pop when the loop comes round.
 */

const CAMPFIRE_MP4 = "/assets/campfire-hero.mp4";
const CAMPFIRE_WEBM = "/assets/campfire-hero.webm";
const CAMPFIRE_POSTER = "/assets/campfire-hero-poster.webp";

export interface CampfireMedallionProps {
  className?: string;
}

export function CampfireMedallion({ className }: CampfireMedallionProps) {
  return (
    <LoopingMedallion
      mp4={CAMPFIRE_MP4}
      webm={CAMPFIRE_WEBM}
      poster={CAMPFIRE_POSTER}
      aspect="aspect-video"
      className={cn("max-w-[480px]", className)}
    />
  );
}
