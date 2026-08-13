import { useMemo, useRef, useState } from "react";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { ChevronDown, ChevronUp } from "lucide-react";
import { pairSentences, type ReaderSentence } from "@/lib/sentences";
import { cn } from "@/lib/utils";

interface SentenceReaderProps {
  /** The whole body, split on punctuation when `sentences` is absent. */
  body: string;
  /** Per-sentence text, when the generator authored it. */
  sentences?: ReaderSentence[];
  vocabulary?: { word_arabic: string; word_english: string }[];
  /** Where a word saved from here came from, e.g. "souq-news", "daily-story". */
  source: string;
  /** Start with every translation showing (the learner's display preference). */
  revealByDefault?: boolean;
  /** Extra classes for the Arabic line — a story reads at a larger size than news. */
  arabicClassName?: string;
}

/**
 * A body of Arabic read one sentence to a card: every word tappable for a
 * gloss, the English hidden behind a tap so the eye cannot cheat, and an Ask AI
 * chip per line.
 *
 * The alternative — the body as one block with a translation under it — is the
 * hardest possible presentation of the hardest thing a learner reads, and it is
 * what this exists to replace. Shared by Souq News and Today's Story so the two
 * behave identically.
 */
export const SentenceReader = ({
  body,
  sentences,
  vocabulary,
  source,
  revealByDefault = false,
  arabicClassName,
}: SentenceReaderProps) => {
  const lines = useMemo<ReaderSentence[]>(() => {
    if (sentences && sentences.length > 0) return sentences;
    return pairSentences({ arabic: body });
  }, [sentences, body]);

  const initial = () =>
    revealByDefault ? new Set(lines.map((_, i) => i)) : new Set<number>();
  const [revealed, setRevealed] = useState<Set<number>>(initial);

  /**
   * Close everything when the body changes.
   *
   * `revealed` is a set of positions with no tie to the content, so swapping
   * `sentences` for another story left the same positions open: a reader who
   * revealed line 2 of one article opened the next with line 2 already
   * translated — which for a sentence-by-sentence exercise is precisely the
   * thing it exists to prevent.
   *
   * Keyed on the Arabic rather than on the array identity, because the parent
   * rebuilds the list on every render.
   */
  const contentKey = `${revealByDefault}|${lines.map((l) => l.arabic).join(" ")}`;
  const lastContent = useRef(contentKey);
  if (lastContent.current !== contentKey) {
    lastContent.current = contentKey;
    setRevealed(initial());
  }

  const toggle = (i: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        Tap any word for translation · Tap a line to reveal English
      </p>
      {lines.map((line, i) => {
        const isOpen = revealed.has(i);
        const english = line.english ?? "";
        const hasTranslation = Boolean(english || line.literal);
        return (
          <div
            key={i}
            className="rounded-xl border border-border/40 bg-card/40 p-3"
          >
            <TappableArabicText
              text={line.arabic}
              vocabulary={vocabulary || []}
              source={source}
              className={arabicClassName}
              sentenceContext={{
                arabic: line.arabic,
                english,
              }}
            />
            {line.transliteration && (
              <p className="text-xs text-muted-foreground italic mt-1">
                {line.transliteration}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              {hasTranslation ? (
                <button
                  onClick={() => toggle(i)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {isOpen ? "Hide translation" : "Reveal translation"}
                </button>
              ) : <span />}
              {/*
                No whole-body fallback. Both this and the word-gloss context
                above once used `line.english || summaryEnglish`. On the
                authored path that never fires; on the split-sentence path every
                line has an empty English, so each one was sent up paired with
                the body's whole summary — telling the model, and the word
                lookup that produces the gloss a learner then saves, that a
                four-word sentence means a paragraph. An absent translation is
                better described as absent.
              */}
              <AskAISentence
                arabic={line.arabic}
                english={english}
                variant="chip"
              />
            </div>
            <div
              className={cn(
                "grid transition-all duration-200",
                isOpen
                  ? "grid-rows-[1fr] opacity-100 mt-2"
                  : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <TranslationPair
                  variant="compact"
                  literal={line.literal}
                  natural={english}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
