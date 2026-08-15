import { useState, useMemo, useRef, useEffect } from "react";
import { CheckCircle2, XCircle, Volume2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

interface QuizCardWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  transliteration?: string | null;
}

interface QuizCardProps {
  word: QuizCardWord;
  otherWords: QuizCardWord[];
  gradient?: string;
  onAnswer: (isCorrect: boolean) => void;
  /** Topic label to display as a tag */
  topicLabel?: string;
}

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * QuizCard - Learning quiz with multiple choice
 *
 * Shows the Arabic word with an audio button and asks the user to pick the
 * correct English translation from four options.
 */
export const QuizCard = ({ word, otherWords, onAnswer, topicLabel }: QuizCardProps) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Prevent double-click / race-condition from advancing the quiz twice
  const answeredRef = useRef(false);

  // Audio: use shared hooks for TTS generation and playback
  const { ttsUrl, isLoading: isGeneratingAudio } = useAzureTTS({
    text: word.word_arabic,
    skip: Boolean(word.audio_url),
  });
  const { isPlaying, play: playAudio } = useAudioPlayer();

  const effectiveAudioUrl = word.audio_url ?? ttsUrl;

  // Generate options only once per word (word.id and word.word_english always
  // change together so listing word.id alone is intentional)
  const options = useMemo(
    () => {
      const wrongAnswers = shuffleArray(otherWords)
        .filter(w => w.id !== word.id)
        .slice(0, 3)
        .map(w => w.word_english);
      return shuffleArray([word.word_english, ...wrongAnswers]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [word.id],
  );

  // Auto-play when the card first appears (after a short delay)
  useEffect(() => {
    answeredRef.current = false;
    const url = word.audio_url; // only auto-play if we already have the URL on mount
    if (!url) return;
    const timer = setTimeout(() => playAudio(url), 300);
    return () => clearTimeout(timer);
  }, [word.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also auto-play once on-demand generation finishes
  useEffect(() => {
    if (ttsUrl && !answeredRef.current) {
      playAudio(ttsUrl);
    }
  }, [ttsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (answer: string) => {
    if (showResult || answeredRef.current) return;
    answeredRef.current = true;

    setSelectedAnswer(answer);
    const correct = answer === word.word_english;
    setIsCorrect(correct);
    setShowResult(true);

    // Correct answers auto-advance quickly (positive reinforcement). Wrong
    // answers wait for the learner to tap Continue so they actually read
    // which option was right instead of it flashing past in 1.5s.
    if (correct) {
      setTimeout(() => {
        onAnswer(correct);
      }, 1500);
    }
  };

  const handleContinue = () => {
    onAnswer(isCorrect);
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Topic Label */}
      {topicLabel && (
        <div className="mb-3 flex justify-center">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {topicLabel}
          </span>
        </div>
      )}

      {/* Question prompt */}
      <div className="text-center mb-4">
        <p className="text-sm text-muted-foreground">وش معناها بالإنجليزي؟</p>
      </div>

      {/* Arabic word + audio button */}
      <div className="flex flex-col items-center justify-center gap-2 mb-8 p-6 rounded-2xl bg-card border border-border">
        <div className="flex items-center justify-center gap-4">
          <p className="text-5xl font-bold font-arabic leading-relaxed" dir="rtl">
            {word.word_arabic}
          </p>
          <button
            onClick={() => effectiveAudioUrl && playAudio(effectiveAudioUrl)}
            aria-label="شغّل النطق"
            aria-disabled={!effectiveAudioUrl}
            aria-busy={isGeneratingAudio}
            className={cn(
              "flex-shrink-0 p-3 rounded-full border transition-all duration-200",
              "focus:outline-none focus:ring-2 focus:ring-primary/30",
              effectiveAudioUrl
                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:scale-110"
                : "bg-muted text-muted-foreground border-border opacity-50 cursor-not-allowed",
              isPlaying && "bg-primary text-primary-foreground border-primary animate-pulse"
            )}
            disabled={!effectiveAudioUrl && !isGeneratingAudio}
          >
            {isGeneratingAudio ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>
        </div>
        {word.transliteration && (
          <p className="text-sm text-muted-foreground italic">{word.transliteration}</p>
        )}
      </div>

      {/* Multiple Choice Options */}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="اختر الترجمة الإنجليزية الصحيحة">
        {options.map((option, index) => {
          const isSelected = selectedAnswer === option;
          const isCorrectAnswer = option === word.word_english;

          let buttonStyle = "bg-card border border-border hover:border-primary/30";

          if (showResult) {
            if (isCorrectAnswer) {
              buttonStyle = "bg-success/10 border border-success";
            } else if (isSelected && !isCorrectAnswer) {
              buttonStyle = "bg-destructive/10 border border-destructive";
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleSelect(option)}
              disabled={showResult}
              role="radio"
              aria-checked={isSelected ?? false}
              aria-label={option}
              className={cn(
                "p-3 rounded-lg text-sm transition-all duration-200",
                "flex items-center justify-center gap-2",
                buttonStyle
              )}
            >
              {showResult && isCorrectAnswer && (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
              {showResult && isSelected && !isCorrectAnswer && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-foreground">{option}</span>
            </button>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div className={cn(
          "mt-4 p-3 rounded-lg text-center text-sm font-medium",
          "animate-in fade-in zoom-in-95 duration-300",
          isCorrect
            ? "bg-success/10 text-success"
            : "bg-destructive/10 text-destructive"
        )}>
          {isCorrect
            ? "Correct! أحسنت"
            : `Not quite — "${word.word_arabic}" means "${word.word_english}", not "${selectedAnswer}"`}
        </div>
      )}

      {/* Wrong answers wait for the learner to acknowledge before advancing */}
      {showResult && !isCorrect && (
        <button
          onClick={handleContinue}
          className="mt-3 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity animate-in fade-in duration-300"
        >
          كمّل
        </button>
      )}
    </div>
  );
};
