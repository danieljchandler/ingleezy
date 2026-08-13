import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface VocabEntry {
  number: number;
  arabic: string;
  transliteration: string;
  english: string;
  category: string;
  imageScene: string;
  teachingNote: string;
}

interface ParsedLessonPlan {
  stageId: string;
  lessonNumber: number;
  title: string;
  titleArabic?: string;
  description?: string;
  durationMinutes?: number;
  cefrTarget?: string;
  approach?: string;
  unlockCondition?: string;
  dialectModule?: string;
  vocabulary: VocabEntry[];
  lessonSequence: any[];
  imageScenes: any[];
  flashcardSpec: any[];
  realWorldPrompts: any[];
  designRationale: any[];
  soundSpotlight: any[];
}

/**
 * Hook to import a parsed lesson plan into the lessons table.
 */
export const useLessonImport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: ParsedLessonPlan) => {
      // Create a lesson in the lessons table
      const { data: lesson, error: lessonErr } = await supabase
        .from('lessons' as never)
        .insert({
          stage_id: plan.stageId,
          lesson_number: plan.lessonNumber,
          title: plan.title,
          title_arabic: plan.titleArabic || null,
          description: plan.description || null,
          duration_minutes: plan.durationMinutes || null,
          cefr_target: plan.cefrTarget || null,
          approach: plan.approach || null,
          icon: '📚',
          gradient: 'bg-gradient-green',
          display_order: plan.lessonNumber,
          dialect_module: plan.dialectModule || 'Gulf',
          status: 'draft',
          // The authored lesson plan. parseLessonXlsx has produced all of these
          // since it was written and the columns have existed since the
          // curriculum restructure, but the insert dropped every one — so a
          // designed lesson arrived as a bare vocabulary list. Learn.tsx renders
          // the learner-facing sections; the rest is authoring metadata kept for
          // the admin tooling.
          unlock_condition: plan.unlockCondition || null,
          lesson_sequence: plan.lessonSequence ?? [],
          image_scenes: plan.imageScenes ?? [],
          flashcard_spec: plan.flashcardSpec ?? [],
          real_world_prompts: plan.realWorldPrompts ?? [],
          design_rationale: plan.designRationale ?? [],
          sound_spotlight: plan.soundSpotlight ?? [],
        } as never)
        .select()
        .single();

      if (lessonErr) throw lessonErr;
      const lessonRecord = lesson as unknown as { id: string; title: string };

      // Insert vocabulary words linked directly to the lesson
      if (plan.vocabulary.length > 0) {
        const wordsToInsert = plan.vocabulary.map((v, idx) => ({
          lesson_id: lessonRecord.id,
          word_arabic: v.arabic,
          word_english: v.english,
          display_order: idx,
          dialect_module: plan.dialectModule || 'Gulf',
        }));

        const { error: wordsError } = await supabase
          .from('vocabulary_words')
          .insert(wordsToInsert);

        if (wordsError) throw wordsError;
      }

      return { id: lessonRecord.id, name: plan.title };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      queryClient.invalidateQueries({ queryKey: ['all-lessons'] });
    },
  });
};
