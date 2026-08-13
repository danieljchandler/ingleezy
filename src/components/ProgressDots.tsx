import { cn } from "@/lib/utils";

interface ProgressDotsProps {
  total: number;
  current: number;
  gradient?: string;
}

/**
 * ProgressDots - Minimal progress indicator
 * 
 * Clean dots that show learning progress without visual clutter.
 */
export const ProgressDots = ({ total, current }: ProgressDotsProps) => {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "transition-all duration-300 rounded-full",
            index === current
              ? "w-6 h-2 bg-primary"
              : index < current
                ? "w-2 h-2 bg-primary/40"
                : "w-2 h-2 bg-muted"
          )}
        />
      ))}
    </div>
  );
};
