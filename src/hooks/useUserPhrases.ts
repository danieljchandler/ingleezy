import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";

export interface UserPhrase {
  id: string;
  user_id: string;
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string | null;
  notes: string | null;
  source: string;
  dialect: string;
  ease_factor: number;
  difficulty: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  lapses?: number;
  is_leech?: boolean;
  mnemonic?: string | null;
  jingle_audio_url?: string | null;
  jingle_lyrics?: string | null;
  phrase_audio_url?: string | null;
}

export const useUserPhrases = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["user-phrases", user?.id, mixAll ? "all" : activeDialect],
    queryFn: async () => {
      if (!user) return [];

      let q: any = (supabase as any)
        .from("user_phrases")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (!mixAll) q = q.eq("dialect", activeDialect);

      const { data, error } = await q;

      if (error) throw error;
      return (data ?? []) as UserPhrase[];
    },
    enabled: !!user,
  });
};

export const useUserPhrasesDueCount = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["user-phrases-due-count", user?.id, mixAll ? "all" : activeDialect],
    queryFn: async () => {
      if (!user) return { dueCount: 0, total: 0 };
      const now = new Date().toISOString();
      let dueQ: any = (supabase as any)
        .from("user_phrases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .lte("next_review_at", now);
      let totalQ: any = (supabase as any)
        .from("user_phrases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (!mixAll) {
        dueQ = dueQ.eq("dialect", activeDialect);
        totalQ = totalQ.eq("dialect", activeDialect);
      }
      const [{ count: dueCount }, { count: total }] = await Promise.all([dueQ, totalQ]);
      return { dueCount: dueCount ?? 0, total: total ?? 0 };
    },
    enabled: !!user,
  });
};

export const useDueUserPhrases = (mixAll = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["user-phrases-due", user?.id, mixAll ? "all" : activeDialect],
    queryFn: async (): Promise<UserPhrase[]> => {
      if (!user) return [];
      const now = new Date().toISOString();
      let q: any = (supabase as any)
        .from("user_phrases")
        .select("*")
        .eq("user_id", user.id)
        .lte("next_review_at", now)
        .order("next_review_at", { ascending: true });
      if (!mixAll) q = q.eq("dialect", activeDialect);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as UserPhrase[];
    },
    enabled: !!user,
  });
};

export const PHRASE_LEECH_THRESHOLD = 6;

export const useUpdateUserPhraseReview = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      phraseId: string;
      stability: number;
      difficulty: number;
      intervalDays: number;
      repetitions: number;
      nextReviewAt: Date;
      rating?: string;
      currentLapses?: number;
    }) => {
      const failed = args.rating === "again";
      const newLapses = failed ? (args.currentLapses ?? 0) + 1 : (args.currentLapses ?? 0);
      const leechTrackingEnabled = (() => {
        try {
          const raw = localStorage.getItem("hakiya:leech-tracking-enabled");
          return raw === null ? true : raw === "true";
        } catch {
          return true;
        }
      })();
      const isLeech = leechTrackingEnabled && newLapses >= PHRASE_LEECH_THRESHOLD;
      const { error } = await (supabase as any)
        .from("user_phrases")
        .update({
          ease_factor: args.stability,
          difficulty: args.difficulty,
          interval_days: Math.max(0, Math.round(args.intervalDays)),
          repetitions: args.repetitions,
          next_review_at: args.nextReviewAt.toISOString(),
          last_reviewed_at: new Date().toISOString(),
          lapses: newLapses,
          is_leech: isLeech,
        })
        .eq("id", args.phraseId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-phrases"] });
      queryClient.invalidateQueries({ queryKey: ["user-phrases-due"] });
      queryClient.invalidateQueries({ queryKey: ["user-phrases-due-count"] });
    },
  });
};

export const useAddUserPhrase = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useMutation({
    mutationFn: async (phrase: {
      phrase_arabic: string;
      phrase_english: string;
      transliteration?: string;
      notes?: string;
      source?: string;
      dialect?: string;
    }) => {
      if (!user) throw new Error("Must be logged in");

      const { data, error } = await (supabase as any)
        .from("user_phrases")
        .insert({
          user_id: user.id,
          phrase_arabic: phrase.phrase_arabic,
          phrase_english: phrase.phrase_english,
          transliteration: phrase.transliteration || null,
          notes: phrase.notes || null,
          source: phrase.source || "how-do-i-say",
          dialect: phrase.dialect || activeDialect,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("هذه العبارة موجودة بالفعل في قائمتك");
        }
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-phrases"] });
      queryClient.invalidateQueries({ queryKey: ["user-phrases-due-count"] });
    },
  });
};

export const useDeleteUserPhrase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (phraseId: string) => {
      const { error } = await (supabase as any)
        .from("user_phrases")
        .delete()
        .eq("id", phraseId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-phrases"] });
      queryClient.invalidateQueries({ queryKey: ["user-phrases-due-count"] });
    },
  });
};
