import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { Switch } from "@/components/ui/switch";
import { useDialect } from "@/contexts/DialectContext";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { HomeButton } from "@/components/HomeButton";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useAddXP } from "@/hooks/useGamification";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { cn } from "@/lib/utils";
import { MarkUnknownsProvider, useMarkUnknowns } from "@/contexts/MarkUnknownsContext";
import { MarkUnknownsToggle } from "@/components/shared/MarkUnknownsToggle";
import { SaveUnknownsBar } from "@/components/shared/SaveUnknownsBar";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { TranslationPair } from "@/components/shared/TranslationPair";
import {
  BookOpen,
  Check,
  X,
  RotateCcw,
  Loader2,
  ChevronRight,
  Sparkles,
  BookmarkPlus,
  Eye,
  EyeOff,
  MessageCircle,
  Send,
  ArrowLeft,
  Languages,
} from "lucide-react";

type Difficulty = "beginner" | "intermediate" | "advanced";
type Mode = "select" | "passage" | "qa";

interface VocabItem {
  arabic: string;
  english: string;
  inContext: string;
}

interface PassageLine {
  arabic: string;
  english: string;
  literal?: string;
  transliteration?: string;
}

interface Question {
  question: string;
  questionEnglish: string;
  options: { text: string; textEnglish: string; correct: boolean }[];
}

interface Passage {
  title: string;
  titleEnglish: string;
  lines: PassageLine[];
  passage?: string;
  passageEnglish?: string;
  difficulty: Difficulty;
  vocabulary: VocabItem[];
  questions: Question[];
}

interface QAMessage {
  role: "user" | "assistant";
  content: string;
  lines?: PassageLine[];
  vocabulary?: VocabItem[];
  followUp?: string;
}

/**
 * Hard ceiling on a passage generation. The edge function budgets itself
 * GENERATION_BUDGET_MS (95s) and returns a real error past that; this is that
 * plus network slack. Without it a slow or wedged request left the learner on
 * an indefinite "Generating passage..." spinner with no way back.
 */
const PASSAGE_TIMEOUT_MS = 110_000;

/** The pre-check for a hand-published passage is a plain indexed select. */
const LIBRARY_QUERY_TIMEOUT_MS = 10_000;

class PassageTimeoutError extends Error {
  constructor() {
    super("Passage generation timed out");
    this.name = "PassageTimeoutError";
  }
}

/** Reject with PassageTimeoutError if `promise` hasn't settled in `ms`. */
const withTimeout = <T,>(promise: PromiseLike<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PassageTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
};

const DIFFICULTY_CONFIG = {
  beginner: { label: "Beginner", color: "bg-green-500/20 text-green-700 dark:text-green-400", xp: 10 },
  intermediate: { label: "Intermediate", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", xp: 15 },
  advanced: { label: "Advanced", color: "bg-red-500/20 text-red-700 dark:text-red-400", xp: 20 },
};

interface WordEnrichment {
  definition?: string;
  root?: string;
  transliteration?: string;
  otherUses?: { arabic: string; english: string }[];
}

/** Fetch definition + root + transliteration + other uses for a word via AI */
const enrichWord = async (word: string, dialect: string): Promise<WordEnrichment> => {
  try {
    const { data, error } = await supabase.functions.invoke("word-enrichment", {
      body: { word, dialect },
    });
    if (error) throw error;
    return {
      definition: data?.definition || undefined,
      root: data?.root || undefined,
      transliteration: data?.transliteration || undefined,
      otherUses: Array.isArray(data?.uses) ? data.uses : [],
    };
  } catch {
    return {};
  }
};

// ─── Tappable Arabic Line Component ───
const TappableArabicLine = ({
  line,
  lineIdx,
  wordTranslations,
  onWordTap,
  isAuthenticated,
  onSaveFlashcard,
  revealedLines,
  onToggleLine,
}: {
  line: PassageLine;
  lineIdx: number;
  wordTranslations: Record<string, { translation: string; lineEnglish: string; enrichment?: WordEnrichment; enriching?: boolean }>;
  onWordTap: (word: string, lineIdx: number) => void;
  isAuthenticated: boolean;
  onSaveFlashcard: (arabic: string, english: string, root?: string, sentence?: { arabic: string; english: string }, transliteration?: string) => void;
  revealedLines: Set<number>;
  onToggleLine: (idx: number) => void;
}) => {
  const markUnknowns = useMarkUnknowns();

  return (
  <div className="space-y-1">
    <p className="text-lg leading-relaxed font-arabic text-foreground flex flex-wrap justify-end gap-1" dir="rtl">
      {line.arabic.split(/\s+/).map((word, wIdx) => {
        const cleanWord = word.replace(/[،.؟!,]/g, "").trim();
        const wordData = wordTranslations[cleanWord];
        const marking = markUnknowns.enabled;
        const marked = marking && markUnknowns.isMarked(cleanWord);

        if (marking) {
          return (
            <span
              key={wIdx}
              onClick={() =>
                cleanWord &&
                markUnknowns.toggle({
                  arabic: cleanWord,
                  sentence_text: line.arabic,
                  sentence_english: line.english,
                })
              }
              className={cn(
                "cursor-pointer rounded px-0.5 transition-colors",
                marked
                  ? "bg-yellow-300/70 text-foreground dark:bg-yellow-500/40"
                  : "hover:bg-yellow-200/40"
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
                onClick={() => onWordTap(word, lineIdx)}
                className={cn(
                  "cursor-pointer rounded px-0.5 transition-colors",
                  wordData
                    ? "text-primary underline underline-offset-4 decoration-primary/30"
                    : "hover:bg-primary/10"
                )}
              >
                {word}
              </span>
            </PopoverTrigger>
            {wordData && (
              <PopoverContent className="w-64 p-3" side="top">
                <div className="space-y-2">
                  <p className="font-bold text-foreground font-arabic text-lg" dir="rtl">{cleanWord}</p>
                  <p className="text-sm text-muted-foreground">{wordData.translation}</p>

                  {wordData.enriching ? (
                    <div className="flex items-center gap-2 pt-1">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Loading root & uses…</span>
                    </div>
                  ) : wordData.enrichment?.root ? (
                    <div className="pt-1 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground">Root</p>
                      <p className="font-arabic text-sm text-foreground" dir="rtl">{wordData.enrichment.root}</p>
                    </div>
                  ) : null}

                  {wordData.enrichment?.otherUses && wordData.enrichment.otherUses.length > 0 && (
                    <div className="pt-1 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Other forms</p>
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

                  {isAuthenticated && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs mt-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSaveFlashcard(cleanWord, wordData.translation, wordData.enrichment?.root, { arabic: line.arabic, english: line.english }, wordData.enrichment?.transliteration);
                      }}
                    >
                      <BookmarkPlus className="h-3 w-3 mr-1" />
                      Save to My Words
                    </Button>
                  )}
                </div>
              </PopoverContent>
            )}
          </Popover>
        );
      })}
    </p>

    <div className="flex items-center gap-1">
      <button
        onClick={() => onToggleLine(lineIdx)}
        className="text-muted-foreground hover:text-foreground transition-colors p-1"
      >
        {revealedLines.has(lineIdx) ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </button>
      {revealedLines.has(lineIdx) && (
        <div className="flex-1 space-y-1">
          {line.transliteration && (
            <p className="text-xs text-muted-foreground/80 tracking-wide" dir="ltr">
              {line.transliteration}
            </p>
          )}
          <TranslationPair
            variant="compact"
            literal={line.literal}
            natural={line.english}
          />
        </div>
      )}
      <AskAISentence arabic={line.arabic} english={line.english} variant="chip" />
    </div>
  </div>
  );
};

const ReadingPractice = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { activeDialect } = useDialect();
  const { difficulty: userDifficulty } = useUserLevel();
  const addXP = useAddXP();
  const addVocab = useAddUserVocabulary();

  // Session-persisted state
  const [savedSession, setSavedSession] = useState<{
    difficulty: Difficulty | null;
    passage: Passage | null;
    currentQuestion: number;
    answers: (number | null)[];
    showResults: boolean;
    quizStarted: boolean;
  } | null>(() => {
    try {
      const raw = localStorage.getItem('session_reading_practice');
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.savedAt > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('session_reading_practice');
        return null;
      }
      return entry.data;
    } catch { return null; }
  });

  const [mode, setMode] = useState<Mode>("select");
  const [difficulty, setDifficulty] = useState<Difficulty | null>(savedSession?.difficulty ?? null);
  const [passage, setPassage] = useState<Passage | null>(savedSession?.passage ?? null);

  usePageAiContext(
    useMemo(
      () =>
        passage
          ? {
              kind: "passage" as const,
              title: passage.title,
              summary: `Reading a ${passage.difficulty} practice passage.`,
              content: passage.lines.map((l) => l.arabic).join(" "),
            }
          : null,
      [passage],
    ),
  );
  const [loading, setLoading] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [revealedLines, setRevealedLines] = useState<Set<number>>(new Set());
  const [currentQuestion, setCurrentQuestion] = useState(savedSession?.currentQuestion ?? 0);
  const [answers, setAnswers] = useState<(number | null)[]>(savedSession?.answers ?? []);
  const [showResults, setShowResults] = useState(savedSession?.showResults ?? false);
  const [quizStarted, setQuizStarted] = useState(savedSession?.quizStarted ?? false);
  const [showEnglish, setShowEnglish] = useState(false);

  // Word-level translation state
  const [wordTranslations, setWordTranslations] = useState<Record<string, { translation: string; lineEnglish: string; enrichment?: WordEnrichment; enriching?: boolean }>>({});

  // Q&A state
  const [qaMessages, setQaMessages] = useState<QAMessage[]>([]);
  const [qaInput, setQaInput] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaDifficulty, setQaDifficulty] = useState<Difficulty>("beginner");
  const [qaRevealedLines, setQaRevealedLines] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  /** Bumped per generation so a cancelled request can't land on the screen later. */
  const loadRequestRef = useRef(0);

  // Restore passage mode if we had a saved session
  useEffect(() => {
    if (savedSession?.passage && savedSession?.difficulty) {
      setMode("passage");
    }
  }, []);

  // Persist important state to localStorage
  useEffect(() => {
    if (!passage) return;
    try {
      const entry = {
        data: { difficulty, passage, currentQuestion, answers, showResults, quizStarted },
        savedAt: Date.now(),
      };
      localStorage.setItem('session_reading_practice', JSON.stringify(entry));
    } catch {}
  }, [difficulty, passage, currentQuestion, answers, showResults, quizStarted]);

  // Scroll to bottom of Q&A chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [qaMessages, qaLoading]);

  /** Normalize passage data */
  const normalizePassage = (raw: any): Passage => {
    let lines: PassageLine[] = raw.lines || [];
    if (lines.length === 0 && raw.passage) {
      const arabicSentences = raw.passage.split(/(?<=[.!؟،])\s+/).filter(Boolean);
      const englishSentences = (raw.passageEnglish || "").split(/(?<=[.!?])\s+/).filter(Boolean);
      lines = arabicSentences.map((s: string, i: number) => ({
        arabic: s.trim(),
        english: (englishSentences[i] || "").trim(),
      }));
    }
    return {
      title: raw.title,
      titleEnglish: raw.titleEnglish || raw.title_english || "",
      lines: lines.map((l) => ({
        arabic: l.arabic,
        english: l.english,
        literal: l.literal || undefined,
        transliteration: l.transliteration || undefined,
      })),
      difficulty: raw.difficulty,
      vocabulary: raw.vocabulary || [],
      questions: raw.questions || [],
    };
  };

  const loadPassage = async (selectedDifficulty: Difficulty) => {
    const requestId = ++loadRequestRef.current;
    const isStale = () => loadRequestRef.current !== requestId;

    setDifficulty(selectedDifficulty);
    setMode("passage");
    setLoading(true);
    setPassage(null);
    setQuizStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setShowResults(false);
    setRevealedLines(new Set());
    setWordTranslations({});

    try {
      // Bounded too: this runs before the edge function, so a stalled query here
      // hung the spinner just as effectively as a stalled generation did. It is
      // only a shortcut to a hand-published passage though, so if it stalls we
      // fall through and generate rather than failing the whole load.
      let approved: unknown[] | null = null;
      try {
        const res = await withTimeout(
          supabase
            .from("reading_passages" as any)
            .select("*")
            .eq("status", "published")
            .eq("difficulty", selectedDifficulty)
            .eq("dialect", activeDialect)
            .limit(10),
          LIBRARY_QUERY_TIMEOUT_MS,
        );
        approved = res.data as unknown[] | null;
      } catch (e) {
        console.warn("Published-passage lookup failed; generating instead", e);
      }

      if (isStale()) return;

      if (approved && approved.length > 0) {
        const picked = (approved as any[])[Math.floor(Math.random() * approved.length)];
        const p = normalizePassage({
          title: picked.title,
          titleEnglish: picked.title_english,
          passage: picked.passage,
          passageEnglish: picked.passage_english,
          lines: picked.lines,
          difficulty: selectedDifficulty,
          vocabulary: picked.vocabulary,
          questions: picked.questions,
        });
        setPassage(p);
        setAnswers(new Array(p.questions.length).fill(null));
        return;
      }

      // No userVocab: the passage is now built from a server-side learner
      // profile (supabase/functions/_shared/learnerProfile.ts) using real SRS
      // state. What used to be sent here was `useAllWords` — the entire
      // curriculum vocabulary, shuffled — described to the model as "words the
      // student knows", which is exactly what it wasn't.
      // One silent re-attempt: the server now returns an honest 503 the moment
      // its own generation budget is spent, and a second try usually lands
      // because the slow/flaky drafting model is skipped on the retry path.
      const invokePassage = () =>
        withTimeout(
          supabase.functions.invoke("reading-passage", {
            body: {
              difficulty: selectedDifficulty,
              topic: customTopic.trim() || undefined,
              dialect: activeDialect,
            },
          }),
          PASSAGE_TIMEOUT_MS,
        );

      let { data, error } = await invokePassage();
      if (!isStale() && (error || !data?.passage)) {
        console.warn("Passage generation failed; retrying once", error);
        ({ data, error } = await invokePassage());
      }

      if (isStale()) return;
      if (error) throw error;

      if (data.passage) {
        const p = normalizePassage(data.passage);
        setPassage(p);
        setAnswers(new Array(p.questions.length).fill(null));
      } else {
        throw new Error("No passage generated");
      }
    } catch (e) {
      if (isStale()) return;
      console.error("Failed to load passage:", e);
      toast.error(
        e instanceof PassageTimeoutError
          ? "The writer took too long. Please try again."
          : "Couldn't write a passage just now. Please try again.",
      );
      setDifficulty(null);
      setMode("select");
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  };

  const toggleLineTranslation = (index: number) => {
    setRevealedLines((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleQaLineTranslation = (key: string) => {
    setQaRevealedLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleWordTap = async (word: string, lineIdx: number, contextLines?: PassageLine[], contextVocab?: VocabItem[]) => {
    const cleanWord = word.replace(/[،.؟!,]/g, "").trim();
    if (!cleanWord) return;
    if (wordTranslations[cleanWord]) return;

    const lines = contextLines || passage?.lines || [];
    const vocab = contextVocab || passage?.vocabulary || [];

    const line = lines[lineIdx];
    const lineEnglish = line?.english || "";

    const vocabMatch = vocab.find(
      (v) => cleanWord.includes(v.arabic) || v.arabic.includes(cleanWord)
    );
    const translation = vocabMatch?.english || "";

    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { translation, lineEnglish, enriching: true },
    }));

    const enrichment = await enrichWord(cleanWord, activeDialect);
    const definition = enrichment?.definition || translation || `In context: "${lineEnglish}"`;
    setWordTranslations((prev) => ({
      ...prev,
      [cleanWord]: { ...prev[cleanWord], translation: definition, enrichment, enriching: false },
    }));
  };

  const saveAsFlashcard = (
    arabic: string,
    english: string,
    root?: string,
    sentence?: { arabic: string; english: string },
    transliteration?: string,
  ) => {
    if (!isAuthenticated) {
      toast.error("Sign in to save flashcards");
      return;
    }
    addVocab.mutate(
      {
        word_arabic: arabic,
        word_english: english,
        root: root || undefined,
        transliteration: transliteration || undefined,
        source: "reading-practice",
        sentence_text: sentence?.arabic || undefined,
        sentence_english: sentence?.english || undefined,
      },
      {
        onSuccess: () => toast.success("Saved to My Words!"),
        onError: () => toast.error("Failed to save"),
      }
    );
  };

  const handleAnswer = (optionIndex: number) => {
    if (answers[currentQuestion] !== null) return;
    const newAnswers = [...answers];
    newAnswers[currentQuestion] = optionIndex;
    setAnswers(newAnswers);

    const question = passage?.questions[currentQuestion];
    if (question?.options[optionIndex]?.correct && isAuthenticated) {
      const xpAmount = DIFFICULTY_CONFIG[difficulty!].xp;
      addXP.mutate({ amount: xpAmount, reason: "reading" });
    }
  };

  const nextQuestion = () => {
    if (currentQuestion < (passage?.questions.length || 0) - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      setShowResults(true);
      markTaskCompletedToday("reading");
    }
  };

  const resetSession = () => {
    // Orphan any in-flight generation so a late response can't yank the learner
    // back onto a passage they already walked away from.
    loadRequestRef.current++;
    setLoading(false);
    setMode("select");
    setDifficulty(null);
    setPassage(null);
    setQuizStarted(false);
    setCurrentQuestion(0);
    setAnswers([]);
    setShowResults(false);
    setRevealedLines(new Set());
    setWordTranslations({});
    localStorage.removeItem('session_reading_practice');
  };

  // ─── Q&A functions ───

  const sendQAQuestion = async (questionText?: string) => {
    const text = questionText || qaInput.trim();
    if (!text || qaLoading) return;

    const userMsg: QAMessage = { role: "user", content: text };
    setQaMessages((prev) => [...prev, userMsg]);
    setQaInput("");
    setQaLoading(true);

    try {
      // Build history for context (last 6 messages)
      const recentHistory = qaMessages.slice(-6).map((m) => ({
        role: m.role,
        content: m.role === "user" ? m.content : m.lines?.map((l) => l.arabic).join(" ") || m.content,
      }));

      const { data, error } = await supabase.functions.invoke("reading-qa", {
        body: {
          question: text,
          difficulty: qaDifficulty,
          dialect: activeDialect,
          history: recentHistory,
        },
      });

      if (error) throw error;

      const answer = data?.answer;
      if (answer) {
        const assistantMsg: QAMessage = {
          role: "assistant",
          content: answer.lines?.map((l: PassageLine) => l.arabic).join(" ") || "",
          lines: answer.lines || [],
          vocabulary: answer.vocabulary || [],
          followUp: answer.followUp || undefined,
        };
        setQaMessages((prev) => [...prev, assistantMsg]);

        if (isAuthenticated) {
          addXP.mutate({ amount: 5, reason: "reading" });
        }
      } else {
        throw new Error("No answer");
      }
    } catch (e: any) {
      console.error("Q&A error:", e);
      const errMsg = e?.message || "Failed to get answer";
      toast.error(errMsg);
      // Remove the user message if we failed
      setQaMessages((prev) => prev.slice(0, -1));
    } finally {
      setQaLoading(false);
    }
  };

  const resetQA = () => {
    setQaMessages([]);
    setQaInput("");
    setWordTranslations({});
    setQaRevealedLines(new Set());
  };

  // Annotated so the accumulator isn't inferred from the (nullable) element type.
  const score = answers.reduce<number>((acc, ans, idx) => {
    if (ans !== null && passage?.questions[idx]?.options[ans]?.correct) return acc + 1;
    return acc;
  }, 0);

  // ── Mode selection ──
  if (mode === "select") {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2 justify-center">Reading Practice <InfoHint {...PAGE_HINTS["reading-practice"]} size="md" /></h1>
            <p className="text-muted-foreground">Read and learn in Arabic</p>
          </div>

          {/* Mode cards */}
          <div className="grid gap-3">
            {/* Passage mode */}
            <button
              onClick={() => setMode("passage")}
              className="w-full p-5 rounded-2xl text-left bg-card border border-border hover:border-primary/40 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <BookOpen className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">Read a Passage</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Read a story or scenario with comprehension quiz
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground mt-1 shrink-0" />
              </div>
            </button>

            {/* Q&A mode */}
            <button
              onClick={() => setMode("qa")}
              className="w-full p-5 rounded-2xl text-left bg-card border border-border hover:border-primary/40 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/30 flex items-center justify-center shrink-0">
                  <MessageCircle className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">Ask Anything</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Ask questions on any topic and get answers in {activeDialect === "Egyptian" ? "Egyptian" : activeDialect === "Yemeni" ? "Yemeni" : "Gulf"} Arabic
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground mt-1 shrink-0" />
              </div>
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Q&A Mode ──
  if (mode === "qa") {
    return (
      <AppShell>
        <div className="flex flex-col h-[calc(100vh-5rem)] max-h-[calc(100vh-5rem)]">
          {/* Header */}
          <div className="flex items-center justify-between py-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => { resetQA(); setMode("select"); }}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <select
                value={qaDifficulty}
                onChange={(e) => setQaDifficulty(e.target.value as Difficulty)}
                className="text-xs rounded-lg border border-border bg-card px-2 py-1.5 text-foreground"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
              {qaMessages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={resetQA}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 pb-3">
            {qaMessages.length === 0 && !qaLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-accent/30 flex items-center justify-center">
                  <MessageCircle className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-1">Ask Anything</h2>
                  <p className="text-sm text-muted-foreground">
                    Ask about any topic and get a response in {activeDialect === "Egyptian" ? "Egyptian" : activeDialect === "Yemeni" ? "Yemeni" : "Gulf"} Arabic. Tap words for translations!
                  </p>
                </div>
                {/* Suggestion chips */}
                <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                  {[
                    "What's the weather like in Dubai?",
                    "Tell me about Arabic coffee",
                    "How do people greet each other?",
                    "What do you eat for breakfast?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendQAQuestion(suggestion)}
                      className="text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {qaMessages.map((msg, msgIdx) => (
              <div key={msgIdx} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5">
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ) : (
                  <div className="max-w-[95%] space-y-3">
                    {/* Arabic response lines */}
                    <div className="bg-card border border-border rounded-2xl rounded-bl-md p-3 space-y-2">
                      <p className="text-xs text-muted-foreground mb-1">Tap words for translation • Eye icon for English</p>
                      {msg.lines?.map((line, lineIdx) => {
                        const lineKey = `${msgIdx}-${lineIdx}`;
                        return (
                          <TappableArabicLine
                            key={lineKey}
                            line={line}
                            lineIdx={lineIdx}
                            wordTranslations={wordTranslations}
                            onWordTap={(w, idx) => handleWordTap(w, idx, msg.lines, msg.vocabulary)}
                            isAuthenticated={isAuthenticated}
                            onSaveFlashcard={saveAsFlashcard}
                            revealedLines={qaRevealedLines.has(lineKey) ? new Set([lineIdx]) : new Set()}
                            onToggleLine={() => toggleQaLineTranslation(lineKey)}
                          />
                        );
                      })}
                    </div>

                    {/* Vocabulary */}
                    {msg.vocabulary && msg.vocabulary.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-1">
                        {msg.vocabulary.map((v, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-secondary/80"
                            onClick={() => saveAsFlashcard(v.arabic, v.english)}
                          >
                            {v.arabic}{showEnglish ? ` — ${v.english}` : ""}
                            {isAuthenticated && <BookmarkPlus className="h-2.5 w-2.5 ml-1 inline" />}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Follow-up suggestion */}
                    {msg.followUp && (
                      <button
                        onClick={() => sendQAQuestion(msg.followUp!)}
                        disabled={qaLoading}
                        className="text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                      >
                        💬 {msg.followUp}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {qaLoading && (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border pt-3 pb-2">
            <form
              onSubmit={(e) => { e.preventDefault(); sendQAQuestion(); }}
              className="flex items-center gap-2"
            >
              <input
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                placeholder="Ask anything in English..."
                className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={qaLoading}
              />
              <Button type="submit" size="icon" disabled={qaLoading || !qaInput.trim()} className="shrink-0 rounded-xl">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Passage: Difficulty selection ──
  if (!difficulty) {
    return (
      <AppShell>
        <div className="py-8 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="sm" onClick={() => setMode("select")}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </div>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Read a Passage</h1>
            <p className="text-muted-foreground">Read Arabic passages and test your comprehension</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="custom-topic" className="text-sm font-medium text-muted-foreground">
              Describe a scenario (optional)
            </label>
            <textarea
              id="custom-topic"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. ordering coffee at a café, visiting the doctor, shopping at the gold souk..."
              className="flex w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[72px]"
              maxLength={200}
            />
            {customTopic.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{customTopic.length}/200</p>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground text-center">Select difficulty</p>
            {(["beginner", "intermediate", "advanced"] as Difficulty[]).map((level) => (
              <button
                key={level}
                onClick={() => loadPassage(level)}
                disabled={loading}
                className={cn(
                  "w-full p-4 rounded-xl text-left bg-card border border-border",
                  "flex items-center justify-between transition-all duration-200",
                  "hover:border-primary/40 active:scale-[0.99] disabled:opacity-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <Badge className={DIFFICULTY_CONFIG[level].color}>{DIFFICULTY_CONFIG[level].label}</Badge>
                  <span className="text-sm text-muted-foreground">+{DIFFICULTY_CONFIG[level].xp} XP per question</span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  // ── Loading ──
  if (loading || !passage) {
    return (
      <AppShell>
        {/*
          The longest wait in the app (PASSAGE_TIMEOUT_MS = 110s), so the deck
          gets a slower dwell — seven messages at 6s land the last one around
          36s and hold it from there.
        */}
        <LoadingPanel task="passage" variant="page" size="lg" intervalMs={6000}>
          <Button variant="ghost" size="sm" onClick={resetSession}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        </LoadingPanel>
      </AppShell>
    );
  }

  // ── Results ──
  if (showResults) {
    return (
      <AppShell>
        <div className="py-8 space-y-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reading Complete!</h1>
          <div className="text-4xl font-bold text-primary">{score}/{passage.questions.length}</div>
          <p className="text-muted-foreground">
            {score === passage.questions.length
              ? "Perfect comprehension! 🎉"
              : score >= passage.questions.length / 2
              ? "Great reading skills! 👍"
              : "Keep practicing! 💪"}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={resetSession}>
              <RotateCcw className="h-4 w-4 mr-2" />
              New Passage
            </Button>
            <Button onClick={() => navigate("/")}>Done</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Reading + Quiz ──
  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={resetSession}>
          <X className="h-4 w-4 mr-1" />
          Exit
        </Button>
        <Badge className={DIFFICULTY_CONFIG[difficulty].color}>{DIFFICULTY_CONFIG[difficulty].label}</Badge>
        <div className="flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">EN</span>
          <Switch checked={showEnglish} onCheckedChange={setShowEnglish} className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4" />
        </div>
      </div>

      {!quizStarted && (
        <div className="flex justify-end mb-3">
          <MarkUnknownsToggle />
        </div>
      )}
      {!quizStarted && (
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-xl font-bold text-foreground font-arabic" dir="rtl">{passage.title}</h2>
            {showEnglish && <p className="text-sm text-muted-foreground animate-in fade-in duration-200">{passage.titleEnglish}</p>}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Tap any word for translation • Tap the eye icon for sentence meaning
            </p>

            {passage.lines.map((line, lineIdx) => (
              <TappableArabicLine
                key={lineIdx}
                line={line}
                lineIdx={lineIdx}
                wordTranslations={wordTranslations}
                onWordTap={(w, idx) => handleWordTap(w, idx)}
                isAuthenticated={isAuthenticated}
                onSaveFlashcard={saveAsFlashcard}
                revealedLines={revealedLines}
                onToggleLine={toggleLineTranslation}
              />
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              Key Vocabulary
            </p>
            <div className="flex flex-wrap gap-2">
              {passage.vocabulary.map((v, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-sm cursor-pointer hover:bg-secondary/80"
                  onClick={() => saveAsFlashcard(v.arabic, v.english)}
                >
                  {v.arabic}{showEnglish ? ` — ${v.english}` : ""}
                  {isAuthenticated && <BookmarkPlus className="h-3 w-3 ml-1.5 inline" />}
                </Badge>
              ))}
            </div>
          </div>

          <Button onClick={() => setQuizStarted(true)} className="w-full" size="lg">
            Start Comprehension Quiz
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Quiz Section */}
      {quizStarted && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Question {currentQuestion + 1} of {passage.questions.length}</span>
              <span className="font-medium text-primary">Score: {score}</span>
            </div>
            <Progress value={((currentQuestion + 1) / passage.questions.length) * 100} className="h-2" />
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="text-center">
              <p className="text-lg font-arabic text-foreground" dir="rtl">{passage.questions[currentQuestion].question}</p>
              {showEnglish && <p className="text-sm text-muted-foreground mt-1 animate-in fade-in duration-200">{passage.questions[currentQuestion].questionEnglish}</p>}
            </div>
            <div className="space-y-2">
              {passage.questions[currentQuestion].options.map((option, i) => {
                const isSelected = answers[currentQuestion] === i;
                const isAnswered = answers[currentQuestion] !== null;
                const isCorrect = option.correct;
                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    disabled={isAnswered}
                    className={cn(
                      "w-full p-4 rounded-xl text-right transition-all border-2",
                      isAnswered
                        ? isCorrect
                          ? "border-green-500 bg-green-500/10"
                          : isSelected
                          ? "border-red-500 bg-red-500/10"
                          : "border-border bg-muted/50"
                        : "border-border hover:border-primary/50 bg-card"
                    )}
                  >
                    <p className="font-arabic text-foreground" dir="rtl">{option.text}</p>
                    {showEnglish && <p className="text-xs text-muted-foreground mt-1 animate-in fade-in duration-200">{option.textEnglish}</p>}
                  </button>
                );
              })}
            </div>
            {answers[currentQuestion] !== null && (
              <Button onClick={nextQuestion} className="w-full">
                {currentQuestion < passage.questions.length - 1 ? "Next Question" : "See Results"}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}
      <SaveUnknownsBar source="reading-practice" />
    </AppShell>
  );
};

const ReadingPracticePage = () => (
  <MarkUnknownsProvider>
    <ReadingPractice />
  </MarkUnknownsProvider>
);

export default ReadingPracticePage;
