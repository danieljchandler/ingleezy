import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Fire-and-forget: extract concepts from approved content into the coverage ledger.
async function extractConcepts(args: {
  content_type: string;
  content_id: string;
  dialect?: string;
  cefr_level?: string | null;
  stage_id?: string | null;
}) {
  try {
    await supabase.functions.invoke('extract-concepts', { body: args });
  } catch (e) {
    console.warn('extract-concepts failed:', e);
  }
}

interface VocabWord {
  word_arabic: string;
  word_english: string;
  transliteration?: string;
  category?: string;
  teaching_note?: string;
  image_scene_description?: string;
}

interface LessonData {
  title: string;
  title_arabic?: string;
  description?: string;
  duration_minutes?: number;
  cefr_target?: string;
  approach?: string;
  icon?: string;
  vocabulary?: VocabWord[];
}

export function useCurriculumApproval() {
  const queryClient = useQueryClient();

  const approveLesson = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      stageId,
      lessonData,
      dialectModule,
    }: {
      messageId: string;
      sessionId: string;
      stageId: string;
      lessonData: LessonData;
      dialectModule?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { data: existingLessons } = await supabase
        .from('lessons' as never)
        .select('lesson_number')
        .eq('stage_id', stageId)
        .order('lesson_number', { ascending: false })
        .limit(1);

      const nextLessonNumber = ((existingLessons as unknown as { lesson_number: number }[])?.[0]?.lesson_number ?? 0) + 1;

      const { data: lesson, error: lessonErr } = await supabase
        .from('lessons')
        .insert({
          stage_id: stageId,
          lesson_number: nextLessonNumber,
          title: lessonData.title,
          title_arabic: lessonData.title_arabic || null,
          description: lessonData.description || null,
          duration_minutes: lessonData.duration_minutes || null,
          cefr_target: lessonData.cefr_target || null,
          approach: lessonData.approach || null,
          icon: lessonData.icon || '📚',
          gradient: 'bg-gradient-green',
          display_order: nextLessonNumber,
          dialect_module: dialectModule || 'Gulf',
        } as never)
        .select()
        .single();

      if (lessonErr) throw lessonErr;
      const lessonRecord = lesson as unknown as { id: string; title: string };

      if (lessonData.vocabulary && lessonData.vocabulary.length > 0) {
      const vocabInserts = lessonData.vocabulary.map((word, idx) => ({
          lesson_id: lessonRecord.id,
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          display_order: idx + 1,
          dialect_module: dialectModule || 'Gulf',
        }));

        const { error: vocabErr } = await supabase
          .from('vocabulary_words' as never)
          .insert(vocabInserts as never);

        if (vocabErr) throw vocabErr;
      }

      const { error: approvalErr } = await supabase
        .from('curriculum_chat_approvals' as never)
        .insert({
          message_id: messageId,
          session_id: sessionId,
          approval_type: 'lesson',
          target_lesson_id: lessonRecord.id,
          approved_by: userData.user.id,
        } as never);

      if (approvalErr) {
        console.warn('Approval tracking error (non-fatal):', approvalErr.message);
      }

      void extractConcepts({
        content_type: 'lesson',
        content_id: lessonRecord.id,
        dialect: dialectModule || 'Gulf',
        cefr_level: lessonData.cefr_target ?? null,
        stage_id: stageId,
      });

      return lessonRecord;
    },
    onSuccess: (lesson: unknown) => {
      const l = lesson as { title: string };
      toast.success('Lesson created!', {
        description: `"${l.title}" added to curriculum`,
      });
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      queryClient.invalidateQueries({ queryKey: ['all-lessons'] });
    },
    onError: (err) => {
      toast.error('Failed to create lesson', { description: (err as Error).message });
    },
  });

  const approveVocabulary = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      lessonId,
      words,
      dialectModule,
    }: {
      messageId: string;
      sessionId: string;
      lessonId: string;
      words: VocabWord[];
      dialectModule?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { data: existing } = await supabase
        .from('vocabulary_words' as never)
        .select('display_order')
        .eq('lesson_id', lessonId)
        .order('display_order', { ascending: false })
        .limit(1);

      const startOrder = ((existing as unknown as { display_order: number }[])?.[0]?.display_order ?? 0) + 1;

      const inserts = words.map((word, idx) => ({
        lesson_id: lessonId,
        word_arabic: word.word_arabic,
        word_english: word.word_english,
        display_order: startOrder + idx,
        dialect_module: dialectModule || 'Gulf',
      }));

      const { error: vocabErr } = await supabase
        .from('vocabulary_words' as never)
        .insert(inserts as never);

      if (vocabErr) throw vocabErr;

      await supabase
        .from('curriculum_chat_approvals' as never)
        .insert({
          message_id: messageId,
          session_id: sessionId,
          approval_type: 'vocabulary',
          target_lesson_id: lessonId,
          approved_by: userData.user.id,
        } as never);

      return words.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} words added to lesson`);
      queryClient.invalidateQueries({ queryKey: ['vocabulary'] });
    },
    onError: (err) => {
      toast.error('Failed to add vocabulary', { description: (err as Error).message });
    },
  });

  // ─── NEW CONTENT TYPE APPROVALS ─────────────────────────

  const approveGrammarExercises = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const exercises = data.exercises as Array<Record<string, unknown>>;
      const category = (data.category as string) || 'verb-conjugation';
      const difficulty = (data.difficulty as string) || 'beginner';

      const inserts = exercises.map((ex) => ({
        category,
        difficulty,
        question_arabic: ex.question_arabic as string,
        question_english: ex.question_english as string,
        grammar_point: (ex.grammar_point as string) || '',
        choices: ex.choices,
        correct_index: ex.correct_index as number,
        explanation: (ex.explanation as string) || '',
        status: 'published',
        created_by: userData.user!.id,
        session_id: sessionId,
      }));

      const { error } = await supabase
        .from('grammar_exercises' as never)
        .insert(inserts as never);
      if (error) throw error;

      return exercises.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} grammar exercises published!`);
      queryClient.invalidateQueries({ queryKey: ['grammar-exercises'] });
    },
    onError: (err) => {
      toast.error('Failed to publish grammar exercises', { description: (err as Error).message });
    },
  });

  const approveListeningExercises = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const exercises = data.exercises as Array<Record<string, unknown>>;
      const mode = (data.mode as string) || 'dictation';
      const difficulty = (data.difficulty as string) || 'beginner';

      const inserts = exercises.map((ex) => ({
        mode,
        difficulty,
        audio_text: ex.audio_text as string,
        audio_text_english: ex.audio_text_english as string,
        questions: ex.options || [],
        hint: (ex.hint as string) || null,
        status: 'published',
        created_by: userData.user!.id,
        session_id: sessionId,
      }));

      const { error } = await supabase
        .from('listening_exercises' as never)
        .insert(inserts as never);
      if (error) throw error;

      return exercises.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} listening exercises published!`);
      queryClient.invalidateQueries({ queryKey: ['listening-exercises'] });
    },
    onError: (err) => {
      toast.error('Failed to publish listening exercises', { description: (err as Error).message });
    },
  });

  const approveReadingPassage = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const passage = data.passage as Record<string, unknown>;

      const { data: inserted, error } = await supabase
        .from('reading_passages' as never)
        .insert({
          title: passage.title as string,
          title_english: passage.title_english as string,
          passage: passage.passage as string,
          passage_english: passage.passage_english as string,
          difficulty: (data.difficulty as string) || 'beginner',
          vocabulary: passage.vocabulary || [],
          questions: passage.questions || [],
          cultural_note: (passage.cultural_note as string) || null,
          status: 'published',
          created_by: userData.user.id,
          session_id: sessionId,
        } as never)
        .select()
        .single();
      if (error) throw error;

      const insertedRow = inserted as { id: string };
      void extractConcepts({
        content_type: 'reading',
        content_id: insertedRow.id,
        dialect: (data.dialect as string) || 'Gulf',
      });

      return passage.title_english as string;
    },
    onSuccess: (title) => {
      toast.success('Reading passage published!', { description: title });
      queryClient.invalidateQueries({ queryKey: ['reading-passages'] });
    },
    onError: (err) => {
      toast.error('Failed to publish reading passage', { description: (err as Error).message });
    },
  });

  const approveDailyChallenge = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('daily_challenges' as never)
        .insert({
          challenge_type: (data.challenge_type as string) || 'mixed',
          title: (data.title as string) || '',
          title_arabic: (data.title_arabic as string) || '',
          questions: data.questions || [],
          difficulty: (data.difficulty as string) || 'beginner',
          status: 'published',
          created_by: userData.user.id,
          session_id: sessionId,
        } as never);
      if (error) throw error;

      return data.title as string;
    },
    onSuccess: (title) => {
      toast.success('Daily challenge published!', { description: title });
      queryClient.invalidateQueries({ queryKey: ['daily-challenges'] });
    },
    onError: (err) => {
      toast.error('Failed to publish daily challenge', { description: (err as Error).message });
    },
  });

  const approveConversationScenario = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const scenario = data.scenario as Record<string, unknown>;

      const { data: inserted, error } = await supabase
        .from('conversation_scenarios' as never)
        .insert({
          title: scenario.title as string,
          title_arabic: scenario.title_arabic as string,
          description: (scenario.description as string) || '',
          system_prompt: scenario.system_prompt as string,
          difficulty: (scenario.difficulty as string) || 'Beginner',
          icon_name: (scenario.icon_name as string) || 'MessageCircle',
          example_exchanges: scenario.example_exchanges || [],
          status: 'published',
          created_by: userData.user.id,
          session_id: sessionId,
        } as never)
        .select()
        .single();
      if (error) throw error;

      const insertedRow = inserted as { id: string };
      void extractConcepts({
        content_type: 'conversation',
        content_id: insertedRow.id,
        dialect: (data.dialect as string) || 'Gulf',
      });

      return scenario.title as string;
    },
    onSuccess: (title) => {
      toast.success('Conversation scenario published!', { description: title });
      queryClient.invalidateQueries({ queryKey: ['conversation-scenarios'] });
    },
    onError: (err) => {
      toast.error('Failed to publish conversation scenario', { description: (err as Error).message });
    },
  });

  const approveGameSet = useMutation({
    mutationFn: async ({
      messageId,
      sessionId,
      data,
    }: {
      messageId: string;
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('vocab_game_sets' as never)
        .insert({
          game_type: (data.game_type as string) || 'matching',
          title: (data.title as string) || '',
          word_pairs: data.word_pairs || [],
          difficulty: (data.difficulty as string) || 'beginner',
          status: 'published',
          created_by: userData.user.id,
          session_id: sessionId,
        } as never);
      if (error) throw error;

      return data.title as string;
    },
    onSuccess: (title) => {
      toast.success('Game set published!', { description: title });
      queryClient.invalidateQueries({ queryKey: ['vocab-game-sets'] });
    },
    onError: (err) => {
      toast.error('Failed to publish game set', { description: (err as Error).message });
    },
  });

  return {
    approveLesson,
    approveVocabulary,
    approveGrammarExercises,
    approveListeningExercises,
    approveReadingPassage,
    approveDailyChallenge,
    approveConversationScenario,
    approveGameSet,
  };
}
