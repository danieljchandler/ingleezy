import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mergeBestScore, type LessonProgressRow } from "@/lib/lessonPath";

/**
 * Per-learner lesson progress.
 *
 * Until now nothing recorded which lessons a learner had finished — the only
 * trace was one localStorage "continue" entry with a 7-day TTL, so progress
 * didn't survive a device change and the curriculum had no notion of being
 * walked at all.
 *
 * The state derivation (next-up, percentages, best-score merging) lives in
 * src/lib/lessonPath.ts and is unit-tested; this file is only the query layer.
 */

const KEY = "lesson-progress";

/** Every progress row for the signed-in learner. */
export const useLessonProgress = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id],
    queryFn: async (): Promise<LessonProgressRow[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("lesson_progress" as never)
        .select("lesson_id, status, last_word_index, words_seen, words_total, best_score, completed_at")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []) as unknown as LessonProgressRow[];
    },
    enabled: !!user,
  });
};

/** The row for one lesson, or null. Used by Learn.tsx to resume. */
export const useLessonProgressFor = (lessonId: string | undefined) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id, lessonId],
    queryFn: async (): Promise<LessonProgressRow | null> => {
      if (!user || !lessonId) return null;
      const { data, error } = await supabase
        .from("lesson_progress" as never)
        .select("lesson_id, status, last_word_index, words_seen, words_total, best_score, completed_at")
        .eq("user_id", user.id)
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as LessonProgressRow | null;
    },
    enabled: !!user && !!lessonId,
  });
};

export interface ResumableLesson {
  lessonId: string;
  title: string;
  lastWordIndex: number;
  wordsSeen: number;
  wordsTotal: number;
  updatedAt: string;
}

/**
 * The lesson to offer on the Home "continue" card when there's nothing in
 * localStorage — a new device, a cleared cache, or an entry past its 7-day TTL.
 *
 * Scoped to the active dialect so switching modules doesn't offer a lesson from
 * the one you just left.
 */
export const useResumableLesson = (dialect: string) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, "resumable", user?.id, dialect],
    queryFn: async (): Promise<ResumableLesson | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("lesson_progress" as never)
        .select(
          "lesson_id, last_word_index, words_seen, words_total, updated_at, lessons!inner(title, dialect_module)",
        )
        .eq("user_id", user.id)
        .eq("status", "in_progress")
        .eq("lessons.dialect_module", dialect)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const row = data as unknown as {
        lesson_id: string;
        last_word_index: number;
        words_seen: number;
        words_total: number;
        updated_at: string;
        lessons?: { title?: string } | null;
      };

      return {
        lessonId: row.lesson_id,
        title: row.lessons?.title ?? "Lesson",
        lastWordIndex: row.last_word_index ?? 0,
        wordsSeen: row.words_seen ?? 0,
        wordsTotal: row.words_total ?? 0,
        updatedAt: row.updated_at,
      };
    },
    enabled: !!user,
  });
};

export interface ProgressUpdate {
  lessonId: string;
  lastWordIndex?: number;
  wordsSeen?: number;
  wordsTotal?: number;
  /** Percentage for this attempt. Merged with any previous best, never lowered. */
  score?: number;
  completed?: boolean;
}

/**
 * Record progress through a lesson.
 *
 * Best-effort by design: this is bookkeeping alongside the lesson the learner is
 * actually doing, so a failure logs and moves on rather than interrupting them.
 * Every write goes through the same upsert so a lesson opened for the first time
 * and one being resumed take identical paths.
 */
export const useUpsertLessonProgress = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (update: ProgressUpdate) => {
      if (!user) return null;

      // Read the current row so best_score can be merged and words_total isn't
      // clobbered by a partial update.
      const { data: existing } = await supabase
        .from("lesson_progress" as never)
        .select("best_score, words_seen, words_total, status")
        .eq("user_id", user.id)
        .eq("lesson_id", update.lessonId)
        .maybeSingle();

      const prev = existing as unknown as {
        best_score: number | null;
        words_seen: number | null;
        words_total: number | null;
        status: string | null;
      } | null;

      const nowIso = new Date().toISOString();
      const row: Record<string, unknown> = {
        user_id: user.id,
        lesson_id: update.lessonId,
        updated_at: nowIso,
      };

      if (update.lastWordIndex !== undefined) row.last_word_index = update.lastWordIndex;
      if (update.wordsTotal !== undefined) row.words_total = update.wordsTotal;
      // Furthest point reached, not the current position — going back to review
      // an earlier card shouldn't shrink the progress bar.
      if (update.wordsSeen !== undefined) {
        row.words_seen = Math.max(update.wordsSeen, prev?.words_seen ?? 0);
      }
      if (update.score !== undefined) {
        row.best_score = mergeBestScore(prev?.best_score, update.score);
      }

      if (update.completed) {
        row.status = "completed";
        row.completed_at = nowIso;
        // A finished lesson restarts from the beginning, not from where the
        // previous run happened to end.
        row.last_word_index = 0;
      } else if (prev?.status !== "completed") {
        // Never demote a completed lesson back to in-progress just because the
        // learner reopened it to practise.
        row.status = "in_progress";
      }

      const { error } = await supabase
        .from("lesson_progress" as never)
        .upsert(row as never, { onConflict: "user_id,lesson_id" });
      if (error) throw error;
      return update.lessonId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
    },
    onError: (err) => {
      // Bookkeeping must never interrupt the lesson in progress.
      console.warn("Couldn't save lesson progress:", err);
    },
  });
};
