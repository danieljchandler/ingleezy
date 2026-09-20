import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** The screen's name. One line, no punctuation. */
  title: ReactNode;
  /** What the screen is for, in the learner's words. */
  subtitle?: ReactNode;
  /** Sits before the title — an icon, or an InfoHint. */
  icon?: ReactNode;
  /** Trailing slot: a count, a filter, one action. Not a toolbar. */
  action?: ReactNode;
  className?: string;
}

/**
 * The one page header.
 *
 * Before this, every screen drew its own: `<h1 className="text-2xl font-bold">`
 * on Discover, a hand-rolled flex row on Leaderboard, `HubHeader` on two pages
 * and nothing at all on several more. The sizes disagreed, the spacing below
 * them disagreed, and a learner moving between screens saw a different app
 * each time.
 *
 * It replaces `HubHeader`, which did the same job but lived inside
 * `HubGrid.tsx` — which is most of why only two pages ever found it. A shared
 * primitive nobody can discover is not shared.
 *
 * The title is ink, not the brand colour `HubHeader` used. The palette this
 * app now runs on reserves its one colour for actions; a heading that is not
 * tappable should not wear the colour of the things that are.
 */
export function PageHeader({ title, subtitle, icon, action, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 pt-1", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="inline-flex items-center gap-2 font-heading text-title font-bold tracking-tight text-foreground md:text-headline">
            {icon}
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-body-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}
