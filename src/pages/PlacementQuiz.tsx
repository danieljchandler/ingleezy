import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { DIALECT_LABELS } from "@/config";
import { AppShell } from "@/components/layout/AppShell";
import { CaravanMedallion } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Languages,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ArrowRight,
  Brain,
  BookOpen,
  Mic,
  PenTool,
} from "lucide-react";

type Choice = { text: string; text_arabic: string };
type Question = {
  question_arabic: string;
  question_english: string;
  skill_type: string;
  difficulty: string;
  choices: Choice[];
  correct_index: number;
};
type AnswerRecord = { correct: boolean; difficulty: string; skill_type: string };

const SKILL_ICONS: Record<string, typeof Brain> = {
  vocabulary: BookOpen,
  grammar: PenTool,
  reading: Brain,
  translation: Mic,
};

const CEFR_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  A1: { label: "Beginner", desc: "You can understand and use basic everyday expressions and simple phrases." },
  A2: { label: "Elementary", desc: "You can communicate in simple, routine tasks and describe your background." },
  B1: { label: "Intermediate", desc: "You can deal with most situations while traveling and describe experiences." },
  B2: { label: "Upper Intermediate", desc: "You can interact fluently with native speakers and understand complex texts." },
  C1: { label: "Advanced", desc: "You can express yourself fluently and use language flexibly for social and academic purposes." },
  C2: { label: "Mastery", desc: "You can understand virtually everything and express yourself spontaneously with precision." },
};

const TOTAL_QUESTIONS = 20;
const BATCH_SIZE = 5;

export default function PlacementQuiz() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDialect } = useDialect();

  const [phase, setPhase] = useState<"intro" | "quiz" | "results">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [results, setResults] = useState<{
    cefr_level: string;
    confidence: number;
    strengths: string[];
    weaknesses: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchBatch = useCallback(
    async (questionNumber: number, history: AnswerRecord[]) => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("placement-quiz", {
          body: {
            action: "generate",
            current_difficulty: history.length > 0 ? undefined : "B1",
            question_number: questionNumber,
            history,
            dialect: activeDialect,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (!data?.questions?.length) throw new Error("No questions received");
        return data.questions as Question[];
      } catch (e: any) {
        console.error("Failed to fetch questions:", e);
        toast.error("Failed to load questions", { description: e.message || "Please try again." });
        return null;
      } finally {
        setLoading(false);
      }
    },
    [activeDialect]
  );

  const startQuiz = async () => {
    const batch = await fetchBatch(0, []);
    if (batch) {
      setQuestions(batch);
      setCurrentIndex(0);
      setAnswers([]);
      setPhase("quiz");
    }
  };

  const handleAnswer = async (choiceIdx: number) => {
    if (showFeedback || selectedChoice !== null) return;
    const q = questions[currentIndex];
    const isCorrect = choiceIdx === q.correct_index;
    setSelectedChoice(choiceIdx);
    setShowFeedback(true);

    const newAnswer: AnswerRecord = {
      correct: isCorrect,
      difficulty: q.difficulty,
      skill_type: q.skill_type,
    };
    const updatedAnswers = [...answers, newAnswer];
    setAnswers(updatedAnswers);

    // After feedback delay, advance
    setTimeout(async () => {
      const nextGlobalIdx = updatedAnswers.length;
      setShowFeedback(false);
      setSelectedChoice(null);

      if (nextGlobalIdx >= TOTAL_QUESTIONS) {
        // Quiz complete — score it
        setLoading(true);
        try {
          const { data, error } = await supabase.functions.invoke("placement-quiz", {
            // dialect: the server appends this run to placement_history (C4).
            body: { action: "score", history: updatedAnswers, dialect: activeDialect },
          });
          if (error) throw error;
          setResults(data);
          setPhase("results");
        } catch (e: any) {
          toast.error("Failed to calculate results");
          // Fallback client-side scoring
          setResults({
            cefr_level: "B1",
            confidence: 50,
            strengths: ["general_comprehension"],
            weaknesses: [],
          });
          setPhase("results");
        } finally {
          setLoading(false);
        }
        return;
      }

      // Need next batch?
      if (nextGlobalIdx % BATCH_SIZE === 0) {
        const nextBatch = await fetchBatch(nextGlobalIdx, updatedAnswers);
        if (nextBatch) {
          setQuestions(nextBatch);
          setCurrentIndex(0);
        }
      } else {
        setCurrentIndex((i) => i + 1);
      }
    }, 1500);
  };

  const saveAndContinue = async () => {
    if (!results || !user) {
      navigate("/");
      return;
    }
    setSaving(true);
    try {
      const dialectKey = activeDialect.toLowerCase(); // gulf | egyptian | yemeni
      const nowIso = new Date().toISOString();
      const updates: Record<string, unknown> = {
        // Per-dialect placement
        [`placement_level_${dialectKey}`]: results.cefr_level,
        [`placement_taken_at_${dialectKey}`]: nowIso,
        // Keep legacy fields in sync for backwards-compat with older code paths
        placement_level: results.cefr_level,
        placement_taken_at: nowIso,
        proficiency_level: results.cefr_level === "A1" ? "beginner"
          : results.cefr_level === "A2" ? "elementary"
          : results.cefr_level === "B1" ? "intermediate"
          : "advanced",
      };
      const { error } = await supabase
        .from("profiles")
        .update(updates as any)
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success(`${DIALECT_LABELS[activeDialect]} level set to ${results.cefr_level}!`);
      navigate("/");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save results");
    } finally {
      setSaving(false);
    }
  };

  const globalQuestionNum = answers.length + 1;
  const currentQuestion = questions[currentIndex];
  const SkillIcon = currentQuestion ? (SKILL_ICONS[currentQuestion.skill_type] || Brain) : Brain;

  return (
    <AppShell>
      <div className="max-w-lg mx-auto px-4 py-6 min-h-[80vh] flex flex-col">
        {/* ─── INTRO ─── */}
        {phase === "intro" && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
            {/* The caravan: this screen is the one about where you are on the road. */}
            <CaravanMedallion className="max-w-[200px] sm:max-w-[240px]" />
            <div>
              <h1 className="text-3xl font-bold font-heading text-foreground mb-3">
                English Placement
              </h1>
              <p className="text-muted-foreground leading-relaxed max-w-sm">
                No matter where you are in your English journey, we'll get you to the right test to show you exactly where you stand right now.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mt-3">
                Answer 20 adaptive questions to find your CEFR level, with <span className="font-semibold">{DIALECT_LABELS[activeDialect]}</span> support a toggle away.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-primary">20</p>
                <p className="text-xs text-muted-foreground">Questions</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-primary">~5 min</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 w-full">
              <Button onClick={startQuiz} disabled={loading} className="w-full h-12 text-base">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Start Quiz"}
              </Button>
              <Button variant="ghost" onClick={() => navigate(-1)} className="text-muted-foreground">
                Go Back
              </Button>
            </div>
          </div>
        )}

        {/* ─── QUIZ ─── */}
        {phase === "quiz" && (
          <div className="flex-1 flex flex-col animate-in fade-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-muted-foreground">
                Question {globalQuestionNum} / {TOTAL_QUESTIONS}
              </p>
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <Switch checked={showEnglish} onCheckedChange={setShowEnglish} />
              </div>
            </div>
            <Progress value={(answers.length / TOTAL_QUESTIONS) * 100} className="h-2 mb-6" />

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                  <p className="text-sm text-muted-foreground">Loading next questions…</p>
                </div>
              </div>
            ) : currentQuestion ? (
              <div className="flex-1 flex flex-col" key={`${answers.length}-${currentIndex}`}>
                {/* Skill badge + difficulty */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1 rounded-full capitalize">
                    <SkillIcon className="h-3.5 w-3.5" />
                    {currentQuestion.skill_type}
                  </span>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
                    {currentQuestion.difficulty}
                  </span>
                </div>

                {/* Question */}
                <div className="bg-card border border-border rounded-2xl p-5 mb-6">
                  <p className="text-xl font-semibold text-foreground leading-relaxed font-english">
                    {currentQuestion.question_english}
                  </p>
                  {showEnglish && (
                    <p className="text-sm text-muted-foreground mt-2 font-arabic" dir="rtl">
                      {currentQuestion.question_arabic}
                    </p>
                  )}
                </div>

                {/* Choices */}
                <div className="space-y-3 flex-1">
                  {currentQuestion.choices.map((choice, idx) => {
                    const isSelected = selectedChoice === idx;
                    const isCorrect = idx === currentQuestion.correct_index;
                    let borderClass = "border-border bg-card hover:border-primary/40";
                    if (showFeedback) {
                      if (isCorrect) borderClass = "border-green-500 bg-green-50 dark:bg-green-950/30";
                      else if (isSelected && !isCorrect) borderClass = "border-destructive bg-red-50 dark:bg-red-950/30";
                      else borderClass = "border-border bg-card opacity-50";
                    } else if (isSelected) {
                      borderClass = "border-primary bg-primary/5";
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(idx)}
                        disabled={showFeedback || selectedChoice !== null}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 text-left",
                          borderClass
                        )}
                      >
                        <span className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground font-english">
                            {choice.text}
                          </p>
                          {showEnglish && (
                            <p className="text-sm text-muted-foreground font-arabic" dir="rtl">{choice.text_arabic}</p>
                          )}
                        </div>
                        {showFeedback && isCorrect && (
                          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                        )}
                        {showFeedback && isSelected && !isCorrect && (
                          <XCircle className="h-5 w-5 text-destructive shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ─── RESULTS ─── */}
        {phase === "results" && results && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
            <div className="bg-primary/10 rounded-full p-6">
              <CheckCircle2 className="h-12 w-12 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Your level is</p>
              <h1 className="text-5xl font-bold font-heading text-primary mb-2">
                {results.cefr_level}
              </h1>
              <p className="text-lg font-semibold text-foreground">
                {CEFR_DESCRIPTIONS[results.cefr_level]?.label || results.cefr_level}
              </p>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                {CEFR_DESCRIPTIONS[results.cefr_level]?.desc}
              </p>
            </div>

            {/* Score breakdown */}
            <div className="w-full max-w-sm space-y-3">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-sm text-muted-foreground mb-1">Confidence</p>
                <Progress value={results.confidence} className="h-2 mb-1" />
                <p className="text-xs text-muted-foreground text-right">{results.confidence}%</p>
              </div>

              {results.strengths.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-foreground mb-2">💪 Strengths</p>
                  <div className="flex flex-wrap gap-2">
                    {results.strengths.map((s) => (
                      <span
                        key={s}
                        className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs px-2.5 py-1 rounded-full capitalize"
                      >
                        {s.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {results.weaknesses.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 text-left">
                  <p className="text-sm font-semibold text-foreground mb-2">📈 Areas to improve</p>
                  <div className="flex flex-wrap gap-2">
                    {results.weaknesses.map((w) => (
                      <span
                        key={w}
                        className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs px-2.5 py-1 rounded-full capitalize"
                      >
                        {w.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 w-full max-w-sm">
              <Button onClick={saveAndContinue} disabled={saving} className="w-full h-12 text-base">
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    ابدأ التعلم <ArrowRight className="h-5 w-5 ml-1" />
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPhase("intro");
                  setResults(null);
                  setAnswers([]);
                  setQuestions([]);
                }}
                className="text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Retake Quiz
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
