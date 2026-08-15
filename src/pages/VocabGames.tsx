import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { toast } from "sonner";
import {
  Gamepad2,
  Shuffle,
  Grid3X3,
  PenLine,
  Trophy,
  Loader2,
  RotateCcw,
  Check,
  X,
  Sparkles,
  Timer
} from "lucide-react";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

type GameMode = "menu" | "matching" | "memory" | "fill-blank";

interface WordPair {
  id: string;
  word_arabic: string;
  word_english: string;
}

// ─── WORD MATCHING GAME ─────────────────────────
const WordMatchingGame = ({ words, onComplete }: { words: WordPair[]; onComplete: (score: number, total: number) => void }) => {
  const gameWords = useMemo(() => words.slice(0, 6), [words]);
  // Anchored on the ENGLISH word: the learner reads the target language and
  // retrieves its meaning, not the other way round.
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrongPair, setWrongPair] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);

  const shuffledArabic = useMemo(
    () => [...gameWords].sort(() => Math.random() - 0.5),
    [gameWords]
  );

  const handleArabicClick = (word: WordPair) => {
    if (!selectedEnglish || matched.has(word.id)) return;

    if (word.word_english === selectedEnglish) {
      setMatched((prev) => new Set([...prev, word.id]));
      setSelectedEnglish(null);

      if (matched.size + 1 === gameWords.length) {
        setTimeout(() => onComplete(gameWords.length - mistakes, gameWords.length), 500);
      }
    } else {
      setWrongPair(word.id);
      setMistakes((m) => m + 1);
      setTimeout(() => {
        setWrongPair(null);
        setSelectedEnglish(null);
      }, 600);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">وصّل الأزواج</h2>
        <p className="text-sm text-muted-foreground">المس كلمة إنجليزية، ثم معناها</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* English column — the anchor */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase text-center mb-1">إنجليزي</p>
          {gameWords.map((w) => (
            <button
              key={w.id + "-en"}
              disabled={matched.has(w.id)}
              onClick={() => setSelectedEnglish(w.word_english)}
              className={cn(
                "font-english w-full p-3 rounded-xl text-center font-semibold transition-all text-lg",
                "border-2",
                matched.has(w.id)
                  ? "bg-primary/10 border-primary/30 text-primary opacity-60"
                  : selectedEnglish === w.word_english
                  ? "bg-primary text-primary-foreground border-primary shadow-lg scale-[1.02]"
                  : "bg-card border-border hover:border-primary/40"
              )}
            >
              {w.word_english}
            </button>
          ))}
        </div>

        {/* Arabic column — the meanings to match against */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase text-center mb-1">المعنى</p>
          {shuffledArabic.map((w) => (
            <button
              key={w.id + "-ar"}
              disabled={matched.has(w.id) || !selectedEnglish}
              onClick={() => handleArabicClick(w)}
              className={cn(
                "w-full p-3 rounded-xl text-center font-medium transition-all",
                "border-2",
                matched.has(w.id)
                  ? "bg-primary/10 border-primary/30 text-primary opacity-60"
                  : wrongPair === w.id
                  ? "bg-destructive/10 border-destructive text-destructive animate-shake"
                  : "bg-card border-border hover:border-primary/40"
              )}
              style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
            >
              {w.word_arabic}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <Badge variant="secondary" className="text-sm">
          {matched.size}/{gameWords.length} موصولة · {mistakes} أخطاء
        </Badge>
      </div>
    </div>
  );
};

// ─── MEMORY CARD GAME ────────────────────────────
interface MemoryCard {
  id: string;
  text: string;
  pairId: string;
  isArabic: boolean;
}

const MemoryCardGame = ({ words, onComplete }: { words: WordPair[]; onComplete: (score: number, total: number) => void }) => {
  const gameWords = useMemo(() => words.slice(0, 6), [words]);

  const cards = useMemo(() => {
    const c: MemoryCard[] = [];
    gameWords.forEach((w) => {
      c.push({ id: w.id + "-ar", text: w.word_arabic, pairId: w.id, isArabic: true });
      c.push({ id: w.id + "-en", text: w.word_english, pairId: w.id, isArabic: false });
    });
    return c.sort(() => Math.random() - 0.5);
  }, [gameWords]);

  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<MemoryCard[]>([]);
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);

  const handleFlip = (card: MemoryCard) => {
    if (locked || flipped.has(card.id) || matched.has(card.pairId)) return;

    const newFlipped = new Set(flipped);
    newFlipped.add(card.id);
    setFlipped(newFlipped);

    const newSelection = [...selection, card];
    setSelection(newSelection);

    if (newSelection.length === 2) {
      setMoves((m) => m + 1);
      setLocked(true);

      if (newSelection[0].pairId === newSelection[1].pairId && newSelection[0].id !== newSelection[1].id) {
        // Match!
        setMatched((prev) => new Set([...prev, newSelection[0].pairId]));
        setSelection([]);
        setLocked(false);

        if (matched.size + 1 === gameWords.length) {
          setTimeout(() => onComplete(Math.max(0, gameWords.length * 2 - moves), gameWords.length * 2), 500);
        }
      } else {
        // No match
        setTimeout(() => {
          setFlipped((prev) => {
            const next = new Set(prev);
            next.delete(newSelection[0].id);
            next.delete(newSelection[1].id);
            return next;
          });
          setSelection([]);
          setLocked(false);
        }, 800);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">بطاقات الذاكرة</h2>
        <p className="text-sm text-muted-foreground">اعثر على أزواج الكلمة ومعناها</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {cards.map((card) => {
          const isRevealed = flipped.has(card.id) || matched.has(card.pairId);
          return (
            <button
              key={card.id}
              onClick={() => handleFlip(card)}
              className={cn(
                "aspect-square rounded-xl flex items-center justify-center p-2 transition-all duration-300",
                "border-2 text-center",
                matched.has(card.pairId)
                  ? "bg-primary/10 border-primary/30"
                  : isRevealed
                  ? "bg-card border-primary shadow-md"
                  : "bg-muted border-border hover:border-primary/30 hover:bg-muted/80"
              )}
            >
              {isRevealed ? (
                <span
                  className={cn(
                    "font-semibold",
                    card.isArabic ? "text-base" : "text-sm",
                    matched.has(card.pairId) ? "text-primary" : "text-foreground"
                  )}
                  dir={card.isArabic ? "rtl" : "ltr"}
                  style={card.isArabic ? { fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" } : undefined}
                >
                  {card.text}
                </span>
              ) : (
                <span className="text-2xl text-muted-foreground/40">?</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <Badge variant="secondary" className="text-sm">
          {matched.size}/{gameWords.length} pairs · {moves} moves
        </Badge>
      </div>
    </div>
  );
};

// ─── FILL IN THE BLANK ──────────────────────────
const FillBlankGame = ({ words, onComplete }: { words: WordPair[]; onComplete: (score: number, total: number) => void }) => {
  const gameWords = useMemo(() => words.slice(0, 8).sort(() => Math.random() - 0.5), [words]);
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  const word = gameWords[current];

  const handleCheck = () => {
    const isCorrect = input.trim().toLowerCase() === word.word_english.toLowerCase();
    setShowAnswer(true);
    if (isCorrect) setScore((s) => s + 1);
    setResults((r) => [...r, isCorrect]);
  };

  const handleNext = () => {
    if (current + 1 >= gameWords.length) {
      onComplete(score + (results[results.length - 1] ? 0 : 0), gameWords.length);
      return;
    }
    setCurrent((c) => c + 1);
    setInput("");
    setShowAnswer(false);
  };

  if (!word) return null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">أكمل الفراغ</h2>
        <p className="text-sm text-muted-foreground">اكتب الكلمة بالإنجليزية</p>
      </div>

      {/* Progress */}
      <div className="flex gap-1">
        {gameWords.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-all",
              i < current
                ? results[i]
                  ? "bg-primary"
                  : "bg-destructive"
                : i === current
                ? "bg-primary/40"
                : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Question Card */}
      <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">كيف تقولها بالإنجليزية؟</p>
        <p
          className="text-4xl font-bold text-foreground"
          dir="rtl"
          style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
        >
          {word.word_arabic}
        </p>

        {!showAnswer ? (
          <div className="space-y-3 pt-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && handleCheck()}
              placeholder="اكتبها بالإنجليزي…"
              className="w-full p-3 rounded-xl bg-muted border border-border text-center text-foreground text-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <Button onClick={handleCheck} disabled={!input.trim()} className="w-full">
              تحقق
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <div
              className={cn(
                "p-4 rounded-xl",
                input.trim().toLowerCase() === word.word_english.toLowerCase()
                  ? "bg-primary/10 border border-primary/30"
                  : "bg-destructive/10 border border-destructive/30"
              )}
            >
              {input.trim().toLowerCase() === word.word_english.toLowerCase() ? (
                <div className="flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span className="font-semibold text-primary">صحيح!</span>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-2">
                    <X className="h-5 w-5 text-destructive" />
                    <span className="font-semibold text-destructive">ليس تماماً</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    الإجابة: <span className="font-english font-semibold text-foreground">{word.word_english}</span>
                  </p>
                </div>
              )}
            </div>
            <Button onClick={handleNext} className="w-full">
              {current + 1 >= gameWords.length ? "النتائج" : "التالي"}
              <ChevronOpen className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <Badge variant="secondary" className="text-sm">
          {current + 1}/{gameWords.length} · Score: {score}
        </Badge>
      </div>
    </div>
  );
};

// ─── RESULTS SCREEN ─────────────────────────────
const ResultsScreen = ({
  score,
  total,
  gameName,
  onPlayAgain,
  onMenu,
}: {
  score: number;
  total: number;
  gameName: string;
  onPlayAgain: () => void;
  onMenu: () => void;
}) => {
  const pct = Math.round((score / total) * 100);

  return (
    <div className="text-center space-y-6 py-8">
      <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
        <Trophy className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground">أنهيت {gameName}!</h2>
        <p className="text-muted-foreground mt-1">
          {pct >= 80 ? "عمل ممتاز! 🎉" : pct >= 50 ? "جهد طيب! واصل التدريب 💪" : "واصل — ستصل! 🌟"}
        </p>
      </div>
      <div className="bg-card border border-border rounded-2xl p-6 max-w-xs mx-auto">
        <p className="text-4xl font-bold text-primary">{pct}%</p>
        <p className="text-sm text-muted-foreground">{score} / {total} صحيحة</p>
      </div>
      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={onMenu}>
          <RotateCcw className="h-4 w-4 me-1.5" /> القائمة
        </Button>
        <Button onClick={onPlayAgain}>
          <Sparkles className="h-4 w-4 me-1.5" /> العب مرة أخرى
        </Button>
      </div>
    </div>
  );
};

// ─── MAIN PAGE ──────────────────────────────────
const VocabGames = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<GameMode>("menu");
  const [words, setWords] = useState<WordPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; game: string } | null>(null);

  const fetchWords = useCallback(async () => {
    setLoading(true);
    try {
      // Try pre-approved game sets first
      const { data: gameSets } = await supabase
        .from("vocab_game_sets" as any)
        .select("*")
        .eq("status", "published")
        .limit(5);

      if (gameSets && gameSets.length > 0) {
        const picked = (gameSets as any[])[Math.floor(Math.random() * gameSets.length)];
        const pairs = (picked.word_pairs as any[]).map((wp: any, i: number) => ({
          id: `gs-${i}`,
          word_arabic: wp.word_arabic,
          word_english: wp.word_english,
        }));
        if (pairs.length >= 6) {
          setWords(pairs.sort(() => Math.random() - 0.5));
          setLoading(false);
          return;
        }
      }

      // Try user vocabulary, fall back to curriculum words
      if (user) {
        const { data } = await supabase
          .from("user_vocabulary")
          .select("id, word_arabic, word_english")
          .eq("user_id", user.id)
          .limit(20);

        if (data && data.length >= 6) {
          setWords(data.sort(() => Math.random() - 0.5));
          setLoading(false);
          return;
        }
      }

      // Fall back to vocabulary_words
      const { data } = await supabase
        .from("vocabulary_words")
        .select("id, word_arabic, word_english")
        .limit(20);

      setWords((data || []).sort(() => Math.random() - 0.5));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWords();
  }, [fetchWords]);

  const startGame = (gameMode: GameMode) => {
    setResult(null);
    setMode(gameMode);
    fetchWords();
  };

  const handleComplete = (score: number, total: number, gameName: string) => {
    setResult({ score, total, game: gameName });
  };

  if (loading && mode !== "menu") {
    return (
      <AppShell>
        <HomeButton />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (result) {
    return (
      <AppShell>
        <HomeButton />
        <ResultsScreen
          score={result.score}
          total={result.total}
          gameName={result.game}
          onPlayAgain={() => startGame(mode)}
          onMenu={() => { setResult(null); setMode("menu"); }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-6">
        {mode === "menu" ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Gamepad2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">ألعاب المفردات <InfoHint {...PAGE_HINTS["vocab-games"]} /></h1>
                <p className="text-sm text-muted-foreground">
                  تمرّن على الكلمات بألعاب ممتعة
                </p>
              </div>
            </div>

            {words.length < 6 ? (
              <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-3">
                <Gamepad2 className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                <p className="text-muted-foreground">تحتاج 6 كلمات على الأقل للعب</p>
                <p className="text-sm text-muted-foreground/70">
                  تعلّم شوية كلمات أول، وبعدين ارجع!
                </p>
                <Button variant="outline" onClick={() => navigate("/learn")}>
                  ابدأ التعلم
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Word Matching */}
                <button
                  onClick={() => startGame("matching")}
                  className={cn(
                    "w-full p-5 rounded-2xl",
                    "bg-gradient-to-r from-primary/10 to-primary/5 border-2 border-primary/20",
                    "flex items-center gap-4",
                    "transition-all duration-200",
                    "hover:border-primary/40 hover:shadow-lg active:scale-[0.98]"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Shuffle className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold text-foreground">توصيل الكلمات</p>
                    <p className="text-sm text-muted-foreground">
                      وصّل الكلمات الإنجليزية بمعانيها
                    </p>
                  </div>
                  <ChevronOpen className="h-5 w-5 text-muted-foreground" />
                </button>

                {/* Memory Cards */}
                <button
                  onClick={() => startGame("memory")}
                  className={cn(
                    "w-full p-5 rounded-2xl",
                    "bg-gradient-to-r from-accent/30 to-accent/10 border-2 border-accent/20",
                    "flex items-center gap-4",
                    "transition-all duration-200",
                    "hover:border-accent/40 hover:shadow-lg active:scale-[0.98]"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center shrink-0">
                    <Grid3X3 className="h-6 w-6 text-accent-foreground" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold text-foreground">بطاقات الذاكرة</p>
                    <p className="text-sm text-muted-foreground">
                      اقلب البطاقات واعثر على الأزواج المتطابقة
                    </p>
                  </div>
                  <ChevronOpen className="h-5 w-5 text-muted-foreground" />
                </button>

                {/* Fill in the Blank */}
                <button
                  onClick={() => startGame("fill-blank")}
                  className={cn(
                    "w-full p-5 rounded-2xl",
                    "bg-gradient-to-r from-secondary/50 to-secondary/20 border-2 border-secondary/30",
                    "flex items-center gap-4",
                    "transition-all duration-200",
                    "hover:border-secondary/50 hover:shadow-lg active:scale-[0.98]"
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-secondary/30 flex items-center justify-center shrink-0">
                    <PenLine className="h-6 w-6 text-secondary-foreground" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold text-foreground">أكمل الفراغ</p>
                    <p className="text-sm text-muted-foreground">
                      اكتب الكلمة بالإنجليزية من معناها العربي
                    </p>
                  </div>
                  <ChevronOpen className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setMode("menu")}>
              → العودة إلى الألعاب
            </Button>

            {mode === "matching" && (
              <WordMatchingGame
                words={words}
                onComplete={(s, t) => handleComplete(s, t, "توصيل الكلمات")}
              />
            )}
            {mode === "memory" && (
              <MemoryCardGame
                words={words}
                onComplete={(s, t) => handleComplete(s, t, "بطاقات الذاكرة")}
              />
            )}
            {mode === "fill-blank" && (
              <FillBlankGame
                words={words}
                onComplete={(s, t) => handleComplete(s, t, "أكمل الفراغ")}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
};

export default VocabGames;
