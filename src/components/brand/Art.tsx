import { cn } from "@/lib/utils";

/**
 * The illustration set: six grainy 3D objects in firoza and gold, one per
 * thing the app does (a clip, a story, a conversation, the tutor, a streak,
 * a casual chat). Generated as one family so they sit together on a page;
 * the files live in public/art as 640px transparent WebP.
 *
 * Always decorative: the label beside an object says what it is, so the
 * image carries no alt text of its own.
 */
export type ArtName = "mic" | "bubbles" | "headphones" | "book" | "coffee" | "flame";

export function Art({
  name,
  className,
  eager = false,
}: {
  name: ArtName;
  className?: string;
  /** Load straight away: for art in the first screen of a page. */
  eager?: boolean;
}) {
  return (
    <img
      src={`/art/${name}.webp`}
      alt=""
      aria-hidden
      width={640}
      height={640}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cn("select-none object-contain", className)}
    />
  );
}
