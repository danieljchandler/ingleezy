import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavigationArrowProps {
  direction: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}

export const NavigationArrow = ({
  direction,
  onClick,
  disabled = false,
}: NavigationArrowProps) => {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={`Navigate ${direction}`}
      className={cn(
        "w-16 h-16 md:w-20 md:h-20 rounded-full",
        "flex items-center justify-center",
        "bg-card shadow-card",
        "transition-all duration-300",
        "hover:scale-110 active:scale-95",
        "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100",
        "focus:outline-none focus:ring-4 focus:ring-primary/50"
      )}
    >
      <Icon className="w-8 h-8 md:w-10 md:h-10 text-foreground" />
    </button>
  );
};
