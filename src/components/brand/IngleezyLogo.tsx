import { cn } from "@/lib/utils";

/**
 * The wordmark: "ıngleezy", lowercase, in Funnel Display at its heaviest,
 * with the i's dot lifted off and set as a gold sphere.
 *
 * It is live text, not an image, so it scales, themes and stays crisp. The
 * glyphs are a dotless ı plus a drawn dot rather than a plain i, because the
 * dot is the one coloured thing in the mark: gold is the brand's highlighter,
 * and the dot is the brand highlighting itself. The sphere's soft light echoes
 * the grainy 3D art used across the app.
 *
 * The visible letters are hidden from assistive tech (a screen reader would
 * otherwise spell out the dotless ı); the lockup is announced as "Ingleezy".
 * Tracking is −3.5%, but zero after the ı, or it touches the n and reads "m".
 */
export function IngleezyLogo({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** The app-icon tile instead of the wordmark — headers and tight spots. */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <img
        src="/brand/ingleezy-icon.svg"
        alt="Ingleezy"
        className={cn("h-[1.6em] w-auto select-none", className)}
        draggable={false}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label="Ingleezy"
      dir="ltr"
      className={cn("inline-block select-none whitespace-nowrap font-wordmark text-foreground", className)}
    >
      <span aria-hidden>
        <span className="relative inline-block" style={{ letterSpacing: 0, marginRight: "0.035em" }}>
          ı
          <WordmarkDot />
        </span>
        ngleezy
      </span>
    </span>
  );
}

/** The gold dot over the ı. Exported so the app icon tile can share it. */
export function WordmarkDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("absolute left-1/2 top-[0.05em] h-[0.17em] w-[0.17em] -ml-[0.085em] rounded-full", className)}
      style={{ background: "radial-gradient(circle at 32% 30%, #FBE39B 0%, #E9AD20 52%, #B8820F 100%)" }}
    />
  );
}
