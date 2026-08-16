import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles, RefreshCw, Check } from "lucide-react";
import { IconBack } from "@/components/shared/DirectionalIcon";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
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
   * The story, one ENGLISH sentence to a card, its Arabic scaffold behind a
   * reveal. Newer stories carry an authored `sentences` array; a story whose
   * split was discarded falls back to splitting body_english on sentence
   * punctuation, with the whole-story Arabic block below covering the
   * scaffold.
   */
  const lines = useMemo<Array<{ english: string; arabic?: string; literal?: string }>>(() => {
    if (!story) return [];
    if (story.sentences && story.sentences.length > 0) {
      return (story.sentences as Array<{ english?: string; arabic?: string; literal?: string }>)
        .filter((sentence) => typeof sentence.english === "string" && sentence.english.trim())
        .map((sentence) => ({
          english: sentence.english as string,
          arabic: sentence.arabic,
          literal: sentence.literal,
        }));
    }
    const body = story.body_english ?? "";
    return body
      .split(/(?<=[.!?])\s+/)
      .map((english) => english.trim())
      .filter(Boolean)
      .map((english) => ({ english }));
  }, [story]);

  const perSentenceArabic = lines.some((l) => l.arabic || l.literal);

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
          <p className="text-muted-foreground">سجّل دخولك عشان تقرأ قصة اليوم.</p>
          <Button onClick={() => navigate("/auth")}>سجّل دخول</Button>
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
          <IconBack className="h-4 w-4" /> رجوع
        </button>

        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">قصة اليوم</h1>
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
                <p className="text-sm text-muted-foreground">نحمّل…</p>
              </>
            )}
          </div>
        )}

        {generate.isError && !story && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
            <p className="text-sm">
              {notEnough
                ? "أضف كم كلمة لرزمتك (كلماتي) عشان تفتح قصة اليوم."
                : `Could not generate today's story. ${errMessage}`}
            </p>
            <div className="flex justify-center gap-2">
              {notEnough ? (
                <Button onClick={() => navigate("/my-words")}>روح لكلماتي</Button>
              ) : (
                <Button onClick={() => generate.mutate(undefined)} variant="outline" className="gap-2">
                  <RefreshCw className="h-4 w-4" /> جرّب مرة ثانية
                </Button>
              )}
            </div>
          </div>
        )}

        {story && (
          <article className="rounded-2xl border-2 border-primary/20 bg-card p-5 sm:p-6 shadow-lg space-y-4">
            <header className="space-y-2 border-b border-border pb-3">
              <h2 dir="rtl" className="text-2xl font-bold text-right" >
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
                    <Check className="h-3 w-3" /> خلّصنا اليوم
                  </Badge>
                )}
              </div>
            </header>

            {/* One English sentence per card; the Arabic scaffold sits under
                each sentence, shown when the global reveal preference is on. */}
            <div className="space-y-3">
              {lines.map((line, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <p className="font-english text-lg leading-relaxed">
                    <TappableEnglishText
                      text={line.english}
                      sentenceArabic={line.arabic}
                      source="daily-story"
                    />
                  </p>
                  {showEnglish && line.arabic && (
                    <p dir="rtl" className="font-arabic text-base text-muted-foreground">
                      {line.arabic}
                    </p>
                  )}
                  {showEnglish && line.literal && (
                    <p dir="rtl" className="font-arabic text-sm text-muted-foreground/80">
                      {line.literal}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Whole-story scaffold fallback: a story whose sentence split was
                discarded still shows its Arabic below, so nothing is lost. */}
            {!perSentenceArabic && showEnglish && story.body_arabic && (
              <div className="border-t border-border pt-3">
                <p dir="rtl" className="font-arabic text-base text-muted-foreground">
                  {story.body_arabic}
                </p>
              </div>
            )}

            {story.new_words?.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">كلمات جديدة</p>
                <div className="flex flex-wrap gap-2">
                  {story.new_words.map((w, i) => (
                    <Badge key={i} variant="outline" className="text-base font-english">{w}</Badge>
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
                    onSuccess: () => toast.success("ولّدنا قصة جديدة"),
                    onError: (e) => toast.error(e instanceof Error ? e.message : "فشل"),
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
