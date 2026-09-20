import { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Drawn in a muted tile above the title. Optional: a bare state is fine. */
  icon?: LucideIcon;
  /** What is not here, said plainly. */
  title: string;
  /** How to get something here. One sentence. */
  body?: ReactNode;
  /** The way out. Usually one control; a first-run state may offer two. */
  action?: ReactNode;
  /**
   * "page" fills a screen that has nothing on it; "inline" sits inside a card
   * or a section that is empty while the rest of the page is not. Same two
   * words LoadingPanel uses, because they mean the same two things.
   */
  variant?: "page" | "inline";
  className?: string;
}

/**
 * The one empty state.
 *
 * Twenty-two pages hand-rolled this, across five different vertical paddings
 * (py-4, py-8, py-12, py-16 and py-24), with the icon sometimes present,
 * sometimes not, and sometimes a different size. The result was that "nothing
 * here yet" looked like a different feature on every screen — and on the ones
 * that centred a lone line of text in a tall blank page, it looked like a bug.
 *
 * An empty state is a real state, not an absence: it says what is missing and
 * offers exactly one way to fix it.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  variant = "page",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        variant === "page" ? "py-20" : "py-10",
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <Icon className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>
      )}
      <h2 className="font-heading text-subtitle font-bold text-foreground">{title}</h2>
      {body && (
        <p className="mt-1.5 max-w-xs text-body-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
