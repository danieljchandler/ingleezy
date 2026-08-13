import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import type { ReaderSentence } from "@/lib/sentences";

export interface DailyStory {
  id: string;
  user_id: string;
  story_date: string;
  dialect: string;
  title: string;
  body_arabic: string;
  body_transliteration: string | null;
  body_english: string | null;
  body_english_literal: string | null;
  /** Per-sentence text for the reader. Null on stories generated before it existed. */
  sentences: ReaderSentence[] | null;
  vocab_used: string[];
  new_words: string[];
  audio_url: string | null;
  created_at: string;
  updated_at: string;
}

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Returns today's daily story if it already exists (does NOT generate). */
export function useDailyStory() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["daily-story", user?.id, activeDialect, todayUtc()],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DailyStory | null> => {
      const { data, error } = await supabase
        .from("daily_vocab_stories" as never)
        .select("*")
        .eq("user_id", user!.id)
        .eq("story_date", todayUtc())
        .eq("dialect", activeDialect)
        .maybeSingle();
      if (error) throw error;
      return (data as DailyStory | null) ?? null;
    },
  });
}

/** Triggers (or fetches cached) generation via the edge function. */
export function useGenerateDailyStory() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useMutation({
    mutationFn: async (opts?: { force?: boolean }): Promise<DailyStory> => {
      const force = opts?.force ?? false;
      const { data, error } = await supabase.functions.invoke("generate-daily-story", {
        body: { dialect: activeDialect, force },
      });
      if (error) throw error;
      if (!data?.story) throw new Error(data?.message || data?.error || "No story returned");
      return data.story as DailyStory;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily-story", user?.id, activeDialect, todayUtc()] });
    },
  });
}
