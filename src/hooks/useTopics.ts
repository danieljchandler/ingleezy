import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';

export interface Topic {
  id: string;
  name: string;
  name_arabic: string;
  icon: string;
  gradient: string;
  display_order: number;
  created_at: string;
  updated_at: string;
  dialect_module?: string;
}

export const useTopics = () => {
  const { activeDialect } = useDialect();

  return useQuery({
    queryKey: ['topics', activeDialect],
    queryFn: async () => {
      const query = supabase
        .from('topics')
        .select('*')
        .order('display_order', { ascending: true });

      const { data, error } = await (query as any).eq('dialect_module', activeDialect);

      if (error) throw error;
      return data as Topic[];
    },
  });
};
