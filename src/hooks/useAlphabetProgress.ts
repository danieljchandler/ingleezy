import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ARABIC_LETTERS, LETTER_STEPS, type LetterStepId } from "@/data/arabicAlphabet";

export interface LetterProgressRow {
  letter_code: string;
  steps_completed: LetterStepId[];
  best_spot_score: number;
  best_sound_score: number;
  mastered_at: string | null;
  last_practiced_at: string;
}

export interface CheckpointRow {
  checkpoint_index: number;
  score: number;
  completed_at: string;
}

/** Returns the user's per-letter progress as a map keyed by letter_code. */
export function useAlphabetProgress() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["alphabet-progress", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_letter_progress" as any)
        .select("letter_code, steps_completed, best_spot_score, best_sound_score, mastered_at, last_practiced_at")
        .eq("user_id", user!.id);
      if (error) throw error;
      const map: Record<string, LetterProgressRow> = {};
      for (const row of (data as any[]) ?? []) {
        map[row.letter_code] = {
          letter_code: row.letter_code,
          steps_completed: Array.isArray(row.steps_completed) ? row.steps_completed : [],
          best_spot_score: row.best_spot_score ?? 0,
          best_sound_score: row.best_sound_score ?? 0,
          mastered_at: row.mastered_at,
          last_practiced_at: row.last_practiced_at,
        };
      }
      return map;
    },
  });

  const completeStep = useMutation({
    mutationFn: async ({
      letterCode,
      step,
      spotScore,
      soundScore,
    }: {
      letterCode: string;
      step: LetterStepId;
      spotScore?: number;
      soundScore?: number;
    }) => {
      if (!user?.id) throw new Error("Not signed in");
      const existing = query.data?.[letterCode];
      const stepsSet = new Set<LetterStepId>(existing?.steps_completed ?? []);
      stepsSet.add(step);
      const stepsCompleted = LETTER_STEPS.filter((s) => stepsSet.has(s));
      const mastered =
        LETTER_STEPS.every((s) => stepsSet.has(s)) && !existing?.mastered_at;
      const row = {
        user_id: user.id,
        letter_code: letterCode,
        steps_completed: stepsCompleted,
        best_spot_score: Math.max(existing?.best_spot_score ?? 0, spotScore ?? 0),
        best_sound_score: Math.max(existing?.best_sound_score ?? 0, soundScore ?? 0),
        mastered_at:
          existing?.mastered_at ?? (mastered ? new Date().toISOString() : null),
        last_practiced_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("user_letter_progress" as any)
        .upsert(row, { onConflict: "user_id,letter_code" });
      if (error) throw error;
      return { mastered };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alphabet-progress", user?.id] });
    },
  });

  /** Index of the highest available letter (first non-mastered, or 0). */
  const currentIndex = useCallback(() => {
    if (!query.data) return 0;
    for (const l of ARABIC_LETTERS) {
      if (!query.data[l.code]?.mastered_at) return l.order_index;
    }
    return ARABIC_LETTERS.length - 1;
  }, [query.data]);

  /** Total mastered count. */
  const masteredCount = Object.values(query.data ?? {}).filter((r) => r.mastered_at).length;

  /** Whether a given letter is unlocked (sequential progression). */
  const isUnlocked = useCallback(
    (orderIndex: number) => orderIndex <= currentIndex(),
    [currentIndex],
  );

  return {
    progress: query.data ?? {},
    isLoading: query.isLoading,
    masteredCount,
    isUnlocked,
    completeStep: completeStep.mutateAsync,
  };
}

export function useCheckpointProgress() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["alphabet-checkpoints", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_checkpoint_progress" as any)
        .select("checkpoint_index, score, completed_at")
        .eq("user_id", user!.id);
      if (error) throw error;
      const map: Record<number, CheckpointRow> = {};
      for (const row of (data as any[]) ?? []) {
        map[row.checkpoint_index] = row as CheckpointRow;
      }
      return map;
    },
  });

  const recordCheckpoint = useMutation({
    mutationFn: async ({ index, score }: { index: number; score: number }) => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase.rpc("record_checkpoint", {
        _index: index,
        _score: score,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alphabet-checkpoints", user?.id] });
    },
  });

  return {
    checkpoints: query.data ?? {},
    isLoading: query.isLoading,
    recordCheckpoint: recordCheckpoint.mutateAsync,
  };
}
