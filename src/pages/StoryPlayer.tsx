import { useState, useEffect, useMemo } from 'react';
import { usePageAiContext } from '@/contexts/AiAssistantContext';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useStoryScenes,
  useStoryProgress,
  useUpsertStoryProgress,
  type StoryScene,
} from '@/hooks/useInteractiveStories';
import { useAddUserVocabulary } from '@/hooks/useUserVocabulary';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { PageCorner } from '@/components/shell/PageCorner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RotateCcw, BookOpen, Trophy, Sparkles, Plus, Check } from 'lucide-react';
import { IconBack } from '@/components/shared/DirectionalIcon';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { recordContinue, clearContinue } from '@/lib/continueProgress';
import { useDialect } from '@/contexts/DialectContext';
import { AskAISentence } from '@/components/shared/AskAISentence';
import { TappableEnglishText } from '@/components/shared/TappableEnglishText';

/**
 * Split a paragraph into sentences by sentence terminators (. ! ? ؟ and newlines),
 * keeping the terminator with its sentence. Commas are NOT treated as terminators.
 */
function splitSentences(text: string): string[] {
  if (!text) return [];
  const parts = text
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

/**
 * Find the sentence in `english` containing `word`, and return the aligned
 * Arabic sentence by index. Falls back to the full text when not found.
 */
function extractSentenceForWord(
  english: string,
  arabic: string,
  word: string,
): { sentence_text: string; sentence_english: string } {
  const enSentences = splitSentences(english);
  const arSentences = splitSentences(arabic);
  const idx = enSentences.findIndex(s => s.toLowerCase().includes(word.toLowerCase()));
  if (idx === -1) {
    return { sentence_text: arabic, sentence_english: english };
  }
  return {
    sentence_text: arSentences[idx] ?? arabic,
    sentence_english: enSentences[idx],
  };
}


const StoryPlayer = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { data: scenes, isLoading: scenesLoading } = useStoryScenes(storyId);
  const { data: progress } = useStoryProgress(storyId);
  const upsertProgress = useUpsertStoryProgress();
  const addVocab = useAddUserVocabulary();

  const [currentSceneOrder, setCurrentSceneOrder] = useState(0);
  const [pathTaken, setPathTaken] = useState<number[]>([0]);
  const [showTranslation, setShowTranslation] = useState(false);
  const [lineByLine, setLineByLine] = useState(false);
  const [storyTitle, setStoryTitle] = useState('');
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  // Load story title
  useEffect(() => {
    if (!storyId) return;
    supabase
      .from('interactive_stories')
      .select('title, title_arabic')
      .eq('id', storyId)
      .single()
      .then(({ data }) => {
        if (data) setStoryTitle(data.title);
      });
  }, [storyId]);

  // Restore progress
  useEffect(() => {
    if (progress && !progress.completed && scenes) {
      const restoredPath = Array.isArray(progress.path_taken) ? progress.path_taken as number[] : [0];
      setPathTaken(restoredPath);
      setCurrentSceneOrder(restoredPath[restoredPath.length - 1] ?? 0);
    }
  }, [progress, scenes]);

  const sceneMap = useMemo(() => {
    if (!scenes) return new Map<number, StoryScene>();
    return new Map(scenes.map((s) => [s.scene_order, s]));
  }, [scenes]);

  const currentScene = sceneMap.get(currentSceneOrder);

  usePageAiContext(
    useMemo(
      () =>
        storyTitle && currentScene
          ? {
              kind: "story" as const,
              title: storyTitle,
              summary: "يقرأ قصة تفاعلية متفرّعة.",
              content: `Current scene: ${currentScene.narrative_english}${currentScene.narrative_arabic ? ` — ${currentScene.narrative_arabic}` : ""}`,
            }
          : null,
      [storyTitle, currentScene],
    ),
  );

  // Record "continue where you left off" entry on every scene change
  useEffect(() => {
    if (!storyId || !storyTitle || !scenes || scenes.length === 0) return;
    if (currentScene?.is_ending) {
      clearContinue();
      return;
    }
    recordContinue({
      kind: 'story',
      route: `/stories/${storyId}`,
      title: storyTitle,
      subtitle: `المشهد ${pathTaken.length} من ${scenes.length}`,
      dialect: activeDialect,
    });
  }, [storyId, storyTitle, scenes, currentScene?.is_ending, pathTaken.length, activeDialect]);

  const handleChoice = (nextSceneOrder: number) => {
    setShowTranslation(false);
    const newPath = [...pathTaken, nextSceneOrder];
    setPathTaken(newPath);
    setCurrentSceneOrder(nextSceneOrder);

    const nextScene = sceneMap.get(nextSceneOrder);

    if (user && storyId) {
      upsertProgress.mutate({
        storyId,
        currentSceneId: nextScene?.id || null,
        completed: nextScene?.is_ending || false,
        pathTaken: newPath,
      });
    }
  };

  const handleRestart = () => {
    setCurrentSceneOrder(0);
    setPathTaken([0]);
    setShowTranslation(false);

    if (user && storyId) {
      upsertProgress.mutate({
        storyId,
        currentSceneId: scenes?.[0]?.id || null,
        completed: false,
        pathTaken: [0],
      });
    }
  };

  if (scenesLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!scenes || scenes.length === 0) {
    return (
      <AppShell>
        <div className="mb-6"><PageCorner /></div>
        <div className="text-center py-16">
          <BookOpen className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-muted-foreground">هذي القصة ما فيها مشاهد بعد.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/stories')}>
            رجوع للقصص
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <PageCorner />
        <Button variant="ghost" size="sm" onClick={() => navigate('/stories')}>
          <IconBack className="h-4 w-4 me-1" />
          كل القصص
        </Button>
      </div>

      <div className="max-w-lg mx-auto">
        {/* Story title */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold font-heading">{storyTitle}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            المشهد {pathTaken.length} · {scenes.length} مشاهد بالكل
          </p>
        </div>

        {currentScene ? (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-400">
            {/* Narrative card */}
            <div className="bg-card border-2 border-border rounded-2xl p-6 mb-6 relative overflow-hidden">
              {/* Decorative corner */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-bl-full" />

              {/* English narrative — the reading task; every word tappable */}
              {lineByLine ? (
                <div className="mb-4 space-y-3">
                  {splitSentences(currentScene.narrative_english).map((en, i) => {
                    const ar = splitSentences(currentScene.narrative_arabic)[i];
                    return (
                      <div key={i} className="pb-3 border-b border-border/40 last:border-0">
                        <p className="text-xl leading-relaxed font-medium font-english">
                          <TappableEnglishText text={en} sentenceArabic={ar} source="story" />
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-1.5">
                          {ar ? (
                            <p className="text-sm text-muted-foreground flex-1 font-arabic" dir="rtl">{ar}</p>
                          ) : <span />}
                          <AskAISentence arabic={ar ?? ""} english={en} variant="chip" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xl leading-relaxed mb-4 font-medium font-english">
                  <TappableEnglishText
                    text={currentScene.narrative_english}
                    sentenceArabic={currentScene.narrative_arabic}
                    source="story"
                  />
                </p>
              )}

              {/* View toggles */}
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => setLineByLine(v => !v)}
                  className="text-xs text-primary hover:underline"
                >
                  {lineByLine ? 'عرض الفقرة' : 'سطراً سطراً'}
                </button>
                {!lineByLine && (
                  <button
                    onClick={() => setShowTranslation(!showTranslation)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showTranslation ? 'أخفِ الترجمة' : 'ورّني الترجمة'}
                  </button>
                )}
              </div>

              {!lineByLine && showTranslation && (
                <div className="animate-in fade-in duration-200 space-y-1">
                  <p dir="rtl" className="font-arabic text-base text-foreground">
                    {currentScene.narrative_arabic}
                  </p>
                  {currentScene.narrative_literal && (
                    <p dir="rtl" className="font-arabic text-sm text-muted-foreground/80">
                      {currentScene.narrative_literal}
                    </p>
                  )}
                </div>
              )}

              {/* Vocabulary pills */}
              {currentScene.vocabulary.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Key Words · tap to save
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {currentScene.vocabulary.map((v, i) => {
                      const key = `${v.word_arabic}::${v.word_english}`;
                      const isSaved = savedWords.has(key);
                      return (
                        <button
                          key={i}
                          disabled={isSaved || !user}
                          onClick={() => {
                            if (!user) {
                              toast.error('سجّل دخولك عشان تحفظ الكلمات');
                              return;
                            }
                            const { sentence_text, sentence_english } = extractSentenceForWord(
                              currentScene.narrative_english,
                              currentScene.narrative_arabic,
                              v.word_english,
                            );
                            addVocab.mutate(
                              {
                                word_arabic: v.word_arabic,
                                word_english: v.word_english,
                                source: 'story',
                                sentence_text,
                                sentence_english,
                              },
                              {
                                onSuccess: () => {
                                  setSavedWords(prev => new Set(prev).add(key));
                                  toast.success('حفظناها في كلماتي');
                                },
                                onError: (err: any) => {
                                  if (err.message?.includes('موجودة')) {
                                    setSavedWords(prev => new Set(prev).add(key));
                                    toast.info('موجودة عندك أصلاً');
                                  } else {
                                    toast.error('تعذّر الحفظ');
                                  }
                                },
                              }
                            );
                          }}
                          className={cn(
                            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm transition-all',
                            isSaved
                              ? 'bg-primary/20 text-primary'
                              : 'bg-primary/10 hover:bg-primary/20 active:scale-95'
                          )}
                        >
                          <span className="font-medium font-english">{v.word_english}</span>
                          {showTranslation && <span className="text-muted-foreground text-xs font-arabic" dir="rtl">({v.word_arabic})</span>}
                          {isSaved ? (
                            <Check className="h-3 w-3 text-primary" />
                          ) : (
                            <Plus className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Ending */}
            {currentScene.is_ending ? (
              <div className="text-center animate-in fade-in zoom-in-95 duration-500">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4">
                  <Trophy className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-xl font-bold mb-2">خلصت القصة!</h2>
                {currentScene.ending_message && (
                  <p className="text-muted-foreground mb-1">{currentScene.ending_message}</p>
                )}
                {currentScene.ending_message_arabic && (
                  <p className="text-lg mb-4" dir="rtl">{currentScene.ending_message_arabic}</p>
                )}
                <div className="flex gap-3 justify-center mt-6">
                  <Button variant="outline" onClick={handleRestart} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    العب مرة ثانية
                  </Button>
                  <Button onClick={() => navigate('/stories')}>
                    قصص أكثر
                  </Button>
                </div>
              </div>
            ) : (
              /* Choices */
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center mb-4">
                  وش تسوي؟
                </p>
                {currentScene.choices.map((choice, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleChoice(choice.next_scene_order)}
                    className={cn(
                      'w-full text-left rounded-xl border-2 border-border bg-card p-4',
                      'transition-all duration-200 hover:border-primary hover:shadow-md',
                      'active:scale-[0.98] group'
                    )}
                  >
                    <p className="text-lg font-medium group-hover:text-primary transition-colors font-english">
                      {choice.text_english}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 font-arabic" dir="rtl">{choice.text_arabic}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground">ما لقينا المشهد. يمكن في رابط مكسور بالقصة.</p>
            <Button variant="outline" className="mt-4" onClick={handleRestart}>
              <RotateCcw className="h-4 w-4 me-2" />
              ابدأ القصة من جديد
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default StoryPlayer;
