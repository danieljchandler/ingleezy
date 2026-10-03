import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Tags, after Dafi: a quiet tint with its own dark text, never a solid fill.
// Each pairing passes AA. Gold marks what is today's or earned; sage what is
// done; clay what needs another go; sand what is merely new.
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-[18px] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-tint-firoza text-primary dark:text-foreground",
        secondary: "border-transparent bg-tint-sand text-muted-foreground",
        destructive: "border-transparent bg-tint-clay text-clay-ink",
        gold: "border-transparent bg-tint-gold text-accent-ink",
        success: "border-transparent bg-tint-sage text-success-ink",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
