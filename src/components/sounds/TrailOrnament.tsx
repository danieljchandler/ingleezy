import { Art, type ArtName } from "@/components/brand/Art";
import { cn } from "@/lib/utils";

/**
 * TrailOrnament — the object that fills the empty side of each stop on the
 * English Sounds trail, cycling through the app's illustration set by
 * order_index so the trail feels varied without becoming busy. It replaced
 * palm, dune, tent and lantern drawings: the brand appeals through the
 * product, not through heritage scenery.
 */
const ORNAMENTS: ArtName[] = ["headphones", "mic", "bubbles", "book", "coffee", "flame"];

export function TrailOrnament({ index, active }: { index: number; active: boolean }) {
  return (
    <Art
      name={ORNAMENTS[index % ORNAMENTS.length]}
      className={cn("h-14 w-14 shrink-0 transition-opacity", active ? "opacity-95" : "opacity-30 grayscale")}
    />
  );
}
