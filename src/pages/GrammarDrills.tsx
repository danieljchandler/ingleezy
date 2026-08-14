import { useState, useEffect, useMemo, useRef } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useGrammarMastery, useRecordGrammarOutcome } from "@/hooks/useGrammarMastery";
import { buildCategoryProgress, GRAMMAR_CATEGORIES } from "@/lib/grammarCategories";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import type { PageAiContext } from "@/lib/pageAiContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  BookOpen,
  Check,
  ChevronRight,
  Languages,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

interface Choice {
  /** The English answer option. */
  text: string;
  /** Its gloss in the learner's dialect. */
  text_ar: string;
}

interface DrillQuestion {
  /** The English sentence/question being tested. */
  question: string;
  /** Instruction line in the learner's dialect. */
  question_ar: string;
  grammar_point: string;
  choices: Choice[];
  correct_index: number;
  /** Why the correct answer is right — in the learner's dialect. */
  explanation_ar: string;
}

const DIFFICULTIES = [
  { id: "beginner", label: "مبتدئ", color: "text-green-600 dark:text-green-400" },
  { id: "intermediate", label: "متوسط", color: "text-yellow-600 dark:text-yellow-400" },
  { id: "advanced", label: "متقدم", color: "text-red-600 dark:text-red-400" },
];

const GrammarDrills = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { difficulty: userDifficulty } = useUserLevel();
  const { activeDialect } = useDialect();
  // Restore persisted session
  const [savedSession] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('session_grammar_drills');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_grammar_drills');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [category, setCategory] = useState<string | null>(savedSession?.category ?? null);
  const [difficulty, setDifficulty] = useState(savedSession?.difficulty ?? userDifficulty);
  const [questions, setQuestions] = useState<DrillQuestion[]>(savedSession?.questions ?? []);
  const [currentIndex, setCurrentIndex] = useState(savedSession?.currentIndex ?? 0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(savedSession?.score ?? 0);
  const [isLoading, setIsLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  // One entry per question answered, in order. The order matters to the mastery
  // ladder — finishing on a miss is treated differently from finishing on a hit
  // — so this is kept rather than derived from `score`.
  const [outcomes, setOutcomes] = useState<boolean[]>(savedSession?.outcomes ?? []);

  const { data: masteryByKey } = useGrammarMastery(activeDialect);
  const recordOutcome = useRecordGrammarOutcome();
  // Guards against a second submit if the results screen re-renders or the
  // learner navigates back into it.
  const submittedRef = useRef(false);

  const categories = useMemo(
    () => buildCategoryProgress(masteryByKey ?? new Map()),
    [masteryByKey],
  );
  const focusCategory = categories.find((c) => c.focus) ?? null;
  const resultCategory = categories.find((c) => c.id === category) ?? null;

  // Tell Ask AI which grammar point is on screen, so the panel can show it and
  // the tutor can talk about it. The explanation is withheld until the learner
  // has answered — otherwise asking the AI would give away the answer.
  const currentQuestion = questions[currentIndex] as DrillQuestion | undefined;
  const answered = selectedAnswer !== null;
  const aiContext = useMemo<PageAiContext | null>(() => {
    if (!currentQuestion) return null;
    const categoryLabel = GRAMMAR_CATEGORIES.find((c) => c.id === category)?.label;
    return {
      kind: "drill",
      title: categoryLabel ? `Grammar drill: ${categoryLabel}` : "Grammar drill",
      summary: `Working through a ${difficulty} grammar drill, question ${currentIndex + 1} of ${questions.length}.`,
      content: [
        `Grammar point: ${currentQuestion.grammar_point}`,
        `Question: ${currentQuestion.question} — ${currentQuestion.question_ar}`,
        answered && `Explanation: ${currentQuestion.explanation_ar}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }, [currentQuestion, category, difficulty, currentIndex, questions.length, answered]);

  usePageAiContext(aiContext);

  // Persist session state
  useEffect(() => {
    if (questions.length === 0) return;
    try {
      const entry = {
        data: { category, difficulty, questions, currentIndex, score, outcomes },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_grammar_drills', JSON.stringify(entry));
    } catch {}
  }, [category, difficulty, questions, currentIndex, score, outcomes]);

  const fetchDrill = async (cat: string) => {
    setIsLoading(true);
    setCategory(cat);
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setShowResult(false);
    setOutcomes([]);
    submittedRef.current = false;

    try {
      // Try pre-approved content first
      const { data: approved } = await supabase
        .from("grammar_exercises" as any)
        .select("*")
        .eq("status", "published")
        .eq("category", cat)
        .eq("difficulty", difficulty)
        .limit(10);

      if (approved && approved.length >= 3) {
        const shuffled = (approved as any[]).sort(() => Math.random() - 0.5).slice(0, 5);
        setQuestions(shuffled.map((q: any) => ({
          question: q.question ?? q.question_english ?? "",
          question_ar: q.question_ar ?? q.question_arabic ?? "",
          grammar_point: q.grammar_point,
          choices: (q.choices as any[]).map((c) => ({
            text: c.text ?? c.text_english ?? "",
            text_ar: c.text_ar ?? c.text_arabic ?? "",
          })),
          correct_index: q.correct_index,
          explanation_ar: q.explanation_ar ?? q.explanation ?? "",
        })));
        return;
      }

      // Fallback to live AI generation
      const { data, error } = await supabase.functions.invoke("grammar-drill", {
        body: { category: cat, difficulty, dialect: activeDialect },
      });
      if (error) throw error;
      if (data?.questions) {
        setQuestions(data.questions);
      } else {
        throw new Error("No questions returned");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "تعذّر توليد التمرين");
      setCategory(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = (index: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(index);
    const correct = index === questions[currentIndex].correct_index;
    if (correct) {
      setScore((s) => s + 1);
    }
    setOutcomes((prev) => [...prev, correct]);
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
    } else {
      setShowResult(true);
      finishDrill();
    }
  };

  /**
   * Send the round's answers to the mastery ladder.
   *
   * Until this existed the score was rendered on the results screen and thrown
   * away: nothing knew which structures the learner kept missing, so the next
   * drill was generated as if they'd never answered a question.
   */
  const finishDrill = () => {
    if (submittedRef.current || !category || outcomes.length === 0) return;
    submittedRef.current = true;
    recordOutcome.mutate({
      category,
      categoryLabel: GRAMMAR_CATEGORIES.find((c) => c.id === category)?.label,
      dialect: activeDialect,
      outcomes,
    });
  };

  const resetDrill = () => {
    setCategory(null);
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setShowResult(false);
    setOutcomes([]);
    submittedRef.current = false;
  };

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center space-y-4">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">سجّل الدخول للتدرب على القواعد</p>
          <Button onClick={() => navigate("/auth")}>تسجيل الدخول</Button>
        </div>
      </AppShell>
    );
  }

  // Results screen
  if (showResult) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <AppShell>
        <HomeButton />
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">أنهيت التمرين!</h1>
          <p className="text-4xl font-bold text-primary">{pct}%</p>
          <p className="text-muted-foreground">
            {score} / {questions.length} صحيحة
          </p>
          {pct >= 80 && <p className="text-sm text-green-600 dark:text-green-400">ممتاز! 🎉</p>}
          {pct >= 50 && pct < 80 && <p className="text-sm text-yellow-600 dark:text-yellow-400">جهد طيب! واصل التدريب 💪</p>}
          {pct < 50 && <p className="text-sm text-red-600 dark:text-red-400">واصل — بالتدريب يأتي الإتقان! 📚</p>}

          {/* The round's standing after this attempt, not just this attempt.
              Shown only once the write has landed — claiming a new strength
              before it saves would be a lie the next page load contradicts. */}
          {resultCategory?.strengthLabel && !recordOutcome.isPending && (
            <p className="text-sm text-muted-foreground">
              {resultCategory.labelAr}: <span className="text-foreground font-medium">{resultCategory.strengthLabel}</span>
              {" "}إجمالاً — {resultCategory.mastery?.correct}/{resultCategory.mastery?.exposures} عبر كل تمارينك.
            </p>
          )}
          <div className="flex gap-3 justify-center pt-4">
            <Button variant="outline" onClick={resetDrill}>
              <RotateCcw className="h-4 w-4 mr-2" /> تمرين جديد
            </Button>
            <Button onClick={() => fetchDrill(category!)}>
              <Sparkles className="h-4 w-4 mr-2" /> إعادة
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Active question
  if (questions.length > 0 && !isLoading) {
    const q = questions[currentIndex];
    return (
      <AppShell>
        <HomeButton />
        <div className="py-4 space-y-5">
          {/* Progress */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              سؤال {currentIndex + 1} من {questions.length}
            </span>
            <span className="text-sm font-medium text-primary">{score} صحيحة</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + (selectedAnswer !== null ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>

          {/* Grammar point badge + EN toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {q.grammar_point}
            </span>
            <button
              onClick={() => setShowEnglish((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                showEnglish
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              <Languages className="h-3.5 w-3.5" />
              ع
            </button>
          </div>

          {/* Question */}
          <div className="bg-card border border-border rounded-2xl p-5 space-y-2">
            <p className="font-english text-xl font-bold text-foreground leading-relaxed">
              {q.question}
            </p>
            {showEnglish && <p dir="rtl" className="font-arabic text-sm text-muted-foreground">{q.question_ar}</p>}
          </div>

          {/* Choices */}
          <div className="space-y-2">
            {q.choices.map((choice, i) => {
              const isCorrect = i === q.correct_index;
              const isSelected = i === selectedAnswer;
              const answered = selectedAnswer !== null;

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={answered}
                  className={cn(
                    "w-full p-4 rounded-xl border text-left",
                    "flex items-center gap-3 transition-all duration-200",
                    !answered && "hover:border-primary/40 active:scale-[0.99] cursor-pointer",
                    !answered && "bg-card border-border",
                    answered && isCorrect && "bg-green-500/10 border-green-500/40",
                    answered && isSelected && !isCorrect && "bg-red-500/10 border-red-500/40",
                    answered && !isSelected && !isCorrect && "opacity-50"
                  )}
                >
                  <div className="w-8 h-8 rounded-full border border-border flex items-center justify-center shrink-0">
                    {answered && isCorrect && <Check className="h-4 w-4 text-green-600 dark:text-green-400" />}
                    {answered && isSelected && !isCorrect && <X className="h-4 w-4 text-red-600 dark:text-red-400" />}
                    {!answered && <span className="text-xs text-muted-foreground">{String.fromCharCode(65 + i)}</span>}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-english font-semibold text-foreground">{choice.text}</p>
                    {showEnglish && <p dir="rtl" className="font-arabic text-xs text-muted-foreground">{choice.text_ar}</p>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Explanation + Next */}
          {selectedAnswer !== null && (
            <div className="space-y-3">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                <p dir="rtl" className="font-arabic text-sm text-foreground">{q.explanation_ar}</p>
              </div>
              <Button onClick={nextQuestion} className="w-full">
                {currentIndex < questions.length - 1 ? (
                  <>التالي <ChevronRight className="h-4 w-4 ml-1" /></>
                ) : (
                  "النتائج"
                )}
              </Button>
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // Category selection
  return (
    <AppShell>
      <HomeButton />
      <div className="py-4 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">تمارين القواعد <InfoHint {...PAGE_HINTS["grammar-drills"]} /></h1>
            <p className="text-sm text-muted-foreground">تدرّب على قواعد الإنجليزية التي تتعثر فيها</p>
          </div>
        </div>

        {/* Difficulty selector */}
        <div className="flex gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              onClick={() => setDifficulty(d.id)}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all",
                difficulty === d.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-muted-foreground hover:border-primary/30"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Where the ladder pays off: one concrete suggestion instead of six
            equally-weighted tiles. Silent when the learner is solid across the
            board, or signed out with no mastery to read. */}
        {!isLoading && focusCategory && (
          <p className="text-xs text-muted-foreground">
            {focusCategory.mastery
              ? <>أضعف نقاطك <strong className="text-foreground">{focusCategory.labelAr}</strong> — {focusCategory.accuracyPct}% حتى الآن. تستحق جولة أخرى.</>
              : <>لم تجرّب <strong className="text-foreground">{focusCategory.labelAr}</strong> بعد.</>}
          </p>
        )}

        {/* Category grid */}
        {isLoading ? (
          <LoadingPanel task="grammarDrill" variant="inline" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => fetchDrill(cat.id)}
                className={cn(
                  "p-4 rounded-xl bg-card border",
                  "flex flex-col items-center gap-2 text-center",
                  "transition-all duration-200",
                  "hover:border-primary/30 active:scale-[0.97]",
                  cat.focus ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
                )}
              >
                <span className="text-2xl">{cat.icon}</span>
                <p className="font-semibold text-foreground text-sm">{cat.labelAr}</p>
                <p className="font-english text-xs text-muted-foreground">{cat.label}</p>
                {/* Strength, once there's something to report. An untouched
                    category shows nothing rather than a zeroed-out bar. */}
                {cat.strengthLabel && (
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                      cat.strengthClass
                    )}
                  >
                    {cat.strengthLabel} · {cat.accuracyPct}%
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default GrammarDrills;
