import { TopicWithWords, VocabularyWord } from "@/hooks/useTopic";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { cn } from "@/lib/utils";
import { Trophy, RotateCcw, Home, CheckCircle2, XCircle } from "lucide-react";

interface QuizResultsProps {
  topic: TopicWithWords;
  quizState: {
    score: number;
    answers: { word: VocabularyWord; correct: boolean; userAnswer?: string }[];
  };
  onRestart: () => void;
  onHome: () => void;
}

export const QuizResults = ({ topic, quizState, onRestart, onHome }: QuizResultsProps) => {
  const total = quizState.answers.length;
  /**
   * Zero answers is not zero percent.
   *
   * `score / answers.length` is 0/0 for an empty quiz, and every band
   * comparison against NaN is false, so the chain fell through to the worst
   * one: "Try again!" over "NaN% correct". A topic whose words were all
   * deleted, or a quiz abandoned before the first answer, landed there — and
   * the learner was told they had failed a quiz they never took.
   */
  const percentage = total > 0 ? Math.round((quizState.score / total) * 100) : 0;

  let message = "";

  if (total === 0) {
    message = "No questions to score";
  } else if (percentage === 100) {
    message = "Perfect! ممتاز";
  } else if (percentage >= 80) {
    message = "Great job! أحسنت";
  } else if (percentage >= 60) {
    message = "Good effort! جيد";
  } else if (percentage >= 40) {
    message = "Keep practicing! استمر";
  } else {
    message = "Try again! حاول مرة أخرى";
  }

  return (
    <AppShell compact>
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-block px-4 py-2 rounded-lg bg-card border border-border">
          <span className="text-sm font-semibold text-foreground font-arabic">
            {topic.name_arabic}
          </span>
        </div>
      </div>

      <div className="max-w-sm mx-auto">
        {/* Score card */}
        <div className="text-center mb-8">
          <Trophy className={cn(
            "h-14 w-14 mx-auto mb-4",
            percentage >= 80 ? "text-primary" : "text-muted-foreground"
          )} />
          
          <h2 className="text-xl font-bold mb-2 text-foreground">{message}</h2>
          
          <div className="text-4xl font-bold my-4 text-foreground">
            {quizState.score} / {total}
          </div>

          {total > 0 && (
            <p className="text-muted-foreground">
              {percentage}% correct
            </p>
          )}
        </div>

        {/* Answer review */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 text-center">
            Review Answers
          </h3>
          <div className="space-y-2">
            {quizState.answers.map((answer, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg",
                  answer.correct ? "bg-success/5" : "bg-destructive/5"
                )}
              >
                {answer.correct ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground font-arabic" dir="rtl">
                    {answer.word.word_arabic}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {answer.correct ? (
                      answer.word.word_english
                    ) : (
                      <>
                        {answer.userAnswer && (
                          <>
                            <span className="text-destructive line-through">{answer.userAnswer}</span>
                            {" → "}
                          </>
                        )}
                        <span className="text-success">{answer.word.word_english}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <Button onClick={onRestart} variant="outline" className="w-full">
            <RotateCcw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
          <Button onClick={onHome} className="w-full">
            <Home className="h-4 w-4 mr-2" />
            Back to Topics
          </Button>
        </div>
      </div>
    </AppShell>
  );
};
