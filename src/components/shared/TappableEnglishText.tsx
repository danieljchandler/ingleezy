import { useCallback, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Check, Volume2 } from "lucide-react";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import type { VocabItem } from "@/types/transcript";
import { cn } from "@/lib/utils";
import { englishSpeechUrl } from "@/lib/englishSpeech";
import { DIALECT_LABELS } from "@/config";

/**
 * English text where every word is tappable — the mirror of
 * TappableArabicText, and the heart of the clickable-word → flashcard loop
 * for English videos: tap a word, see its meaning in your own dialect, save
 * it to My Words.
 *
 * Deliberately simpler than the Arabic side (no compound spans, no token
 * glosses from the pipeline): English words are fetched on demand through
 * translate-phrase, which is dialect-aware and already capped server-side.
 *
 * The popover is the design's word sheet in small: the word lit in gold with
 * a button to hear it said, a tag naming the dialect of the gloss, the
 * meaning in Naskh, and one button to keep it.
 */

interface Props {
  text: string;
  /** The line's Arabic scaffold, sent as context so one-word lookups translate in context. */
  sentenceArabic?: string;
  source: string;
  onSaveWord?: (word: VocabItem) => void;
  savedWords?: Set<string>;
  className?: string;
}

interface Lookup {
  translation: string | null;
  loading: boolean;
}

/** Strip leading/trailing punctuation for lookup while keeping the display form. */
const lookupForm = (surface: string) => surface.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");

export function TappableEnglishText({
  text,
  sentenceArabic,
  source,
  onSaveWord,
  savedWords,
  className,
}: Props) {
  const { activeDialect } = useDialect();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const [savedLocal, setSavedLocal] = useState<Set<string>>(new Set());

  const words = useMemo(() => text.split(/(\s+)/), [text]);

  // A model English voice for the word. Quiet on failure: the word and its
  // meaning are still on screen, and a missing sound is not worth a toast.
  const say = useCallback(async (word: string) => {
    try {
      await new Audio(await englishSpeechUrl(word)).play();
    } catch {
      /* no audio this time */
    }
  }, []);

  const lookup = useCallback(
    async (word: string) => {
      if (!word || lookups[word]?.translation || lookups[word]?.loading) return;
      setLookups((prev) => ({ ...prev, [word]: { translation: null, loading: true } }));
      try {
        const { data, error } = await supabase.functions.invoke("translate-phrase", {
          body: { phrase: word, dialect: activeDialect, mode: "word", direction: "en_to_ar" },
        });
        const translation =
          !error && typeof data?.translation === "string" ? data.translation : null;
        setLookups((prev) => ({ ...prev, [word]: { translation, loading: false } }));
      } catch {
        setLookups((prev) => ({ ...prev, [word]: { translation: null, loading: false } }));
      }
    },
    [activeDialect, lookups],
  );

  return (
    <span className={cn("font-english", className)} data-source={source}>
      {words.map((segment, i) => {
        if (/^\s*$/.test(segment)) return <span key={i}>{segment}</span>;
        const word = lookupForm(segment);
        if (!word) return <span key={i}>{segment}</span>;
        const key = word.toLowerCase();
        const state = lookups[key];
        const isSaved = savedLocal.has(key) || savedWords?.has(key);

        return (
          <Popover
            key={i}
            open={openIdx === i}
            onOpenChange={(open) => {
              setOpenIdx(open ? i : null);
              if (open) void lookup(key);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  // The negative margin cancels the padding's width: the
                  // highlight gets room around the word without adding to the
                  // space between words, which read as gaps in the sentence.
                  "-mx-0.5 rounded px-0.5 transition-colors hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/40",
                  isSaved && "text-primary underline decoration-dotted underline-offset-4",
                )}
              >
                {segment}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60 space-y-2 rounded-3xl p-4" side="top">
              <div className="flex items-center justify-between gap-2">
                <span dir="ltr" className="rounded-lg bg-accent px-1.5 font-heading text-2xl leading-9 text-accent-foreground">{word}</span>
                <button
                  type="button"
                  onClick={() => void say(word)}
                  aria-label="اسمع الكلمة"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-tint-firoza"
                >
                  <Volume2 className="h-[18px] w-[18px]" aria-hidden />
                </button>
              </div>
              <span className="inline-block rounded-full bg-tint-sage px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-success-ink">
                بال{DIALECT_LABELS[activeDialect]}
              </span>
              {state?.loading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> نترجم…
                </div>
              ) : state?.translation ? (
                <p dir="rtl" className="font-naskh text-xl leading-8">{state.translation}</p>
              ) : (
                <p className="text-xs text-muted-foreground">ما فيه ترجمة.</p>
              )}
              {onSaveWord && (
                <Button
                  variant={isSaved ? "secondary" : "default"}
                  className="h-11 w-full gap-1.5"
                  disabled={isSaved || state?.loading}
                  onClick={() => {
                    onSaveWord({
                      english: word,
                      arabic: state?.translation ?? "",
                      sentenceText: sentenceArabic,
                      sentenceEnglish: text,
                    });
                    setSavedLocal((prev) => new Set(prev).add(key));
                    setOpenIdx(null);
                  }}
                >
                  {isSaved ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {isSaved ? "محفوظة" : "احفظ في كلماتي"}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        );
      })}
    </span>
  );
}
