/**
 * TrailMarker — the learner's current spot on the English Sounds trail: the
 * wordmark's gold dot, bobbing gently over the stop. It replaced a camel,
 * part of a desert scene the brand has dropped (no heritage motifs).
 */
export function TrailMarker({ size = 18 }: { size?: number }) {
  return (
    <div
      className="animate-marker-bob inline-flex"
      style={{ width: size, height: size }}
      role="img"
      aria-label="أنت هنا"
      title="أنت هنا"
    >
      <span
        className="block h-full w-full rounded-full shadow-[0_4px_10px_-2px_rgba(184,130,15,0.55)]"
        style={{ background: "radial-gradient(circle at 32% 30%, #FBE39B 0%, #E9AD20 52%, #B8820F 100%)" }}
      />
    </div>
  );
}
