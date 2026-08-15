import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { calculateNextReview, elapsedDaysSince, type Rating } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "./useDesiredRetention";

const sb = supabase as any;

export interface SetPhraseOccasion {
  id: string;
  slug: string;
  name: string;
  name_arabic: string | null;
  description: string | null;
  icon_name: string;
  display_order: number;
  dialect: string;
  difficulty_floor: string;
}

export interface SetPhrase {
  id: string;
  occasion_id: string | null;
  dialect: string;
  phrase_arabic: string;
  phrase_phonetic_ar: string | null;
  phrase_english: string | null;
  phrase_literal: string | null;
  phrase_audio_url: string | null;
  reply_arabic: string | null;
  reply_phonetic_ar: string | null;
  reply_english: string | null;
  reply_literal: string | null;
  reply_audio_url: string | null;
  scenario_english: string | null;
  cultural_note: string | null;
  formality: string;
  difficulty: string;
  accepted_variants: string[];
  cached_distractors: { arabic: string; english?: string }[];
  status: string;
  tags: string[];
}

export const useSetPhraseOccasions = () => {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["set-phrase-occasions", activeDialect],
    queryFn: async () => {
      const { data, error } = await sb
        .from("set_phrase_occasions")
        .select("*")
        .eq("dialect", activeDialect)
        .eq("status", "published")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as SetPhraseOccasion[];
    },
  });
};

export const useSetPhrasesByOccasion = (occasionId: string | undefined) => {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["set-phrases", activeDialect, occasionId],
    queryFn: async () => {
      if (!occasionId) return [];
      const { data, error } = await sb
        .from("set_phrases")
        .select("*")
        .eq("dialect", activeDialect)
        .eq("status", "published")
        .eq("occasion_id", occasionId)
        .order("difficulty");
      if (error) throw error;
      return (data ?? []) as SetPhrase[];
    },
    enabled: !!occasionId,
  });
};

export interface UserSetPhrase {
  id: string;
  user_id: string;
  phrase_id: string;
  source: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  last_quality: number | null;
  set_phrases?: SetPhrase;
}

export const useUserSetPhrases = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-set-phrases", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await sb
        .from("user_set_phrases")
        .select("*, set_phrases(*)")
        .eq("user_id", user.id)
        .order("next_review_at");
      if (error) throw error;
      return (data ?? []) as UserSetPhrase[];
    },
    enabled: !!user,
  });
};

export const useUserSetPhrasesDueCount = () => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["user-set-phrases-due", user?.id, activeDialect],
    queryFn: async () => {
      if (!user) return 0;
      // Inner-join on set_phrases so we only count rows whose phrase matches the active dialect
      const { count, error } = await sb
        .from("user_set_phrases")
        .select("*, set_phrases!inner(dialect)", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("set_phrases.dialect", activeDialect)
        .lte("next_review_at", new Date().toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });
};

export const useSavePhrase = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phraseId, source = "manual_save" }: { phraseId: string; source?: string }) => {
      if (!user) throw new Error("login required");
      const { error } = await sb.from("user_set_phrases").upsert(
        {
          user_id: user.id,
          phrase_id: phraseId,
          source,
        },
        { onConflict: "user_id,phrase_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-set-phrases"] });
      qc.invalidateQueries({ queryKey: ["user-set-phrases-due"] });
    },
  });
};

export const useReviewPhrase = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const desiredRetention = useDesiredRetention();
  return useMutation({
    mutationFn: async ({
      phraseId,
      quality,
    }: {
      phraseId: string;
      quality: number;
    }) => {
      if (!user) throw new Error("login required");
      // map quality 0..5 → FSRS rating
      const rating: Rating =
        quality >= 5 ? "easy" : quality >= 4 ? "good" : quality >= 3 ? "hard" : "again";

      const { data: existing } = await sb
        .from("user_set_phrases")
        .select("*")
        .eq("user_id", user.id)
        .eq("phrase_id", phraseId)
        .maybeSingle();

      const stability = existing?.ease_factor ?? 0;
      const difficulty = existing?.difficulty ?? 5;
      const intervalDays = existing?.interval_days ?? 0;
      const repetitions = existing?.repetitions ?? 0;
      const elapsedDays = elapsedDaysSince(existing?.last_reviewed_at);

      const next = calculateNextReview(rating, stability, difficulty, intervalDays, repetitions, elapsedDays, {
        desiredRetention,
        fuzzSeed: phraseId,
      });

      const row = {
        user_id: user.id,
        phrase_id: phraseId,
        source: existing?.source ?? "reviewed",
        ease_factor: next.stability,
        difficulty: next.difficulty,
        interval_days: Math.max(1, Math.round(next.intervalDays)),
        repetitions: next.repetitions,
        next_review_at: next.nextReviewAt.toISOString(),
        last_reviewed_at: new Date().toISOString(),
        last_quality: quality,
      };

      const { error } = await sb
        .from("user_set_phrases")
        .upsert(row, { onConflict: "user_id,phrase_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-set-phrases"] });
      qc.invalidateQueries({ queryKey: ["user-set-phrases-due"] });
    },
  });
};

export const useLogQuizAttempt = () => {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (a: {
      phrase_id: string;
      question_type: "reply" | "scenario";
      answer_mode: "voice" | "choice";
      correct: boolean;
      asr_transcript?: string | null;
      asr_similarity?: number | null;
    }) => {
      if (!user) return;
      await sb.from("set_phrase_quiz_attempts").insert({ ...a, user_id: user.id });
    },
  });
};

export interface QuizItem {
  phrase_id: string;
  question_type: "reply" | "scenario";
  /** reply mode: `english` is the opener the learner answers. scenario mode:
   *  `arabic` is the situation in the learner's dialect. */
  prompt: { arabic?: string; english?: string; audio_url?: string | null };
  /** The English the learner should produce. */
  expected_english: string;
  /** Its dialect-Arabic gloss. */
  expected_arabic?: string | null;
  /** phonetic_ar — the English pronounced in Arabic letters. */
  expected_transliteration?: string | null;
  expected_audio_url?: string | null;
  cultural_note?: string | null;
  formality?: string | null;
  occasion?: { name: string; icon_name: string } | null;
  choices: { english: string; arabic?: string; correct: boolean }[];
  is_due_review: boolean;
}

export const useGenerateQuiz = () => {
  const { activeDialect } = useDialect();
  return useMutation({
    mutationFn: async ({ occasionId, length = 8 }: { occasionId?: string; length?: number }) => {
      const { data, error } = await supabase.functions.invoke("generate-set-phrase-quiz", {
        body: { dialect: activeDialect, occasionId, length },
      });
      if (error) throw error;
      return (data?.items ?? []) as QuizItem[];
    },
  });
};

export const useScoreVoice = () => {
  return useMutation({
    mutationFn: async ({
      audioBase64,
      mimeType,
      phraseId,
      target,
    }: {
      audioBase64: string;
      mimeType: string;
      phraseId: string;
      target: "phrase" | "reply";
    }) => {
      const { data, error } = await supabase.functions.invoke("score-set-phrase-voice", {
        body: { audioBase64, mimeType, phraseId, target },
      });
      if (error) throw error;
      return data as {
        transcript: string;
        similarity: number;
        quality: number;
        accepted: boolean;
        canonical: string;
      };
    },
  });
};
