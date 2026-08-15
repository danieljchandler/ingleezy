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
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { TranslationPair } from "@/components/shared/TranslationPair";
import {
  BookOpen,
  Check,
  X,
  RotateCcw,
  Loader2,
  Sparkles,
  BookmarkPlus,
  Eye,
  EyeOff,
  MessageCircle,
  Send,
  Languages
} from "lucide-react";
import { IconBack } from "@/components/shared/DirectionalIcon";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

type Difficulty = "beginner" | "intermediate" | "advanced";
type Mode = "select" | "passage" | "qa";

interface VocabItem {
  arabic: string;
  english: string;
  inContext: string;
}

interface PassageLine {
  /** The sentence as read — English is the studied language. */
  english: string;
  /** Dialect-Arabic translation (scaffold). */
  arabic: string;
  /** Word-for-word Arabic gloss preserving the English word order. */
  literal?: string;
}

interface Question {
  /** The question, in English. */
  question: string;
  questionArabic: string;
  options: { text: string; textArabic: string; correct: boolean }[];
}

interface Passage {
  title: string;
  titleArabic: string;
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
  beginner: { label: "مبتدئ", color: "bg-green-500/20 text-green-700 dark:text-green-400", xp: 10 },
  intermediate: { label: "متوسط", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", xp: 15 },
  advanced: { label: "متقدّم", color: "bg-red-500/20 text-red-700 dark:text-red-400", xp: 20 },
};

// ─── English line with tappable words + Arabic scaffold ───
const TappableEnglishLine = ({
  line,
  lineIdx,
  onSaveFlashcard,
  revealedLines,
  onToggleLine,
}: {
  line: PassageLine;
  lineIdx: number;
  onSaveFlashcard: (arabic: string, english: string, root?: string, sentence?: { arabic: string; english: string }, transliteration?: string) => void;
  revealedLines: Set<number>;
  onToggleLine: (idx: number) => void;
}) => {
  return (
  <div className="space-y-1">
    <p className="font-english text-lg leading-relaxed text-foreground">
      <TappableEnglishText
        text={line.english}
        sentenceArabic={line.arabic}
        source="reading-practice"
        onSaveWord={(w) =>
          onSaveFlashcard(w.arabic ?? "", w.english, undefined, { arabic: line.arabic, english: line.english })
        }
      />
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
      {/* Same per-line Ask AI affordance the other readers carry; dropped by
          accident when the word-enrichment machinery was removed. */}
      <AskAISentence arabic={line.arabic} english={line.english} variant="chip" />
      {revealedLines.has(lineIdx) && (
        <div className="flex-1 space-y-1">
          <p dir="rtl" className="font-arabic text-sm text-foreground">{line.arabic}</p>
          {line.literal && (
            <p dir="rtl" className="font-arabic text-xs text-muted-foreground/80">{line.literal}</p>
          )}
        </div>
      )}
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
              content: passage.lines.map((l) => l.english).join(" "),
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
      // Editorial rows store the passage as one ENGLISH block; the Arabic
      // scaffold (when the library carries one) is paired by position.
      const englishSentences = raw.passage.split(/(?<=[.!?])\s+/).filter(Boolean);
      const arabicSentences = (raw.passageArabic || "").split(/(?<=[.!؟،])\s+/).filter(Boolean);
      lines = englishSentences.map((sentence: string, i: number) => ({
        english: sentence.trim(),
        arabic: (arabicSentences[i] || "").trim(),
      }));
    }
    return {
      title: raw.title,
      titleArabic: raw.titleArabic || raw.title_arabic || "",
      lines: lines.map((l) => ({
        english: l.english,
        arabic: l.arabic,
        literal: l.literal || undefined,
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
          titleArabic: picked.title_arabic ?? picked.titleArabic ?? "",
          passage: picked.passage,
          passageArabic: picked.passage_arabic ?? "",
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
          ? "الكاتب تأخّر. جرّب مرة ثانية."
          : "ما قدرنا نكتب نصاً الحين. جرّب مرة ثانية.",
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

  const saveAsFlashcard = (
    arabic: string,
    english: string,
    root?: string,
    sentence?: { arabic: string; english: string },
    transliteration?: string,
  ) => {
    if (!isAuthenticated) {
      toast.error("سجّل دخولك عشان تحفظ البطاقات");
      return;
    }
    addVocab.mutate(
      {
        word_arabic: arabic,
        word_english: english,
        word_family: root || undefined,
        transliteration: transliteration || undefined,
        source: "reading-practice",
        sentence_text: sentence?.arabic || undefined,
        sentence_english: sentence?.english || undefined,
      },
      {
        onSuccess: () => toast.success("حفظناها في كلماتي!"),
        onError: () => toast.error("تعذّر الحفظ"),
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
        content: m.role === "user" ? m.content : m.lines?.map((l) => l.english).join(" ") || m.content,
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
          content: answer.lines?.map((l: PassageLine) => l.english).join(" ") || "",
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
      const errMsg = e?.message || "ما وصلنا جواب";
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
            <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2 justify-center">تمرين القراءة <InfoHint {...PAGE_HINTS["reading-practice"]} size="md" /></h1>
            <p className="text-muted-foreground">اقرأ إنجليزي وتعلّم منه</p>
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
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">اقرأ نصاً</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    اقرأ قصة أو موقفاً مع أسئلة فهم
                  </p>
                </div>
                <ChevronOpen className="h-5 w-5 text-muted-foreground mt-1 shrink-0" />
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
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">اسأل أي شي</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    اسأل عن أي موضوع وخذ الجواب بالإنجليزي مع شرح بلهجتك
                  </p>
                </div>
                <ChevronOpen className="h-5 w-5 text-muted-foreground mt-1 shrink-0" />
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
              <IconBack className="h-4 w-4 me-1" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <select
                value={qaDifficulty}
                onChange={(e) => setQaDifficulty(e.target.value as Difficulty)}
                className="text-xs rounded-lg border border-border bg-card px-2 py-1.5 text-foreground"
              >
                <option value="beginner">مبتدئ</option>
                <option value="intermediate">متوسط</option>
                <option value="advanced">متقدّم</option>
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
                  <h2 className="text-lg font-semibold text-foreground mb-1">اسأل أي شي</h2>
                  <p className="text-sm text-muted-foreground">
                    اسأل عن أي موضوع والجواب يجيك بالإنجليزي. اضغط أي كلمة تشوف معناها!
                  </p>
                </div>
                {/* Suggestion chips */}
                <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                  {[
                    "وش جو دبي هالأيام؟",
                    "كلّمني عن القهوة العربية",
                    "كيف الناس يسلّمون على بعض؟",
                    "وش تاكلون بالفطور؟",
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
                      <p className="text-xs text-muted-foreground mb-1">اضغط الكلمة تشوف معناها • أيقونة العين للعربي</p>
                      {msg.lines?.map((line, lineIdx) => {
                        const lineKey = `${msgIdx}-${lineIdx}`;
                        return (
                          <TappableEnglishLine
                            key={lineKey}
                            line={line}
                            lineIdx={lineIdx}
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
                            {v.english}{showEnglish ? ` — ${v.arabic}` : ""}
                            {isAuthenticated && <BookmarkPlus className="h-2.5 w-2.5 ms-1 inline" />}
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
                placeholder="اسأل أي شي…"
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
              <IconBack className="h-4 w-4 me-1" />
              Back
            </Button>
          </div>

          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">اقرأ نصاً</h1>
            <p className="text-muted-foreground">اقرأ نصوصاً إنجليزية واختبر فهمك</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="custom-topic" className="text-sm font-medium text-muted-foreground">
              اوصف الموقف (اختياري)
            </label>
            <textarea
              id="custom-topic"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="مثلاً: تطلب قهوة في كافيه، تزور الدكتور، تتسوّق…"
              className="flex w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[72px]"
              maxLength={200}
            />
            {customTopic.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{customTopic.length}/200</p>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground text-center">اختر المستوى</p>
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
                <ChevronOpen className="h-5 w-5 text-muted-foreground" />
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
            <X className="h-4 w-4 me-1" />
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
          <h1 className="text-2xl font-bold text-foreground">خلّصت القراءة!</h1>
          <div className="text-4xl font-bold text-primary">{score}/{passage.questions.length}</div>
          <p className="text-muted-foreground">
            {score === passage.questions.length
              ? "فهم كامل! 🎉"
              : score >= passage.questions.length / 2
              ? "قراءة ممتازة! 👍"
              : "واصل التمرين! 💪"}
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={resetSession}>
              <RotateCcw className="h-4 w-4 me-2" />
              نص جديد
            </Button>
            <Button onClick={() => navigate("/")}>تمام</Button>
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
          <X className="h-4 w-4 me-1" />
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
            <h2 className="font-english text-xl font-bold text-foreground">{passage.title}</h2>
            {showEnglish && <p dir="rtl" className="font-arabic text-sm text-muted-foreground animate-in fade-in duration-200">{passage.titleArabic}</p>}
          </div>

          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Tap any word for translation • Tap the eye icon for sentence meaning
            </p>

            {passage.lines.map((line, lineIdx) => (
              <TappableEnglishLine
                key={lineIdx}
                line={line}
                lineIdx={lineIdx}
                onSaveFlashcard={saveAsFlashcard}
                revealedLines={revealedLines}
                onToggleLine={toggleLineTranslation}
              />
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              كلمات مهمة
            </p>
            <div className="flex flex-wrap gap-2">
              {passage.vocabulary.map((v, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-sm cursor-pointer hover:bg-secondary/80"
                  onClick={() => saveAsFlashcard(v.arabic, v.english)}
                >
                  {v.english}{showEnglish ? ` — ${v.arabic}` : ""}
                  {isAuthenticated && <BookmarkPlus className="h-3 w-3 ms-1.5 inline" />}
                </Badge>
              ))}
            </div>
          </div>

          <Button onClick={() => setQuizStarted(true)} className="w-full" size="lg">
            ابدأ أسئلة الفهم
            <ChevronOpen className="h-4 w-4 ms-1" />
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
              <p className="font-english text-lg text-foreground">{passage.questions[currentQuestion].question}</p>
              {showEnglish && <p dir="rtl" className="font-arabic text-sm text-muted-foreground mt-1 animate-in fade-in duration-200">{passage.questions[currentQuestion].questionArabic}</p>}
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
                      "w-full p-4 rounded-xl text-left transition-all border-2",
                      isAnswered
                        ? isCorrect
                          ? "border-green-500 bg-green-500/10"
                          : isSelected
                          ? "border-red-500 bg-red-500/10"
                          : "border-border bg-muted/50"
                        : "border-border hover:border-primary/50 bg-card"
                    )}
                  >
                    <p className="font-english text-foreground">{option.text}</p>
                    {showEnglish && <p dir="rtl" className="font-arabic text-xs text-muted-foreground mt-1 animate-in fade-in duration-200">{option.textArabic}</p>}
                  </button>
                );
              })}
            </div>
            {answers[currentQuestion] !== null && (
              <Button onClick={nextQuestion} className="w-full">
                {currentQuestion < passage.questions.length - 1 ? "السؤال التالي" : "شوف النتيجة"}
                <ChevronOpen className="h-4 w-4 ms-1" />
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
