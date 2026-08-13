import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** Duration in ms — ring sweeps from full to empty over this period */
  durationMs: number;
  /** Pause the sweep */
  paused?: boolean;
  /** Children rendered centered inside the ring */
  children?: React.ReactNode;
  className?: string;
  /** Active accent color class (e.g. "text-primary" or "text-destructive") */
  colorClass?: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CountdownRing({ durationMs, paused, children, className, colorClass = "text-primary" }: Props) {
  const [progress, setProgress] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (paused) return;
    if (reduced) {
      // Single fade — no sweep
      setProgress(1);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, paused, reduced]);

  const radius = 44;
  const circ = 2 * Math.PI * radius;
  const dashoffset = reduced ? 0 : circ * progress;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashoffset}
          className={cn("transition-opacity", colorClass)}
          style={{ stroke: "currentColor", opacity: reduced ? 1 - progress * 0.7 : 1 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
