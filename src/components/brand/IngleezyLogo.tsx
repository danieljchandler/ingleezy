import { cn } from "@/lib/utils";

/**
 * The primary lockup: icon + INGLEEZY wordmark + تعلم tagline.
 *
 * The wordmark is live text in the display face (Archivo Black, italicised),
 * not an image — it scales, themes, and stays selectable. The icon rides in
 * from the shared SVG asset so the favicon and the in-app logo can never
 * drift apart. Wordmark color is locked to foreground/white per the guide:
 * never recolored.
 */
export function IngleezyLogo({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** Icon without wordmark — headers and tight spots. */
  iconOnly?: boolean;
}) {
  return (
    <span dir="ltr" className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <img
        src="/brand/ingleezy-icon.svg"
        alt=""
        aria-hidden
        className="h-[1.9em] w-auto shrink-0"
        draggable={false}
      />
      {!iconOnly && (
        <span className="flex flex-col leading-none" dir="ltr">
          <span className="font-display text-[1.35em] leading-none text-foreground">
            Ingleezy
          </span>
          <span
            className="mt-1 border-t border-[#3A508E]/70 pt-0.5 text-end font-arabic text-[0.62em] font-semibold not-italic leading-none text-[#3A508E] dark:border-periwinkle/70 dark:text-periwinkle"
            dir="rtl"
          >
            تعلّم
          </span>
        </span>
      )}
    </span>
  );
}
