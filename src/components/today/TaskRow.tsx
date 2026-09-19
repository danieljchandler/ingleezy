import { Check, type LucideIcon } from "lucide-react";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { useDialect } from "@/contexts/DialectContext";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

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

// Each dialect gets its own hue so a learner can tell at a glance which module
// they are in. These are the three brand tokens rather than raw palette steps:
// the rails used to be Tailwind's teal/amber/red, which belonged to no theme,
// ignored dark mode, and clashed with every other colour on the screen.
const DIALECT_ICON_TINT: Record<string, string> = {
  Gulf: "bg-primary/10 text-primary",
  Egyptian: "bg-accent/15 text-accent-foreground dark:text-accent",
  Yemeni: "bg-success/15 text-success",
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
        "group relative w-full flex cursor-pointer items-center gap-3 px-3.5 py-3 rounded-2xl text-left overflow-hidden",
        "bg-card border transition-all duration-300 shadow-soft",
        "hover:shadow-card hover:-translate-y-0.5 active:translate-y-0",
        done ? "border-border opacity-70" : "border-border hover:border-primary/30"
      )}
    >
      {/* No handler of its own: a click (or Enter/Space, which a native
          button synthesises into a click) bubbles to the wrapper's onClick,
          so pointer and keyboard share one code path. */}
      <button
        aria-label={AR.queue.taskAria(done, title, estMinutes)}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* Icon tile. This carries the dialect hue now that the rail is gone: the
          rail was a hardcoded gradient, and its `rounded-r-full` was a physical
          corner that landed on the wrong edge under the RTL root. */}
      <div className="relative z-[1] flex items-center">
        <div
          className={cn(
            "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 transition-colors",
            done ? "bg-muted" : iconTint
          )}
        >
          {done ? (
            // Animated stroke checkmark in Desert Red on completion
            <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-success" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
              "font-bold text-[15px] text-foreground font-heading",
              done && "line-through decoration-muted-foreground/50"
            )}
          >
            {title}
          </span>
          {countBadge && !done && (
            <span className="text-[10px] leading-none px-2 py-1 rounded-full bg-primary text-primary-foreground font-bold tracking-wide">
              {countBadge}
            </span>
          )}
          {hint && <InfoHint title={hint.title} body={hint.body} />}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {subtitle && (
            <span className="text-[11px] text-muted-foreground truncate">{subtitle}</span>
          )}
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border",
              done
                ? "border-border text-muted-foreground/60 bg-transparent"
                : "border-transparent text-muted-foreground bg-muted"
            )}
          >
            ~{estMinutes} min
          </span>
        </div>
      </div>

      <ChevronOpen
        className={cn(
          "relative z-[1] h-5 w-5 shrink-0 self-center transition-transform",
          done ? "text-muted-foreground/40" : "text-muted-foreground group-hover:-translate-x-0.5 group-hover:text-primary"
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
