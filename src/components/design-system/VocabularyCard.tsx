import { useCallback, useEffect, useState } from "react";
import { Volume2, RotateCcw, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

export interface VocabularyWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  image_position?: string | null;
  transliteration?: string | null;
  /** Arabic root. Null until looked up; '' means the word has none. */
  root?: string | null;
}

interface VocabularyCardProps {
  word: VocabularyWord;
  /** Show answer text below the card */
  showAnswer?: boolean;
  /** Show tap hint overlay */
  showTapHint?: boolean;
  /** Hint text to display */
  hintText?: string;
  /** Show repeat button */
  showRepeatButton?: boolean;
  /** Callback when card is clicked */
  onCardClick?: () => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * VocabularyCard - Unified vocabulary display component
 * 
 * Use this component for all vocabulary word displays including:
 * - Flashcards
 * - Review cards
 * - Intro cards
 * - Quiz cards (image portion)
 */
export const VocabularyCard = ({
  word,
  showAnswer = false,
  showTapHint = false,
  hintText = "Tap to hear",
  showRepeatButton = false,
  onCardClick,
  className,
}: VocabularyCardProps) => {
  // Audio: use shared hooks for TTS generation and playback
  const { ttsUrl, isLoading } = useAzureTTS({
    text: word.word_arabic,
    skip: Boolean(word.audio_url),
  });
  const { isPlaying, play: playUrl } = useAudioPlayer();

  const playAudio = useCallback(() => {
    if (word.audio_url) {
      playUrl(word.audio_url);
    } else if (ttsUrl) {
      playUrl(ttsUrl);
    }
  }, [word.audio_url, ttsUrl, playUrl]);

  const handleClick = () => {
    playAudio();
    onCardClick?.();
  };

  return (
    <div className={cn("relative w-full max-w-md mx-auto", className)}>
      {/* Main Card */}
      <button
        onClick={handleClick}
        className={cn(
          "relative w-full aspect-[4/3] rounded-xl overflow-hidden",
          "transform transition-all duration-200",
          "hover:scale-[1.02] active:scale-95",
          "shadow-card",
          "bg-card border border-border",
          "focus:outline-none focus:ring-2 focus:ring-primary/50"
        )}
      >
        {/* Image Container */}
        <div className="absolute inset-3 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
          {word.image_url ? (
            <img
              src={word.image_url}
              alt=""
              className="w-full h-full object-contain"
              style={{ 
                objectPosition: word.image_position 
                  ? `${word.image_position.split(' ')[0]}% ${word.image_position.split(' ')[1]}%`
                  : '50% 50%' 
              }}
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted-foreground/10 flex items-center justify-center">
              <Volume2 className="w-8 h-8 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Loading indicator overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-primary">
              <Loader2 className="w-10 h-10 text-primary-foreground animate-spin" />
            </div>
          </div>
        )}

        {/* Playing indicator overlay */}
        {isPlaying && !isLoading && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-primary animate-pulse-glow">
              <Volume2 className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
        )}

        {/* Tap hint */}
        {showTapHint && !isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-5 py-2.5 rounded-full bg-primary shadow-lg animate-bounce-gentle">
              <span className="text-primary-foreground font-semibold text-base flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                {hintText}
              </span>
            </div>
          </div>
        )}

        {/* Sound icon badge */}
        <div className="absolute top-3 right-3 w-10 h-10 rounded-lg flex items-center justify-center bg-primary shadow-lg">
          <Volume2 className="w-5 h-5 text-primary-foreground" />
        </div>
      </button>

      {/* Answer Display */}
      {showAnswer && (
        <AnswerReveal
          arabic={word.word_arabic}
          english={word.word_english}
          transliteration={word.transliteration}
          onReveal={playAudio}
        />
      )}

      {/* Repeat Button */}
      {showRepeatButton && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            playAudio();
          }}
          className={cn(
            "absolute -bottom-5 left-1/2 transform -translate-x-1/2",
            "w-12 h-12 rounded-full",
            "flex items-center justify-center",
            "bg-primary shadow-button",
            "transition-all duration-200",
            "hover:scale-110 active:scale-95",
            isPlaying && "animate-wiggle"
          )}
        >
          <RotateCcw className="w-6 h-6 text-primary-foreground" />
        </button>
      )}

    </div>
  );
};

/**
 * AnswerReveal — shows the English word and lets the learner produce the Arabic
 * themselves before optionally revealing the script. Arabic is hidden by default.
 */
const AnswerReveal = ({ arabic, english, transliteration, onReveal }: { arabic: string; english: string; transliteration?: string | null; onReveal?: () => void }) => {
  const [showArabic, setShowArabic] = useState(false);
  // Reset to hidden whenever a new word is shown
  useEffect(() => {
    setShowArabic(false);
  }, [arabic]);

  return (
    <div className="mt-5 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
      <p className="text-base text-muted-foreground font-sans mb-3">{english}</p>
      {showArabic ? (
        <>
          <p
            className="text-4xl font-bold text-foreground mb-1 font-arabic leading-relaxed animate-in fade-in duration-200"
            dir="rtl"
          >
            {arabic}
          </p>
          {transliteration && (
            <p className="text-sm text-muted-foreground italic mb-2">{transliteration}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground/70 italic mb-2">
          Try saying it in Arabic, then reveal
        </p>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowArabic((v) => {
            const next = !v;
            if (next) onReveal?.();
            return next;
          });
        }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline focus:outline-none"
      >
        {showArabic ? (
          <>
            <EyeOff className="w-4 h-4" /> Hide Arabic
          </>
        ) : (
          <>
            <Eye className="w-4 h-4" /> Show Arabic
          </>
        )}
      </button>
    </div>
  );
};
