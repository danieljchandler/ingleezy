import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { DiscoverVideo } from "./useDiscoverVideos";

// Get liked video IDs for the current user
export function useVideoLikes() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["video-likes", user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("video_likes" as any)
        .select("video_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data || []).map((d: any) => d.video_id as string);
    },
    enabled: !!user,
  });
}

// Check if a specific video is liked
export function useIsVideoLiked(videoId: string | undefined) {
  const { data: likes } = useVideoLikes();
  return !!videoId && (likes || []).includes(videoId);
}

// Get like count for a video
export function useVideoLikeCount(videoId: string | undefined) {
  return useQuery({
    queryKey: ["video-like-count", videoId],
    queryFn: async (): Promise<number> => {
      if (!videoId) return 0;
      const { count, error } = await supabase
        .from("video_likes" as any)
        .select("id", { count: "exact", head: true })
        .eq("video_id", videoId);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!videoId,
  });
}

// Like a video
export function useLikeVideo() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (videoId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("video_likes" as any)
        .insert({ video_id: videoId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: (_, videoId) => {
      queryClient.invalidateQueries({ queryKey: ["video-likes"] });
      queryClient.invalidateQueries({ queryKey: ["video-like-count", videoId] });
      queryClient.invalidateQueries({ queryKey: ["liked-videos"] });
    },
  });
}

// Unlike a video
export function useUnlikeVideo() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (videoId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("video_likes" as any)
        .delete()
        .eq("video_id", videoId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: (_, videoId) => {
      queryClient.invalidateQueries({ queryKey: ["video-likes"] });
      queryClient.invalidateQueries({ queryKey: ["video-like-count", videoId] });
      queryClient.invalidateQueries({ queryKey: ["liked-videos"] });
    },
  });
}

// Get all liked videos (with full video data) for a user
export function useLikedVideos(userId?: string) {
  const { user: authUser } = useAuth();
  const targetUserId = userId || authUser?.id;

  return useQuery({
    queryKey: ["liked-videos", targetUserId],
    queryFn: async (): Promise<DiscoverVideo[]> => {
      if (!targetUserId) return [];
      // Get liked video IDs
      const { data: likes, error: likesError } = await supabase
        .from("video_likes" as any)
        .select("video_id, created_at")
        .eq("user_id", targetUserId)
        .order("created_at", { ascending: false });
      if (likesError) throw likesError;

      const videoIds = (likes || []).map((l: any) => l.video_id as string);
      if (videoIds.length === 0) return [];

      // Get the video data
      const { data: videos, error: videosError } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .in("id", videoIds)
        .eq("published", true);
      if (videosError) throw videosError;

      // Sort by liked order
      const videoMap = new Map((videos || []).map((v: any) => [v.id, v]));
      return videoIds
        .map((id) => videoMap.get(id))
        .filter(Boolean) as DiscoverVideo[];
    },
    enabled: !!targetUserId,
  });
}
