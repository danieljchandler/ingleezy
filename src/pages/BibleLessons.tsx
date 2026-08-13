import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, BookMarked, Loader2, Lock, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { useDialect } from "@/contexts/DialectContext";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { DIALECT_FLAGS } from "@/config";
import { useBibleDisplayPrefs } from "@/hooks/useBibleDisplayPrefs";
import { stripTashkil } from "@/lib/bibleDisplayPrefs";
import { toast } from "sonner";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

type BibleLesson = {
  id: string;
  title: string;
  description: string | null;
  book_usfm: string;
  book_name: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  dialect: string;
  dialect_verses: string[];
  formal_verses: string[];
  english_verses: string[];
  cultural_note: string | null;
};

const BibleLessons = () => {
  const navigate = useNavigate();
  const { lessonId } = useParams<{ lessonId?: string }>();
  const { isAuthenticated } = useAuth();
  const { hasAccess, loading: accessLoading } = useBibleAccess();
  const { activeDialect } = useDialect();

  const [lessons, setLessons] = useState<BibleLesson[]>([]);
  const [active, setActive] = useState<BibleLesson | null>(null);
  const [loading, setLoading] = useState(true);

  // Display preferences (from Settings)
  const { prefs, update: updatePrefs } = useBibleDisplayPrefs();

  // ── Fetch list ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("bible_lessons")
        .select("*")
        .eq("dialect", activeDialect)
        .eq("published", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error("Failed to load lessons", { description: error.message });
        setLessons([]);
      } else {
        setLessons((data ?? []) as BibleLesson[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDialect, hasAccess]);

  // ── Sync active lesson from URL ─────────────────────────────────────────
  useEffect(() => {
    if (!lessonId) {
      setActive(null);
      return;
    }
    const found = lessons.find((l) => l.id === lessonId);
    if (found) {
      setActive(found);
      return;
    }
    // Direct deep link — fetch single lesson
    (async () => {
      const { data, error } = await supabase
        .from("bible_lessons")
        .select("*")
        .eq("id", lessonId)
        .maybeSingle();
      if (!error && data) setActive(data as BibleLesson);
    })();
  }, [lessonId, lessons]);

  // ── Access gate ─────────────────────────────────────────────────────────
  if (accessLoading) {
    return (
      <AppShell>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated || !hasAccess) {
    return (
      <AppShell>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">Bible Lessons <InfoHint {...PAGE_HINTS["bible-lessons"]} size="md" /></h1>
          <p className="text-muted-foreground max-w-sm">
            {!isAuthenticated
              ? "Please sign in to access this feature."
              : "This feature is available by invitation only."}
          </p>
          <HomeButton />
        </div>
      </AppShell>
    );
  }

  // ── Reading mode ────────────────────────────────────────────────────────
  if (active) {
    const dialectVerses = Array.isArray(active.dialect_verses)
      ? active.dialect_verses
      : [];
    const formalVerses = Array.isArray(active.formal_verses)
      ? active.formal_verses
      : [];
    const englishVerses = Array.isArray(active.english_verses)
      ? active.english_verses
      : [];

    return (
      <AppShell>
        <div className="min-h-screen bg-background pb-24">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/bible/lessons")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold truncate">{active.title}</h1>
                <p className="text-xs text-muted-foreground truncate">
                  {active.book_name} {active.chapter}:{active.verse_start}
                  {active.verse_end !== active.verse_start
                    ? `–${active.verse_end}`
                    : ""}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {DIALECT_FLAGS[active.dialect as keyof typeof DIALECT_FLAGS] ?? "🗣️"}{" "}
                {active.dialect}
              </Badge>
            </div>

            {/* Quick toggles (synced with Settings) */}
            <div className="flex items-center gap-4 mt-3 text-sm flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={prefs.showArabic}
                  onCheckedChange={(v) => updatePrefs({ showArabic: v })}
                />
                <span>Arabic</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={prefs.showTashkil}
                  onCheckedChange={(v) => updatePrefs({ showTashkil: v })}
                  disabled={!prefs.showArabic}
                />
                <span>Tashkil</span>
              </label>
              {formalVerses.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={prefs.showFormal}
                    onCheckedChange={(v) => updatePrefs({ showFormal: v })}
                  />
                  <span>Formal Arabic</span>
                </label>
              )}
              {englishVerses.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={prefs.showEnglish}
                    onCheckedChange={(v) => updatePrefs({ showEnglish: v })}
                  />
                  <span>English</span>
                </label>
              )}
            </div>
          </div>

          {/* Description / cultural note */}
          {(active.description || active.cultural_note) && (
            <div className="px-4 py-3 border-b bg-muted/20 space-y-1">
              {active.description && (
                <p className="text-sm text-foreground">{active.description}</p>
              )}
              {active.cultural_note && (
                <p className="text-xs text-muted-foreground italic">
                  {active.cultural_note}
                </p>
              )}
            </div>
          )}

          {/* Verses */}
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
              {dialectVerses.map((verse, idx) => {
                const verseNumber = active.verse_start + idx;
                const formal = formalVerses[idx] ?? "";
                const english = englishVerses[idx] ?? "";
                const dialectText = prefs.showTashkil ? verse : stripTashkil(verse);
                const formalText = prefs.showTashkil ? formal : stripTashkil(formal);
                const nothingShown =
                  !prefs.showArabic &&
                  !(prefs.showFormal && formal) &&
                  !(prefs.showEnglish && english);
                return (
                  <div key={idx} className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">
                      Verse {verseNumber}
                    </div>

                    {/* Dialect (primary) */}
                    {prefs.showArabic && (
                      <div
                        dir="rtl"
                        className="text-lg leading-relaxed font-arabic text-primary"
                      >
                        <TappableArabicText
                          text={dialectText}
                          source="bible"
                          sentenceContext={{ arabic: verse, english }}
                        />
                      </div>
                    )}

                    {/* Formal Arabic */}
                    {prefs.showFormal && formal && (
                      <div
                        dir="rtl"
                        className="text-base leading-relaxed font-arabic text-foreground"
                      >
                        <TappableArabicText
                          text={formalText}
                          source="bible"
                          sentenceContext={{ arabic: formal, english }}
                        />
                      </div>
                    )}

                    {/* English */}
                    {prefs.showEnglish && english && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {english}
                      </p>
                    )}

                    {/* Ask AI */}
                    <div className="flex justify-end">
                      <AskAISentence
                        arabic={dialectText || formalText || verse}
                        english={english}
                        variant="chip"
                      />
                    </div>

                    {nothingShown && (
                      <p className="text-xs italic text-muted-foreground">
                        All display options hidden — enable one above or in Settings.
                      </p>
                    )}

                    {idx < dialectVerses.length - 1 && (
                      <div className="border-b border-border/50 pt-2" />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </AppShell>
    );
  }

  // ── List mode ───────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="min-h-screen bg-background p-4 pb-24">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/bible")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <BookMarked className="h-6 w-6 text-primary" />
                Bible Lessons
              </h1>
              <p className="text-sm text-muted-foreground">
                Hand-picked passages in {activeDialect} Arabic with tap-to-translate.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : lessons.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                No lessons yet for {activeDialect}. Check back soon!
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {lessons.map((lesson) => (
                <button
                  key={lesson.id}
                  onClick={() => navigate(`/bible/lessons/${lesson.id}`)}
                  className="w-full text-left p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground">{lesson.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {lesson.book_name} {lesson.chapter}:{lesson.verse_start}
                        {lesson.verse_end !== lesson.verse_start
                          ? `–${lesson.verse_end}`
                          : ""}{" "}
                        · {lesson.dialect_verses?.length ?? 0} verses
                      </p>
                      {lesson.description && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {lesson.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default BibleLessons;
