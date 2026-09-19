import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/**
 * Two bugs this fixes, both of which made every bar in the app read wrong:
 *
 * 1. The track was `bg-secondary`, and `--secondary` is the near-black ink the
 *    app sets text in. An empty or barely-started bar therefore painted as a
 *    solid black slab — "no progress" looked identical to "full", and louder
 *    than anything around it. A track is a recessed surface, so it is
 *    `bg-muted`.
 *
 * 2. The indicator was slid into place with `translateX(-N%)`, which moves it
 *    leftward whatever the writing direction. Under this app's RTL root that
 *    filled every bar from the left, so progress drained away from the side
 *    the learner reads from. `scaleX` against a direction-aware origin fills
 *    from the start edge in both directions.
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 origin-left rounded-full bg-primary transition-transform duration-500 ease-lahja rtl:origin-right motion-reduce:transition-none"
      style={{ transform: `scaleX(${Math.max(0, Math.min(100, value || 0)) / 100})` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
