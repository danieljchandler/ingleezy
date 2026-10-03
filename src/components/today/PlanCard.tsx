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
 * Today's plan: three steps and one button, on a white card.
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
      className={cn("rounded-[28px] bg-card px-4 pb-4 pt-[18px] shadow-card", className)}
    >
      <div className="flex items-center justify-between gap-3">
        {/* The heading is the tag: "today's plan" names the card, the serif
            line under it says where you are in it. */}
        <h2
          id="today-plan"
          className="rounded-full bg-tint-gold px-2.5 py-0.5 font-sans text-xs font-semibold leading-[18px] text-accent-ink"
        >
          {AR.today.planTitle}
        </h2>
        <p className="text-[13px] leading-5 text-muted-foreground">
          {AR.today.minutes(plan.minutes)} · {AR.today.planProgress(plan.done, plan.steps.length)}
        </p>
      </div>
      <p className="mx-1 mt-2.5 font-heading text-[22px] leading-[34px]">
        {AR.today.planHeadline(plan.done, plan.steps.length)}
      </p>
      <p className="sr-only">{AR.home.tasksDone(plan.done, plan.steps.length)}</p>

      <ol className="mt-2 space-y-1">
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
        <div className="mt-3 rounded-2xl bg-tint-sage px-4 py-3">
          <p className="font-semibold text-success-ink">{AR.today.planDoneTitle}</p>
          <p className="text-sm text-muted-foreground">{AR.today.planDoneBody}</p>
        </div>
      )}

      {plan.next && (
        <button
          type="button"
          onClick={() => open(plan.next!)}
          className={cn(
            "mt-3 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5",
            "text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]",
          )}
        >
          <span className="truncate">
            {plan.done === 0 ? AR.today.start : AR.today.keepGoing}: {plan.next.title}
          </span>
          <ChevronNext className="h-5 w-5 shrink-0" aria-hidden />
        </button>
      )}

      {plan.extras.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={showExtras}
            onClick={() => setShowExtras((open) => !open)}
            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
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
        "flex w-full items-center gap-3 rounded-[18px] p-2 text-start transition-colors",
        isNext ? "bg-gradient-next" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-[14px]",
          task.done
            ? "bg-tint-sage text-success-ink"
            : isNext
              ? "bg-card text-foreground"
              : "bg-tint-firoza text-primary dark:text-foreground",
        )}
      >
        {task.done ? (
          <Check className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        ) : (
          <Icon className="h-5 w-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[15px] font-semibold leading-[22px]",
            task.done && "text-muted-foreground",
          )}
        >
          {task.title}
        </span>
        {subtitleEn ? (
          <span
            dir="ltr"
            className="font-english block truncate text-right text-[13px] leading-5 text-muted-foreground"
          >
            {subtitleEn}
          </span>
        ) : (
          <span className="block truncate text-[13px] leading-5 text-muted-foreground">
            {task.subtitle ? `${task.subtitle} · ` : ""}
            {AR.today.minutes(task.estMinutes)}
          </span>
        )}
      </span>
      {task.done && (
        <span className="shrink-0 text-xs font-semibold text-success-ink">{AR.today.dayDone}</span>
      )}
      {isNext && <ChevronNext className="h-5 w-5 shrink-0" aria-hidden />}
      {task.countBadge && !task.done && !isNext && (
        <span className="shrink-0 rounded-full bg-tint-firoza px-2 py-0.5 text-xs font-semibold tabular-nums text-primary dark:text-foreground">
          {task.countBadge}
        </span>
      )}
    </button>
  );
}
