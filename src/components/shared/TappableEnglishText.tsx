import { useCallback, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Check } from "lucide-react";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import type { VocabItem } from "@/types/transcript";
import { cn } from "@/lib/utils";

/**
 * English text where every word is tappable — the mirror of
 * TappableArabicText, and the heart of the clickable-word → flashcard loop
 * for English videos: tap a word, see its meaning in your own dialect, save
 * it to My Words.
 *
 * Deliberately simpler than the Arabic side (no compound spans, no token
 * glosses from the pipeline): English words are fetched on demand through
 * translate-phrase, which is dialect-aware and already capped server-side.
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
                  "rounded px-0.5 transition-colors hover:bg-primary/10 focus:outline-none focus:ring-1 focus:ring-primary/40",
                  isSaved && "text-primary underline decoration-dotted underline-offset-4",
                )}
              >
                {segment}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-2" side="top">
              <p className="font-english font-semibold">{word}</p>
              {state?.loading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> نترجم…
                </div>
              ) : state?.translation ? (
                <p dir="rtl" className="font-arabic text-base">{state.translation}</p>
              ) : (
                <p className="text-xs text-muted-foreground">ما فيه ترجمة.</p>
              )}
              {onSaveWord && (
                <Button
                  size="sm"
                  variant={isSaved ? "secondary" : "default"}
                  className="w-full gap-1.5"
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
