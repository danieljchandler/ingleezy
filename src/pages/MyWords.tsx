import { useState, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useUserVocabulary, useUserVocabularyDueCount, useDeleteUserVocabulary, type UserVocabularyWord } from "@/hooks/useUserVocabulary";
import { useUserPhrases, useUserPhrasesDueCount, useDeleteUserPhrase } from "@/hooks/useUserPhrases";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, Loader2, Shuffle, Sparkles, Quote, MessageCircleQuestion, Upload, CheckSquare, X, Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { arCount } from "@/lib/strings";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { SuggestFlashcardsDialog } from "@/components/mywords/SuggestFlashcardsDialog";
// Lazy + mounted only while open: keeps the heavy Anki parsers (sql.js, fflate)
// out of the My Words chunk until the user actually opens the import dialog.
const ImportFromAnkiDialog = lazy(() =>
  import("@/components/mywords/ImportFromAnkiDialog").then((m) => ({ default: m.ImportFromAnkiDialog })),
);
import { Wand2 } from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { buildWordFamilies, familyKey, formatFamily } from "@/lib/wordFamily";
import { useRootFamilyPrefs } from "@/hooks/useRootFamilyPrefs";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronBack, ChevronOpen } from "@/components/shared/DirectionalIcon";

const MyWords = () => {
  const navigate = useNavigate();
  const [mixAll, setMixAll] = useState(false);
  const { activeDialect } = useDialect();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { data: words, isLoading } = useUserVocabulary(mixAll);
  const { data: stats } = useUserVocabularyDueCount(mixAll);
  const deleteWord = useDeleteUserVocabulary();
  const { data: phrases } = useUserPhrases(mixAll);
  const { data: phraseStats } = useUserPhrasesDueCount(mixAll);
  const deletePhrase = useDeleteUserPhrase();
  const { enabled: rootFamiliesEnabled } = useRootFamilyPrefs();
  const [imageDialogWord, setImageDialogWord] = useState<UserVocabularyWord | null>(null);
  const [expandedContext, setExpandedContext] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [showAllPhrases, setShowAllPhrases] = useState(false);
  const [ankiOpen, setAnkiOpen] = useState(false);
  const [deckFilter, setDeckFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [rootFilter, setRootFilter] = useState<string | null>(null);
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"anki" | "app" | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const queryClient = useQueryClient();

  const CATEGORY_LABELS: Record<string, string> = {
    "transcription": "🎬 Videos",
    "listen": "🎙 Podcast",
    "podcast": "🎙 Podcast",
    "souq-news": "📰 Souq News",
    "reading-practice": "📚 Reading",
    "daily-story": "📔 Stories",
    "discover": "🔍 Discover",
    "tutor-upload": "🎯 Tutor Upload",
    
    "free-chat": "💬 Chat",
    "how-do-i-say": "❓ كيف أقول",
  };
  const categoryLabel = (src: string) => CATEGORY_LABELS[src] || `· ${src}`;

  const sourceCounts = useMemo(() => {
    let anki = 0, app = 0;
    for (const w of words || []) {
      if (w.source === "anki_import") anki++;
      else app++;
    }
    return { anki, app };
  }, [words]);

  const categoryOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of words || []) {
      if (w.source === "anki_import") continue;
      const key = w.source || "other";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [words]);

  const deckOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of words || []) {
      if (w.deck_name) m.set(w.deck_name, (m.get(w.deck_name) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [words]);

  const tagOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of words || []) {
      for (const t of w.tags || []) m.set(t, (m.get(t) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [words]);

  /**
   * Word families, grouped from the deck already in memory.
   *
   * `useUserVocabulary` fetches every word, so grouping here costs a pass over
   * an array rather than a query. Families of one are dropped: a single word is
   * not a pattern, and keeping them would bury the real families under a wall
   * of chips that each filter to exactly one card.
   */
  const rootOptions = useMemo(
    () => buildWordFamilies(words ?? [], { minSize: 2 }),
    [words],
  );

  /**
   * Words nobody has looked up a family for yet — `''` means we looked and
   * found none.
   *
   * The multi-word check reads the ENGLISH side, because that is what the
   * backfill derives from: a phrase has no family of its own, and counting one
   * here would promise a lookup the function resolves for free as "none".
   */
  const rootlessCount = useMemo(
    () => (words ?? []).filter((w) => w.word_family === null && !/\s/.test(w.word_english ?? "")).length,
    [words],
  );

  const filteredWords = useMemo(() => {
    if (!words) return words;
    return words.filter((w) => {
      if (sourceFilter === "anki" && w.source !== "anki_import") return false;
      if (sourceFilter === "app" && w.source === "anki_import") return false;
      if (categoryFilter && w.source !== categoryFilter) return false;
      if (deckFilter && w.deck_name !== deckFilter) return false;
      if (tagFilter && !(w.tags || []).includes(tagFilter)) return false;
      if (rootFilter && familyKey(w.word_family) !== rootFilter) return false;
      return true;
    });
  }, [words, sourceFilter, categoryFilter, deckFilter, tagFilter, rootFilter]);

  /**
   * Look up the roots of words that have none.
   *
   * One call covers up to 120 words; the button stays until there are none
   * left, so a large imported deck is caught up in a few deliberate presses
   * rather than one silent unbounded run.
   */
  const findRoots = async () => {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-word-roots", {
        // The count on the button comes from the list on screen, which is
        // scoped to the active dialect unless "All dialects" is on. The run has
        // to be scoped the same way or the number never goes down.
        body: mixAll ? {} : { dialect: activeDialect },
      });
      if (showCapToastIfLimited(error, data)) return;
      if (error) throw error;

      const found = Number((data as { resolved?: number } | null)?.resolved ?? 0);
      toast.success(
        found > 0
          ? `لقينا عائلات لـ${found} ${found === 1 ? "كلمة" : "كلمات"}`
          : "ما لقينا عائلات جديدة في هذي الدفعة",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] }),
        queryClient.invalidateQueries({ queryKey: ["root-index"] }),
      ]);
    } catch {
      toast.error("تعذّر البحث عن العائلات الآن");
    } finally {
      setBackfilling(false);
    }
  };

  const selectSource = (next: "anki" | "app" | null) => {
    setSourceFilter(next);
    setDeckFilter(null);
    setCategoryFilter(null);
  };

  const toggleContext = (id: string) => {
    setExpandedContext((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async (wordId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteWord.mutateAsync(wordId);
      toast.success("تم حذف الكلمة");
    } catch (error) {
      toast.error("فشل حذف الكلمة");
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const selectAllVisible = () => {
    if (!filteredWords) return;
    setSelectedIds(new Set(filteredWords.map((w) => w.id)));
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      // Delete in chunks of 200 to keep URL length sane
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { error } = await supabase.from("user_vocabulary").delete().in("id", slice);
        if (error) throw error;
      }
      toast.success(
        arCount(ids.length, {
          one: "حُذفت بطاقة واحدة",
          two: "حُذفت بطاقتان",
          few: "بطاقات محذوفة",
          many: "بطاقة محذوفة",
        }),
      );
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
      exitSelectMode();
    } catch (err: any) {
      console.error("[mywords] bulk delete error", err);
      toast.error(err?.message || "Failed to delete selected cards");
    } finally {
      setBulkDeleting(false);
      setConfirmBulkDelete(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">سجّل الدخول لعرض كلماتك</h2>
          <p className="text-muted-foreground mb-6">
            Save vocabulary from transcriptions and review them with spaced repetition.
          </p>
          <Button onClick={() => navigate("/auth")}>تسجيل الدخول</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/")}
          className="text-muted-foreground"
        >
          <ChevronBack className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">كلماتي</h1>
          <InfoHint {...PAGE_HINTS["my-words"]} />
        </div>
        <span className="text-sm text-muted-foreground">
          ({words?.length || 0})
        </span>
        <Button
          variant={mixAll ? "default" : "outline"}
          size="sm"
          className="ms-auto gap-1.5"
          onClick={() => setMixAll(!mixAll)}
        >
          <Shuffle className="h-4 w-4" />
          {mixAll ? "All Dialects" : activeDialect}
        </Button>
        <InfoHint
          title="اخلط كل اللهجات"
          body="Toggle this to review words from every dialect at once. Leave it off to stay focused on your current dialect only."
        />
      </div>

      {/* AI suggest button */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Button
          onClick={() => setSuggestOpen(true)}
          variant="outline"
          className="w-full gap-2"
        >
          <Wand2 className="h-4 w-4" />اقتراحات الذكاء الاصطناعي</Button>
        <Button
          onClick={() => navigate("/translate")}
          variant="outline"
          className="w-full gap-2"
        >
          <Languages className="h-4 w-4" />أضف من نص</Button>
        <Button
          onClick={() => setAnkiOpen(true)}
          variant="outline"
          className="w-full gap-2"
        >
          <Upload className="h-4 w-4" />استيراد من Anki</Button>
      </div>

      {/* Review button */}
      {stats && stats.dueCount > 0 && (
        <Button
          onClick={() => navigate("/review/my-words")}
          className="w-full mb-6 gap-2"
          size="lg"
        >
          Review {stats.dueCount} due words
          <ChevronOpen className="h-4 w-4" />
        </Button>
      )}

      {/* My Phrases section */}
      <div className="mb-8 rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">عباراتي</h2>
            <InfoHint {...PAGE_HINTS["my-phrases"]} />
            <span className="text-xs text-muted-foreground">
              ({phraseStats?.total ?? 0})
            </span>
          </div>
          {phraseStats && phraseStats.dueCount > 0 && (
            <Button
              size="sm"
              onClick={() => navigate("/review/my-phrases")}
              className="gap-1.5"
            >
              Review {phraseStats.dueCount}
              <ChevronOpen className="h-4 w-4" />
            </Button>
          )}
        </div>

        {(!phrases || phrases.length === 0) ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Save phrases from{" "}
            <button
              className="text-primary underline underline-offset-2"
              onClick={() => navigate("/how-do-i-say")}
            >
              كيف أقول…؟
            </button>{" "}
            to start practicing them here.
          </div>
        ) : (
          <>
            {(showAllPhrases ? phrases : phrases.slice(0, 4)).map((p, i, arr) => (
              <div
                key={p.id}
                className={cn(
                  "flex items-center justify-between gap-3 p-3",
                  i < arr.length - 1 && "border-b border-border"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-base font-semibold text-foreground truncate"
                    dir="rtl"
                  >
                    {p.phrase_arabic}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.phrase_english}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await deletePhrase.mutateAsync(p.id);
                      toast.success("أُزيلت العبارة");
                    } catch {
                      toast.error("تعذّرت إزالة العبارة");
                    }
                  }}
                  disabled={deletePhrase.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {phrases.length > 4 && (
              <button
                className="w-full p-3 text-xs text-muted-foreground hover:text-foreground border-t border-border bg-muted/20"
                onClick={() => setShowAllPhrases((v) => !v)}
              >
                {showAllPhrases ? "Show less" : `Show all ${phrases.length}`}
              </button>
            )}
          </>
        )}
      </div>
      {(!words || words.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">لا كلمات محفوظة بعد</h2>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Start a lesson or watch a clip in Discover — tap any Arabic word to save it here, then review it with flashcards.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <Button className="flex-1 h-11" onClick={() => navigate("/learn")}>ابدأ درساً</Button>
            <Button variant="outline" className="flex-1 h-11" onClick={() => navigate("/discover")}>تصفح اكتشف</Button>
          </div>
        </div>
      )}

      {/* Source + Category + Deck + Tag filters */}
      {words && words.length > 0 && (
        <div className="mb-3 space-y-2">
          {/* Source row */}
          {(sourceCounts.anki > 0 && sourceCounts.app > 0) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">المصدر</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => selectSource(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    !sourceFilter
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >الكل</button>
                <button
                  onClick={() => selectSource(sourceFilter === "anki" ? null : "anki")}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    sourceFilter === "anki"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  📥 Anki <span className="opacity-70">· {sourceCounts.anki}</span>
                </button>
                <button
                  onClick={() => selectSource(sourceFilter === "app" ? null : "app")}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    sourceFilter === "app"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  ✨ App <span className="opacity-70">· {sourceCounts.app}</span>
                </button>
              </div>
            </div>
          )}

          {/* Category row (shown when App selected, or when no source filter & no anki cards) */}
          {sourceFilter !== "anki" && categoryOptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">التصنيف</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    !categoryFilter
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >الكل</button>
                {categoryOptions.map(([src, n]) => (
                  <button
                    key={src}
                    onClick={() => setCategoryFilter(categoryFilter === src ? null : src)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs border transition-colors",
                      categoryFilter === src
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {categoryLabel(src)} <span className="opacity-70">· {n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Decks row (Anki only) */}
          {sourceFilter !== "app" && deckOptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">المجموعات</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setDeckFilter(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    !deckFilter
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >الكل</button>
                {deckOptions.map(([name, n]) => (
                  <button
                    key={name}
                    onClick={() => setDeckFilter(deckFilter === name ? null : name)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs border transition-colors",
                      deckFilter === name
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    📚 {name} <span className="opacity-70">· {n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tagOptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">الوسوم</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                <button
                  onClick={() => setTagFilter(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    !tagFilter
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >الكل</button>
                {tagOptions.slice(0, 40).map(([tag, n]) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs border transition-colors",
                      tagFilter === tag
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    #{tag} <span className="opacity-70">· {n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/*
            Word families. Hidden entirely when there are none — a learner
            whose words have no families yet should not be shown an empty shelf
            labelled with something they cannot use.
          */}
          {rootFamiliesEnabled && (rootOptions.length > 0 || rootlessCount > 0) && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">عائلات الكلمات</p>
              {/* No chip row at all before any family exists — an "All" chip on
                  its own filters nothing and only asks to be clicked. */}
              {rootOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                <button
                  onClick={() => setRootFilter(null)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    !rootFilter
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >الكل</button>
                {rootOptions.slice(0, 24).map((family) => (
                  <button
                    key={family.key}
                    onClick={() =>
                      setRootFilter(rootFilter === family.key ? null : family.key)
                    }
                    title={`${family.words.length} كلمة من هذي العائلة`}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs border transition-colors",
                      rootFilter === family.key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="font-english">{family.display}</span>{" "}
                    <span className="opacity-70">· {family.words.length}</span>
                  </button>
                ))}
              </div>
              )}

              {/*
                The only part of this feature that spends credits, and it never
                runs on its own. Most cards have no family because only one save
                path ever wrote one — this is how an imported deck catches up,
                at a moment the learner picks.
              */}
              {rootlessCount > 0 && (
                <button
                  onClick={() => setConfirmBackfill(true)}
                  disabled={backfilling}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                >
                  {backfilling && <Loader2 className="h-3 w-3 animate-spin" />}
                  {backfilling
                    ? "ندوّر العائلات…"
                    : `دوّر عائلات لـ${rootlessCount} ${rootOptions.length > 0 ? "كلمة إضافية" : "كلمة"}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk select toolbar */}
      {filteredWords && filteredWords.length > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          {!selectMode ? (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setSelectMode(true)}>
              <CheckSquare className="h-4 w-4" />تحديد</Button>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{selectedIds.size} selected</span>
                <button className="text-xs text-primary hover:underline" onClick={selectAllVisible}>
                  Select all ({filteredWords.length})
                </button>
                {selectedIds.size > 0 && (
                  <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button>
                )}
              </div>
              <div className="flex items-center gap-1.5 ms-auto">
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  disabled={selectedIds.size === 0 || bulkDeleting}
                  onClick={() => setConfirmBulkDelete(true)}
                >
                  {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete {selectedIds.size > 0 ? selectedIds.size : ""}
                </Button>
                <Button variant="ghost" size="sm" onClick={exitSelectMode} disabled={bulkDeleting}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirmBackfill} onOpenChange={setConfirmBackfill}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تبي ندوّر عائلات كلماتك؟</AlertDialogTitle>
            <AlertDialogDescription>
              هذا يسأل الذكاء عن عائلة الكلمة لِما يصل إلى 120 كلمة ما لها عائلة بعد،
              ويستهلك جزءاً من حصتك اليومية. كل كلمة تُسأل مرة وحدة بس.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={backfilling}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setConfirmBackfill(false); findRoots(); }}
              disabled={backfilling}
            >دوّر العائلات</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} card{selectedIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              هذا يحذف الكلمات المختارة وتقدّم مراجعتها نهائياً. ما فيه تراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Word list */}
      {filteredWords && filteredWords.length > 0 && (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {filteredWords.map((word, index) => {
            const hasContext = !!word.sentence_text;
            const isExpanded = expandedContext.has(word.id);
            return (
            <div
              key={word.id}
              className={cn(
                "p-4",
                "hover:bg-muted/50 transition-colors",
                selectMode && selectedIds.has(word.id) && "bg-primary/5",
                selectMode && "cursor-pointer",
                index < (filteredWords?.length ?? 0) - 1 && "border-b border-border"
              )}
              onClick={selectMode ? () => toggleSelected(word.id) : undefined}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectMode && (
                    <Checkbox
                      checked={selectedIds.has(word.id)}
                      onCheckedChange={() => toggleSelected(word.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                    />
                  )}
                  {word.image_url ? (
                    <img
                      src={word.image_url}
                      alt={word.word_english}
                      loading="lazy"
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-lg object-cover border border-border flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted/50 border border-dashed border-border flex items-center justify-center flex-shrink-0">
                      <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                  )}
                  <div>
                    <span
                      className="text-lg font-bold text-foreground block"
                      dir="rtl"
                    >
                      {word.word_arabic}
                    </span>
                    {/*
                      Falls back to the raw stored value when it will not
                      canonicalise, so a card whose family was written oddly
                      still shows what it has rather than silently losing it —
                      it just cannot be filtered on. Pre-flip Arabic roots land
                      here too, which is the honest place for them: visible as
                      leftover data, never presented as an English family.
                    */}
                    {word.word_family && (
                      familyKey(word.word_family) && !selectMode ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const key = familyKey(word.word_family)!;
                            setRootFilter(rootFilter === key ? null : key);
                          }}
                          title="أظهر كل كلماتك من هذي العائلة"
                          className="text-xs font-english text-muted-foreground bg-muted hover:bg-muted/70 hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
                        >
                          {formatFamily(word.word_family)}
                        </button>
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {formatFamily(word.word_family) ?? word.word_family}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden sm:inline">
                    {word.word_english}
                  </span>
                  {hasContext && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8 hover:text-primary",
                        isExpanded ? "text-primary" : "text-muted-foreground"
                      )}
                      onClick={(e) => { e.stopPropagation(); toggleContext(word.id); }}
                      title="أظهر الجملة الأصلية"
                    >
                      <Quote className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={(e) => { e.stopPropagation(); setImageDialogWord(word); }}
                    title="ولّد صورة"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    // Icon-only and destructive, on data the learner created
                    // themselves. Without a name it announces as just "button".
                    aria-label={`احذف ${word.word_english}`}
                    onClick={(e) => handleDelete(word.id, e)}
                    disabled={deleteWord.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {hasContext && isExpanded && (
                <div className="mt-3 ms-1 border-l-2 border-primary/30 ps-3 py-1 bg-muted/30 rounded-r">
                  <p className="text-xs text-muted-foreground mb-1">السياق الأصلي</p>
                  <p
                    className="text-sm text-foreground/90 font-arabic leading-relaxed"
                    dir="rtl"
                  >
                    {word.sentence_text}
                  </p>
                  {word.sentence_english && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      {word.sentence_english}
                    </p>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Image generation dialog */}
      <GenerateImageDialog
        word={imageDialogWord}
        open={!!imageDialogWord}
        onOpenChange={(open) => { if (!open) setImageDialogWord(null); }}
        onImageSaved={async (wordId, imageUrl) => {
          const { error } = await supabase
            .from("user_vocabulary")
            .update({ image_url: imageUrl })
            .eq("id", wordId);
          if (error) {
            toast.error("تعذّر حفظ الصورة");
            return;
          }
          queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
          queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
        }}
      />

      <SuggestFlashcardsDialog open={suggestOpen} onOpenChange={setSuggestOpen} />
      {ankiOpen && (
        <Suspense fallback={null}>
          <ImportFromAnkiDialog open={ankiOpen} onOpenChange={setAnkiOpen} />
        </Suspense>
      )}
    </AppShell>
  );
};

export default MyWords;
