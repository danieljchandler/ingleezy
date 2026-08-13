import { Home } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface HomeButtonProps {
  className?: string;
}

/**
 * HomeButton - Minimal navigation back to home
 *
 * Some Radix/shadcn components pass refs to their children via `asChild`,
 * so this component must forward refs.
 */
export const HomeButton = React.forwardRef<HTMLButtonElement, HomeButtonProps>(
  ({ className }, ref) => {
    const navigate = useNavigate();

    return (
      <button
        ref={ref}
        onClick={() => navigate("/")}
        className={cn(
          "w-11 h-11 rounded-xl",
          "flex items-center justify-center",
          "bg-card/80 border border-border",
          "transition-all duration-200",
          "hover:bg-card hover:border-primary/20 active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-primary/30",
          className,
        )}
        aria-label="Go home"
        type="button"
      >
        <Home className="w-5 h-5 text-muted-foreground" />
      </button>
    );
  },
);
HomeButton.displayName = "HomeButton";
