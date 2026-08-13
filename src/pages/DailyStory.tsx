import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles, RefreshCw, ArrowLeft, Check } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SentenceReader } from "@/components/shared/SentenceReader";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { pairSentences, type ReaderSentence } from "@/lib/sentences";
import { useAuth } from "@/hooks/useAuth";
import { useDailyStory, useGenerateDailyStory } from "@/hooks/useDailyStory";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { markTaskCompletedToday, isTaskCompletedToday } from "@/lib/todayCompletion";
import { toast } from "sonner";
import { LoadingPanel } from "@/components/loading/LoadingPanel";

const DailyStoryPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: story, isLoading } = useDailyStory();
  const generate = useGenerateDailyStory();
  const { prefs } = useDisplayPrefs();
  const showEnglish = prefs?.showEnglish ?? false;

  // Auto-trigger generation on first visit if none exists
  useEffect(() => {
    if (!authLoading && user && !isLoading && !story && !generate.isPending && !generate.isError) {
      generate.mutate(undefined);
    }
  }, [authLoading, user, isLoading, story, generate]);

  // Mark task complete when story is shown
  useEffect(() => {
    if (story && !isTaskCompletedToday("daily-story")) {
      markTaskCompletedToday("daily-story");
    }
  }, [story]);

  /**
   * The story, one sentence to a card.
   *
   * Newer stories carry an authored `sentences` array; the ones already in the
   * table are four whole-paragraph columns, so they are split here and their
   * translations lined up by position — which only happens when the counts
   * agree (see `pairSentences`). Whatever that leaves unmatched still has the
   * whole-story blocks below to fall back on.
   */
  const lines = useMemo<ReaderSentence[]>(() => {
    if (!story) return [];
    if (story.sentences && story.sentences.length > 0) return story.sentences;
    return pairSentences({
      arabic: story.body_arabic,
      transliteration: story.body_transliteration,
      english: story.body_english,
      literal: story.body_english_literal,
    });
  }, [story]);

  const perSentenceEnglish = lines.some((l) => l.english || l.literal);
  const perSentenceTransliteration = lines.some((l) => l.transliteration);

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex justify-center pt-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </AppShell>
    );
  }
  if (!user) {
    return (
      <AppShell>
        <div className="text-center pt-20 space-y-3">
          <p className="text-muted-foreground">Sign in to read your daily story.</p>
          <Button onClick={() => navigate("/auth")}>Sign in</Button>
        </div>
      </AppShell>
    );
  }

  const errMessage = generate.error instanceof Error ? generate.error.message : "";
  const notEnough = errMessage.toLowerCase().includes("vocab");

  return (
    <AppShell>
      <div className="space-y-4 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Today's Story</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          A fresh ~200-word story built from words you already know plus a few new ones.
        </p>

        {(isLoading || generate.isPending) && !story && (
          <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
            {/* Only the generation is a long AI wait; the plain fetch keeps a spinner. */}
            {generate.isPending ? (
              <LoadingPanel task="story" variant="inline" />
            ) : (
              <>
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading…</p>
              </>
            )}
          </div>
        )}

        {generate.isError && !story && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
            <p className="text-sm">
              {notEnough
                ? "Add a few more words to your deck (My Words) to unlock today's story."
                : `Could not generate today's story. ${errMessage}`}
            </p>
            <div className="flex justify-center gap-2">
              {notEnough ? (
                <Button onClick={() => navigate("/my-words")}>Go to My Words</Button>
              ) : (
                <Button onClick={() => generate.mutate(undefined)} variant="outline" className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Try again
                </Button>
              )}
            </div>
          </div>
        )}

        {story && (
          <article className="rounded-2xl border-2 border-primary/20 bg-card p-5 sm:p-6 shadow-lg space-y-4">
            <header className="space-y-2 border-b border-border pb-3">
              <h2 dir="rtl" className="text-2xl font-bold text-right" style={{ fontFamily: "'Noto Sans Arabic', serif" }}>
                {story.title}
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{story.dialect}</Badge>
                {story.new_words?.length > 0 && (
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    {story.new_words.length} new word{story.new_words.length === 1 ? "" : "s"}
                  </Badge>
                )}
                {isTaskCompletedToday("daily-story") && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                    <Check className="h-3 w-3" /> Done for today
                  </Badge>
                )}
              </div>
            </header>

            <SentenceReader
              body={story.body_arabic}
              sentences={lines}
              source="daily-story"
              revealByDefault={showEnglish}
              arabicClassName="text-lg"
            />

            {/* Whole-story fallbacks: only for a story whose paragraphs could
                not be lined up sentence by sentence, so nothing is lost. */}
            {!perSentenceTransliteration && story.body_transliteration && (
              <p className="text-sm text-muted-foreground italic">
                {story.body_transliteration}
              </p>
            )}

            {!perSentenceEnglish && (
              <div className="flex justify-start">
                <AskAISentence
                  arabic={story.body_arabic}
                  english={story.body_english ?? undefined}
                  variant="chip"
                />
              </div>
            )}

            {!perSentenceEnglish && showEnglish && story.body_english && (
              <div className="border-t border-border pt-3">
                <TranslationPair
                  variant="compact"
                  literal={story.body_english_literal}
                  natural={story.body_english}
                />
              </div>
            )}

            {story.new_words?.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">New words introduced</p>
                <div className="flex flex-wrap gap-2" dir="rtl">
                  {story.new_words.map((w, i) => (
                    <Badge key={i} variant="outline" className="text-base">{w}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() =>
                  generate.mutate({ force: true }, {
                    onSuccess: () => toast.success("Fresh story generated"),
                    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
                  })
                }
                disabled={generate.isPending}
              >
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Regenerate
              </Button>
            </div>
          </article>
        )}
      </div>
    </AppShell>
  );
};

export default DailyStoryPage;
