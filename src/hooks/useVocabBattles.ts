import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface BattleQuestion {
  word_arabic: string;
  word_english: string;
  choices: string[];
  correct_index: number;
}

export interface VocabBattle {
  id: string;
  challenger_id: string;
  opponent_id: string;
  questions: BattleQuestion[];
  question_count: number;
  time_limit_seconds: number;
  challenger_score: number | null;
  challenger_time_ms: number | null;
  challenger_played_at: string | null;
  opponent_score: number | null;
  opponent_time_ms: number | null;
  opponent_played_at: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  winner_id: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

export interface BattleWithProfiles extends VocabBattle {
  challenger_profile?: {
    display_name: string | null;
    avatar_url: string | null;
  };
  opponent_profile?: {
    display_name: string | null;
    avatar_url: string | null;
  };
}

// Generate random questions from vocabulary
async function generateBattleQuestions(count: number = 10): Promise<BattleQuestion[]> {
  // Fetch random vocabulary words
  const { data: words, error } = await supabase
    .from('vocabulary_words')
    .select('word_arabic, word_english')
    .limit(100);

  if (error || !words || words.length < count) {
    throw new Error('Not enough vocabulary words available');
  }

  // Shuffle and pick
  const shuffled = words.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  const allEnglish = words.map(w => w.word_english);

  return selected.map(word => {
    // Create 4 choices including the correct answer
    const wrongChoices = allEnglish
      .filter(e => e !== word.word_english)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    
    const choices = [...wrongChoices, word.word_english].sort(() => Math.random() - 0.5);
    const correct_index = choices.indexOf(word.word_english);

    return {
      word_arabic: word.word_arabic,
      word_english: word.word_english,
      choices,
      correct_index,
    };
  });
}

// Get all battles for current user
export function useMyBattles() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['vocab-battles', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocab_battles')
        .select('*')
        .or(`challenger_id.eq.${user!.id},opponent_id.eq.${user!.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Type cast the questions from unknown
      return (data as unknown as VocabBattle[]).map(b => ({
        ...b,
        questions: Array.isArray(b.questions) ? b.questions : [],
      }));
    },
  });
}

// Get pending battles where I'm the opponent
export function usePendingBattles() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['vocab-battles', 'pending', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocab_battles')
        .select('*')
        .eq('opponent_id', user!.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as unknown as VocabBattle[]).map(b => ({
        ...b,
        questions: Array.isArray(b.questions) ? b.questions : [],
      }));
    },
  });
}

// Get a single battle
export function useBattle(battleId: string | undefined) {
  return useQuery({
    queryKey: ['vocab-battle', battleId],
    enabled: !!battleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocab_battles')
        .select('*')
        .eq('id', battleId!)
        .single();

      if (error) throw error;
      const battle = data as unknown as VocabBattle;
      return {
        ...battle,
        questions: Array.isArray(battle.questions) ? battle.questions : [],
      };
    },
  });
}

// Create a new battle
export function useCreateBattle() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      opponentId: string;
      questionCount?: number;
      timeLimitSeconds?: number;
    }) => {
      if (!user) throw new Error('Not authenticated');

      const questions = await generateBattleQuestions(params.questionCount || 10);

      const { data, error } = await supabase
        .from('vocab_battles')
        .insert({
          challenger_id: user.id,
          opponent_id: params.opponentId,
          questions,
          question_count: params.questionCount || 10,
          time_limit_seconds: params.timeLimitSeconds || 60,
          status: 'pending',
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vocab-battles'] });
    },
  });
}

// Submit battle result (challenger plays immediately after creating)
export function useSubmitChallengerScore() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      battleId: string;
      score: number;
      timeMs: number;
    }) => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('vocab_battles')
        .update({
          challenger_score: params.score,
          challenger_time_ms: params.timeMs,
          challenger_played_at: new Date().toISOString(),
        })
        .eq('id', params.battleId)
        .eq('challenger_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['vocab-battle', vars.battleId] });
      queryClient.invalidateQueries({ queryKey: ['vocab-battles'] });
    },
  });
}

// Submit opponent score and determine winner
export function useSubmitOpponentScore() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      battleId: string;
      score: number;
      timeMs: number;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // First get the battle to compare scores
      const { data: battle, error: fetchError } = await supabase
        .from('vocab_battles')
        .select('*')
        .eq('id', params.battleId)
        .single();

      if (fetchError || !battle) throw new Error('Battle not found');

      const challengerScore = battle.challenger_score || 0;
      const challengerTime = battle.challenger_time_ms || Infinity;

      // Determine winner: higher score wins, tie goes to faster time
      let winnerId: string | null = null;
      if (params.score > challengerScore) {
        winnerId = user.id;
      } else if (params.score < challengerScore) {
        winnerId = battle.challenger_id;
      } else if (params.timeMs < challengerTime) {
        winnerId = user.id;
      } else if (params.timeMs > challengerTime) {
        winnerId = battle.challenger_id;
      }
      // If still tied, it's a draw (winnerId stays null)

      const { data, error } = await supabase
        .from('vocab_battles')
        .update({
          opponent_score: params.score,
          opponent_time_ms: params.timeMs,
          opponent_played_at: new Date().toISOString(),
          status: 'completed',
          winner_id: winnerId,
          completed_at: new Date().toISOString(),
        })
        .eq('id', params.battleId)
        .eq('opponent_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['vocab-battle', vars.battleId] });
      queryClient.invalidateQueries({ queryKey: ['vocab-battles'] });
    },
  });
}

// Decline/cancel a battle
export function useDeclineBattle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (battleId: string) => {
      const { error } = await supabase
        .from('vocab_battles')
        .delete()
        .eq('id', battleId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vocab-battles'] });
    },
  });
}
