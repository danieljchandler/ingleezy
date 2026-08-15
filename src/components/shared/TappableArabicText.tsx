import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BookmarkPlus, Loader2, Sparkles, Link2, MessageCircleQuestion, X } from "lucide-react";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { toast } from "sonner";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { stripTashkil } from "@/lib/displayPrefs";
import { useMarkUnknowns } from "@/contexts/MarkUnknownsContext";
import { vibrate } from "@/lib/tapFeedback";
import { useBridgeMode } from "@/hooks/useBridgeMode";

interface WordEnrichment {
  definition?: string;
  literal?: string;
  transliteration?: string;
  otherUses?: { arabic: string; english: string }[];
}

interface SampleSentence { arabic: string; english: string; literal?: string }

interface WordData {
  translation: string;
  enrichment?: WordEnrichment;
  enriching?: boolean;
  samples?: SampleSentence[];
  generatingSamples?: boolean;
}

const enrichWord = async (
  word: string,
  dialect: string,
  sentenceContext?: { arabic?: string; english?: string },
  isPhrase = false
): Promise<WordEnrichment> => {
  try {
    const { data, error } = await supabase.functions.invoke("word-enrichment", {
      body: {
        word,
        dialect,
        sentenceArabic: sentenceContext?.arabic,
        sentenceEnglish: sentenceContext?.english,
        isPhrase,
      },
    });
    if (error) throw error;
    return {
      definition: data?.definition || undefined,
      literal: data?.literal || undefined,
      transliteration: data?.transliteration || undefined,
      otherUses: Array.isArray(data?.uses) ? data.uses : [],
    };
  } catch {
    return {};
  }
};

interface TappableArabicTextProps {
  /** The Arabic text to render as tappable words */
  text: string;
  /** Optional vocabulary context for instant translation before enrichment.
   *  When `msa_form` is provided AND Bridge view is enabled, the MSA equivalent
   *  is shown inside each word's popover. */
  vocabulary?: { word_arabic: string; word_english: string; msa_form?: string | null; msa_note?: string | null }[];
  /** Source label for saved words (e.g. "souq-news", "reading-practice") */
  source?: string;
  /** Additional className for the container */
  className?: string;
  /** Optional surrounding sentence (Arabic + accepted English) so word translations match context */
  sentenceContext?: { arabic?: string; english?: string };
}

/**
 * Renders Arabic text where each word is tappable.
 * Tapping a word → popover with translation, related forms, save.
 * Long-pressing (or using "Combine with neighbour") starts PHRASE MODE:
 *   words become checkbox-like; tap any word and the contiguous range
 *   between the first and last picked is highlighted. A floating bar
 *   translates / saves the whole phrase as a single flashcard.
 */
export const TappableArabicText = ({
  text,
  vocabulary = [],
  source = "tappable-text",
  className,
  sentenceContext,
}: TappableArabicTextProps) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { prefs } = useDisplayPrefs();
  const { enabled: bridgeOn } = useBridgeMode();
  const addVocab = useAddUserVocabulary();
  const markUnknowns = useMarkUnknowns();
  const { openChat } = useAiAssistant();
  const [wordTranslations, setWordTranslations] = useState<Record<string, WordData>>({});

  // ── Phrase selection state ────────────────────────────────────────
  // We track the anchor (first picked word index) and head (last picked).
  // The active selection is the contiguous range [min..max].
  const [phraseSel, setPhraseSel] = useState<{ anchor: number; head: number } | null>(null);
  const [phraseData, setPhraseData] = useState<WordData | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const cleanRe = /[،.؟!,؛:«»"]/g;
  const clean = (w: string) => w.replace(cleanRe, "").trim();

  const handleWordTap = async (word: string) => {
    const cleanWord = clean(word);
    if (!cleanWord) return;
    if (wordTranslations[cleanWord]) return;

    const vocabMatch = vocabulary.find(
      (v) => cleanWord.includes(v.word_arabic) || v.word_arabic.includes(cleanWord)
    );
    const translation = vocabMatch?.word_english || "";

    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation, enriching: true },
    }));

    const enrichment = await enrichWord(cleanWord, activeDialect, sentenceContext ?? { arabic: text });
    const definition = enrichment?.definition || translation || "";

    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation: definition, enrichment, enriching: false },
    }));
  };

  const generateSamples = async (cleanWord: string) => {
    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { ...(prev[cleanWord] ?? { translation: "" }), generatingSamples: true },
    }));
    try {
      const { data, error } = await supabase.functions.invoke("generate-sample-sentences", {
        body: {
          word: cleanWord,
          dialect: activeDialect,
          definition: wordTranslations[cleanWord]?.translation,
        },
      });
      if (error) throw error;
      const sentences: SampleSentence[] = Array.isArray(data?.sentences) ? data.sentences : [];
      setWordTranslations((prev) => ({
        ...prev,
        [cleanWord]: { ...(prev[cleanWord] ?? { translation: "" }), samples: sentences, generatingSamples: false },
      }));
      if (sentences.length === 0) toast.error("تعذّر توليد الجمل");
    } catch {
      setWordTranslations((prev) => ({
        ...prev,
        [cleanWord]: { ...(prev[cleanWord] ?? { translation: "" }), generatingSamples: false },
      }));
      toast.error("تعذّر توليد الجمل");
    }
  };

  const saveAsFlashcard = (arabic: string, english: string, transliteration?: string) => {
    if (!user) {
      toast.error("سجّل دخولك عشان تحفظ البطاقات");
      return;
    }
    addVocab.mutate(
      {
        word_arabic: arabic,
        word_english: english,
        transliteration: transliteration || undefined,
        source,
        sentence_text: sentenceContext?.arabic || text || undefined,
        sentence_english: sentenceContext?.english || undefined,
      },
      {
        onSuccess: () => toast.success("حفظناها في كلماتي!"),
        onError: (err: any) => {
          if (err?.message?.includes("duplicate")) {
            toast.info("موجودة عندك أصلاً");
          } else {
            toast.error("تعذّر الحفظ");
          }
        },
      }
    );
  };

  const displayText = prefs.showTashkil ? text : stripTashkil(text);
  const words = displayText.split(/\s+/);

  // ── Phrase helpers ────────────────────────────────────────────────
  const phraseRange = phraseSel
    ? { lo: Math.min(phraseSel.anchor, phraseSel.head), hi: Math.max(phraseSel.anchor, phraseSel.head) }
    : null;

  const phraseText = phraseRange
    ? words.slice(phraseRange.lo, phraseRange.hi + 1).map(clean).filter(Boolean).join(" ")
    : "";

  const startPhrase = (idx: number) => {
    setPhraseSel({ anchor: idx, head: idx });
    setPhraseData(null);
  };

  const extendPhrase = (idx: number) => {
    setPhraseSel((prev) => (prev ? { anchor: prev.anchor, head: idx } : { anchor: idx, head: idx }));
    setPhraseData(null);
  };

  const cancelPhrase = () => {
    setPhraseSel(null);
    setPhraseData(null);
  };

  const translatePhrase = async () => {
    if (!phraseText) return;
    setPhraseData({ translation: "", enriching: true });
    const enrichment = await enrichWord(
      phraseText,
      activeDialect,
      sentenceContext ?? { arabic: text },
      true
    );
    setPhraseData({
      translation: enrichment.definition || "",
      enrichment,
      enriching: false,
    });
  };

  const savePhrase = () => {
    if (!phraseText) return;
    const english = phraseData?.translation;
    if (!english) {
      toast.info("ترجمها أول، بعدين احفظها");
      return;
    }
    saveAsFlashcard(phraseText, english, phraseData?.enrichment?.transliteration);
  };

  // ── Long-press handlers (mobile-first) ────────────────────────────
  const onPointerDown = (idx: number) => {
    longPressFired.current = false;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      vibrate(15);
      startPhrase(idx);
    }, 450);
  };
  const onPointerUp = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const inPhraseMode = phraseSel !== null;

  return (
    <>
      <p
        className={cn(
          "text-base leading-loose text-foreground/90 flex flex-wrap justify-end gap-1 font-arabic",
          className
        )}
        dir="rtl"
        style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
      >
        {words.map((word, wIdx) => {
          const cleanWord = clean(word);
          const wordData = wordTranslations[cleanWord];
          const marking = markUnknowns.enabled;
          const marked = marking && markUnknowns.isMarked(cleanWord);

          if (marking) {
            const toggleMark = () =>
              cleanWord &&
              markUnknowns.toggle({
                arabic: cleanWord,
                sentence_text: sentenceContext?.arabic || text,
                sentence_english: sentenceContext?.english,
              });
            return (
              <span
                key={wIdx}
                role="button"
                tabIndex={0}
                aria-pressed={marked}
                aria-label={`${marked ? "شيل علامة" : "علّم"} «${cleanWord}» كغير معروفة`}
                onClick={toggleMark}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleMark();
                  }
                }}
                className={cn(
                  "cursor-pointer rounded px-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  marked
                    ? "bg-yellow-300/70 text-foreground dark:bg-yellow-500/40"
                    : "hover:bg-yellow-200/40"
                )}
              >
                {word}
              </span>
            );
          }

          // Phrase mode: every word becomes a toggle within contiguous range
          if (inPhraseMode && phraseRange) {
            const inRange = wIdx >= phraseRange.lo && wIdx <= phraseRange.hi;
            const isEdge = wIdx === phraseRange.lo || wIdx === phraseRange.hi;
            return (
              <span
                key={wIdx}
                role="button"
                tabIndex={0}
                aria-label={`مدّد التحديد إلى «${clean(word)}»`}
                onClick={(e) => {
                  e.stopPropagation();
                  extendPhrase(wIdx);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    extendPhrase(wIdx);
                  }
                }}
                className={cn(
                  "cursor-pointer rounded px-1 transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  inRange
                    ? "bg-primary/25 text-foreground ring-1 ring-primary/40"
                    : "hover:bg-primary/10",
                  isEdge && "ring-2 ring-primary"
                )}
              >
                {word}
              </span>
            );
          }

          return (
            <Popover key={wIdx}>
              <PopoverTrigger asChild>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`ابحث عن «${clean(word)}»`}
                  onPointerDown={() => onPointerDown(wIdx)}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleWordTap(word);
                    }
                  }}
                  onClick={(e) => {
                    if (longPressFired.current) {
                      // Long-press just started phrase mode — swallow the tap so popover doesn't open
                      e.preventDefault();
                      e.stopPropagation();
                      longPressFired.current = false;
                      return;
                    }
                    handleWordTap(word);
                  }}
                  className={cn(
                    "cursor-pointer rounded px-0.5 transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    wordData
                      ? "text-primary underline underline-offset-4 decoration-primary/30"
                      : "hover:bg-primary/10"
                  )}
                >
                  {word}
                </span>
              </PopoverTrigger>
              {wordData && (
                <PopoverContent className="w-72 p-3 max-h-[70vh] overflow-y-auto" side="top">
                  <div className="space-y-2">
                    <p className="font-bold text-foreground font-arabic text-lg" dir="rtl">
                      {cleanWord}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {wordData.translation || "اضغط للتفاصيل…"}
                    </p>

                    {wordData.enriching ? (
                      <div className="flex items-center gap-2 pt-1">
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">نجيب الاستعمالات…</span>
                      </div>
                    ) : null}

                    {bridgeOn && (() => {
                      const match = vocabulary.find(
                        (v) => v.msa_form && (cleanWord.includes(v.word_arabic) || v.word_arabic.includes(cleanWord))
                      );
                      if (!match?.msa_form) return null;
                      return (
                        <div className="pt-1 border-t border-border bg-[#5C3A46]/5 -mx-3 px-3 py-2">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-[#5C3A46]">
                            MSA · الفصحى
                          </p>
                          <p className="font-arabic text-sm text-foreground" dir="rtl">
                            {match.msa_form}
                          </p>
                          {match.msa_note && (
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                              {match.msa_note}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {wordData.enrichment?.otherUses && wordData.enrichment.otherUses.length > 0 && (
                      <div className="pt-1 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">صيغ أخرى</p>
                        <div className="space-y-0.5">
                          {wordData.enrichment.otherUses.map((u, i) => (
                            <p key={i} className="text-xs">
                              <span className="font-arabic" dir="rtl">{u.arabic}</span>
                              <span className="text-muted-foreground"> — {u.english}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="pt-1 border-t border-border space-y-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-primary/40 bg-primary/5 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openChat({
                            arabic: cleanWord,
                            english: wordData.translation,
                          });
                        }}
                      >
                        <MessageCircleQuestion className="h-3 w-3 mr-1" />
                        اسأل الذكاء عن الكلمة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          startPhrase(wIdx);
                        }}
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        اضمّها للكلمة الجارة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        disabled={wordData.generatingSamples || wordData.enriching}
                        onClick={(e) => {
                          e.stopPropagation();
                          generateSamples(cleanWord);
                        }}
                      >
                        {wordData.generatingSamples ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        {wordData.samples && wordData.samples.length > 0
                          ? "ولّد جمل جديدة"
                          : "ولّد جمل أمثلة"}
                      </Button>
                    </div>

                    {wordData.samples && wordData.samples.length > 0 && (
                      <div className="pt-1 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">أمثلة</p>
                        <div className="space-y-1.5">
                          {wordData.samples.map((s, i) => (
                            <div key={i} className="text-xs">
                              <p className="font-arabic text-foreground" dir="rtl">{s.arabic}</p>
                              <p className="text-muted-foreground">{s.english}</p>
                              {s.literal && (
                                <p className="italic text-muted-foreground/70">
                                  <span className="not-italic uppercase tracking-wide text-[9px] mr-1 text-muted-foreground/50">
                                    حرفي
                                  </span>
                                  {s.literal}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {user && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs mt-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveAsFlashcard(cleanWord, wordData.translation, wordData.enrichment?.transliteration);
                        }}
                      >
                        <BookmarkPlus className="h-3 w-3 mr-1" />
                        احفظ في كلماتي
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </p>

      {/* Floating phrase bar */}
      {inPhraseMode && (
        <div className="fixed inset-x-0 bottom-3 z-50 flex justify-center px-3 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-primary/40 bg-background/95 shadow-lg backdrop-blur p-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Phrase ({phraseRange ? phraseRange.hi - phraseRange.lo + 1 : 0} words) · tap a word to extend
                </p>
                <p className="font-arabic text-base text-foreground truncate" dir="rtl">
                  {phraseText || "—"}
                </p>
                {phraseData?.enriching && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> نترجم العبارة…
                  </p>
                )}
                {phraseData && !phraseData.enriching && phraseData.translation && (
                  <p className="text-sm text-foreground mt-1">{phraseData.translation}</p>
                )}
                {phraseData && !phraseData.enriching && phraseData.enrichment?.literal && (
                  <p className="text-xs italic text-muted-foreground/80 mt-0.5">
                    <span className="not-italic uppercase tracking-wide text-[9px] mr-1 text-muted-foreground/60">
                      حرفي
                    </span>
                    {phraseData.enrichment.literal}
                  </p>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={cancelPhrase}
                aria-label="ألغِ العبارة"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={translatePhrase}
                disabled={!phraseText || phraseData?.enriching}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                ترجم العبارة
              </Button>
              <Button
                size="sm"
                className="flex-1 text-xs"
                onClick={savePhrase}
                disabled={!phraseText || !phraseData?.translation}
              >
                <BookmarkPlus className="h-3 w-3 mr-1" />
                احفظ العبارة
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
