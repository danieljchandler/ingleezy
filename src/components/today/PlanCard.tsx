import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import type { TodayTask } from "@/hooks/useTodayQueue";
import { buildPlan } from "@/lib/todayPlan";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";
import { ChevronNext } from "@/components/shared/DirectionalIcon";

/**
 * Today's plan: three steps and one button.
 *
 * Borrowed from the calm-home pattern (Headspace's Today, Elevate's daily
 * workout): one card, a short list, and a single button that launches the next
 * unfinished step, so the first tap of the day is never a decision. The rest of
 * the queue is not dropped; it folds away under "if you have time".
 *
 * Every step marks itself complete on its own real completion event, so opening
 * one is a plain navigation — marking on click would let a learner clear the
 * day by tapping through it. The one exception is today's clip, whose page has
 * no completion event: opening it is the only signal there is.
 */

interface PlanCardProps {
  tasks: TodayTask[];
  /** Today's clip title, shown under the watch step. English, so set LTR. */
  videoTitle?: string;
  className?: string;
}

export function PlanCard({ tasks, videoTitle, className }: PlanCardProps) {
  const navigate = useNavigate();
  const [showExtras, setShowExtras] = useState(false);
  const plan = buildPlan(tasks);

  const open = (task: TodayTask) => {
    if (task.id === "listening") markTaskCompletedToday("listening");
    navigate(task.route);
  };

  if (plan.steps.length === 0) return null;

  return (
    <section
      aria-labelledby="today-plan"
      className={cn(
        "rounded-[28px] bg-primary p-5 text-primary-foreground shadow-elegant",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-plan" className="text-[22px] leading-8 text-primary-foreground">
          {AR.today.planTitle}
        </h2>
        <p className="text-sm leading-[22px] text-primary-foreground/85">
          {AR.today.minutes(plan.minutes)} · {AR.today.planProgress(plan.done, plan.steps.length)}
        </p>
      </div>

      {/* One segment per step, filled from the start edge as steps finish. */}
      <div aria-hidden className="mt-3.5 flex gap-1.5">
        {plan.steps.map((step) => (
          <span
            key={step.id}
            className={cn("h-1.5 flex-1 rounded-full", step.done ? "bg-accent" : "bg-white/25")}
          />
        ))}
      </div>
      <p className="sr-only">{AR.home.tasksDone(plan.done, plan.steps.length)}</p>

      <ol className="mt-3 space-y-1">
        {plan.steps.map((step) => (
          <li key={step.id}>
            <Step
              task={step}
              isNext={step === plan.next}
              subtitleEn={step.id === "listening" ? videoTitle : undefined}
              onOpen={() => open(step)}
            />
          </li>
        ))}
      </ol>

      {plan.complete && (
        <div className="mt-3 rounded-2xl bg-white/10 px-4 py-3">
          <p className="font-semibold">{AR.today.planDoneTitle}</p>
          <p className="text-sm text-primary-foreground/85">{AR.today.planDoneBody}</p>
        </div>
      )}

      {plan.next && (
        <button
          type="button"
          onClick={() => open(plan.next!)}
          className={cn(
            "mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-card px-5",
            "text-lg font-semibold text-primary transition-transform active:scale-[0.98]",
          )}
        >
          <span className="truncate">
            {plan.done === 0 ? AR.today.start : AR.today.keepGoing}: {plan.next.title}
          </span>
          <ChevronNext className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      )}

      {plan.extras.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showExtras}
            onClick={() => setShowExtras((open) => !open)}
            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 text-sm font-medium text-primary-foreground/85"
          >
            {AR.today.extrasTitle} ({plan.extras.length})
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", showExtras && "rotate-180")}
              aria-hidden
            />
          </button>
          {showExtras && (
            <ol className="mt-1 space-y-1">
              {plan.extras.map((extra) => (
                <li key={extra.id}>
                  <Step task={extra} isNext={false} onOpen={() => open(extra)} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function Step({
  task,
  isNext,
  subtitleEn,
  onOpen,
}: {
  task: TodayTask;
  isNext: boolean;
  subtitleEn?: string;
  onOpen: () => void;
}) {
  const Icon = task.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={AR.queue.taskAria(task.done, task.title, task.estMinutes)}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-start transition-colors",
        isNext ? "bg-card text-card-foreground" : "hover:bg-white/10",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full",
          task.done
            ? "bg-accent text-secondary"
            : isNext
              ? "bg-primary text-primary-foreground"
              : "border-[1.5px] border-white/55",
        )}
      >
        {task.done ? (
          <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        ) : (
          <Icon className="h-5 w-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-base leading-6",
            isNext ? "font-semibold" : "font-medium",
            task.done && "text-primary-foreground/85",
          )}
        >
          {task.title}
        </span>
        {subtitleEn ? (
          <span
            dir="ltr"
            className={cn(
              "font-english block truncate text-right text-[13px] leading-5",
              isNext ? "text-muted-foreground" : "text-primary-foreground/85",
            )}
          >
            {subtitleEn}
          </span>
        ) : (
          <span
            className={cn(
              "block truncate text-[13px] leading-5",
              isNext ? "text-muted-foreground" : "text-primary-foreground/85",
            )}
          >
            {task.subtitle ? `${task.subtitle} · ` : ""}
            {AR.today.minutes(task.estMinutes)}
          </span>
        )}
      </span>
      {isNext && (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          {AR.today.next}
        </span>
      )}
      {task.countBadge && !task.done && !isNext && (
        <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold tabular-nums">
          {task.countBadge}
        </span>
      )}
    </button>
  );
}
