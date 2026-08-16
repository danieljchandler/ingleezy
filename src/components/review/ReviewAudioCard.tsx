import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, Headphones, Loader2, Volume2 } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  /** Recorded audio, when the word has any. TTS fills in otherwise. */
  audioUrl?: string | null;
  /**
   * The word's own dialect. Needed because /review has a "Mix All" mode that
   * serves cards from every dialect — falling back to the ambient active
   * dialect would synthesise an Egyptian word with a Gulf voice.
   */
  dialect?: string | null;
  /** Revealed state is owned by the review page so rating can gate on it. */
  showAnswer: boolean;
  onReveal: () => void;
  /**
   * Called once with the synthesised blob the first time TTS runs, so the
   * caller can persist it and skip the synthesis on later reviews.
   */
  onAudioGenerated?: (blob: Blob) => Promise<void> | void;
}

/**
 * Listening-recall card: hear the English word, recall what it means.
 *
 * Recognising a written word tells you very little about whether you'd catch
 * it in speech — and catching spoken English is the whole point. The text is
 * deliberately hidden until the learner reveals, so the only route to the
 * answer is the audio.
 */
export const ReviewAudioCard = ({
  wordArabic,
  wordEnglish,
  audioUrl,
  dialect,
  showAnswer,
  onReveal,
  onAudioGenerated,
}: Props) => {
  const { activeDialect } = useDialect();
  const voiceDialect = dialect ?? activeDialect;
  const [hasPlayed, setHasPlayed] = useState(false);
  const autoPlayedFor = useRef<string | null>(null);

  const { ttsUrl, isLoading, regenerate } = useAzureTTS({
    text: wordEnglish,
    skip: Boolean(audioUrl),
    // The audio is the English target word — dialect voice routing is for
    // Arabic scaffold audio only, so pin an English voice instead.
    voice: "en-US-JennyNeural",
    persist: onAudioGenerated,
  });
  const { isPlaying, play } = useAudioPlayer();

  const playableUrl = audioUrl || ttsUrl;

  const playWord = useCallback(() => {
    if (!playableUrl) return;
    setHasPlayed(true);
    play(playableUrl);
  }, [playableUrl, play]);

  // Play once automatically when the card's audio becomes available — the card
  // is unanswerable in silence. Guarded so a re-render never replays mid-listen.
  //
  // The key includes the dialect, not just the word: in Mix All the queue spans
  // dialects, so the same word can appear twice with different audio. Keying
  // on the word alone would leave the second card silent.
  const autoPlayKey = `${wordEnglish} ${voiceDialect}`;
  useEffect(() => {
    if (!playableUrl) return;
    if (autoPlayedFor.current === autoPlayKey) return;
    autoPlayedFor.current = autoPlayKey;
    setHasPlayed(true);
    play(playableUrl);
  }, [playableUrl, autoPlayKey, play]);

  return (
    <div className="rounded-2xl bg-card border border-border p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
        <Headphones className="h-3.5 w-3.5" />
        استمع
      </div>

      <button
        type="button"
        onClick={playWord}
        disabled={!playableUrl}
        aria-label="أعد تشغيل الكلمة"
        className={cn(
          "mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all duration-200",
          playableUrl
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-95"
            : "border-border bg-muted cursor-not-allowed",
          isPlaying && "border-primary bg-primary/10",
        )}
      >
        {isLoading ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <Volume2
            className={cn("h-8 w-8", playableUrl ? "text-primary" : "text-muted-foreground")}
          />
        )}
      </button>

      <p className="text-sm text-muted-foreground mb-6">
        {isLoading
          ? "جارٍ تجهيز الصوت…"
          : playableUrl
          ? hasPlayed
            ? "ماذا تعني؟"
            : "المس للاستماع"
          : "لا يتوفر صوت لهذه الكلمة"}
      </p>

      {showAnswer ? (
        <div className="animate-in fade-in duration-200 space-y-2">
          <p className="font-english text-3xl font-bold text-foreground break-words">
            {wordEnglish}
          </p>
          <p
            className="text-lg text-muted-foreground"
          >
            {wordArabic}
          </p>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={onReveal} className="gap-1.5 text-muted-foreground">
          <Eye className="h-4 w-4" />
          أظهر الإجابة
        </Button>
      )}

      {/* Without a recorded clip and without TTS there is nothing to hear, so
          offer a retry rather than stranding the learner on a silent card. */}
      {!playableUrl && !isLoading && !audioUrl && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={regenerate}>
            أعد المحاولة
          </Button>
        </div>
      )}
    </div>
  );
};
