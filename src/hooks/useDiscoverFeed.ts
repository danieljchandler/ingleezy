import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import type { DiscoverVideo } from "./useDiscoverVideos";

export interface FeedItem {
  video_id: string;
  score: number;
  comprehension: number;
  reason: string;
  bucket: "match" | "stretch" | "comfort" | "fresh";
}

export interface DiscoverFeedResult {
  items: (FeedItem & { video: DiscoverVideo })[];
  coldStart: boolean;
  seed: number;
}

export function useDiscoverFeed(seed: number) {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ["discover-feed", user?.id, activeDialect, seed],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<DiscoverFeedResult> => {
      const { data, error } = await supabase.functions.invoke("discover-feed", {
        body: { limit: 24, seed },
      });
      if (error) throw error;

      const items = (data?.items ?? []) as FeedItem[];
      if (items.length === 0) {
        return { items: [], coldStart: !!data?.cold_start, seed: data?.seed ?? seed };
      }

      const ids = items.map((i) => i.video_id);
      const { data: videos, error: vErr } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .in("id", ids);
      if (vErr) throw vErr;

      const byId = new Map<string, DiscoverVideo>(
        (videos ?? []).map((v: any) => [v.id, v as DiscoverVideo]),
      );

      const hydrated = items
        .map((i) => {
          const v = byId.get(i.video_id);
          return v ? { ...i, video: v } : null;
        })
        .filter(Boolean) as (FeedItem & { video: DiscoverVideo })[];

      return {
        items: hydrated,
        coldStart: !!data?.cold_start,
        seed: data?.seed ?? seed,
      };
    },
  });
}

/**
 * Upsert a video view row, used to track engagement for the feed.
 * Throttled by caller; safe to call repeatedly.
 */
export function useRecordVideoView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      videoId,
      watchedSeconds,
      completed,
    }: {
      videoId: string;
      watchedSeconds: number;
      completed?: boolean;
    }) => {
      if (!user) return;
      const { error } = await (supabase.from("video_views" as any) as any).upsert(
        {
          user_id: user.id,
          video_id: videoId,
          watched_seconds: Math.round(watchedSeconds),
          completed: !!completed,
          watched_at: new Date().toISOString(),
        },
        { onConflict: "user_id,video_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discover-feed"] });
    },
  });
}
