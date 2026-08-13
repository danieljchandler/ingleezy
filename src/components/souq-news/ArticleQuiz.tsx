import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Brain } from "lucide-react";

interface QuizChoice {
  arabic: string;
  english: string;
  correct: boolean;
}

interface QuizQuestion {
  question_arabic: string;
  question_english: string;
  choices: QuizChoice[];
  explanation: string;
}

interface ArticleQuizProps {
  article: {
    title_dialect: string;
    body_dialect: string;
    title_english: string;
    summary_english: string;
  };
}

export const ArticleQuiz = ({ article }: ArticleQuizProps) => {
  const { activeDialect } = useDialect();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const startQuiz = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("souq-news-quiz", {
        body: {
          dialect: activeDialect,
          title_dialect: article.title_dialect,
          body_dialect: article.body_dialect,
          title_english: article.title_english,
          summary_english: article.summary_english,
        },
      });
      if (error) throw error;
      if (data?.questions && Array.isArray(data.questions)) {
        setQuestions(data.questions);
        setCurrentQ(0);
        setSelected(null);
        setScore(0);
        setFinished(false);
      }
    } catch (e) {
      console.error("Quiz error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    if (questions![currentQ].choices[idx].correct) {
      setScore((s) => s + 1);
    }
  };

  const nextQuestion = () => {
    if (currentQ < questions!.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelected(null);
    } else {
      setFinished(true);
    }
  };

  const reset = () => {
    setQuestions(null);
    setCurrentQ(0);
    setSelected(null);
    setScore(0);
    setFinished(false);
  };

  // Not started
  if (!questions) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={startQuiz}
        disabled={loading}
        className="text-xs gap-1.5"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Brain className="h-3 w-3" />
        )}
        {loading ? "Generating quiz…" : "Test Comprehension"}
      </Button>
    );
  }

  // Finished
  if (finished) {
    return (
      <div className="mt-3 rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="text-center">
          <p className="text-lg font-bold text-foreground">
            {score}/{questions.length}
          </p>
          <p className="text-sm text-muted-foreground">
            {score === questions.length
              ? "Perfect! You understood everything 🎉"
              : score >= Math.ceil(questions.length / 2)
              ? "Good job! Keep reading 💪"
              : "Try re-reading the article and quiz again 📖"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reset} className="w-full text-xs">
          Close Quiz
        </Button>
      </div>
    );
  }

  // Active question
  const q = questions[currentQ];

  return (
    <div className="mt-3 rounded-xl bg-card border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Question {currentQ + 1}/{questions.length}
        </p>
        <p className="text-xs font-medium text-primary">{score} correct</p>
      </div>

      {/* Question */}
      <p
        className="text-sm font-semibold text-foreground leading-relaxed font-arabic"
        dir="rtl"
        style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
      >
        {q.question_arabic}
      </p>
      <p className="text-xs text-muted-foreground">{q.question_english}</p>

      {/* Choices */}
      <div className="space-y-2">
        {q.choices.map((choice, idx) => {
          const isSelected = selected === idx;
          const showResult = selected !== null;
          const isCorrect = choice.correct;

          return (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              disabled={selected !== null}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition-all text-sm",
                showResult && isCorrect
                  ? "border-green-500 bg-green-500/10"
                  : showResult && isSelected && !isCorrect
                  ? "border-red-500 bg-red-500/10"
                  : !showResult
                  ? "border-border hover:border-primary/40 bg-background"
                  : "border-border bg-background opacity-60"
              )}
            >
              <div className="flex items-start gap-2">
                {showResult && isCorrect && (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                )}
                {showResult && isSelected && !isCorrect && (
                  <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-arabic" dir="rtl" style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}>
                    {choice.arabic}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{choice.english}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Explanation + Next */}
      {selected !== null && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
            💡 {q.explanation}
          </p>
          <Button size="sm" onClick={nextQuestion} className="w-full text-xs">
            {currentQ < questions.length - 1 ? "Next Question" : "See Results"}
          </Button>
        </div>
      )}
    </div>
  );
};
