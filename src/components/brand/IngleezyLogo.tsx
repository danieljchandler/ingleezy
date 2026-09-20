import { cn } from "@/lib/utils";

/**
 * The primary lockup: mark + Ingleezy wordmark + تعلّم tagline.
 *
 * The wordmark is live text in the display face (Baloo Bhaijaan 2), not an
 * image — it scales, themes, and stays selectable. The mark rides in from the
 * shared SVG asset so the favicon and the in-app logo can never drift apart.
 *
 * The display face replaced Archivo Black here: set italic and uppercase, the
 * old face read as a sports badge and fought the Arabic sitting beside it.
 * Baloo is a rounded dual-script family, so the wordmark and the tagline are
 * finally drawn in one voice. Wordmark colour stays locked to the foreground:
 * never recoloured.
 */
export function IngleezyLogo({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** Mark without wordmark — headers and tight spots. */
  iconOnly?: boolean;
}) {
  return (
    <span dir="ltr" className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <img
        src="/brand/ingleezy-icon.svg"
        alt=""
        aria-hidden
        className="h-[1.55em] w-auto shrink-0"
        draggable={false}
      />
      {!iconOnly && (
        <span className="flex flex-col leading-none" dir="ltr">
          <span className="font-display text-[1.28em] font-extrabold leading-none text-foreground">
            Ingleezy
          </span>
          {/* Sits on the wordmark's baseline rather than under a rule: the old
              bordered block made the lockup read as two stacked logos. */}
          <span
            className="mt-[0.22em] text-end font-display text-[0.6em] font-semibold not-italic leading-none text-primary"
            dir="rtl"
          >
            تعلّم
          </span>
        </span>
      )}
    </span>
  );
}
