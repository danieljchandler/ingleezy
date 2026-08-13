import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { type ArabicLetter } from "@/data/arabicAlphabet";
import { prefersReducedMotion } from "@/lib/uiPrefs";

interface FourFacesPanelProps {
  letter: ArabicLetter;
}

const FACES: { key: "isolated" | "initial" | "medial" | "final"; label: string; example: string }[] = [
  { key: "isolated", label: "Isolated", example: "alone" },
  { key: "initial", label: "Initial", example: "start" },
  { key: "medial", label: "Medial", example: "middle" },
  { key: "final", label: "Final", example: "end" },
];

/**
 * Shows the letter in all four positional forms. Arabic letters change shape
 * based on where they sit in a word — this panel makes that visual.
 *
 * A subtle "spotlight" rotates through the four faces, each time replaying a
 * morph keyframe on the highlighted glyph so the shapes feel related, not
 * static.
 */
export const FourFacesPanel = ({ letter }: FourFacesPanelProps) => {
  const reduced = prefersReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);

  // Reset cycle on letter change
  useEffect(() => {
    setActiveIdx(0);
    if (reduced) return;
    const iv = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % FACES.length);
    }, 1600);
    return () => window.clearInterval(iv);
  }, [letter.code, reduced]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {FACES.map((f, idx) => {
        const isActive = !reduced && idx === activeIdx;
        return (
          <div
            key={f.key}
            className={cn(
              "p-4 rounded-2xl border-2 bg-card text-center transition-all duration-300",
              isActive
                ? "border-primary shadow-md scale-[1.03] bg-primary/5"
                : "border-border",
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {f.label}
            </p>
            <p
              key={isActive ? `${letter.code}-${idx}-on` : `${letter.code}-${idx}`}
              className={cn(
                "text-5xl text-foreground mb-1",
                isActive && "animate-face-morph text-primary",
              )}
              style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
            >
              {letter[f.key]}
            </p>
            <p className="text-xs text-muted-foreground mt-1">at the {f.example}</p>
          </div>
        );
      })}
    </div>
  );
};
