import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  ALL_BOOKS,
  OLD_TESTAMENT,
  NEW_TESTAMENT,
  ARABIC_VERSIONS,
  ENGLISH_VERSION,
  type BibleBook,
} from "@/data/bibleBooks";
import {
  BookOpen,
  Loader2,
  Lock,
  ChevronRight,
  Languages,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { DIALECT_FLAGS, DIALECT_LABELS } from "@/config";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { VerseAudioButton } from "@/components/bible/VerseAudioButton";

// ─── Types ───────────────────────────────────────────────────────────────────
type ViewMode = "select" | "reading";

interface PassageData {
  arabicVerses: string[];
  englishVerses: string[];
  dialectVerses: string[];
  bookUsfm: string;
  chapter: number;
  dialect: string;
}

// ─── Session persistence helpers ─────────────────────────────────────────────
const STORAGE_KEY = "hakiya_bible_session";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface BibleSession {
  passage: PassageData | null;
  selectedBookUsfm: string | null;
  selectedChapter: number;
  arabicVersion: string;
  showEnglish: boolean;
  showFormal: boolean;
  showDialect: boolean;
  mode: ViewMode;
  savedAt: number;
}

type BibleFunctionResponse = Partial<PassageData> & {
  error?: string;
  fallback?: boolean;
};

function clearSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function makeVerseArray(length: number, source: unknown, fallbackValue = "") {
  return Array.from({ length }, (_, index) => {
    if (!Array.isArray(source)) return fallbackValue;
    return typeof source[index] === "string" ? source[index] : fallbackValue;
  });
}

function normalizePassageData(value: unknown): PassageData | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const rawArabicVerses = candidate.arabicVerses;

  if (!Array.isArray(rawArabicVerses)) return null;

  const arabicVerses = rawArabicVerses.filter(
    (verse): verse is string => typeof verse === "string" && verse.trim().length > 0,
  );

  if (arabicVerses.length === 0) return null;

  return {
    arabicVerses,
    englishVerses: makeVerseArray(arabicVerses.length, candidate.englishVerses),
    dialectVerses: makeVerseArray(arabicVerses.length, candidate.dialectVerses),
    bookUsfm: typeof candidate.bookUsfm === "string" ? candidate.bookUsfm : "",
    chapter:
      typeof candidate.chapter === "number" && Number.isFinite(candidate.chapter)
        ? candidate.chapter
        : 1,
    dialect: typeof candidate.dialect === "string" ? candidate.dialect : "",
  };
}

function loadSession(): BibleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as BibleSession;
    if (Date.now() - session.savedAt > SESSION_TTL_MS) {
      clearSession();
      return null;
    }

    const fallbackArabicVersion = ARABIC_VERSIONS[0]?.code ?? "SVD";
    const normalizedPassage = normalizePassageData(session.passage);

    return {
      passage: normalizedPassage,
      selectedBookUsfm:
        typeof session.selectedBookUsfm === "string" ? session.selectedBookUsfm : null,
      selectedChapter:
        typeof session.selectedChapter === "number" && session.selectedChapter > 0
          ? Math.floor(session.selectedChapter)
          : 1,
      arabicVersion:
        typeof session.arabicVersion === "string" &&
        ARABIC_VERSIONS.some((version) => version.code === session.arabicVersion)
          ? session.arabicVersion
          : fallbackArabicVersion,
      showEnglish: typeof session.showEnglish === "boolean" ? session.showEnglish : false,
      showFormal: typeof session.showFormal === "boolean" ? session.showFormal : true,
      showDialect: typeof session.showDialect === "boolean" ? session.showDialect : true,
      mode:
        session.mode === "reading" && normalizedPassage ? "reading" : "select",
      savedAt:
        typeof session.savedAt === "number" && Number.isFinite(session.savedAt)
          ? session.savedAt
          : Date.now(),
    };
  } catch {
    clearSession();
    return null;
  }
}

function saveSession(session: Omit<BibleSession, "savedAt">) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...session, savedAt: Date.now() })
    );
  } catch {
    // Storage full or blocked — ignore
  }
}

// ─── Retry helper ────────────────────────────────────────────────────────────
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1500
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ─── Component ───────────────────────────────────────────────────────────────
const BibleReadingInner = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { hasAccess, loading: accessLoading } = useBibleAccess();
  const { activeDialect } = useDialect();

  const dialectLabel =
    DIALECT_LABELS[activeDialect as keyof typeof DIALECT_LABELS] ??
    activeDialect;
  const dialectFlag =
    DIALECT_FLAGS[activeDialect as keyof typeof DIALECT_FLAGS];

  // Restore session
  const cached = useRef(loadSession()).current;

  // Selection state
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(() => {
    if (cached?.selectedBookUsfm) {
      return ALL_BOOKS.find((b) => b.usfm === cached.selectedBookUsfm) ?? null;
    }
    return null;
  });
  const [selectedChapter, setSelectedChapter] = useState<number>(
    cached?.selectedChapter ?? 1
  );
  const [arabicVersion, setArabicVersion] = useState<string>(
    cached?.arabicVersion ?? ARABIC_VERSIONS[0].code
  );

  // View state
  const [mode, setMode] = useState<ViewMode>(cached?.mode ?? "select");
  const [passage, setPassage] = useState<PassageData | null>(
    cached?.passage ?? null
  );
  const [loading, setLoading] = useState(false);

  // Toggle states
  const [showEnglish, setShowEnglish] = useState(cached?.showEnglish ?? false);
  const [showFormal, setShowFormal] = useState(cached?.showFormal ?? true);
  const [showDialect, setShowDialect] = useState(cached?.showDialect ?? true);

  // ── Persist on every state change ────────────────────────────────────────
  useEffect(() => {
    saveSession({
      passage,
      selectedBookUsfm: selectedBook?.usfm ?? null,
      selectedChapter,
      arabicVersion,
      showEnglish,
      showFormal,
      showDialect,
      mode,
    });
  }, [
    passage,
    selectedBook,
    selectedChapter,
    arabicVersion,
    showEnglish,
    showFormal,
    showDialect,
    mode,
  ]);

  // ── Fetch passage with retry ─────────────────────────────────────────────
  const fetchPassage = useCallback(async () => {
    if (!selectedBook) return;

    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error } = await supabase.functions.invoke(
          "bible-passage",
          {
            body: {
              arabicVersion,
              englishVersion: ENGLISH_VERSION.code,
              bookNumber: selectedBook.bookNumber,
              bookUsfm: selectedBook.usfm,
              chapter: selectedChapter,
              dialect: activeDialect,
            },
          }
        );

        if (error) {
          const message =
            typeof error === "object" && error !== null && "message" in error
              ? (error as { message: string }).message
              : String(error);
          throw new Error(message);
        }

        const response = data as BibleFunctionResponse | null;

        if (response?.error) {
          throw new Error(response.error);
        }

        const normalizedPassage = normalizePassageData(response);

        if (!normalizedPassage) {
          throw new Error("The passage response was incomplete. Please try again.");
        }

        // Handle fallback signal from edge function
        if (response?.fallback) {
          console.warn("Bible API returned fallback signal");
        }

        return {
          fallback: response?.fallback === true,
          passage: normalizedPassage,
        };
      });

      setPassage(data.passage);
      setMode("reading");

      if (data.fallback) {
        toast.info("Loaded with fallback text", {
          description:
            "Some live translation helpers were unavailable, so the reader kept the passage stable.",
        });
      }
    } catch (err: unknown) {
      console.error("Failed to fetch Bible passage:", err);
      toast.error("Failed to load passage", {
        description:
          err instanceof Error ? err.message : "Please try again later.",
      });
    } finally {
      setLoading(false);
    }
  }, [selectedBook, selectedChapter, arabicVersion, activeDialect]);

  // ── Access gate ──────────────────────────────────────────────────────────
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
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">Bible Reading <InfoHint {...PAGE_HINTS["bible-reading"]} size="md" /></h1>
          <p className="text-muted-foreground max-w-sm">
            {!isAuthenticated
              ? "Please sign in to access this feature."
              : "This feature is available by invitation only. Contact an administrator to request access."}
          </p>
          <HomeButton />
        </div>
      </AppShell>
    );
  }

  // ── Reading mode ─────────────────────────────────────────────────────────
  if (mode === "reading" && passage) {
    const bookMeta = ALL_BOOKS.find((b) => b.usfm === passage.bookUsfm);
    const versionMeta = ARABIC_VERSIONS.find((v) => v.code === arabicVersion);
    const arabicVerses = passage.arabicVerses;
    const englishVerses = makeVerseArray(arabicVerses.length, passage.englishVerses);
    const dialectVerses = makeVerseArray(arabicVerses.length, passage.dialectVerses);

    return (
      <AppShell>
        <div className="min-h-screen bg-background pb-24">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMode("select")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold truncate">
                  {bookMeta?.name ?? passage.bookUsfm} {passage.chapter}
                </h1>
                <p
                  className="text-xs text-muted-foreground truncate font-arabic"
                  dir="rtl"
                >
                  {bookMeta?.nameArabic ?? ""} {passage.chapter}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={fetchPassage}
                disabled={loading}
                title="Reload passage"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
              </Button>
              <Badge variant="outline" className="shrink-0">
                {dialectFlag} {activeDialect}
              </Badge>
            </div>

            {/* Toggle row */}
            <div className="flex items-center gap-4 mt-3 text-sm flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showFormal}
                  onCheckedChange={setShowFormal}
                />
                <span>Formal Arabic</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showDialect}
                  onCheckedChange={setShowDialect}
                />
                <span>{activeDialect} Dialect</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={showEnglish}
                  onCheckedChange={setShowEnglish}
                />
                <span>English (ESV)</span>
              </label>
            </div>
          </div>

          {/* Version info */}
          <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-2 border-b">
            <Languages className="h-3.5 w-3.5" />
            <span>
              Arabic: {versionMeta?.abbreviation ?? "?"} | English: ESV |
              Dialect: {dialectLabel}
            </span>
          </div>

          {/* Verses */}
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
              {arabicVerses.map((verse, idx) => {
                const englishLine = englishVerses[idx] || "";
                const dialectLine = dialectVerses[idx] || "";
                return (
                  <div key={idx} className="space-y-2">
                    {/* Formal Arabic */}
                    {showFormal && (
                      <div dir="rtl" className="text-lg leading-relaxed font-arabic text-foreground">
                        <TappableArabicText
                          text={verse}
                          source="bible"
                          sentenceContext={{ arabic: verse, english: englishLine }}
                        />
                      </div>
                    )}

                    {/* Dialect */}
                    {showDialect && dialectLine && (
                      <div dir="rtl" className="text-lg leading-relaxed font-arabic text-primary">
                        <TappableArabicText
                          text={dialectLine}
                          source="bible"
                          sentenceContext={{ arabic: dialectLine, english: englishLine }}
                        />
                        <div dir="ltr" className="mt-1 flex justify-end">
                          <VerseAudioButton text={dialectLine} dialect={activeDialect} label={`Listen (${dialectLabel})`} />
                        </div>
                      </div>
                    )}

                    {/* English */}
                    {showEnglish && englishLine && (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {englishLine}
                      </p>
                    )}

                    {/* Ask AI */}
                    {(showFormal || showDialect) && (
                      <div className="flex justify-end">
                        <AskAISentence
                          arabic={dialectLine || verse}
                          english={englishLine}
                          variant="chip"
                        />
                      </div>
                    )}

                    {/* Divider */}
                    {idx < arabicVerses.length - 1 && (
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

  // ── Select mode ──────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="min-h-screen bg-background p-4 pb-24">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <HomeButton />
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-primary" />
                Bible Reading
              </h1>
              <p className="text-sm text-muted-foreground">
                Read the Bible in {dialectLabel}
              </p>
            </div>
          </div>

          {/* Curated lessons entry point */}
          <button
            onClick={() => navigate("/bible/lessons")}
            className="w-full p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/30 flex items-center gap-3 transition-all hover:border-amber-500/60 active:scale-[0.99] text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <BookOpen className="h-5 w-5 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Curated Lessons</p>
              <p className="text-xs text-muted-foreground">
                Hand-picked passages in {dialectLabel} — different from the AI reader below
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </button>

          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold pt-2">
            Or browse the full Bible
          </div>

          {/* Arabic Version */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Arabic Translation</label>
            <Select
              value={arabicVersion}
              onValueChange={(v) => setArabicVersion(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Arabic version" />
              </SelectTrigger>
              <SelectContent>
                {ARABIC_VERSIONS.map((v) => (
                  <SelectItem key={v.code} value={v.code}>
                    {v.abbreviation} — {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* English version (read-only info) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">English Translation</label>
            <div className="border rounded-md px-3 py-2 text-sm text-muted-foreground bg-muted/50">
              {ENGLISH_VERSION.abbreviation} — {ENGLISH_VERSION.name}
            </div>
          </div>

          {/* Dialect info */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Dialect</label>
            <div className="border rounded-md px-3 py-2 text-sm bg-muted/50 flex items-center gap-2">
              <span>{dialectFlag}</span>
              <span>{dialectLabel}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                Change dialect in app settings
              </span>
            </div>
          </div>

          {/* Book selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Book</label>
            <Select
              value={selectedBook?.usfm ?? ""}
              onValueChange={(usfm) => {
                const book = ALL_BOOKS.find((b) => b.usfm === usfm) ?? null;
                setSelectedBook(book);
                setSelectedChapter(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a book" />
              </SelectTrigger>
              <SelectContent>
                {/* Old Testament group */}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Old Testament
                </div>
                {OLD_TESTAMENT.map((b) => (
                  <SelectItem key={b.usfm} value={b.usfm}>
                    {b.name}{" "}
                    <span className="text-muted-foreground font-arabic text-xs">
                      ({b.nameArabic})
                    </span>
                  </SelectItem>
                ))}
                {/* New Testament group */}
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">
                  New Testament
                </div>
                {NEW_TESTAMENT.map((b) => (
                  <SelectItem key={b.usfm} value={b.usfm}>
                    {b.name}{" "}
                    <span className="text-muted-foreground font-arabic text-xs">
                      ({b.nameArabic})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Chapter selector */}
          {selectedBook && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Chapter{" "}
                <span className="text-muted-foreground font-normal">
                  (1–{selectedBook.chapters})
                </span>
              </label>
              <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 max-h-48 overflow-y-auto">
                {Array.from(
                  { length: selectedBook.chapters },
                  (_, i) => i + 1
                ).map((ch) => (
                  <Button
                    key={ch}
                    variant={selectedChapter === ch ? "default" : "outline"}
                    size="sm"
                    className="h-9 w-full text-xs"
                    onClick={() => setSelectedChapter(ch)}
                  >
                    {ch}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Load button */}
          <Button
            className="w-full"
            size="lg"
            disabled={!selectedBook || loading}
            onClick={fetchPassage}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading passage…
              </>
            ) : (
              <>
                Read Chapter
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            One chapter at a time to keep AI usage manageable.
          </p>
        </div>
      </div>
    </AppShell>
  );
};

// Wrap in ErrorBoundary so a crash doesn't lose everything
const BibleReading = () => (
  <ErrorBoundary name="BibleReading">
    <BibleReadingInner />
  </ErrorBoundary>
);

export default BibleReading;
