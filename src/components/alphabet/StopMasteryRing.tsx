interface StopMasteryRingProps {
  /** 0..1 progress fraction */
  progress: number;
  state: "locked" | "active" | "mastered";
  size?: number;
}

/**
 * Thin SVG ring rendered behind a stop marker showing per-letter mastery progress.
 * Pure presentation — no layout shift; absolutely positioned by its parent.
 */
export const StopMasteryRing = ({ progress, state, size = 76 }: StopMasteryRingProps) => {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = state === "mastered" ? 1 : Math.max(0, Math.min(1, progress));
  const offset = c * (1 - pct);

  const trackColor =
    state === "locked" ? "rgba(120,113,108,0.25)" : "rgba(92,58,70,0.18)";
  const arcColor =
    state === "mastered" ? "#CFA44E" : state === "active" ? "#5C3A46" : "transparent";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0 -m-[6px] pointer-events-none"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
      />
      {pct > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={arcColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      )}
    </svg>
  );
};
