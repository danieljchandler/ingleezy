import { useState, useEffect } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PageCorner } from "@/components/shell/PageCorner";
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
import { Input } from "@/components/ui/input";
import { hasArabic } from "@/lib/watch";
import {
  Flame,
  Check,
  X,
  RotateCcw,
  Loader2,
  Zap,
  Star,
  Calendar,
  Languages
} from "lucide-react";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { Art } from "@/components/brand/Art";

/**
 * One question, in the shape both sources share: the `daily-challenge`
 * generator and the published pool `curriculum-chat` writes. English is what
 * is practised and the learner's dialect is the scaffold, but keys are
 * Arabic-era where the pool fixed them: `sentenceEnglish` holds the DIALECT
 * meaning of an English `sentence`. Nothing here assumes a direction — a
 * string is set as English or as Arabic by what script it is in — so pool rows
 * written either way still read correctly.
 */
interface ChallengeQuestion {
  prompt?: string;
  answer?: string;
  options?: string[];
  sentence?: string;
  sentenceEnglish?: string;
  /** The answer's words, shuffled. With no options, tapped back into order. */
  scrambled?: string;
  hint?: string;
  arabic?: string;
  english?: string;
}

/**
 * How typed and tapped answers are compared: case, curly apostrophes, spacing
 * and closing punctuation are not what a daily challenge is testing.
 */
function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[.!?\u060C,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A string set in its own script: English as English, Arabic in Naskh. */
function Phrase({ text, english, arabic }: { text: string; english: string; arabic: string }) {
  return hasArabic(text) ? (
    <span dir="rtl" className={cn("font-naskh", arabic)}>{text}</span>
  ) : (
    <span lang="en" dir="ltr" className={cn("font-english", english)}>{text}</span>
  );
}

/** An English gap sentence, the gap drawn as a line until it is answered. */
function GapSentence({ sentence, fill }: { sentence: string; fill?: string }) {
  const parts = sentence.split(/_{2,}/);
  return (
    <p lang="en" dir="ltr" className="font-english text-[22px] font-semibold leading-9 text-foreground">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 &&
            (fill ? (
              <mark className="rounded-md bg-accent px-1.5 text-accent-foreground">{fill}</mark>
            ) : (
              <span aria-label="فراغ" className="mx-1 inline-block w-14 border-b-2 border-foreground/40 align-baseline" />
            ))}
        </span>
      ))}
    </p>
  );
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
  const { data: allWords, refetch: refetchAllWords } = useAllWords();
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
  // A question with no options is answered by tapping the words into order
  // (unscramble) or by typing; the pool's fill-blank and unscramble rows carry
  // no options, and until these existed they could not be answered at all.
  const [placed, setPlaced] = useState<number[]>([]);
  const [typed, setTyped] = useState("");

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
        setPlaced([]);
        setTyped("");
        setSessionComplete(false);
        return;
      }

      // Fallback to live AI generation. The challenge words come from the
      // server-side learner profile (real SRS state, weak words first); this
      // list is only a cold-start fallback for a learner with no deck yet.
      // Start can be tapped before the words query has answered. Wait for it
      // rather than sending an empty hint, which would quietly build the
      // challenge from nothing of the learner's own.
      const words = allWords ?? (await refetchAllWords()).data ?? [];
      const wordsToUse = words.slice(0, 20);
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
      setPlaced([]);
      setTyped("");
      setSessionComplete(false);
    } catch (e) {
      console.error("Failed to load challenge:", e);
      toast.error("تعذّر تحميل تحدي اليوم");
    } finally {
      setLoading(false);
    }
  };

  /** `exact` for a picked option; typed and tapped answers are normalized. */
  const handleAnswer = (answer: string, exact = true) => {
    if (showResult || !currentQuestion?.answer) return;

    setSelectedAnswer(answer);
    const correct = exact
      ? answer === currentQuestion.answer
      : normalizeAnswer(answer) === normalizeAnswer(currentQuestion.answer);
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
      setPlaced([]);
      setTyped("");
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
        <PageCorner />
        <div className="py-8 space-y-6">
          <div className="text-center space-y-2">
            <Art name="flame" eager className="mx-auto mb-1 h-32 w-32" />
            <h1 className="text-[28px] font-normal leading-[42px] text-foreground inline-flex items-center gap-2 justify-center">تحدي اليوم <InfoHint {...PAGE_HINTS["daily-challenge"]} size="md" /></h1>
            <p className="text-muted-foreground">خلّص تحدي اليوم عشان تحافظ على سلسلتك!</p>
          </div>

          {/* Streak display */}
          {isAuthenticated && (
            <div className="rounded-3xl bg-card p-4 text-center shadow-card">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Flame className="h-6 w-6 text-accent" />
                <span className="text-3xl font-bold text-foreground">{streakData || 0}</span>
              </div>
              <p className="text-sm text-muted-foreground">يوم متتالي</p>
              {(streakData || 0) >= 3 && (
                <Badge className="mt-2 bg-accent/20 text-accent-ink">
                  {(streakData || 0) >= 7 ? "2x XP Bonus! 🔥" : "1.5x XP Bonus! ⚡"}
                </Badge>
              )}
            </div>
          )}

          {alreadyCompleted ? (
            <div className="bg-card rounded-3xl shadow-card p-6 text-center space-y-3">
              <Check className="h-12 w-12 text-primary mx-auto" />
              <p className="font-bold text-foreground">خلّصت التحدي!</p>
              <p className="text-sm text-muted-foreground">
                You earned {(todayCompletion as any)?.xp_earned} XP today. Come back tomorrow!
              </p>
              <Button variant="outline" onClick={() => navigate("/")}>رجوع للرئيسية</Button>
            </div>
          ) : (
            <Button onClick={startChallenge} className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin me-2" />
              ) : (
                <Zap className="h-5 w-5 me-2" />
              )}
              ابدأ تحدي اليوم
            </Button>
          )}

          {!isAuthenticated && (
            <Button variant="outline" onClick={() => navigate("/auth")} className="w-full">
              سجّل دخولك عشان نتابع سلسلتك
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
          <p className="text-muted-foreground">نجهّز تحدي اليوم…</p>
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
          <h1 className="text-2xl font-bold text-foreground">خلّصت التحدي!</h1>
          <div className="text-4xl font-bold text-primary">
            {score}/{challenge.questions.length}
          </div>
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">حصّلت {totalXP} نقطة خبرة</p>
            {streakMultiplier > 1 && (
              <p className="text-sm text-accent">
                مكافأة السلسلة ×{streakMultiplier} 🔥
              </p>
            )}
          </div>
          <Button onClick={() => navigate("/")} className="w-full">
            رجوع للرئيسية
          </Button>
        </div>
      </AppShell>
    );
  }

  // Question view
  const tiles = currentQuestion?.scrambled?.split(/\s+/).filter(Boolean) ?? [];
  const hasOptions = !!currentQuestion?.options?.length;
  const isWordBank = !hasOptions && tiles.length > 0;
  const isTyped = !hasOptions && !isWordBank;

  /** A pair matched: score it, and finish the challenge on the last one. */
  const matchPair = (index: number) => {
    const newMatched = new Set(matchedPairs);
    newMatched.add(index);
    setMatchedPairs(newMatched);
    setScore((prev) => prev + 1);
    setMatchSelected(null);
    if (newMatched.size !== challenge.questions.length) return;

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
  };

  const missedPair = () => {
    setMatchSelected(null);
    toast.error("مو مطابقة، جرّب مرة ثانية");
  };

  const matchTile = (state: "matched" | "selected" | "idle") =>
    cn(
      "w-full min-h-12 rounded-2xl px-3 py-2.5 text-center transition-all",
      state === "matched" && "bg-tint-sage text-success-ink opacity-70",
      state === "selected" && "bg-tint-firoza ring-2 ring-primary",
      state === "idle" && "bg-card shadow-soft hover:bg-muted",
    );

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <X className="h-4 w-4 me-1" /> خروج
        </Button>
        <div className="min-w-0 text-center">
          <p className="text-sm font-semibold text-foreground">{challenge.titleArabic}</p>
          <p lang="en" dir="ltr" className="font-english text-xs text-muted-foreground">{challenge.title}</p>
        </div>
        {/* Only where there is a meaning to reveal. Hidden by default so the
            English is read before the dialect explains it. */}
        {currentQuestion?.sentenceEnglish ? (
          <div className="flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <Switch
              checked={showEnglish}
              onCheckedChange={setShowEnglish}
              aria-label="أظهر المعنى"
              className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
            />
          </div>
        ) : (
          <span className="w-16" aria-hidden />
        )}
      </div>

      <Progress value={progress} className="h-2 mb-6" />

      <div className="bg-card rounded-3xl shadow-card p-6 space-y-6">
        {/* The question (every type but match) */}
        {challenge.type !== 'match' && currentQuestion && (
          <div className="space-y-2 text-center">
            {currentQuestion.prompt && (
              <p className="text-foreground">
                <Phrase
                  text={currentQuestion.prompt}
                  english="font-heading text-[26px] leading-10"
                  arabic="text-xl leading-9"
                />
              </p>
            )}
            {currentQuestion.sentence &&
              (hasArabic(currentQuestion.sentence) ? (
                <p dir="rtl" className="font-naskh text-xl leading-9 text-foreground">{currentQuestion.sentence}</p>
              ) : (
                <GapSentence
                  sentence={currentQuestion.sentence}
                  fill={showResult ? currentQuestion.answer : undefined}
                />
              ))}
            {showEnglish && currentQuestion.sentenceEnglish && (
              <p className="text-[15px] text-muted-foreground animate-in fade-in duration-200">
                <Phrase text={currentQuestion.sentenceEnglish} english="" arabic="" />
              </p>
            )}
            {currentQuestion.scrambled && hasOptions && (
              <p className="text-foreground">
                <Phrase text={currentQuestion.scrambled} english="text-xl" arabic="text-2xl" />
              </p>
            )}
            {currentQuestion.hint && (
              <p className="text-sm text-muted-foreground">
                تلميح: <bdi>{currentQuestion.hint}</bdi>
              </p>
            )}
          </div>
        )}

        {/* Match: English on one side, the dialect on the other */}
        {challenge.type === 'match' && (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground mb-2">اضغط كلمة إنجليزية، بعدين اضغط معناها</p>
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
                          if (shuffledEnglish[matchSelected.index].origIndex === i) matchPair(i);
                          else missedPair();
                        } else {
                          setMatchSelected({ side: 'arabic', index: i });
                        }
                      }}
                      className={matchTile(isMatched ? "matched" : isSelected ? "selected" : "idle")}
                    >
                      <Phrase text={q.arabic ?? ""} english="text-[15px] font-semibold" arabic="text-lg" />
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
                          if (item.origIndex === matchSelected.index) matchPair(item.origIndex);
                          else missedPair();
                        } else {
                          setMatchSelected({ side: 'english', index: i });
                        }
                      }}
                      className={matchTile(isMatched ? "matched" : isSelected ? "selected" : "idle")}
                    >
                      <Phrase text={item.text} english="text-[15px] font-semibold" arabic="text-lg" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Options */}
        {challenge.type !== 'match' && hasOptions && currentQuestion?.options && (
          <div role="group" aria-label="الخيارات" className="space-y-2">
            {currentQuestion.options.map((option, i) => {
              const isSelected = selectedAnswer === option;
              const isAnswer = option === currentQuestion.answer;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(option)}
                  disabled={showResult}
                  className={cn(
                    "w-full min-h-14 rounded-2xl px-4 py-3 text-center transition-all",
                    showResult
                      ? isAnswer
                        ? "bg-tint-sage ring-2 ring-success text-success-ink"
                        : isSelected
                        ? "bg-tint-clay ring-2 ring-destructive text-clay-ink"
                        : "bg-muted text-muted-foreground"
                      : "bg-card text-foreground shadow-soft hover:bg-muted"
                  )}
                >
                  <Phrase text={option} english="text-[17px] font-semibold" arabic="text-lg" />
                </button>
              );
            })}
          </div>
        )}

        {/* Word order: tap the words into the sentence, tap one to take it back */}
        {challenge.type !== 'match' && isWordBank && (
          <div className="space-y-4">
            <div
              role="group"
              aria-label="جملتك"
              dir="ltr"
              className={cn(
                "flex min-h-[60px] flex-wrap items-center gap-2 rounded-2xl p-3",
                showResult ? (isCorrect ? "bg-tint-sage" : "bg-tint-clay") : "bg-muted",
              )}
            >
              {placed.map((tileIndex, position) => (
                <button
                  key={`${tileIndex}-${position}`}
                  disabled={showResult}
                  onClick={() => setPlaced((prev) => prev.filter((_, p) => p !== position))}
                  className="rounded-xl bg-card px-3 py-2 font-english text-[15px] font-semibold shadow-soft"
                  lang="en"
                >
                  {tiles[tileIndex]}
                </button>
              ))}
            </div>
            <div role="group" aria-label="الكلمات" dir="ltr" className="flex flex-wrap justify-center gap-2">
              {tiles.map((tile, i) => (
                <button
                  key={i}
                  disabled={showResult || placed.includes(i)}
                  onClick={() => setPlaced((prev) => [...prev, i])}
                  className={cn(
                    "rounded-xl bg-card px-3 py-2 font-english text-[15px] font-semibold shadow-soft hover:bg-muted",
                    placed.includes(i) && "invisible",
                  )}
                  lang="en"
                >
                  {tile}
                </button>
              ))}
            </div>
            {!showResult && (
              <Button
                className="w-full"
                disabled={placed.length !== tiles.length}
                onClick={() => handleAnswer(placed.map((i) => tiles[i]).join(" "), false)}
              >
                تحقق
              </Button>
            )}
          </div>
        )}

        {/* Typed: a question with nothing to pick from */}
        {challenge.type !== 'match' && isTyped && currentQuestion && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) handleAnswer(typed, false);
            }}
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={showResult}
              aria-label="جوابك بالإنجليزي"
              placeholder="اكتب الجواب بالإنجليزي"
              lang="en"
              dir="ltr"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="text-center font-english text-lg placeholder:font-sans"
            />
            {!showResult && (
              <Button type="submit" className="w-full" disabled={!typed.trim()}>
                تحقق
              </Button>
            )}
          </form>
        )}

        {/* Result + Next */}
        {challenge.type !== 'match' && showResult && currentQuestion && (
          <div className="space-y-3">
            <div className={cn(
              "rounded-2xl p-3 text-center",
              isCorrect ? "bg-tint-sage text-success-ink" : "bg-tint-clay text-clay-ink"
            )}>
              <div className="flex items-center justify-center gap-2 font-medium">
                {isCorrect ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
                <span>
                  {isCorrect ? "صح!" : <>الجواب: <bdi>{currentQuestion.answer}</bdi></>}
                </span>
              </div>
            </div>
            <Button onClick={nextQuestion} className="w-full">
              {currentIndex < challenge.questions.length - 1 ? "التالي" : "شوف النتيجة"}
              <ChevronOpen className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}
      </div>

      <div className="text-center mt-4">
        <p className="text-sm text-muted-foreground">النتيجة: {score}</p>
      </div>
    </AppShell>
  );
};

export default DailyChallenge;
