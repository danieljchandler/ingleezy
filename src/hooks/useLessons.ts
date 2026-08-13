import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';

export interface Lesson {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  word_count?: number;
  /** Needed to group lessons under their stage on the curriculum path. */
  stage_id: string | null;
  cefr_target: string | null;
  duration_minutes: number | null;
  /**
   * Free text from the lesson spreadsheet, shown as guidance on the curriculum
   * page. Deliberately not parsed into a gate — see src/pages/Curriculum.tsx.
   */
  unlock_condition: string | null;
}

/** Fetch lessons from the lessons table, filtered by active dialect module and optional stage */
export const useLessons = (stageId?: string | undefined) => {
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['lessons', stageId, activeDialect],
    queryFn: async () => {
      let query = supabase
        .from('lessons')
        .select('*, vocabulary_words(id)')
        .eq('dialect_module', activeDialect)
        .order('display_order', { ascending: true });

      if (stageId) {
        query = query.eq('stage_id', stageId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((lesson: any) => ({
        id: lesson.id,
        name: lesson.title,
        name_arabic: lesson.title_arabic || '',
        icon: lesson.icon,
        gradient: lesson.gradient,
        display_order: lesson.display_order,
        created_at: lesson.created_at,
        updated_at: lesson.updated_at,
        word_count: lesson.vocabulary_words?.length || 0,
        stage_id: lesson.stage_id ?? null,
        cefr_target: lesson.cefr_target ?? null,
        duration_minutes: lesson.duration_minutes ?? null,
        unlock_condition: lesson.unlock_condition ?? null,
      })) as Lesson[];
    },
  });
};

/** Fetch all lessons across all stages (alias) */
export const useAllLessons = () => useLessons();
