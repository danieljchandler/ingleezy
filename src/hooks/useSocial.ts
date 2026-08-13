import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface UserFollow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface Challenge {
  id: string;
  challenger_id: string;
  challenged_id: string;
  challenge_type: string;
  target_xp: number;
  duration_days: number;
  status: string;
  challenger_progress: number;
  challenged_progress: number;
  winner_id: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

export interface FriendWithProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  xp_this_week: number;
  total_xp: number;
  level: number;
  current_streak: number;
  is_following: boolean;
}

// Get users I'm following
export const useFollowing = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["following", user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", user.id);
      if (error) throw error;
      return (data || []).map((f: any) => f.following_id);
    },
    enabled: !!user,
  });
};

// Get users following me
export const useFollowers = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["followers", user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_follows")
        .select("follower_id")
        .eq("following_id", user.id);
      if (error) throw error;
      return (data || []).map((f: any) => f.follower_id);
    },
    enabled: !!user,
  });
};

// Get friend activity (profiles of people I follow with their stats)
export const useFriendsActivity = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["friends-activity", user?.id],
    queryFn: async (): Promise<FriendWithProfile[]> => {
      if (!user) return [];

      // Get list of following
      const { data: follows, error: followsError } = await supabase
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", user.id);
      if (followsError) throw followsError;

      const followingIds = (follows || []).map((f: any) => f.following_id);
      if (followingIds.length === 0) return [];

      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .in("user_id", followingIds);
      if (profilesError) throw profilesError;

      // Get XP data
      const { data: xpData, error: xpError } = await supabase
        .from("user_xp")
        .select("user_id, xp_this_week, total_xp, level")
        .in("user_id", followingIds);
      if (xpError) throw xpError;

      // Get streaks
      const { data: streakData, error: streakError } = await supabase
        .from("review_streaks")
        .select("user_id, current_streak")
        .in("user_id", followingIds);
      if (streakError) throw streakError;

      // Combine data
      return followingIds.map((userId) => {
        const profile = (profiles || []).find((p: any) => p.user_id === userId) || {};
        const xp = (xpData || []).find((x: any) => x.user_id === userId) || {};
        const streak = (streakData || []).find((s: any) => s.user_id === userId) || {};
        return {
          user_id: userId,
          display_name: (profile as any).display_name || null,
          avatar_url: (profile as any).avatar_url || null,
          xp_this_week: (xp as any).xp_this_week || 0,
          total_xp: (xp as any).total_xp || 0,
          level: (xp as any).level || 1,
          current_streak: (streak as any).current_streak || 0,
          is_following: true,
        };
      }).sort((a, b) => b.xp_this_week - a.xp_this_week);
    },
    enabled: !!user,
  });
};

// Search users to follow
export const useSearchUsers = (searchTerm: string) => {
  const { user } = useAuth();
  const { data: following } = useFollowing();

  return useQuery({
    queryKey: ["search-users", searchTerm, user?.id],
    queryFn: async (): Promise<FriendWithProfile[]> => {
      if (!user || searchTerm.length < 2) return [];

      // Search profiles by display name
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .ilike("display_name", `%${searchTerm}%`)
        .neq("user_id", user.id)
        .eq("show_on_leaderboard", true)
        .limit(20);
      if (error) throw error;

      const userIds = (profiles || []).map((p: any) => p.user_id);
      if (userIds.length === 0) return [];

      // Get XP data
      const { data: xpData } = await supabase
        .from("user_xp")
        .select("user_id, xp_this_week, total_xp, level")
        .in("user_id", userIds);

      return (profiles || []).map((profile: any) => {
        const xp = (xpData || []).find((x: any) => x.user_id === profile.user_id) || {};
        return {
          user_id: profile.user_id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          xp_this_week: (xp as any).xp_this_week || 0,
          total_xp: (xp as any).total_xp || 0,
          level: (xp as any).level || 1,
          current_streak: 0,
          is_following: (following || []).includes(profile.user_id),
        };
      });
    },
    enabled: !!user && searchTerm.length >= 2,
  });
};

// Follow a user
export const useFollowUser = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("user_follows")
        .insert({ follower_id: user.id, following_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["following"] });
      queryClient.invalidateQueries({ queryKey: ["friends-activity"] });
      queryClient.invalidateQueries({ queryKey: ["search-users"] });
    },
  });
};

// Unfollow a user
export const useUnfollowUser = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("user_follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["following"] });
      queryClient.invalidateQueries({ queryKey: ["friends-activity"] });
      queryClient.invalidateQueries({ queryKey: ["search-users"] });
    },
  });
};

// Get my challenges
export const useMyChallenges = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-challenges", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("challenges")
        .select("*")
        .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Challenge[];
    },
    enabled: !!user,
  });
};

// Create a challenge
export const useCreateChallenge = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      challengedId,
      targetXp = 100,
      durationDays = 7,
    }: {
      challengedId: string;
      targetXp?: number;
      durationDays?: number;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      const { data, error } = await supabase
        .from("challenges")
        .insert({
          challenger_id: user.id,
          challenged_id: challengedId,
          target_xp: targetXp,
          duration_days: durationDays,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-challenges"] });
    },
  });
};

// Accept a challenge
export const useAcceptChallenge = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (challengeId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("challenges")
        .update({ status: "active" })
        .eq("id", challengeId)
        .eq("challenged_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-challenges"] });
    },
  });
};

// Decline a challenge
export const useDeclineChallenge = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (challengeId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("challenges")
        .update({ status: "declined" })
        .eq("id", challengeId)
        .eq("challenged_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-challenges"] });
    },
  });
};
