import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import type { PageAiContext } from "@/lib/pageAiContext";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, BookmarkPlus, RefreshCw, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PhraseData {
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string;
  notes: string;
  dialect: string;
  date: string;
}

const cacheKey = (dialect: string, date: string) => `phraseOfDay:${dialect}:${date}`;
const seenKey = (dialect: string, date: string) => `phraseOfDay:seen:${dialect}:${date}`;

export const PhraseOfTheDay = () => {
  const { activeDialect } = useDialect();
  const { isAuthenticated } = useAuth();
  const addPhrase = useAddUserPhrase();

  const [phrase, setPhrase] = useState<PhraseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showArabic, setShowArabic] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // Publish the displayed phrase to the Ask AI assistant, so "tell me about
  // the phrase of the day" is answered about THIS phrase, not an invented one.
  const aiContext = useMemo<PageAiContext | null>(() => {
    if (!phrase) return null;
    return {
      kind: "phrase",
      title: "Phrase of the Day",
      summary: `The learner's home screen is showing today's Phrase of the Day in ${phrase.dialect} Arabic.`,
      content: [
        `Today's Phrase of the Day (${phrase.dialect} Arabic, ${phrase.date}):`,
        `Arabic: ${phrase.phrase_arabic}`,
        `Transliteration: ${phrase.transliteration}`,
        `English: ${phrase.phrase_english}`,
        phrase.notes && `Notes: ${phrase.notes}`,
        !showArabic &&
          "(The Arabic script is still hidden on screen — the learner hasn't tapped to reveal it yet.)",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }, [phrase, showArabic]);
  usePageAiContext(aiContext);

  const fetchPhrase = async (force = false) => {
    setLoading(true);
    setSaved(false);
    setShowArabic(false);
    try {
      if (!force) {
        const cached = localStorage.getItem(cacheKey(activeDialect, today));
        if (cached) {
          setPhrase(JSON.parse(cached));
          setLoading(false);
          return;
        }
      }
      // Track categories already shown today so Refresh rotates to a new bucket.
      let avoidCategories: string[] = [];
      try {
        avoidCategories = JSON.parse(localStorage.getItem(seenKey(activeDialect, today)) || "[]");
      } catch { avoidCategories = []; }

      const body: Record<string, unknown> = {
        dialect: activeDialect,
        seed: force ? `${today}-${Date.now()}` : today,
      };
      if (force && avoidCategories.length) body.avoidCategories = avoidCategories;

      let data: any = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabase.functions.invoke("phrase-of-the-day", { body });
        if (!res.error && res.data && !res.data.error) {
          data = res.data;
          lastErr = null;
          break;
        }
        if (res.data?.fallback) {
          toast.error(res.data.message || "Phrase of the day unavailable right now.");
          lastErr = null;
          break;
        }
        lastErr = res.error || new Error(res.data?.error || "Unknown error");
        const msg = String(lastErr?.message || lastErr);
        if (!/Failed to send|fetch|network|load failed/i.test(msg)) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
      if (!data) {
        if (lastErr) throw lastErr;
        return;
      }
      setPhrase(data);

      // Record this category as seen for the day.
      const cat = data?.category || data?._meta?.category;
      if (cat && !avoidCategories.includes(cat)) {
        try {
          localStorage.setItem(
            seenKey(activeDialect, today),
            JSON.stringify([...avoidCategories, cat].slice(-20)),
          );
        } catch { /* ignore quota */ }
      }

      // Don't cache phrases that needed MSA repair — they may still be borderline.
      const repairs = Number(data?._meta?.msaRepairs ?? 0);
      if (repairs === 0 && !force) {
        localStorage.setItem(cacheKey(activeDialect, today), JSON.stringify(data));
      }
    } catch (e: any) {
      console.warn("[PhraseOfTheDay] fetch failed:", e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPhrase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialect]);

  const handleSave = async () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to save phrases");
      return;
    }
    if (!phrase) return;
    try {
      await addPhrase.mutateAsync({
        phrase_arabic: phrase.phrase_arabic,
        phrase_english: phrase.phrase_english,
        transliteration: phrase.transliteration,
        notes: phrase.notes,
        source: "phrase-of-the-day",
      });
      setSaved(true);
      toast.success("Saved to your flashcards");
    } catch (e: any) {
      toast.error(e.message || "Couldn't save");
    }
  };

  return (
    <div
      className={cn(
        "w-full mb-6 p-5 rounded-2xl",
        "bg-gradient-to-br from-accent/15 via-primary/10 to-accent/5",
        "border-2 border-accent/30 relative overflow-hidden",
      )}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/2" />

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
          </div>
          <div>
            <p className="font-bold text-foreground text-sm">Phrase of the Day</p>
            <p className="text-xs text-muted-foreground">{activeDialect} Arabic</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fetchPhrase(true)}
          disabled={loading}
          title="New phrase"
          aria-label="Refresh phrase"
          className="h-8 w-8"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !phrase ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Generating today's phrase…
        </div>
      ) : phrase ? (
        <div className="space-y-3 relative z-10">
          {showArabic ? (
            <p
              dir="rtl"
              className="text-2xl font-semibold text-foreground leading-relaxed"
              style={{ fontFamily: "'Noto Sans Arabic', sans-serif" }}
            >
              {phrase.phrase_arabic}
            </p>
          ) : (
            <button
              onClick={() => setShowArabic(true)}
              aria-label="Reveal Arabic phrase"
              className="w-full py-3 rounded-lg border-2 border-dashed border-accent/40 bg-card/40 text-sm text-muted-foreground hover:bg-card/60 transition flex items-center justify-center gap-2"
            >
              <Eye className="h-4 w-4" />
              Tap to reveal Arabic
            </button>
          )}

          <p className="text-base text-foreground font-medium">
            {phrase.phrase_english}
          </p>

          {showArabic && (
            <p className="text-sm text-muted-foreground italic">
              {phrase.transliteration}
            </p>
          )}

          {phrase.notes && (
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-accent/40 pl-3">
              {phrase.notes}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saved || addPhrase.isPending}
              className="flex-1"
            >
              {saved ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Saved
                </>
              ) : (
                <>
                  <BookmarkPlus className="h-4 w-4 mr-1.5" />
                  Save as flashcard
                </>
              )}
            </Button>
            <AskAISentence
              arabic={phrase.phrase_arabic}
              english={phrase.phrase_english}
              variant="chip"
              className="h-9"
            />
            {showArabic && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowArabic(false)}
                title="Hide Arabic"
                aria-label="Hide Arabic"
              >
                <EyeOff className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
