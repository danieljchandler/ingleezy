import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, Volume2, Play, Loader2, Quote } from "lucide-react";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { cn } from "@/lib/utils";

interface Props {
  wordArabic: string;
  wordEnglish: string;
  /** The ENGLISH sentence the blank lives in. */
  sentenceText: string;
  /** Arabic translation of the sentence, revealed on demand after answering. */
  sentenceArabic?: string | null;
  /** Recorded audio of the sentence, when it exists and is English audio. */
  sentenceAudioUrl?: string | null;
  distractors: string[]; // other English words from the due queue
  onAnswered?: (correct: boolean) => void;
}

const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Replace first occurrence of the target word (whitespace-bounded) with a
// blank. Case-insensitive: "Market" at the sentence start still blanks "market".
const buildCloze = (sentence: string, word: string) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\s|[،.,!؟?])${escaped}(?=$|\\s|[،.,!؟?])`, "i");
  const m = sentence.match(re);
  if (!m) return null;
  const before = sentence.slice(0, m.index! + m[1].length);
  const after = sentence.slice(m.index! + m[0].length);
  return { before, after };
};

export const ReviewClozeCard = ({
  wordArabic,
  wordEnglish,
  sentenceText,
  sentenceArabic,
  sentenceAudioUrl,
  distractors,
  onAnswered,
}: Props) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);

  const cloze = useMemo(() => buildCloze(sentenceText, wordEnglish), [sentenceText, wordEnglish]);

  // Sentence with the target word masked out so the audio doesn't reveal the
  // answer. Recorded sentence audio always contains the word, so we ignore it
  // for cloze cards and synthesise a masked version instead. After the learner
  // answers, we fall back to the full audio so they can hear it in context.
  const maskedSentence = useMemo(() => {
    if (!cloze) return sentenceText;
    return `${cloze.before} ... ${cloze.after}`.replace(/\s+/g, " ").trim();
  }, [cloze, sentenceText]);

  const options = useMemo(() => {
    // Only keep Latin-script options so we never offer Arabic answers when
    // the blank requires an English word.
    const LATIN_RE = /[A-Za-z]/;
    const pool = distractors.filter(
      (d) => d && d.toLowerCase() !== wordEnglish.toLowerCase() && LATIN_RE.test(d),
    );
    const picks = shuffle(pool).slice(0, 3);
    return shuffle([wordEnglish, ...picks]);
  }, [distractors, wordEnglish]);

  // Reset when card changes
  useEffect(() => {
    setSelected(null);
    setShowTranslation(false);
  }, [wordEnglish, sentenceText]);

  // Masked-sentence TTS (used before the learner answers). English voice —
  // the sentence is the English target material.
  const { ttsUrl: maskedUrl, isLoading: maskedLoading } = useAzureTTS({
    text: maskedSentence,
    skip: !cloze,
    voice: "en-US-JennyNeural",
  });
  // Full-sentence TTS fallback (used after answering, when no recording exists).
  const { ttsUrl: fullTtsUrl, isLoading: fullTtsLoading } = useAzureTTS({
    text: sentenceText,
    skip: Boolean(sentenceAudioUrl) || selected == null,
    voice: "en-US-JennyNeural",
  });
  const fullAudioUrl = sentenceAudioUrl || fullTtsUrl;
  const audioUrl = selected == null ? maskedUrl : fullAudioUrl;
  const ttsLoading = selected == null ? maskedLoading : fullTtsLoading;

  const playAudio = (url: string) => {
    const a = new Audio(url);
    a.play().catch(console.error);
  };

  // Auto-play sentence audio once available
  useEffect(() => {
    if (audioUrl) playAudio(audioUrl);
     
  }, [audioUrl, sentenceText]);

  if (!cloze) {
    // Word not found in sentence — caller should fall back to standard card
    return null;
  }

  const handleSelect = (opt: string) => {
    if (selected) return;
    setSelected(opt);
    onAnswered?.(opt === wordEnglish);
  };

  return (
    <div className="rounded-3xl bg-card border border-[#5C3A46]/15 p-7 text-center shadow-elegant">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          أكمل الكلمة الناقصة
        </span>
      </div>

      {/* Sentence with blank */}
      <div className="font-english text-3xl leading-loose text-foreground mb-7">
        <span>{cloze.before}</span>
        <span
          className={cn(
            "inline-block min-w-[5.5rem] mx-1.5 px-3 py-1 rounded-lg border-2 border-dashed align-middle transition-colors",
            selected == null && "border-primary/50 bg-primary/8 text-primary/60",
            selected != null && selected === wordArabic && "border-green-600 bg-green-500/15 text-green-700 border-solid",
            selected != null && selected !== wordArabic && "border-red-600 bg-red-500/15 text-red-700 border-solid"
          )}
        >
          {selected ?? "___"}
        </span>
        <span>{cloze.after}</span>
      </div>

      {/* Circular audio button */}
      <div className="flex flex-col items-center justify-center gap-1.5 mb-7">
        <button
          type="button"
          onClick={() => audioUrl && playAudio(audioUrl)}
          disabled={!audioUrl || ttsLoading}
          aria-label={selected == null ? "شغّل الجملة مع حجب الكلمة" : "شغّل الجملة كاملة"}
          className={cn(
            "h-14 w-14 rounded-full flex items-center justify-center",
            "bg-primary text-primary-foreground shadow-elegant",
            "transition-all hover:scale-105 active:scale-95",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {ttsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6 ms-0.5" />}
        </button>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {selected == null ? "الكلمة محجوبة" : "الجملة كاملة"}
        </span>
      </div>

      {/* Choices */}
      <div className="grid grid-cols-2 gap-2.5 mb-2">
        {options.map((opt) => {
          const isPicked = selected === opt;
          const isTarget = opt === wordEnglish;
          const reveal = selected != null;
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={selected != null}
              className={cn(
                "font-english rounded-xl border-2 border-[#5C3A46]/15 bg-card px-3 min-h-[56px] text-xl transition-all",
                "hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5",
                "disabled:hover:translate-y-0",
                reveal && isTarget && "border-green-600 bg-green-500/12",
                reveal && isPicked && !isTarget && "border-red-600 bg-red-500/12",
                reveal && !isTarget && !isPicked && "opacity-50",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {opt}
                {reveal && isTarget && <Check className="h-4 w-4 text-green-600" />}
                {reveal && isPicked && !isTarget && <X className="h-4 w-4 text-red-600" />}
              </span>
            </button>
          );
        })}
      </div>

      {selected != null && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-5 text-center">
          <p className="text-base text-foreground">
            <span className="font-english font-semibold">{wordEnglish}</span>
            <span className="text-muted-foreground"> — {wordArabic}</span>
          </p>
          {sentenceArabic && (
            <div className="mt-3">
              {!showTranslation ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => setShowTranslation(true)}
                >
                  <Quote className="h-4 w-4" />
                  أظهر الترجمة
                </Button>
              ) : (
                <p
                  className="text-sm text-muted-foreground"
                  style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                >
                  {sentenceArabic}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

