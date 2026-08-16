import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useReducedMotion } from "@/lib/uiPrefs";
import { arCount } from "@/lib/strings";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ingleezy:sounds:milestone-seen";

const THRESHOLDS = [7, 14, 21, 28];

function getSeen(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Records the dismissed milestone *and every one below it*.
 *
 * Recording only the threshold that was on screen made the banner count
 * downwards. A learner whose progress arrives in one go — which is what happens
 * on a second device, or on any account restored from the server — is
 * congratulated on 28, dismisses it, and next visit is congratulated on 21.
 * Then 14. Then 7: four celebrations of milestones they passed weeks ago, each
 * a smaller number than the last. Worse, the effect reruns on `masteredCount`,
 * so the next one arrived without even a reload.
 *
 * Marking everything at or below is what "show the highest unseen" already
 * implies: crossing 28 means 21 happened too.
 */
function markSeen(threshold: number) {
  try {
    const cur = new Set(getSeen());
    for (const t of THRESHOLDS) {
      if (t <= threshold) cur.add(t);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cur]));
  } catch {
    /* ignore */
  }
}

interface Props {
  masteredCount: number;
}

/**
 * One-time celebratory banner shown when the learner crosses 7/14/21/28 mastered sounds.
 * Dismissal is remembered in localStorage so the banner doesn't reappear.
 */
export const MilestoneBanner = ({ masteredCount }: Props) => {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const seen = new Set(getSeen());
    // Show the highest unseen threshold the user has reached
    const candidate = [...THRESHOLDS].reverse().find((t) => masteredCount >= t && !seen.has(t));
    if (candidate) setActive(candidate);
  }, [masteredCount]);

  if (active === null) return null;

  const dismiss = () => {
    markSeen(active);
    setActive(null);
  };

  return (
    <div
      className={cn(
        "relative mb-4 overflow-hidden rounded-2xl border-2 border-[#D98A3D]",
        "bg-gradient-to-r from-[#EDF0F9] via-[#F2F4FB] to-[#DDE3F4]",
        "shadow-[0_6px_20px_-6px_rgba(207,164,78,0.45)]",
      )}
      role="status"
    >
      {!reduced && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute -left-full top-0 h-full w-[200%] bg-gradient-to-r from-transparent via-white/55 to-transparent animate-banner-shine"
            style={{ transform: "skewX(-18deg)" }}
          />
        </div>
      )}
      <div className="relative flex items-center gap-3 p-4">
        <div className="h-10 w-10 shrink-0 rounded-full bg-[#D98A3D]/25 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-[#8F5A24]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#2C3B74]">
            أتقنت{" "}
            {arCount(active, { one: "صوتاً واحداً", two: "صوتين", few: "أصوات", many: "صوتاً" })}!
          </p>
          <p className="text-xs text-[#2C3B74]/75">
            {active === 28
              ? "أنهيت رحلة القافلة كاملة 🐪"
              : "استمر — القافلة تواصل مسيرها."}
          </p>
        </div>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-full text-[#2C3B74]/70 hover:text-[#2C3B74] hover:bg-[#2C3B74]/10 transition-colors"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
