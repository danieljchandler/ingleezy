import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useDialect } from '@/contexts/DialectContext';

export interface WordWithTopic {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position: string | null;
  root?: string | null;
  display_order: number;
  topic_id: string | null;
  lesson_id: string | null;
  topic_name: string;
  topic_name_arabic: string;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const useAllWords = (onlyNew = false) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['all-words', onlyNew, user?.id, activeDialect],
    queryFn: async (): Promise<WordWithTopic[]> => {
      const query = supabase
        .from('vocabulary_words')
        .select(`
          id,
          word_arabic,
          word_english,
          image_url,
          audio_url,
          image_position,
          root,
          display_order,
          topic_id,
          lesson_id,
          lessons (
            title,
            title_arabic
          ),
          topics (
            name,
            name_arabic
          )
        `);

      const { data: words, error } = await (query as any).eq('dialect_module', activeDialect);

      if (error) throw error;

      let mapped = (words || []).map((w: any) => {
        const lesson = w.lessons;
        const topic = w.topics;
        return {
          id: w.id,
          word_arabic: w.word_arabic,
          word_english: w.word_english,
          image_url: w.image_url,
          audio_url: w.audio_url,
          image_position: w.image_position,
          display_order: w.display_order,
          topic_id: w.topic_id,
          lesson_id: w.lesson_id,
          topic_name: lesson?.title || topic?.name || '',
          topic_name_arabic: lesson?.title_arabic || topic?.name_arabic || '',
        };
      });

      if (onlyNew && user) {
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('word_id')
          .eq('user_id', user.id);

        const reviewedIds = new Set(reviews?.map(r => r.word_id) || []);
        mapped = mapped.filter((w: any) => !reviewedIds.has(w.id));
      }

      return shuffleArray(mapped);
    },
  });
};
