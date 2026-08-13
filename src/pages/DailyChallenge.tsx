import { useState, useEffect } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { HomeButton } from "@/components/HomeButton";
import { useAuth } from "@/hooks/useAuth";
import { useAllWords } from "@/hooks/useAllWords";
import { useAddXP } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { useUserLevel } from "@/hooks/useUserLevel";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { toast } from "sonner";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Flame,
  Check,
  X,
  RotateCcw,
  Loader2,
  ChevronRight,
  Zap,
  Star,
  Calendar,
  Languages,
} from "lucide-react";

interface ChallengeQuestion {
  prompt?: string;
  answer: string;
  options?: string[];
  sentence?: string;
  sentenceEnglish?: string;
  scrambled?: string;
  hint?: string;
  arabic?: string;
  english?: string;
}

interface Challenge {
  type: string;
  title: string;
  titleArabic: string;
  questions: ChallengeQuestion[];
}

const DailyChallenge = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { difficulty: userDifficulty } = useUserLevel();
  const { data: allWords } = useAllWords();
  const addXP = useAddXP();

  // Restore persisted session
  const [savedSession] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('session_daily_challenge');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_daily_challenge');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [challenge, setChallenge] = useState<Challenge | null>(savedSession?.challenge ?? null);
  const [streakMultiplier, setStreakMultiplier] = useState(savedSession?.streakMultiplier ?? 1.0);
  const [baseXP, setBaseXP] = useState(savedSession?.baseXP ?? 15);
  const [currentIndex, setCurrentIndex] = useState(savedSession?.currentIndex ?? 0);
  const [score, setScore] = useState(savedSession?.score ?? 0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(savedSession?.sessionComplete ?? false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [matchedPairs, setMatchedPairs] = useState<Set<number>>(new Set());
  const [matchSelected, setMatchSelected] = useState<{ side: 'arabic' | 'english'; index: number } | null>(null);
  const [shuffledEnglish, setShuffledEnglish] = useState<{ text: string; origIndex: number }[]>([]);

  // Persist session state
  useEffect(() => {
    if (!challenge) return;
    try {
      const entry = {
        data: { challenge, streakMultiplier, baseXP, currentIndex, score, sessionComplete },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_daily_challenge', JSON.stringify(entry));
    } catch {}
  }, [challenge, streakMultiplier, baseXP, currentIndex, score, sessionComplete]);

  // Initialize shuffled english for match type
  useEffect(() => {
    if (challenge?.type === 'match' && challenge.questions.length > 0 && shuffledEnglish.length === 0) {
      const items = challenge.questions.map((q, i) => ({ text: q.english || '', origIndex: i }));
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      setShuffledEnglish(items);
    }
  }, [challenge, shuffledEnglish.length]);

  // Check if already completed today
  const { data: todayCompletion } = useQuery({
    queryKey: ["daily-challenge-completion", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("daily_challenge_completions" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("challenge_date", today)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Get streak count
  const { data: streakData } = useQuery({
    queryKey: ["daily-challenge-streak", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { data } = await supabase
        .from("daily_challenge_completions" as any)
        .select("challenge_date")
        .eq("user_id", user.id)
        .order("challenge_date", { ascending: false })
        .limit(30);

      if (!data || data.length === 0) return 0;

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < data.length; i++) {
        const expected = new Date(today);
        expected.setDate(expected.getDate() - i);
        const dateStr = expected.toISOString().split("T")[0];

        if ((data[i] as any).challenge_date === dateStr) {
          streak++;
        } else {
          break;
        }
      }
      return streak;
    },
    enabled: !!user,
  });

  const currentQuestion = challenge?.questions[currentIndex];
  const progress = challenge ? ((currentIndex + 1) / challenge.questions.length) * 100 : 0;

  const startChallenge = async () => {
    setLoading(true);
    try {
      // Try pre-approved content first
      const { data: approved } = await supabase
        .from("daily_challenges" as any)
        .select("*")
        .eq("status", "published")
        .limit(10);

      if (approved && approved.length > 0) {
        // Pick a random challenge
        const picked = (approved as any[])[Math.floor(Math.random() * approved.length)];
        setChallenge({
          type: picked.challenge_type,
          title: picked.title,
          titleArabic: picked.title_arabic,
          questions: picked.questions as ChallengeQuestion[],
        });
        setStreakMultiplier(1 + (streakData || 0) * 0.1);
        setBaseXP(15);
        setCurrentIndex(0);
        setScore(0);
        setSelectedAnswer(null);
        setShowResult(false);
        setSessionComplete(false);
        return;
      }

      // Fallback to live AI generation. The challenge words come from the
      // server-side learner profile (real SRS state, weak words first); this
      // list is only a cold-start fallback for a learner with no deck yet.
      const wordsToUse = allWords?.slice(0, 20) || [];
      const { data, error } = await supabase.functions.invoke("daily-challenge", {
        body: {
          userVocab: wordsToUse.map((w) => ({
            word_arabic: w.word_arabic,
            word_english: w.word_english,
          })),
          streakDays: streakData || 0,
          dialect: activeDialect,
          difficulty: userDifficulty,
        },
      });

      if (error) throw error;

      setChallenge(data.challenge);
      setStreakMultiplier(data.streakMultiplier || 1.0);
      setBaseXP(data.baseXP || 15);
      setCurrentIndex(0);
      setScore(0);
      setSelectedAnswer(null);
      setShowResult(false);
      setSessionComplete(false);
    } catch (e) {
      console.error("Failed to load challenge:", e);
      toast.error("Failed to load today's challenge");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = (answer: string) => {
    if (showResult || !currentQuestion) return;

    setSelectedAnswer(answer);
    const correct = answer === currentQuestion.answer;
    setIsCorrect(correct);
    setShowResult(true);

    if (correct) {
      setScore((prev) => prev + 1);
    }
  };

  const nextQuestion = async () => {
    if (currentIndex < (challenge?.questions.length || 0) - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      // Complete
      setSessionComplete(true);
      markTaskCompletedToday("daily-challenge");
      const totalXP = Math.round(score * baseXP * streakMultiplier);

      if (isAuthenticated && user) {
        addXP.mutate({ amount: totalXP, reason: "daily_challenge" });

        // Save completion
        const today = new Date().toISOString().split("T")[0];
        await supabase.from("daily_challenge_completions" as any).insert({
          user_id: user.id,
          challenge_date: today,
          challenge_type: challenge?.type || "vocab",
          xp_earned: totalXP,
          score,
          max_score: challenge?.questions.length || 0,
        });
      }
    }
  };

  // Landing screen
  if (!challenge && !loading) {
    const alreadyCompleted = !!todayCompletion;

    return (
      <AppShell>
        <HomeButton />
        <div className="py-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Flame className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2 justify-center">Daily Challenge <InfoHint {...PAGE_HINTS["daily-challenge"]} size="md" /></h1>
            <p className="text-muted-foreground">Complete today's challenge to keep your streak!</p>
          </div>

          {/* Streak display */}
          {isAuthenticated && (
            <div className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/20 rounded-2xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Flame className="h-6 w-6 text-orange-500" />
                <span className="text-3xl font-bold text-foreground">{streakData || 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">Day Streak</p>
              {(streakData || 0) >= 3 && (
                <Badge className="mt-2 bg-orange-500/20 text-orange-700 dark:text-orange-400">
                  {(streakData || 0) >= 7 ? "2x XP Bonus! 🔥" : "1.5x XP Bonus! ⚡"}
                </Badge>
              )}
            </div>
          )}

          {alreadyCompleted ? (
            <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-3">
              <Check className="h-12 w-12 text-primary mx-auto" />
              <p className="font-bold text-foreground">Challenge Complete!</p>
              <p className="text-sm text-muted-foreground">
                You earned {(todayCompletion as any)?.xp_earned} XP today. Come back tomorrow!
              </p>
              <Button variant="outline" onClick={() => navigate("/")}>Back to Home</Button>
            </div>
          ) : (
            <Button onClick={startChallenge} className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Zap className="h-5 w-5 mr-2" />
              )}
              Start Today's Challenge
            </Button>
          )}

          {!isAuthenticated && (
            <Button variant="outline" onClick={() => navigate("/auth")} className="w-full">
              Sign in to track your streak
            </Button>
          )}
        </div>
      </AppShell>
    );
  }

  // Loading
  if (loading || !challenge || (challenge.type !== 'match' && !currentQuestion)) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Generating today's challenge...</p>
        </div>
      </AppShell>
    );
  }

  // Session complete
  if (sessionComplete) {
    const totalXP = Math.round(score * baseXP * streakMultiplier);

    return (
      <AppShell>
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Star className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Challenge Complete!</h1>
          <div className="text-4xl font-bold text-primary">
            {score}/{challenge.questions.length}
          </div>
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">+{totalXP} XP earned</p>
            {streakMultiplier > 1 && (
              <p className="text-sm text-orange-600 dark:text-orange-400">
                {streakMultiplier}x streak bonus applied! 🔥
              </p>
            )}
          </div>
          <Button onClick={() => navigate("/")} className="w-full">
            Back to Home
          </Button>
        </div>
      </AppShell>
    );
  }

  // Question view
  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <X className="h-4 w-4 mr-1" /> Exit
        </Button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{challenge.title}</p>
          <p className="text-xs font-arabic text-muted-foreground">{challenge.titleArabic}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">EN</span>
          <Switch checked={showEnglish} onCheckedChange={setShowEnglish} className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4" />
        </div>
      </div>

      <Progress value={progress} className="h-2 mb-6" />

      <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
        {/* Question prompt (non-match types) */}
        {challenge.type !== 'match' && currentQuestion && (
        <div className="text-center">
          {currentQuestion.prompt && (
            <p className="text-xl font-semibold text-foreground">{currentQuestion.prompt}</p>
          )}
          {currentQuestion.sentence && (
            <div>
              <p className="text-xl font-arabic text-foreground" dir="rtl">{currentQuestion.sentence}</p>
              {showEnglish && currentQuestion.sentenceEnglish && (
                <p className="text-sm text-muted-foreground mt-1 animate-in fade-in duration-200">{currentQuestion.sentenceEnglish}</p>
              )}
            </div>
          )}
          {currentQuestion.scrambled && (
            <div>
              <p className="text-2xl font-arabic text-foreground tracking-widest" dir="rtl">
                {currentQuestion.scrambled}
              </p>
              {currentQuestion.hint && (
                <p className="text-sm text-muted-foreground mt-2">Hint: {currentQuestion.hint}</p>
              )}
            </div>
          )}
        </div>
        )}

        {/* Match type */}
        {challenge.type === 'match' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground mb-2">Tap an Arabic word, then tap its English match</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                {challenge.questions.map((q, i) => {
                  const isMatched = matchedPairs.has(i);
                  const isSelected = matchSelected?.side === 'arabic' && matchSelected.index === i;
                  return (
                    <button
                      key={`ar-${i}`}
                      disabled={isMatched}
                      onClick={() => {
                        if (isMatched) return;
                        if (matchSelected?.side === 'english') {
                          const engItem = shuffledEnglish[matchSelected.index];
                          if (engItem.origIndex === i) {
                            const newMatched = new Set(matchedPairs);
                            newMatched.add(i);
                            setMatchedPairs(newMatched);
                            setScore(prev => prev + 1);
                            setMatchSelected(null);
                            if (newMatched.size === challenge.questions.length) {
                              setSessionComplete(true);
                              markTaskCompletedToday("daily-challenge");
                              const totalXP = Math.round(newMatched.size * baseXP * streakMultiplier);
                              if (isAuthenticated && user) {
                                addXP.mutate({ amount: totalXP, reason: "daily_challenge" });
                                const today = new Date().toISOString().split("T")[0];
                                supabase.from("daily_challenge_completions" as any).insert({
                                  user_id: user.id, challenge_date: today, challenge_type: "match",
                                  xp_earned: totalXP, score: newMatched.size, max_score: challenge.questions.length,
                                });
                              }
                            }
                          } else {
                            setMatchSelected(null);
                            toast.error("Not a match, try again");
                          }
                        } else {
                          setMatchSelected({ side: 'arabic', index: i });
                        }
                      }}
                      className={cn(
                        "w-full p-3 rounded-xl border-2 text-center font-arabic text-lg transition-all",
                        isMatched ? "border-green-500 bg-green-500/10 opacity-60" :
                        isSelected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                      )}
                    >
                      {q.arabic}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
                {shuffledEnglish.map((item, i) => {
                  const isMatched = matchedPairs.has(item.origIndex);
                  const isSelected = matchSelected?.side === 'english' && matchSelected.index === i;
                  return (
                    <button
                      key={`en-${i}`}
                      disabled={isMatched}
                      onClick={() => {
                        if (isMatched) return;
                        if (matchSelected?.side === 'arabic') {
                          if (item.origIndex === matchSelected.index) {
                            const newMatched = new Set(matchedPairs);
                            newMatched.add(item.origIndex);
                            setMatchedPairs(newMatched);
                            setScore(prev => prev + 1);
                            setMatchSelected(null);
                            if (newMatched.size === challenge.questions.length) {
                              setSessionComplete(true);
                              markTaskCompletedToday("daily-challenge");
                              const totalXP = Math.round(newMatched.size * baseXP * streakMultiplier);
                              if (isAuthenticated && user) {
                                addXP.mutate({ amount: totalXP, reason: "daily_challenge" });
                                const today = new Date().toISOString().split("T")[0];
                                supabase.from("daily_challenge_completions" as any).insert({
                                  user_id: user.id, challenge_date: today, challenge_type: "match",
                                  xp_earned: totalXP, score: newMatched.size, max_score: challenge.questions.length,
                                });
                              }
                            }
                          } else {
                            setMatchSelected(null);
                            toast.error("Not a match, try again");
                          }
                        } else {
                          setMatchSelected({ side: 'english', index: i });
                        }
                      }}
                      className={cn(
                        "w-full p-3 rounded-xl border-2 text-center text-sm transition-all",
                        isMatched ? "border-green-500 bg-green-500/10 opacity-60" :
                        isSelected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                      )}
                    >
                      {item.text}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Options (non-match types) */}
        {challenge.type !== 'match' && currentQuestion?.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((option, i) => {
              const isSelected = selectedAnswer === option;
              const isAnswer = option === currentQuestion.answer;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(option)}
                  disabled={showResult}
                  className={cn(
                    "w-full p-4 rounded-xl text-center transition-all border-2",
                    showResult
                      ? isAnswer
                        ? "border-green-500 bg-green-500/10"
                        : isSelected
                        ? "border-red-500 bg-red-500/10"
                        : "border-border bg-muted/50"
                      : "border-border hover:border-primary/50 bg-card"
                  )}
                >
                  <p className="font-medium text-foreground font-arabic text-lg">{option}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Result + Next (non-match types) */}
        {challenge.type !== 'match' && showResult && currentQuestion && (
          <div className="space-y-3">
            <div className={cn(
              "p-3 rounded-xl text-center",
              isCorrect ? "bg-green-500/10" : "bg-red-500/10"
            )}>
              <div className="flex items-center justify-center gap-2">
                {isCorrect ? (
                  <Check className="h-5 w-5 text-green-600" />
                ) : (
                  <X className="h-5 w-5 text-red-600" />
                )}
                <span className={isCorrect ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                  {isCorrect ? "Correct!" : `Answer: ${currentQuestion.answer}`}
                </span>
              </div>
            </div>
            <Button onClick={nextQuestion} className="w-full">
              {currentIndex < challenge.questions.length - 1 ? "Next" : "See Results"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      <div className="text-center mt-4">
        <p className="text-sm text-muted-foreground">Score: {score}</p>
      </div>
    </AppShell>
  );
};

export default DailyChallenge;
