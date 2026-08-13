import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader } from "@/components/layout/HubGrid";
import { HomeButton } from "@/components/HomeButton";
import { useStages } from "@/hooks/useStages";
import { useAllLessons } from "@/hooks/useLessons";
import { useLessonProgress } from "@/hooks/useLessonProgress";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import {
  findNextUpLessonId,
  indexProgress,
  lessonPathState,
  stageCompletion,
  type PathLesson,
} from "@/lib/lessonPath";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Loader2, PlayCircle, Circle } from "lucide-react";

/**
 * The curriculum path.
 *
 * This route did not exist. `useStages` and `useLessons` were referenced only by
 * admin pages, nothing linked to `/learn/:lessonId`, and LearnHub's "Lessons —
 * your personalized path at your level" tile pointed at `/learn`, which with no
 * lesson id serves a shuffled batch of five unseen words. The stages, the CEFR
 * progression and the lessons all existed in the database and were invisible.
 *
 * Gating is deliberately soft. `lessons.unlock_condition` is a free-text column
 * imported from a spreadsheet ("Complete 80% of the quiz", "After lesson 3") —
 * not a machine-readable rule. Hard-locking on arbitrary English would be
 * fragile and would strand learners, so the condition is shown as guidance,
 * exactly one lesson is marked "Next up", and anything can be opened.
 */
const Curriculum = () => {
  const { activeDialect } = useDialect();
  const { isAuthenticated } = useAuth();
  const { data: stages, isLoading: stagesLoading } = useStages();
  const { data: lessons, isLoading: lessonsLoading } = useAllLessons();
  const { data: progressRows } = useLessonProgress();

  const progress = useMemo(() => indexProgress(progressRows ?? []), [progressRows]);

  // Lessons carry stage_id; useLessons maps to a display shape, so group here.
  const lessonsByStage = useMemo(() => {
    const map = new Map<string, typeof lessons>();
    for (const lesson of lessons ?? []) {
      const stageId = lesson.stage_id ?? "unstaged";
      const bucket = map.get(stageId);
      if (bucket) bucket.push(lesson);
      else map.set(stageId, [lesson]);
    }
    return map;
  }, [lessons]);

  const pathLessons: PathLesson[] = useMemo(
    () => (lessons ?? []).map((l) => ({ id: l.id, display_order: l.display_order })),
    [lessons],
  );

  const nextUpId = useMemo(
    () => findNextUpLessonId(pathLessons, progress),
    [pathLessons, progress],
  );

  const isLoading = stagesLoading || lessonsLoading;

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  const hasLessons = (lessons?.length ?? 0) > 0;

  return (
    <AppShell>
      <div className="mb-4">
        <HomeButton />
      </div>

      <HubHeader
        title="Curriculum"
        subtitle={`Your ${activeDialect} path, stage by stage.`}
      />

      {!isAuthenticated && (
        <p className="mb-6 text-sm text-muted-foreground">
          <Link to="/auth" className="text-primary hover:underline">
            Sign in
          </Link>{" "}
          to track which lessons you've finished.
        </p>
      )}

      {!hasLessons && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-foreground font-medium mb-1">No lessons yet for {activeDialect}</p>
          <p className="text-sm text-muted-foreground">
            Try another dialect from the switcher on Home, or start with the{" "}
            <Link to="/alphabet" className="text-primary hover:underline">
              Alphabet Journey
            </Link>
            .
          </p>
        </div>
      )}

      {(stages ?? []).map((stage) => {
        const stageLessons = lessonsByStage.get(stage.id) ?? [];
        if (stageLessons.length === 0) return null;

        const stagePath: PathLesson[] = stageLessons.map((l) => ({
          id: l.id,
          display_order: l.display_order,
        }));
        const completion = stageCompletion(stagePath, progress);

        return (
          <section key={stage.id} className="mb-8">
            <div className="flex items-baseline justify-between gap-3 mb-1 px-1">
              <h2
                className="text-lg font-bold text-foreground"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              >
                {stage.name}
              </h2>
              {stage.cefr_level && (
                <span className="shrink-0 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  {stage.cefr_level}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 px-1 mb-3">
              <div
                className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuenow={completion.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${stage.name} progress`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${completion.percent}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {completion.completed}/{completion.total}
              </span>
            </div>

            <div className="space-y-2">
              {stageLessons
                .slice()
                .sort((a, b) => a.display_order - b.display_order)
                .map((lesson) => {
                  const state = lessonPathState(
                    { id: lesson.id, display_order: lesson.display_order },
                    progress,
                    nextUpId,
                  );
                  const unlockCondition = lesson.unlock_condition;

                  return (
                    <Link
                      key={lesson.id}
                      to={`/learn/${lesson.id}`}
                      className={cn(
                        "flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200",
                        state.isNextUp
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/30",
                      )}
                    >
                      <span className="shrink-0">
                        {state.status === "completed" ? (
                          <CheckCircle2 className="h-6 w-6 text-primary" />
                        ) : state.status === "in_progress" ? (
                          <PlayCircle className="h-6 w-6 text-primary" />
                        ) : (
                          <Circle className="h-6 w-6 text-muted-foreground/40" />
                        )}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{lesson.name}</span>
                          {state.isNextUp && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                              Next up
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {state.status === "completed"
                            ? state.bestScore !== null
                              ? `Completed · best ${Math.round(state.bestScore)}%`
                              : "Completed"
                            : state.status === "in_progress"
                            ? `${state.percentComplete}% through`
                            : [
                                lesson.word_count ? `${lesson.word_count} words` : null,
                                unlockCondition || null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Not started"}
                        </p>

                        {state.status === "in_progress" && (
                          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-500"
                              style={{ width: `${state.percentComplete}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  );
                })}
            </div>
          </section>
        );
      })}
    </AppShell>
  );
};

export default Curriculum;
