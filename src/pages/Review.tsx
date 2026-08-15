import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  useDueWords,
  useReviewStats,
} from "@/hooks/useReview";
import { useReviewQueue } from "@/hooks/useReviewQueue";
import { useReviewSession } from "@/hooks/useReviewSession";
import { RootChip } from "@/components/vocab/RootChip";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { SessionHandoff } from "@/components/review/SessionHandoff";
import { SessionProgress } from "@/components/review/SessionProgress";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { useDialect } from "@/contexts/DialectContext";
import { Rating, calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { scheduleDirectionFor } from "@/lib/reviewOrder";
import { ReviewAudioCard } from "@/components/review/ReviewAudioCard";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { Loader2, Trophy, Brain, Sparkles, LogIn, Shuffle, Eye, Volume2, ImagePlus, WifiOff, CloudUpload, PenLine, BookOpen } from "lucide-react";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { useReviewKeyboard } from "@/hooks/useKeyboardShortcuts";


const DIALECT_FLAGS: Record<string, string> = {
  Gulf: "🇦🇪",
  Egyptian: "🇪🇬",
};

const Review = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  const [mixAll, setMixAll] = useState(false);

  const { data: dueWords, isLoading: wordsLoading, refetch } = useDueWords(mixAll);
  const { data: stats } = useReviewStats(mixAll);
  const { enqueue, pendingCount, isFlushing, isOnline } = useReviewQueue();
  const session = useReviewSession(mixAll);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleFlip = useCallback(() => setShowAnswer(true), []);
  const handleRateKeyboard = useCallback((rating: Rating) => {
    handleRate(rating);
  }, [dueWords, currentIndex]);

  useReviewKeyboard({
    showAnswer,
    onFlip: handleFlip,
    onRate: handleRateKeyboard,
    enabled: !!dueWords && dueWords.length > 0,
  });

  const playAudio = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(console.error);
  };

  /**
   * Cache a synthesised pronunciation onto the shared curriculum word.
   *
   * `vocabulary_words` is admin/recorder-write only, so unlike the personal
   * deck the client can't stamp `audio_url` itself — without this every
   * audio-first card would re-synthesise the same word on every review, for
   * every learner. The edge function does the write under the service role and
   * re-synthesises from the word's own text, so nothing arbitrary can be
   * attached to a shared row. Best-effort: a failure just means we synthesise
   * again next time.
   */
  const persistCurriculumAudio = useCallback(async () => {
    const word = dueWords?.[currentIndex];
    if (!word || word.audio_url) return;
    try {
      await supabase.functions.invoke("persist-word-audio", {
        // Same fallback the card uses for playback. Sending the raw nullable
        // column instead would let the learner hear one voice and cache
        // another — and the cache is written once and never revisited.
        body: { wordId: word.id, dialect: word.dialect_module ?? activeDialect },
      });
    } catch (err) {
      console.warn("Couldn't cache word audio:", err);
    }
  }, [dueWords, currentIndex, activeDialect]);

  const goToNext = async () => {
    if (!dueWords) return;
    setShowAnswer(false);
    if (currentIndex < dueWords.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }
  };

  const handleRate = (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;
    const word = dueWords[currentIndex];
    const wordCount = dueWords.length;

    // Queue locally; background processor retries on network failures.
    // The direction decides which column set the rating lands in — getting it
    // wrong silently corrupts the card's schedule, so it is passed explicitly
    // rather than inferred at flush time.
    enqueue({
      wordId: word.id,
      rating,
      currentReview: word.review,
      direction: scheduleDirectionFor(word.card_type),
    });

    setSessionCount((prev) => prev + 1);
    setShowAnswer(false);

    // Advance immediately — UI does not wait on the network
    if (currentIndex < wordCount - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      // End of list: refetch (queue keeps flushing in background)
      void refetch();
      setCurrentIndex(0);
    }
  };


  const handleToggleMix = () => {
    setMixAll((prev) => !prev);
    setCurrentIndex(0);
    setSessionCount(0);
    setShowAnswer(false);
  };

  if (authLoading || wordsLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">جارٍ تحميل مراجعاتك...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mx-auto mb-6">
            <LogIn className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-3">تسجيل الدخول مطلوب</h1>
          <p className="text-muted-foreground mb-8">سجّل الدخول لتتبع تقدّمك بالتكرار المتباعد.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 me-2" />
            سجّل الدخول للمراجعة
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!dueWords || dueWords.length === 0) {
    // The other decks' counts load independently of this one, and they read as
    // 0 until they arrive — deciding now would flash "All caught up" before
    // forwarding. Wait for real numbers first.
    if (session.isLoading) {
      return (
        <AppShell compact>
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        </AppShell>
      );
    }

    // "/review" is the single entry point for the daily session, so arriving
    // with no curriculum cards shouldn't dead-end on "All caught up" while
    // other decks have work waiting — forward straight into the next one.
    // Only on arrival: if cards were rated here, show the completion state
    // first and let the learner choose to continue.
    const forwardTo = sessionCount === 0 ? session.nextDeck("curriculum") : null;
    if (forwardTo) {
      return <Navigate to={forwardTo.route} replace />;
    }

    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleMix}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                mixAll
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
              خلط الكل
            </button>
            {sessionCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{sessionCount}</span>
              </div>
            )}
          </div>
        </div>

        <SessionHandoff
          deckId="curriculum"
          session={session}
          message="راجعت كل كلمات المنهج المستحقة."
          fallbackLabel="العودة إلى الرئيسية"
          fallbackRoute="/"
        >
          {stats && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-card rounded-xl p-4 border border-border">
                <Brain className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.learnedCount}</p>
                <p className="text-xs text-muted-foreground">قيد التعلم</p>
              </div>
              <div className="bg-card rounded-xl p-4 border border-border">
                <Sparkles className="h-6 w-6 text-accent mx-auto mb-2" />
                <p className="text-xl font-bold text-foreground">{stats.masteredCount}</p>
                <p className="text-xs text-muted-foreground">متقنة</p>
              </div>
            </div>
          )}
        </SessionHandoff>
      </AppShell>
    );
  }

  // Safety: clamp index if list shrank after refetch
  const safeIndex = Math.min(currentIndex, dueWords.length - 1);
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
  }

  const currentWord = dueWords[safeIndex];
  if (!currentWord) return null;

  const dialectFlag = DIALECT_FLAGS[currentWord.dialect_module || "Gulf"] || "";
  const dialectLabel = currentWord.dialect_module || "Gulf";

  // Which schedule this card is being rated against. Audio and recognition
  // share one (see scheduleDirectionFor); production has its own, so the
  // interval preview on the rating buttons must read from the matching columns
  // or it shows the learner the wrong next-review estimate.
  const isProduction = currentWord.card_type === "production";
  const isAudio = currentWord.card_type === "audio";
  const review = currentWord.review;

  const stability = (isProduction ? review?.production_ease_factor : review?.ease_factor) ?? 0;
  const difficulty = (isProduction ? review?.production_difficulty : review?.difficulty) ?? 5.0;
  const intervalDays = (isProduction ? review?.production_interval_days : review?.interval_days) ?? 0;
  const repetitions = (isProduction ? review?.production_repetitions : review?.repetitions) ?? 0;
  const elapsedDays = elapsedDaysSince(
    isProduction ? review?.production_last_reviewed_at : review?.last_reviewed_at,
  );

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleMix}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              mixAll
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            خلط الكل
          </button>
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border">
            <span className="text-sm font-medium text-foreground">
              {currentWord.topic?.name || "المراجعة"}
            </span>
          </div>
          {pendingCount > 0 && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                isOnline
                  ? "bg-card border-border text-muted-foreground"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
              }`}
              title={isOnline ? "جارٍ حفظ التقييمات…" : "غير متصل — سنعيد المحاولة عند عودة الاتصال"}
            >
              {isOnline ? (
                <CloudUpload className={`h-3.5 w-3.5 ${isFlushing ? "animate-pulse" : ""}`} />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {isOnline ? `جارٍ حفظ ${pendingCount}` : `${pendingCount} بانتظار الحفظ`}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>

        </div>
      </div>

      {/* Dialect tag */}
      {mixAll && (
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {dialectFlag} {dialectLabel}
          </span>
        </div>
      )}

      {/* Progress bar */}
      <SessionProgress
        deckId="curriculum"
        session={session}
        position={safeIndex + 1}
        total={dueWords.length}
      />

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          {isAudio ? (
            <ReviewAudioCard
              wordArabic={currentWord.word_arabic}
              wordEnglish={currentWord.word_english}
              audioUrl={currentWord.audio_url}
              dialect={currentWord.dialect_module ?? activeDialect}
              showAnswer={showAnswer}
              onReveal={() => setShowAnswer(true)}
              onAudioGenerated={persistCurriculumAudio}
            />
          ) : (
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            {/* Direction label — without it, a production card looks like a
                recognition card the learner has simply failed to read. */}
            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-6">
              {isProduction ? (
                <>
                  <PenLine className="h-3.5 w-3.5" />
                  قلها بالإنجليزية
                </>
              ) : (
                <>
                  <BookOpen className="h-3.5 w-3.5" />
                  ما معناها؟
                </>
              )}
            </div>
            {/* Image if available. Hidden on production cards — a picture of the
                answer turns recall into recognition. */}
            {!isProduction && currentWord.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
                <img
                  src={currentWord.image_url}
                  alt=""
                  className="w-full h-full object-contain"
                  style={currentWord.image_position ? {
                    objectPosition: currentWord.image_position.replace(' ', '% ') + '%',
                  } : undefined}
                />
              </div>
            )}
            {/* Generate image button. Production cards don't show an image, so
                there's nothing to generate from here. */}
            {!isProduction && (
              <div className="mb-6 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImageDialogOpen(true)}
                  className="gap-1.5 text-muted-foreground"
                >
                  <ImagePlus className="h-4 w-4" />
                  {currentWord.image_url ? "أعد توليد الصورة" : "ولّد صورة"}
                </Button>
              </div>
            )}

            {isProduction ? (
              /* Prompt in Arabic; the English is what the learner has to
                 produce, so it stays hidden until they've committed. */
              <p
                className="text-3xl font-bold text-foreground mb-6 break-words max-w-full"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              >
                {currentWord.word_arabic}
              </p>
            ) : (
              <p className="font-english text-4xl font-bold text-foreground mb-6 break-words max-w-full">
                {currentWord.word_english}
              </p>
            )}

            {/* Audio button. Never before the answer on a production card — it
                would simply read out the answer. */}
            <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
              {currentWord.audio_url && (!isProduction || showAnswer) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  الكلمة
                </Button>
              )}
            </div>

            {/* Pronunciation practice. Same reasoning: on a production card the
                learner must recall the word before being scored saying it. */}
            {(!isProduction || showAnswer) && (
              <div className="mb-6">
                <PronunciationButton word={currentWord.word_english} gloss={currentWord.word_arabic} />
              </div>
            )}

            {/* Reveal the other side */}
            {showAnswer && (
              <div className="animate-in fade-in duration-200 mb-4">
                {isProduction ? (
                  <p className="font-english text-3xl font-bold text-foreground break-words">
                    {currentWord.word_english}
                  </p>
                ) : (
                  <p
                    className="text-xl text-muted-foreground"
                    style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                  >
                    {currentWord.word_arabic}
                  </p>
                )}
                {/* Only after the reveal. On a production card the Arabic is
                    the answer, and a root shown alongside the English prompt
                    would hand over most of it. */}
                <RootChip root={currentWord.word_family} className="mt-2" />
              </div>
            )}
            {!showAnswer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Eye className="h-4 w-4" />
                {isProduction ? "أظهر الإنجليزية" : "أظهر المعنى"}
              </Button>
            )}
          </div>
          )}

          {/* Rescue for a card the learner keeps failing. The personal decks
              have had this since leech tracking landed; the curriculum deck —
              the one the app hands every learner — had nothing. */}
          {leechTrackingEnabled && review?.is_leech && review?.id && (
            <LeechHelperPanel
              kind="curriculum"
              rowId={review.id}
              arabic={currentWord.word_arabic}
              english={currentWord.word_english}
              dialect={currentWord.dialect_module ?? activeDialect}
              mnemonic={review.mnemonic ?? null}
              invalidateKeys={[["due-words"]]}
            />
          )}
        </div>

        {/* Self-rating always visible */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
            stability={stability}
            difficulty={difficulty}
            intervalDays={intervalDays}
            repetitions={repetitions}
            elapsedDays={elapsedDays}
            disabled={false}
          />
        </div>
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          await supabase
            .from("vocabulary_words")
            .update({ image_url: imageUrl })
            .eq("id", wordId);
          refetch();
        }}
      />
    </AppShell>
  );
};

export default Review;
