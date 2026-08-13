import { ChevronRight, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { useDialect } from "@/contexts/DialectContext";

interface TaskRowProps {
  title: string;
  subtitle?: string;
  countBadge?: string;
  estMinutes: number;
  icon: LucideIcon;
  done: boolean;
  onClick: () => void;
  hint?: { title: string; body: string };
}

// Dialect rail colors — tactile vertical bar in each tile's active color
const DIALECT_RAIL: Record<string, string> = {
  Gulf: "bg-gradient-to-b from-teal-400 to-teal-600",
  Egyptian: "bg-gradient-to-b from-amber-400 to-amber-600",
  Yemeni: "bg-gradient-to-b from-red-500 to-red-700",
};

const DIALECT_ICON_TINT: Record<string, string> = {
  Gulf: "bg-teal-500/10 text-teal-700",
  Egyptian: "bg-amber-500/10 text-amber-700",
  Yemeni: "bg-red-500/10 text-red-700",
};

export const TaskRow = ({
  title,
  subtitle,
  countBadge,
  estMinutes,
  icon: Icon,
  done,
  onClick,
  hint,
}: TaskRowProps) => {
  const { activeDialect } = useDialect();
  const rail = DIALECT_RAIL[activeDialect] ?? DIALECT_RAIL.Gulf;
  const iconTint = DIALECT_ICON_TINT[activeDialect] ?? DIALECT_ICON_TINT.Gulf;

  // The row reads as one big button but may carry an InfoHint — itself a real
  // <button> (see its comment). A button can't contain a button, so the row
  // is a clickable wrapper with a full-bleed <button> UNDER the content for
  // the accessible name, focus ring and key handling; every click — on the
  // overlay or on the painted content — bubbles to the wrapper's onClick.
  // The InfoHint stops propagation, which is exactly its contract.
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative w-full flex cursor-pointer items-stretch gap-3 pr-4 pl-0 py-3.5 rounded-2xl text-left overflow-hidden",
        "bg-card-cream border-2 transition-all duration-300",
        "shadow-[0_1px_0_rgba(92,58,70,0.04),0_4px_12px_-6px_rgba(92,58,70,0.12)]",
        "hover:shadow-[0_2px_0_rgba(92,58,70,0.06),0_10px_20px_-8px_rgba(92,58,70,0.2)] hover:-translate-y-px active:translate-y-0",
        done
          ? "border-desert-red/70 opacity-90"
          : "border-desert-red/15 hover:border-desert-red/35"
      )}
    >
      {/* No handler of its own: a click (or Enter/Space, which a native
          button synthesises into a click) bubbles to the wrapper's onClick,
          so pointer and keyboard share one code path. */}
      <button
        aria-label={`${done ? "Completed: " : ""}${title} — estimated ${estMinutes} minutes`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* Left dialect rail */}
      <span
        aria-hidden
        className={cn(
          "relative z-[1] w-1.5 shrink-0 rounded-r-full transition-opacity",
          rail,
          done && "opacity-40"
        )}
      />

      {/* Micro-icon tile */}
      <div className="relative z-[1] pl-1 flex items-center">
        <div
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-colors",
            done ? "bg-desert-red/10" : iconTint
          )}
        >
          {done ? (
            // Animated stroke checkmark in Desert Red on completion
            <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-desert-red" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                style={{
                  strokeDasharray: 24,
                  strokeDashoffset: 0,
                  animation: "task-stroke 420ms ease-out both",
                }}
              />
            </svg>
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative z-[1] flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "font-semibold text-[15px] text-foreground font-heading",
              done && "line-through decoration-desert-red/50"
            )}
          >
            {title}
          </span>
          {countBadge && !done && (
            <span className="text-[10px] leading-none px-1.5 py-1 rounded-full bg-desert-red text-card-cream font-bold tracking-wide">
              {countBadge}
            </span>
          )}
          {hint && <InfoHint title={hint.title} body={hint.body} />}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {subtitle && (
            <span className="text-[11px] text-desert-red/70 truncate">{subtitle}</span>
          )}
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border",
              done
                ? "border-desert-red/20 text-desert-red/50 bg-transparent"
                : "border-desert-red/15 text-desert-red/80 bg-desert-red/[0.04]"
            )}
          >
            ~{estMinutes} min
          </span>
        </div>
      </div>

      <ChevronRight
        className={cn(
          "relative z-[1] h-5 w-5 shrink-0 self-center transition-transform",
          done ? "text-desert-red/30" : "text-desert-red/40 group-hover:translate-x-0.5 group-hover:text-desert-red/70"
        )}
      />

      {/* keyframe for check stroke */}
      <style>{`
        @keyframes task-stroke {
          from { stroke-dashoffset: 24; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
};
