import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

export interface HubTile {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  to: string;
  /** Optional accent class on the icon bubble, e.g. "bg-accent/10 text-accent-ink". */
  accent?: string;
  /** Render only if true. Use to hide entitlement-gated tiles. */
  show?: boolean;
  badge?: ReactNode;
}

interface HubSectionProps {
  title: string;
  subtitle?: string;
  tiles: HubTile[];
}

export function HubSection({ title, subtitle, tiles }: HubSectionProps) {
  const navigate = useNavigate();
  const visible = tiles.filter((t) => t.show !== false);
  if (visible.length === 0) return null;

  return (
    <section className="mb-7">
      <div className="px-1 mb-3 flex items-baseline gap-3">
        <span className="h-px flex-1 bg-primary/15" aria-hidden />
        <h2
          className="text-[10px] font-bold text-primary/65 uppercase tracking-[0.18em]"
        >
          {title}
        </h2>
        <span className="h-px flex-1 bg-primary/15" aria-hidden />
      </div>
      {subtitle && (
        <p className="text-[11px] text-muted-foreground mb-2 px-1 text-center">{subtitle}</p>
      )}
      <div className="space-y-2.5">
        {visible.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => navigate(t.to)}
              className={cn(
                "group w-full p-4 rounded-2xl bg-card border border-primary/15",
                "flex items-center gap-3.5 text-left shadow-card-soft",
                "transition-all duration-200",
                "hover:border-primary/30 hover:shadow-elegant hover:-translate-y-px",
                "active:scale-[0.99] active:translate-y-0",
              )}
            >
              <div
                className={cn(
                  "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
                  "transition-transform group-hover:scale-105",
                  t.accent ?? "bg-primary/15 text-primary",
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm flex items-center gap-2 leading-tight">
                  {t.label}
                  {t.badge}
                </p>
                {t.description && (
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{t.description}</p>
                )}
              </div>
              <ChevronOpen className="h-4 w-4 text-primary/40 shrink-0 transition-transform group-hover:-translate-x-0.5 group-hover:text-primary/70" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

