import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface StoryScene {
  id: string;
  story_id: string;
  scene_order: number;
  narrative_arabic: string;
  narrative_english: string;
  narrative_literal?: string | null;
  vocabulary: { word_arabic: string; word_english: string }[];
  choices: { text_arabic: string; text_english: string; next_scene_order: number }[];
  is_ending: boolean;
  ending_message: string | null;
  ending_message_arabic: string | null;
}

export interface InteractiveStory {
  id: string;
  title: string;
  title_arabic: string;
  description: string;
  description_arabic: string;
  dialect: string;
  difficulty: string;
  icon_name: string;
  cover_image_url: string | null;
  status: string;
  created_by: string;
  display_order: number;
  created_at: string;
}

export interface StoryProgress {
  id: string;
  user_id: string;
  story_id: string;
  current_scene_id: string | null;
  completed: boolean;
  path_taken: number[];
  started_at: string;
  completed_at: string | null;
}

export function usePublishedStories() {
  return useQuery({
    queryKey: ['interactive-stories', 'published'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interactive_stories')
        .select('*')
        .eq('status', 'published')
        .order('display_order');
      if (error) throw error;
      return data as InteractiveStory[];
    },
  });
}

export function useAllStories() {
  return useQuery({
    queryKey: ['interactive-stories', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interactive_stories')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data as InteractiveStory[];
    },
  });
}

export function useStoryScenes(storyId: string | undefined) {
  return useQuery({
    queryKey: ['story-scenes', storyId],
    enabled: !!storyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('story_scenes')
        .select('*')
        .eq('story_id', storyId!)
        .order('scene_order');
      if (error) throw error;
      return (data as unknown as StoryScene[]).map(s => ({
        ...s,
        vocabulary: Array.isArray(s.vocabulary) ? s.vocabulary : [],
        choices: Array.isArray(s.choices) ? s.choices : [],
      }));
    },
  });
}

export function useStoryProgress(storyId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['story-progress', storyId, user?.id],
    enabled: !!storyId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('story_progress')
        .select('*')
        .eq('story_id', storyId!)
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as StoryProgress | null;
    },
  });
}

export function useUpsertStoryProgress() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      storyId: string;
      currentSceneId: string | null;
      completed: boolean;
      pathTaken: number[];
    }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('story_progress')
        .upsert(
          {
            user_id: user.id,
            story_id: params.storyId,
            current_scene_id: params.currentSceneId,
            completed: params.completed,
            path_taken: params.pathTaken,
            completed_at: params.completed ? new Date().toISOString() : null,
          },
          { onConflict: 'user_id,story_id' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['story-progress', vars.storyId] });
    },
  });
}
