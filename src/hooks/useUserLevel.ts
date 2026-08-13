import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useDialect } from '@/contexts/DialectContext';

/**
 * Maps CEFR placement levels to difficulty labels used by edge functions.
 */
const cefrToDifficulty = (level: string | null): 'beginner' | 'intermediate' | 'advanced' => {
  switch (level?.toUpperCase()) {
    case 'A1':
    case 'A2':
      return 'beginner';
    case 'B1':
    case 'B2':
      return 'intermediate';
    case 'C1':
    case 'C2':
      return 'advanced';
    default:
      return 'beginner';
  }
};

export const useUserLevel = () => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  const { data: profile } = useQuery({
    queryKey: ['user-level', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('profiles')
        .select('placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni, proficiency_level')
        .eq('user_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Prefer the per-dialect placement level for the active dialect; fall back
  // to the legacy single-dialect field for users who placed before per-dialect
  // tracking existed.
  const dialectKey = activeDialect.toLowerCase() as 'gulf' | 'egyptian' | 'yemeni';
  const placementLevel =
    (profile as Record<string, string | null> | null | undefined)?.[`placement_level_${dialectKey}`]
    ?? profile?.placement_level
    ?? null;
  const difficulty = cefrToDifficulty(placementLevel);

  return {
    /** Raw CEFR level from placement quiz, e.g. "B1" */
    placementLevel,
    /** Mapped difficulty: beginner | intermediate | advanced */
    difficulty,
    /** Whether the user has taken the placement quiz */
    hasTakenPlacement: !!placementLevel,
  };
};
