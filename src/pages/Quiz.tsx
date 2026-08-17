import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTopic, VocabularyWord } from "@/hooks/useTopic";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";
import { QuizCard } from "@/components/learn/QuizCard";
import { QuizResults } from "@/components/quiz/QuizResults";

interface QuizState {
  currentIndex: number;
  score: number;
  answers: { word: VocabularyWord; correct: boolean }[];
  isComplete: boolean;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const Quiz = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { data: topic, isLoading, error } = useTopic(lessonId);
  
  const [round, setRound] = useState(0);
  const [quizState, setQuizState] = useState<QuizState>({
    currentIndex: 0,
    score: 0,
    answers: [],
    isComplete: false,
  });

  /**
   * Derived, not stored in an effect.
   *
   * The shuffle used to happen in a `useEffect`, which runs *after* the render
   * that first has the words. On that render `topic.words` was already long
   * enough to pass the four-word gate below while `shuffledWords` was still
   * empty, so `currentWord` was undefined and `key={currentWord.id}` threw.
   * That is every lesson the quiz can actually run — with fewer than four
   * words it returned early and never reached the crash, which is why the
   * route-coverage suite never saw it. Deriving the shuffle closes the gap
   * instead of guarding it: there is no longer a render where one exists and
   * the other does not.
   */
  const shuffledWords = useMemo<VocabularyWord[]>(
    // `round` is the re-shuffle trigger — restarting deals the same words out
    // in a fresh order rather than replaying the previous run.
    () => (round >= 0 && topic?.words?.length ? shuffleArray(topic.words) : []),
    [topic, round],
  );

  const resetQuiz = useCallback(() => {
    setRound((r) => r + 1);
    setQuizState({
      currentIndex: 0,
      score: 0,
      answers: [],
      isComplete: false,
    });
  }, []);

  const handleAnswer = (isCorrect: boolean) => {
    const currentWord = shuffledWords[quizState.currentIndex];
    const newAnswers = [...quizState.answers, { word: currentWord, correct: isCorrect }];
    const newScore = isCorrect ? quizState.score + 1 : quizState.score;
    const isLastQuestion = quizState.currentIndex >= shuffledWords.length - 1;

    setQuizState({
      currentIndex: isLastQuestion ? quizState.currentIndex : quizState.currentIndex + 1,
      score: newScore,
      answers: newAnswers,
      isComplete: isLastQuestion,
    });
  };

  if (isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">نحمّل التمرين…</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !topic) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-lg text-muted-foreground mb-4">ما لقينا الموضوع</p>
            <Button onClick={() => navigate("/")}>رجوع للرئيسية</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (topic.words.length < 4) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <PageCorner />
        </div>
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground mb-2">محتاج كلمات أكثر</p>
          <p className="text-sm text-muted-foreground mb-6">
            الاختبار يحتاج ٤ كلمات على الأقل.
          </p>
          <Button onClick={() => navigate("/")}>رجوع للرئيسية</Button>
        </div>
      </AppShell>
    );
  }

  // Quiz complete - show results
  if (quizState.isComplete) {
    return (
      <QuizResults
        topic={topic}
        quizState={quizState}
        onRestart={resetQuiz}
        onHome={() => navigate("/")}
      />
    );
  }

  // Active quiz
  const currentWord = shuffledWords[quizState.currentIndex];
  const otherWords = shuffledWords.filter((_, i) => i !== quizState.currentIndex);
  const progress = (quizState.currentIndex / shuffledWords.length) * 100;

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        <div className="px-4 py-2 rounded-lg bg-card border border-border">
          <span className="text-sm font-semibold text-foreground font-arabic">
            {topic.name_arabic}
          </span>
        </div>
        <div className="w-11" />
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-500 bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-center mt-2 text-xs text-muted-foreground">
          {quizState.currentIndex + 1} / {shuffledWords.length}
        </p>
      </div>

      <div className="py-4">
        <QuizCard
          key={currentWord.id}
          word={currentWord}
          otherWords={otherWords}
          gradient={topic.gradient}
          onAnswer={handleAnswer}
        />
      </div>
    </AppShell>
  );
};

export default Quiz;
