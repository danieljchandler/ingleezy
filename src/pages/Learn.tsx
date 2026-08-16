import { useState, useEffect, useMemo } from "react";
import { IngleezyLogo } from "@/components/brand/IngleezyLogo";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTopic } from "@/hooks/useTopic";
import { useAllWords } from "@/hooks/useAllWords";
import { useAuth } from "@/hooks/useAuth";
import { useSubmitReview } from "@/hooks/useReview";
import { IntroCard } from "@/components/learn/IntroCard";
import { QuizCard } from "@/components/learn/QuizCard";
import { ProgressDots } from "@/components/ProgressDots";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";
import { Loader2, Trophy, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recordContinue, clearContinue } from "@/lib/continueProgress";
import { useDialect } from "@/contexts/DialectContext";
import { SoundSpotlight } from "@/components/learn/SoundSpotlight";
import { LessonPlanSection } from "@/components/learn/LessonPlanSection";
import { useLessonProgressFor, useUpsertLessonProgress } from "@/hooks/useLessonProgress";
import { ListChecks, Sparkles } from "lucide-react";

type Phase = "intro" | "quiz";

const BATCH_SIZE = 5;

const Learn = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const submitReview = useSubmitReview();
  const { activeDialect } = useDialect();

  // Mixed mode: no lessonId, fetch all words shuffled
  const isMixedMode = !lessonId;
  const { data: topic, isLoading: topicLoading, error: topicError } = useTopic(lessonId);
  const { data: allWords, isLoading: allWordsLoading, error: allWordsError } = useAllWords(true);

  const isLoading = isMixedMode ? allWordsLoading : topicLoading;
  const error = isMixedMode ? allWordsError : topicError;

  // In mixed mode, take a batch of words
  const words = useMemo(() => {
    if (isMixedMode) {
      return (allWords || []).slice(0, BATCH_SIZE);
    }
    return topic?.words || [];
  }, [isMixedMode, allWords, topic?.words]);

  // Build topic label map for mixed mode
  const topicLabelMap = useMemo(() => {
    if (!isMixedMode || !allWords) return new Map<string, string>();
    return new Map(allWords.map(w => [w.id, w.topic_name]));
  }, [isMixedMode, allWords]);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionResults, setSessionResults] = useState({ correct: 0, total: 0 });
  const [isComplete, setIsComplete] = useState(false);

  const {
    data: savedProgress,
    isSuccess: progressLoaded,
    isFetching: progressFetching,
  } = useLessonProgressFor(isMixedMode ? undefined : lessonId);
  // Settled *and* successful. isFetched would also be true after an error and
  // for a stale cached value mid-refetch, which would let the resume lock in on
  // the wrong position and then ignore the real one.
  const progressSettled = progressLoaded && !progressFetching;
  const upsertProgress = useUpsertLessonProgress();
  // Resume once per lesson, not on every progress refetch — otherwise saving
  // progress would immediately yank the learner back to the saved index.
  const [hasResumed, setHasResumed] = useState(false);
  const [userReviews, setUserReviews] = useState<Map<string, {
    id: string;
    ease_factor: number;
    interval_days: number;
    repetitions: number;
    last_reviewed_at: string | null;
    // Non-null in the schema — every review row carries a due date.
    next_review_at: string;
  }>>(new Map());

  // Fetch existing reviews for SRS integration
  useEffect(() => {
    if (user && words.length > 0) {
      const fetchReviews = async () => {
        const wordIds = words.map(w => w.id);
        const { data: reviews } = await supabase
          .from('word_reviews')
          .select('id, word_id, ease_factor, interval_days, repetitions, last_reviewed_at, next_review_at')
          .eq('user_id', user.id)
          .in('word_id', wordIds);
        if (reviews) {
          const reviewMap = new Map(reviews.map(r => [r.word_id, {
            id: r.id,
            ease_factor: r.ease_factor,
            interval_days: r.interval_days,
            repetitions: r.repetitions,
            last_reviewed_at: r.last_reviewed_at,
            next_review_at: r.next_review_at,
          }]));
          setUserReviews(reviewMap);
        }
      };
      fetchReviews();
    }
  }, [user, words]);

  // Reset when topic changes
  useEffect(() => {
    setCurrentIndex(0);
    setPhase("intro");
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
    setHasResumed(false);
  }, [lessonId]);

  // Pick up where the learner left off, on whatever device they left off on.
  //
  // Gated on the query having settled rather than on `savedProgress` being
  // truthy. A learner starting a lesson fresh has no row, so a truthiness guard
  // would leave this armed — and the first save's refetch would then fire it
  // and yank them back to the saved index mid-session.
  useEffect(() => {
    if (hasResumed || isMixedMode || words.length === 0 || !progressSettled) return;
    setHasResumed(true);
    if (!savedProgress || savedProgress.status === "completed") return;
    const resumeAt = Math.min(
      Math.max(0, savedProgress.last_word_index),
      words.length - 1,
    );
    if (resumeAt > 0) {
      setCurrentIndex(resumeAt);
      setPhase("intro");
    }
  }, [hasResumed, isMixedMode, progressSettled, savedProgress, words.length]);

  // Record "continue where you left off". localStorage stays as the fast local
  // path (it works signed-out and makes the Home card instant); lesson_progress
  // below is the durable one that survives a device change.
  useEffect(() => {
    if (isMixedMode || !lessonId || !topic || words.length === 0) return;
    if (isComplete) {
      clearContinue();
      return;
    }
    recordContinue({
      kind: "lesson",
      route: `/learn/${lessonId}`,
      title: topic.name || "Lesson",
      subtitle: `Word ${Math.min(currentIndex + 1, words.length)} of ${words.length}`,
      dialect: activeDialect,
    });
  }, [isMixedMode, lessonId, topic, words.length, currentIndex, isComplete, activeDialect]);

  // Server-side progress: how far through, and whether it's finished. Mixed mode
  // isn't a lesson, so it has nothing to record against.
  useEffect(() => {
    if (isMixedMode || !lessonId || !user || words.length === 0 || isComplete) return;
    // Never write before the resume attempt has run for THIS lesson. On mount
    // currentIndex is 0, so an early write would persist 0 and destroy the
    // saved position the learner was about to be restored to. `hasResumed` is
    // reset on every lessonId change, so it's a per-lesson readiness token.
    if (!hasResumed) return;
    upsertProgress.mutate({
      lessonId,
      lastWordIndex: currentIndex,
      wordsSeen: currentIndex + 1,
      wordsTotal: words.length,
    });
    // Deliberately keyed on the card index only: this should fire once per card
    // advance, not on every render or mutation-identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMixedMode, lessonId, user?.id, currentIndex, words.length, isComplete]);

  const handleContinueToQuiz = () => {
    setPhase("quiz");
  };

  const handleQuizAnswer = async (isCorrect: boolean) => {
    const currentWord = words[currentIndex];

    setSessionResults(prev => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1
    }));

    if (isAuthenticated && user) {
      const existingReview = userReviews.get(currentWord.id);
      try {
        await submitReview.mutateAsync({
          wordId: currentWord.id,
          rating: isCorrect ? "good" : "again",
          currentReview: existingReview ? {
            id: existingReview.id,
            user_id: user.id,
            word_id: currentWord.id,
            ease_factor: existingReview.ease_factor,
            interval_days: existingReview.interval_days,
            repetitions: existingReview.repetitions,
            last_reviewed_at: existingReview.last_reviewed_at,
            next_review_at: existingReview.next_review_at,
          } : null
        });
      } catch (err) {
        console.error("Failed to submit review:", err);
      }
    }

    setTimeout(() => {
      if (currentIndex < words.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setPhase("intro");
      } else {
        setIsComplete(true);
        // Score from the freshly-updated tallies, not from `sessionResults`,
        // which this render still sees at its pre-answer value.
        if (!isMixedMode && lessonId && user) {
          const correct = sessionResults.correct + (isCorrect ? 1 : 0);
          const total = sessionResults.total + 1;
          upsertProgress.mutate({
            lessonId,
            completed: true,
            wordsSeen: words.length,
            wordsTotal: words.length,
            score: total > 0 ? Math.round((correct / total) * 100) : 0,
          });
        }
      }
    }, 500);
  };

  const handleRestartSession = () => {
    setCurrentIndex(0);
    setPhase("intro");
    setSessionResults({ correct: 0, total: 0 });
    setIsComplete(false);
    // Already resumed once this visit; a deliberate restart starts at the top.
    setHasResumed(true);
  };

  if (isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">جاري التحميل…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || (!isMixedMode && !topic)) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-4">
              {isMixedMode ? "تعذّر تحميل الكلمات" : "ما لقينا الموضوع"}
            </p>
            <Button onClick={() => navigate("/")}>رجوع للرئيسية</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (words.length === 0) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-2">
              {isMixedMode ? "ما فيه كلمات جديدة" : "ما فيه كلمات بعد"}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {isMixedMode ? "شفت كل الكلمات المتاحة. جرّب المراجعة!" : "أضف مفردات من لوحة الإدارة."}
            </p>
            <Button onClick={() => navigate("/")}>رجوع للرئيسية</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Session complete screen
  if (isComplete) {
    const percentage = Math.round((sessionResults.correct / sessionResults.total) * 100);
    const isGreatScore = percentage >= 80;

    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>

        <div className="text-center max-w-sm mx-auto py-8">
          <Trophy className={cn(
            "h-16 w-16 mx-auto mb-6",
            isGreatScore ? "text-primary" : "text-muted-foreground"
          )} />

          <h1 className="text-2xl font-bold text-foreground mb-2">
            {isGreatScore ? "ممتاز!" : "مجهود طيب"}
          </h1>
          <p className="text-muted-foreground mb-8">
            {isGreatScore ? "أحسنت — تقدّمك حلو" : "واصل التمرين وبتتحسّن"}
          </p>

          <div className="p-6 rounded-xl mb-8 bg-card border border-border">
            <span className="text-4xl font-bold text-foreground">{percentage}%</span>
            <p className="text-muted-foreground mt-2">
              {sessionResults.correct} / {sessionResults.total} correct
            </p>
          </div>

          {/* Authored "take it outside the app" tasks. Renders only when the
              lesson was imported with a real-world prompts sheet. */}
          {!isMixedMode && (topic?.realWorldPrompts?.length ?? 0) > 0 && (
            <div className="mb-8 text-left">
              <LessonPlanSection
                title="جرّبها اليوم"
                icon={Sparkles}
                rows={topic!.realWorldPrompts}
                defaultOpen
                blurb="استخدم اللي تعلّمته في موقف حقيقي."
              />
            </div>
          )}

          <div className="space-y-3">
            <Button onClick={handleRestartSession} className="w-full">
              <RotateCcw className="h-4 w-4 me-2" />
              {isMixedMode ? "تعلّم كلمات أكثر" : "تمرّن مرة ثانية"}
            </Button>
            {!isMixedMode && (
              <Button variant="outline" onClick={() => navigate("/curriculum")} className="w-full">
                رجوع للمنهج
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/")} className="w-full">
              رجوع للرئيسية
            </Button>
          </div>

          {!isAuthenticated && (
            <p className="mt-6 text-sm text-muted-foreground">
              <Link to="/auth" className="text-primary hover:underline">سجّل دخولك</Link> عشان نحفظ تقدّمك
            </p>
          )}
        </div>
      </AppShell>
    );
  }

  const currentWord = words[currentIndex];
  const otherWords = words.filter(w => w.id !== currentWord.id);
  const topicLabel = isMixedMode ? topicLabelMap.get(currentWord.id) : undefined;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        
        <Link to="/" className="flex items-center">
          <IngleezyLogo className="text-xl" />
        </Link>
        
        <div className="w-11" />
      </div>

      {/* Phase indicator */}
      <div className="flex justify-center gap-2 mb-6">
        <div className={cn(
          "px-3 py-1 rounded-full text-xs font-medium transition-all",
          phase === "intro" 
            ? "bg-primary/10 text-primary" 
            : "text-muted-foreground"
        )}>
          Learn
        </div>
        <div className={cn(
          "px-3 py-1 rounded-full text-xs font-medium transition-all",
          phase === "quiz" 
            ? "bg-primary/10 text-primary" 
            : "text-muted-foreground"
        )}>
          Quiz
        </div>
      </div>

      {/* The authored lesson plan. Both sections were parsed by the importer,
          dropped at insert, and rendered nowhere until now; they're empty for
          lessons imported before that was fixed, and empty sections render
          nothing. Shown on the first card only, so they introduce the lesson
          rather than interrupting it. */}
      {!isMixedMode && currentIndex === 0 && phase === "intro" && (
        <div className="mb-4 space-y-3">
          <SoundSpotlight entries={topic?.soundSpotlight ?? []} />
          <LessonPlanSection
            title="وش في هذا الدرس"
            icon={ListChecks}
            rows={topic?.lessonSequence ?? []}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="py-4">
        {phase === "intro" ? (
          <IntroCard 
            word={currentWord} 
            gradient={isMixedMode ? undefined : topic?.gradient} 
            onContinue={handleContinueToQuiz}
            topicLabel={topicLabel}
          />
        ) : (
          <QuizCard 
            word={currentWord} 
            otherWords={otherWords} 
            gradient={isMixedMode ? undefined : topic?.gradient} 
            onAnswer={handleQuizAnswer}
            topicLabel={topicLabel}
          />
        )}
      </div>

      {/* Progress */}
      <div className="mt-8">
        <ProgressDots 
          total={words.length} 
          current={currentIndex} 
          gradient={isMixedMode ? undefined : topic?.gradient} 
        />
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {currentIndex + 1} / {words.length}
        </p>
      </div>
    </AppShell>
  );
};

export default Learn;
