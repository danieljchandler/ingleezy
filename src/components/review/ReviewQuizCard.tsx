import { useState, useMemo, useCallback } from "react";
import { VocabularyWord } from "@/hooks/useReview";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Volume2 } from "lucide-react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

interface ReviewQuizCardProps {
  word: VocabularyWord;
  /** Words from the same topic, used as distractors. If fewer than 3 are
   *  available, `fallbackWords` (words from other topics) are used to pad. */
  topicWords: VocabularyWord[];
  /** Optional pool of words from all topics for distractor fallback */
  fallbackWords?: VocabularyWord[];
  onAnswer: (correct: boolean) => void;
  disabled?: boolean;
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
 * ReviewQuizCard - Second quiz mode used during spaced repetition review.
 *
 * Shows the word image (no audio), then asks the user to select the correct
 * Arabic word from 4 options. Each option has a play button to hear the word.
 */
export const ReviewQuizCard = ({
  word,
  topicWords,
  fallbackWords = [],
  onAnswer,
  disabled,
}: ReviewQuizCardProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const { play: playAudioUrl } = useAudioPlayer();

  // Build up to 4 options: correct word + up to 3 distractors (full word objects
  // so we have access to word_arabic and audio_url for each option).
  // Memoised on word id so options don't reshuffle on re-renders.
  const options = useMemo(() => {
    const sameTopicPool = shuffleArray(topicWords.filter((w) => w.id !== word.id));
    const fallbackPool = shuffleArray(fallbackWords.filter((w) => w.id !== word.id));
    const distractors = [...sameTopicPool, ...fallbackPool].slice(0, 3);
    return shuffleArray([word, ...distractors]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  const handleSelect = (option: VocabularyWord) => {
    if (showResult || disabled) return;
    const correct = option.id === word.id;
    setSelectedId(option.id);
    setShowResult(true);
    onAnswer(correct);
  };

  const playOptionAudio = useCallback((option: VocabularyWord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!option.audio_url) return;
    playAudioUrl(option.audio_url);
  }, [playAudioUrl]);

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Image only – no audio interaction */}
      <div className="rounded-xl overflow-hidden border border-border bg-card aspect-[4/3] flex items-center justify-center mb-6">
        {word.image_url ? (
          <img
            src={word.image_url}
            alt=""
            className="w-full h-full object-contain"
            style={{
              objectPosition: word.image_position
                ? `${word.image_position.split(" ")[0]}% ${word.image_position.split(" ")[1]}%`
                : "50% 50%",
            }}
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-muted-foreground/10 flex items-center justify-center">
            <Volume2 className="w-8 h-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Arabic multiple-choice options with play buttons */}
      <p className="text-center text-sm text-muted-foreground mb-3">
        Which word matches the picture?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = selectedId === option.id;
          const isCorrectAnswer = option.id === word.id;

          let style = "bg-card border border-border hover:border-primary";
          if (showResult) {
            if (isCorrectAnswer) {
              style = "bg-success/20 border-2 border-success";
            } else if (isSelected && !isCorrectAnswer) {
              style = "bg-destructive/20 border-2 border-destructive";
            }
          }

          return (
            <div
              key={option.id}
              role="button"
              tabIndex={showResult || disabled ? -1 : 0}
              onClick={!showResult && !disabled ? () => handleSelect(option) : undefined}
              onKeyDown={
                !showResult && !disabled
                  ? (e) => e.key === "Enter" && handleSelect(option)
                  : undefined
              }
              aria-disabled={showResult || disabled}
              className={cn(
                "p-3 rounded-xl text-sm font-medium transition-all duration-200",
                "flex items-center justify-between gap-2",
                style,
                !showResult && !disabled && "cursor-pointer hover:scale-[1.02] active:scale-[0.98]",
                (showResult || disabled) && "cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {showResult && isCorrectAnswer && (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                )}
                {showResult && isSelected && !isCorrectAnswer && (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <span className="text-lg font-bold font-arabic truncate" dir="rtl">
                  {option.word_arabic}
                </span>
              </div>
              <button
                onClick={(e) => playOptionAudio(option, e)}
                disabled={!option.audio_url}
                aria-label={`Play ${option.word_arabic}`}
                className={cn(
                  "p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 shrink-0",
                  "transition-colors duration-150",
                  !option.audio_url && "opacity-40 cursor-not-allowed"
                )}
              >
                <Volume2 className="h-4 w-4 text-primary" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Result feedback */}
      {showResult && (
        <div
          className={cn(
            "mt-4 p-3 rounded-xl text-center text-sm font-semibold",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
            selectedId === word.id
              ? "bg-success/20 text-success-foreground"
              : "bg-destructive/20 text-destructive-foreground"
          )}
        >
          {selectedId === word.id
            ? "Correct! أحسنت"
            : `The answer was: ${word.word_arabic}`}
        </div>
      )}
    </div>
  );
};
