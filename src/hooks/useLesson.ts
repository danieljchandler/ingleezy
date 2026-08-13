import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LessonVocabularyWord {
  id: string;
  lesson_id: string | null;
  topic_id: string | null;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface LessonWithWords {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  words: LessonVocabularyWord[];
}

/** Fetches a lesson with its vocabulary words from the lessons table */
export const useLesson = (lessonId: string | undefined) => {
  return useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: async () => {
      if (!lessonId) throw new Error('Lesson ID is required');

      // Try lessons table first
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('*')
        .eq('id', lessonId)
        .maybeSingle();

      if (lesson) {
        // Fetch words linked by lesson_id
        const { data: words, error: wordsError } = await supabase
          .from('vocabulary_words')
          .select('*')
          .eq('lesson_id', lessonId)
          .order('display_order', { ascending: true });

        if (wordsError) throw wordsError;

        return {
          id: lesson.id,
          name: lesson.title,
          name_arabic: lesson.title_arabic || '',
          icon: lesson.icon,
          gradient: lesson.gradient,
          display_order: lesson.display_order,
          words: (words || []) as LessonVocabularyWord[],
        } as LessonWithWords;
      }

      // Fallback: try topics table for legacy data
      const { data: topic, error: topicError } = await supabase
        .from('topics')
        .select('*')
        .eq('id', lessonId)
        .single();

      if (topicError) throw topicError;

      const { data: words, error: wordsError } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('topic_id', lessonId)
        .order('display_order', { ascending: true });

      if (wordsError) throw wordsError;

      return {
        id: topic.id,
        name: topic.name,
        name_arabic: topic.name_arabic,
        icon: topic.icon,
        gradient: topic.gradient,
        display_order: topic.display_order,
        words: (words || []) as LessonVocabularyWord[],
      } as LessonWithWords;
    },
    enabled: !!lessonId,
  });
};