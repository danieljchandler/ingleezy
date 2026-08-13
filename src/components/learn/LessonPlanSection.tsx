import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { planRows } from "@/lib/lessonPath";
import { cn } from "@/lib/utils";
import type { LessonPlanRow } from "@/hooks/useTopic";

interface Props {
  title: string;
  icon: LucideIcon;
  rows: LessonPlanRow[];
  /** Collapsed by default for supporting material, open for the main event. */
  defaultOpen?: boolean;
  /** Shown above the list. */
  blurb?: string;
}

/**
 * Renders one section of the authored lesson plan (`lesson_sequence`,
 * `real_world_prompts`).
 *
 * These come from spreadsheet sheets whose column headers vary between lessons,
 * so the rows arrive as Record<string, string> with unpredictable keys —
 * planRows() in src/lib/lessonPath.ts turns each into a headline plus details
 * without assuming a schema. Renders nothing at all when a section is empty,
 * which is the case for every lesson imported before the importer was fixed.
 */
export const LessonPlanSection = ({ title, icon: Icon, rows, defaultOpen = false, blurb }: Props) => {
  const [open, setOpen] = useState(defaultOpen);
  const items = planRows(rows);
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3">
          {blurb && <p className="text-xs text-muted-foreground mb-3">{blurb}</p>}
          <ol className="space-y-2.5">
            {items.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="shrink-0 mt-0.5 h-5 w-5 rounded-full bg-muted text-[10px] font-bold text-muted-foreground flex items-center justify-center tabular-nums">
                  {item.index ?? i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{item.headline}</p>
                  {item.detail.length > 0 && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.detail.join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
};
