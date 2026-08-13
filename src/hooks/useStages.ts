import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CurriculumStage {
  id: string;
  name: string;
  name_arabic: string | null;
  stage_number: number;
  cefr_level: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  lesson_count?: number;
}

export const useStages = () => {
  return useQuery({
    queryKey: ['curriculum-stages'],
    queryFn: async (): Promise<CurriculumStage[]> => {
      const { data, error } = await supabase
        .from('curriculum_stages')
        .select('*')
        .order('stage_number', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CurriculumStage[];
    },
  });
};