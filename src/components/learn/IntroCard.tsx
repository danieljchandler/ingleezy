import { useState, useRef, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/design-system";
import { VocabularyCard, type VocabularyWord } from "@/components/design-system";
import { RootChip } from "@/components/vocab/RootChip";

interface IntroCardProps {
  word: VocabularyWord;
  gradient?: string;
  onContinue: () => void;
  /** Topic label to display as a tag */
  topicLabel?: string;
}

/**
 * IntroCard - Word introduction before quiz
 * 
 * Clean, focused presentation of vocabulary with audio.
 */
export const IntroCard = ({ word, onContinue, topicLabel }: IntroCardProps) => {
  const [showArabic, setShowArabic] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset reveal state on new word. Do NOT auto-play audio — the learner should
  // try to produce the meaning themselves first, then tap "ورّني العربي" to see it.
  useEffect(() => {
    setShowArabic(false);
  }, [word.id]);

  const playStoredAudio = () => {
    if (word.audio_url && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto text-center">
      {/* Topic Label */}
      {topicLabel && (
        <div className="mb-3 flex justify-center">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
            {topicLabel}
          </span>
        </div>
      )}

      {/* Word Card */}
      <div className="mb-6">
        {/*
          The tap plays. Its only action used to be setting a `hasPlayed` flag
          that nothing read — so the "hear again" hint was untrue even
          for a word that had a recording.
        */}
        <VocabularyCard
          word={word}
          showTapHint={false}
          onCardClick={playStoredAudio}
        />
      </div>

      {/* Arabic Word Display - hidden until revealed */}
      <div className="mb-3 py-4 px-5 rounded-xl bg-card border border-border">
        {showArabic ? (
          <div className="animate-in fade-in duration-200">
            <p
              className="text-2xl font-bold text-foreground font-arabic leading-relaxed"
              dir="rtl"
            >
              {word.word_arabic}
            </p>
            {/* Under the Arabic, not beside it: the family is context for a
                word the learner has just chosen to see, never a hint before
                that. */}
            <RootChip root={word.word_family} className="mt-1.5" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 italic">
            جرّب تقول معناها، بعدين اكشفها
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setShowArabic((v) => {
              const next = !v;
              if (next) playStoredAudio();
              return next;
            });
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline focus:outline-none"
        >
          {showArabic ? (
            <><EyeOff className="w-4 h-4" /> أخفِ العربي</>
          ) : (
            <><Eye className="w-4 h-4" /> ورّني العربي</>
          )}
        </button>
      </div>

      {/* English Translation */}
      <div className="mb-6 py-3 px-5 rounded-xl bg-card border border-border">
        <p className="text-xs text-muted-foreground/70 mb-1 tracking-wide">
          بالإنجليزي
        </p>
        <p className="text-sm text-muted-foreground font-english">
          {word.word_english}
        </p>
      </div>

      {/*
        Only for a word that has audio. This was unconditional, so a lesson
        imported without recordings — the normal state of a freshly authored one
        — promised audio on every word and the tap did nothing at all.
      */}
      <p className="text-sm text-muted-foreground mb-6">
        {word.audio_url ? "اضغط البطاقة تسمعها مرة ثانية" : "\u00A0"}
      </p>

      {/* Continue Button */}
      <Button onClick={onContinue} className="w-full">
        كمّل للاختبار
      </Button>

      {/* Hidden Audio Element */}
      {word.audio_url && (
        <audio
          ref={audioRef}
          src={word.audio_url}
          preload="auto"
        />
      )}
    </div>
  );
};
