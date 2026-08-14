import { useMemo, useRef, useState } from "react";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { ChevronDown, ChevronUp } from "lucide-react";
import { splitSentences } from "@/lib/sentences";
import type { VocabItem } from "@/types/transcript";
import { cn } from "@/lib/utils";

/** One card's worth of English, plus the Arabic scaffold written about it. */
export interface EnglishReaderSentence {
  english: string;
  /** Dialect-Arabic translation of the line. */
  arabic?: string;
  /** Word-for-word Arabic gloss preserving the English word order. */
  literal?: string;
}

interface SentenceReaderProps {
  /** The whole English body, split on punctuation when `sentences` is absent. */
  body: string;
  /** Per-sentence text, when the generator authored it. */
  sentences?: EnglishReaderSentence[];
  /** Where a word saved from here came from, e.g. "souq-news". */
  source: string;
  /** Start with every translation showing (the learner's display preference). */
  revealByDefault?: boolean;
  /** Extra classes for the English line — a story reads at a larger size than news. */
  englishClassName?: string;
  /** Save a tapped word to the learner's deck; omitting it hides the save button. */
  onSaveWord?: (word: VocabItem) => void;
}

/**
 * A body of English read one sentence to a card: every word tappable for a
 * dialect gloss, the Arabic hidden behind a tap so the eye cannot cheat, and
 * an Ask AI chip per line.
 *
 * The alternative — the body as one block with a translation under it — is the
 * hardest possible presentation of the hardest thing a learner reads, and it
 * is what this exists to replace.
 */
export const SentenceReader = ({
  body,
  sentences,
  source,
  revealByDefault = false,
  englishClassName,
  onSaveWord,
}: SentenceReaderProps) => {
  const lines = useMemo<EnglishReaderSentence[]>(() => {
    if (sentences && sentences.length > 0) {
      return sentences.filter((s) => typeof s.english === "string" && s.english.trim());
    }
    return splitSentences(body).map((english) => ({ english }));
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
   * Keyed on the English rather than on the array identity, because the parent
   * rebuilds the list on every render.
   */
  const contentKey = `${revealByDefault}|${lines.map((l) => l.english).join(" ")}`;
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
        Tap any word for translation · Tap a line to reveal Arabic
      </p>
      {lines.map((line, i) => {
        const isOpen = revealed.has(i);
        const hasTranslation = Boolean(line.arabic || line.literal);
        return (
          <div
            key={i}
            className="rounded-xl border border-border/40 bg-card/40 p-3"
          >
            <p className={cn("font-english leading-relaxed", englishClassName)}>
              <TappableEnglishText
                text={line.english}
                sentenceArabic={line.arabic}
                source={source}
                onSaveWord={onSaveWord}
              />
            </p>
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
                  {isOpen ? "أخفِ الترجمة" : "ورّني الترجمة"}
                </button>
              ) : <span />}
              {/*
                No whole-body fallback for the missing scaffold: a line whose
                Arabic was never authored is better described as absent than
                labelled with the article's summary — that label is what the
                word lookup and the assistant would then treat as this
                sentence's meaning.
              */}
              <AskAISentence
                arabic={line.arabic ?? ""}
                english={line.english}
                variant="chip"
              />
            </div>
            {/* `invisible` matters beyond the fade: the collapsed grid clips
                the scaffold visually, but the paragraphs inside still report
                their own bounding boxes, so a screen reader or an assertion
                would find "hidden" Arabic that the reveal exists to hide. */}
            <div
              className={cn(
                "grid transition-all duration-200",
                isOpen
                  ? "grid-rows-[1fr] opacity-100 mt-2"
                  : "grid-rows-[0fr] opacity-0 invisible",
              )}
            >
              <div className="overflow-hidden space-y-1">
                {line.arabic && (
                  <p dir="rtl" className="font-arabic text-base text-foreground">
                    {line.arabic}
                  </p>
                )}
                {line.literal && (
                  <p dir="rtl" className="font-arabic text-sm text-muted-foreground/80">
                    {line.literal}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
