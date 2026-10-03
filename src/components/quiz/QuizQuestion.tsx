import { useState, useEffect, useMemo } from "react";
import { RootChip } from "@/components/vocab/RootChip";
import { VocabularyWord } from "@/hooks/useTopic";

export type QuizMode = "multiple-choice" | "typing";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Volume2 } from "lucide-react";

interface QuizQuestionProps {
  mode: QuizMode;
  currentWord: VocabularyWord;
  otherWords: VocabularyWord[];
  gradient: string;
  onAnswer: (isCorrect: boolean, userAnswer: string) => void;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const QuizQuestion = ({
  mode,
  currentWord,
  otherWords,
  gradient,
  onAnswer,
}: QuizQuestionProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate multiple choice options - memoize to prevent reshuffling
  const options = useMemo(() => {
    const wrongAnswers = shuffleArray(otherWords)
      .slice(0, 3)
      .map((w) => w.word_english);
    return shuffleArray([currentWord.word_english, ...wrongAnswers]);
  }, [currentWord.id, otherWords]);

  // Reset state when question changes
  useEffect(() => {
    setSelectedAnswer(null);
    setTypedAnswer("");
    setShowResult(false);
    setIsCorrect(false);
  }, [currentWord.id]);

  const playAudio = () => {
    if (currentWord.audio_url && !isPlaying) {
      setIsPlaying(true);
      const audio = new Audio(currentWord.audio_url);
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => setIsPlaying(false);
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const handleMultipleChoiceSelect = (answer: string) => {
    if (showResult) return;
    
    setSelectedAnswer(answer);
    const correct = answer === currentWord.word_english;
    setIsCorrect(correct);
    setShowResult(true);
    onAnswer(correct, answer);
  };

  const handleTypingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showResult || !typedAnswer.trim()) return;
    
    const userAnswer = typedAnswer.trim().toLowerCase();
    const correctAnswer = currentWord.word_english.toLowerCase();
    const correct = userAnswer === correctAnswer;
    
    setIsCorrect(correct);
    setShowResult(true);
    onAnswer(correct, typedAnswer.trim());
  };

  return (
    <div className="w-full max-w-md">
      {/* Image and Arabic word display */}
      <div className="text-center mb-6">
        {currentWord.image_url ? (
          <div className="relative inline-block">
            <img
              src={currentWord.image_url}
              alt={currentWord.word_english}
              className={cn(
                "w-44 h-32 object-cover rounded-xl shadow-card mx-auto mb-4",
                "border border-border"
              )}
            />
            {currentWord.audio_url && (
              <button
                onClick={playAudio}
                className={cn(
                  "absolute -bottom-2 -right-2 p-2.5 rounded-full",
                  "bg-primary text-primary-foreground shadow-button",
                  "transition-all duration-200 hover:scale-110",
                  isPlaying && "animate-pulse-glow"
                )}
              >
                <Volume2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="w-44 h-32 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-muted">
            <Volume2 className="w-8 h-8 text-muted-foreground/40" />
          </div>
        )}
        
        <p className="font-naskh text-[38px] leading-[56px] mb-2" dir="rtl">
          {currentWord.word_arabic}
        </p>
        {/* Held back until the question is answered. The root of a word is a
            strong clue to its meaning, which is exactly what is being asked. */}
        {showResult && <RootChip root={currentWord.word_family} className="mb-2" />}
        <p className="text-muted-foreground text-sm font-sans">
          وش هذي بالإنجليزي؟
        </p>
      </div>

      {/* Multiple Choice Mode */}
      {mode === "multiple-choice" && (
        <div className="grid grid-cols-2 gap-3">
          {options.map((option, index) => {
            const isSelected = selectedAnswer === option;
            const isCorrectAnswer = option === currentWord.word_english;
            
            // Tint plus its own ink: the old fills put white text on a pale
            // green, which a learner could barely read at the one moment it
            // mattered.
            let buttonStyle = "bg-card shadow-soft hover:bg-muted";
            
            if (showResult) {
              if (isCorrectAnswer) {
                buttonStyle = "bg-tint-sage ring-2 ring-success text-success-ink";
              } else if (isSelected && !isCorrectAnswer) {
                buttonStyle = "bg-tint-clay ring-2 ring-destructive text-clay-ink";
              }
            } else if (isSelected) {
              buttonStyle = "bg-tint-firoza ring-2 ring-primary";
            }

            return (
              <button
                key={index}
                onClick={() => handleMultipleChoiceSelect(option)}
                disabled={showResult}
                className={cn(
                  "min-h-14 p-3 rounded-2xl font-english text-[15px] font-semibold transition-all duration-200",
                  "flex items-center justify-center gap-2",
                  buttonStyle,
                  !showResult && "hover:scale-[1.02] active:scale-[0.98]"
                )}
              >
                {showResult && isCorrectAnswer && (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                )}
                {showResult && isSelected && !isCorrectAnswer && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {option}
              </button>
            );
          })}
        </div>
      )}

      {/* Typing Mode */}
      {mode === "typing" && (
        <form onSubmit={handleTypingSubmit} className="space-y-3">
          <div className="relative">
            <Input
              type="text"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              placeholder="اكتب الكلمة بالإنجليزي…"
              disabled={showResult}
              autoFocus
              className={cn(
                "text-lg text-center py-5 rounded-xl",
                showResult && isCorrect && "border-success bg-success/10",
                showResult && !isCorrect && "border-destructive bg-destructive/10"
              )}
            />
            {showResult && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isCorrect ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
              </div>
            )}
          </div>
          
          {!showResult && (
            <Button
              type="submit"
              disabled={!typedAnswer.trim()}
              className="h-[54px] w-full text-base font-semibold rounded-2xl bg-primary text-primary-foreground"
            >
              تحقّق
            </Button>
          )}
          
          {showResult && !isCorrect && (
            <div className="text-center p-3 bg-card rounded-2xl shadow-soft">
              <p className="text-muted-foreground text-sm mb-1">الجواب الصحيح:</p>
              <p className="text-xl font-bold text-success">
                {currentWord.word_english}
              </p>
            </div>
          )}
        </form>
      )}

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-5 p-3 rounded-xl text-center text-base font-semibold",
          "animate-pop",
          isCorrect ? "bg-success/20 text-success-foreground" : "bg-destructive/20 text-destructive-foreground"
        )}>
          {isCorrect ? "صح! أحسنت" : "مو بالضبط — واصل التمرين"}
        </div>
      )}
    </div>
  );
};
