import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useBattle,
  useSubmitChallengerScore,
  useSubmitOpponentScore,
  type BattleQuestion,
} from '@/hooks/useVocabBattles';
import { AppShell } from '@/components/layout/AppShell';
import { PageCorner } from '@/components/shell/PageCorner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, Swords, Trophy, Clock, ArrowRight, RotateCcw, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const BattlePlay = () => {
  const { battleId } = useParams<{ battleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: battle, isLoading } = useBattle(battleId);
  const submitChallenger = useSubmitChallengerScore();
  const submitOpponent = useSubmitOpponentScore();

  // Game state
  const [gameState, setGameState] = useState<'ready' | 'playing' | 'finished'>('ready');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [totalTimeMs, setTotalTimeMs] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval>>();
  // Refs mirror score/startTime so finishGame reads live values even when it is
  // invoked from the timer's interval closure (captured once at game start).
  // Without this the timeout path always submitted score 0.
  const scoreRef = useRef(0);
  const startTimeRef = useRef(0);
  const finishedRef = useRef(false);

  const isChallenger = battle?.challenger_id === user?.id;
  const questions: BattleQuestion[] = battle?.questions || [];
  const question = questions[currentQuestion];

  // Timer effect
  useEffect(() => {
    if (gameState === 'playing' && timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            // Time's up!
            clearInterval(timerRef.current);
            finishGame();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => clearInterval(timerRef.current);
  }, [gameState]);

  const startGame = () => {
    finishedRef.current = false;
    scoreRef.current = 0;
    startTimeRef.current = Date.now();
    setGameState('playing');
    setCurrentQuestion(0);
    setScore(0);
    setTimeRemaining(battle?.time_limit_seconds || 60);
  };

  const finishGame = useCallback(async () => {
    // Idempotency guard: the timer and the last-question path can both fire.
    if (finishedRef.current) return;
    finishedRef.current = true;

    setGameState('finished');
    clearInterval(timerRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    const finalScore = scoreRef.current;
    setTotalTimeMs(elapsed);

    if (!battleId) return;

    try {
      if (isChallenger) {
        await submitChallenger.mutateAsync({
          battleId,
          score: finalScore,
          timeMs: elapsed,
        });
      } else {
        await submitOpponent.mutateAsync({
          battleId,
          score: finalScore,
          timeMs: elapsed,
        });
      }
      toast.success('أُرسلت نتيجتك!');
    } catch (err: any) {
      toast.error(err.message || 'تعذّر إرسال النتيجة');
    }
  }, [battleId, isChallenger, submitChallenger, submitOpponent]);

  const handleAnswer = (answerIndex: number) => {
    if (showResult) return;

    setSelectedAnswer(answerIndex);
    setShowResult(true);

    const isCorrect = answerIndex === question.correct_index;
    if (isCorrect) {
      // Update the ref synchronously so a finishGame fired from the final
      // question (or the timer) counts this answer instead of missing it.
      scoreRef.current += 1;
      setScore(scoreRef.current);
    }

    // Move to next question after brief delay
    setTimeout(() => {
      if (currentQuestion + 1 >= questions.length) {
        finishGame();
      } else {
        setCurrentQuestion((prev) => prev + 1);
        setSelectedAnswer(null);
        setShowResult(false);
      }
    }, 800);
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!battle) {
    return (
      <AppShell>
        <div className="mb-6"><PageCorner /></div>
        <div className="text-center py-16">
          <p className="text-muted-foreground">لم نعثر على المعركة</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/battles')}>
            العودة إلى المعارك
          </Button>
        </div>
      </AppShell>
    );
  }

  // Check if user can play
  const canPlay = isChallenger
    ? battle.challenger_score === null
    : battle.status === 'pending' && battle.challenger_score !== null;

  if (!canPlay && gameState === 'ready') {
    return (
      <AppShell>
        <div className="mb-6"><PageCorner /></div>
        <div className="max-w-md mx-auto text-center py-16">
          <Swords className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">لعبت هذه المعركة</h1>
          <p className="text-muted-foreground mb-6">
            {battle.status === 'completed'
              ? 'انتهت هذه المعركة.'
              : isChallenger
              ? 'بانتظار خصمك ليلعب.'
              : 'بانتظار المتحدي ليلعب أولاً.'}
          </p>
          <Button onClick={() => navigate('/battles')}>العودة إلى المعارك</Button>
        </div>
      </AppShell>
    );
  }

  // Ready screen
  if (gameState === 'ready') {
    return (
      <AppShell>
        <div className="mb-6"><PageCorner /></div>
        <div className="max-w-md mx-auto text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-6">
            <Swords className="h-10 w-10 text-primary" />
          </div>

          <h1 className="text-2xl font-bold font-heading mb-2">معركة مفردات</h1>
          <p className="text-muted-foreground mb-8">
            أجب عن {battle.question_count} أسئلة مفردات بأسرع ما يمكنك!
          </p>

          <div className="bg-card border-2 border-border rounded-2xl p-6 mb-6">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-3xl font-bold text-primary">{battle.question_count}</p>
                <p className="text-sm text-muted-foreground">أسئلة</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-primary">{battle.time_limit_seconds}s</p>
                <p className="text-sm text-muted-foreground">المهلة</p>
              </div>
            </div>

            {!isChallenger && battle.challenger_score !== null && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">النتيجة المطلوب تجاوزها:</p>
                <p className="text-2xl font-bold">
                  {battle.challenger_score}/{battle.question_count}
                </p>
              </div>
            )}
          </div>

          <Button size="lg" className="w-full gap-2" onClick={startGame}>
            <Swords className="h-5 w-5" />
            ابدأ المعركة!
          </Button>
        </div>
      </AppShell>
    );
  }

  // Finished screen
  if (gameState === 'finished') {
    const isWinner = battle.winner_id === user?.id;
    const isDraw = battle.winner_id === null && battle.status === 'completed';

    return (
      <AppShell>
        <div className="mb-6"><PageCorner /></div>
        <div className="max-w-md mx-auto text-center animate-in fade-in zoom-in-95 duration-500">
          <div className={cn(
            'inline-flex items-center justify-center w-24 h-24 rounded-full mb-6',
            isWinner ? 'bg-yellow-500/10' : isDraw ? 'bg-blue-500/10' : 'bg-muted'
          )}>
            {isWinner ? (
              <Trophy className="h-12 w-12 text-yellow-500" />
            ) : (
              <Swords className="h-12 w-12 text-muted-foreground" />
            )}
          </div>

          <h1 className="text-3xl font-bold font-heading mb-2">
            {battle.status === 'completed'
              ? isWinner
                ? '🎉 فزت!'
                : isDraw
                ? '🤝 تعادل!'
                : 'محاولة طيبة!'
              : 'أُرسلت نتيجتك!'}
          </h1>

          <div className="bg-card border-2 border-border rounded-2xl p-6 my-6">
            <p className="text-5xl font-bold text-primary mb-2">
              {score}/{questions.length}
            </p>
            <p className="text-muted-foreground">
              أنهيتها في {(totalTimeMs / 1000).toFixed(1)} ثانية
            </p>

            {battle.status === 'pending' && isChallenger && (
              <p className="mt-4 text-sm text-muted-foreground">
                بانتظار خصمك ليلعب...
              </p>
            )}

            {battle.status === 'completed' && (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">أنت</p>
                  <p className="font-bold">
                    {isChallenger ? battle.challenger_score : battle.opponent_score}/{questions.length}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">الخصم</p>
                  <p className="font-bold">
                    {isChallenger ? battle.opponent_score : battle.challenger_score}/{questions.length}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => navigate('/battles')}>
              كل المعارك
            </Button>
            <Button className="flex-1" onClick={() => navigate('/friends')}>
              تحدٍّ جديد
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Playing screen
  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        {/* Header with timer and progress */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {currentQuestion + 1}/{questions.length}
            </span>
          </div>
          <div className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-full font-mono font-bold',
            timeRemaining <= 10 ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
          )}>
            <Clock className="h-4 w-4" />
            {timeRemaining}s
          </div>
        </div>

        <Progress value={((currentQuestion + 1) / questions.length) * 100} className="h-2 mb-6" />

        {/* Question */}
        {question && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="bg-card border-2 border-border rounded-2xl p-8 text-center mb-6">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                كيف تقولها بالإنجليزية؟
              </p>
              <p className="text-4xl font-bold">
                {question.word_arabic}
              </p>
            </div>

            {/* Choices */}
            <div className="space-y-3">
              {question.choices.map((choice, idx) => {
                const isSelected = selectedAnswer === idx;
                const isCorrect = idx === question.correct_index;
                const showCorrect = showResult && isCorrect;
                const showWrong = showResult && isSelected && !isCorrect;

                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(idx)}
                    disabled={showResult}
                    className={cn(
                      'w-full text-left rounded-xl border-2 p-4 transition-all duration-200',
                      'flex items-center justify-between',
                      showCorrect
                        ? 'border-green-500 bg-green-500/10'
                        : showWrong
                        ? 'border-red-500 bg-red-500/10'
                        : isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:border-primary/40',
                      !showResult && 'active:scale-[0.98]'
                    )}
                  >
                    <span className="font-english font-medium">{choice}</span>
                    {showCorrect && <Check className="h-5 w-5 text-green-500" />}
                    {showWrong && <X className="h-5 w-5 text-red-500" />}
                  </button>
                );
              })}
            </div>

            {/* Score tracker */}
            <div className="text-center mt-6 text-sm text-muted-foreground">
              النتيجة: <span className="font-bold text-foreground">{score}</span>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default BattlePlay;
