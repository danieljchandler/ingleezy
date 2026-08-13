import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { DIALECT_MODULE_VALUES, type Dialect } from "@/config";

const DIFFICULTY_ORDER = ["Beginner", "Intermediate", "Advanced", "Expert"];
const CEFR_TO_DIFFICULTY: Record<string, string> = {
  A1: "Beginner", A2: "Beginner",
  B1: "Intermediate", B2: "Intermediate",
  C1: "Advanced", C2: "Expert",
};

/**
 * Map a learner's CEFR placement level to the set of difficulty buckets
 * within one step of their level (their bucket plus the adjacent one on
 * each side), so the Discover feed can be filtered to level ±1 instead of
 * showing every difficulty regardless of the learner's placement.
 * Returns null (no filter) when the learner hasn't taken placement yet.
 */
export function difficultyWindow(cefrLevel: string | null | undefined): string[] | null {
  if (!cefrLevel) return null;
  const bucket = CEFR_TO_DIFFICULTY[cefrLevel.toUpperCase()];
  const idx = DIFFICULTY_ORDER.indexOf(bucket);
  if (idx === -1) return null;
  const lo = Math.max(0, idx - 1);
  const hi = Math.min(DIFFICULTY_ORDER.length - 1, idx + 1);
  return DIFFICULTY_ORDER.slice(lo, hi + 1);
}

export interface DiscoverVideo {
  id: string;
  title: string;
  title_arabic: string | null;
  source_url: string;
  platform: string;
  embed_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  dialect: string;
  difficulty: string;
  cefr_level?: string | null;
  /** 'native' = this app's English uploads; 'hakiya' = bridged Arabic immersion content. */
  source?: string;
  transcript_lines: Json;
  vocabulary: Json;
  grammar_points: Json;
  cultural_context: string | null;
  published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  transcription_status?: string;
  transcription_error?: string | null;
  trending_candidate_id?: string | null;
  is_meme?: boolean;
  engines_used?: Json | null;
}

export function useDiscoverVideos(
  filters?: { dialect?: string; difficulty?: string | string[]; search?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["discover-videos", filters],
    // Off by default for nobody — the flag exists so a caller can hold a second,
    // wider read back until it knows the narrow one came up empty (see
    // useTodaysVideo), rather than fetching the whole library on every home page
    // load just in case.
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      let query = supabase
        .from("discover_videos" as any)
        .select("*")
        .eq("published", true)
        .order("created_at", { ascending: false });

      if (filters?.dialect) {
        // Gulf videos can be tagged with the specific country the AI detected
        // (Saudi, Kuwaiti, ...) rather than the bare "Gulf" module name, so an
        // exact-match filter would drop them. Expand to every raw value that
        // belongs to the selected module; fall back to an exact match for any
        // other (e.g. legacy MSA/Levantine/Maghrebi) tag.
        const moduleValues = DIALECT_MODULE_VALUES[filters.dialect as Dialect];
        query = moduleValues
          ? query.in("dialect", moduleValues as string[])
          : query.eq("dialect", filters.dialect);
      }
      if (Array.isArray(filters?.difficulty)) {
        if (filters.difficulty.length > 0) query = query.in("difficulty", filters.difficulty);
      } else if (filters?.difficulty) {
        query = query.eq("difficulty", filters.difficulty);
      }
      if (filters?.search) {
        query = query.ilike("title", `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as DiscoverVideo[];
    },
  });
}

export function useDiscoverVideo(videoId: string | undefined) {
  return useQuery({
    queryKey: ["discover-video", videoId],
    queryFn: async () => {
      if (!videoId) return null;
      const { data, error } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .eq("id", videoId)
        .single();
      if (error) throw error;
      return data as unknown as DiscoverVideo;
    },
    enabled: !!videoId,
    // Auto-refresh when video is still being processed
    refetchInterval: (query) => {
      const video = query.state.data;
      const isProcessing =
        video?.transcription_status === 'pending' ||
        video?.transcription_status === 'processing';
      return isProcessing ? 5000 : false;
    },
  });
}

export function useAdminDiscoverVideos() {
  return useQuery({
    queryKey: ["admin-discover-videos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DiscoverVideo[];
    },
    // Auto-refresh every 10s when any video is still processing
    refetchInterval: (query) => {
      const videos = query.state.data;
      const hasProcessing = videos?.some(
        (v) => v.transcription_status === 'pending' || v.transcription_status === 'processing'
      );
      return hasProcessing ? 10000 : false;
    },
  });
}

export function useDeleteDiscoverVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("discover_videos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-discover-videos"] }),
  });
}

export function useTogglePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { error } = await (supabase.from("discover_videos" as any) as any)
        .update({ published })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-discover-videos"] }),
  });
}
