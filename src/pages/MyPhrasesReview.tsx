import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useDueUserPhrases, useUpdateUserPhraseReview, useDeleteUserPhrase } from "@/hooks/useUserPhrases";
import { useReviewSession } from "@/hooks/useReviewSession";
import { SessionHandoff } from "@/components/review/SessionHandoff";
import { SessionProgress } from "@/components/review/SessionProgress";
import { PageCorner } from "@/components/shell/PageCorner";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
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
import { Rating, calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { Loader2, Trophy, LogIn, Eye, Volume2, Trash2, MessageCircleQuestion, Music, Play, RefreshCw, Undo2, MessageSquarePlus } from "lucide-react";
import { SentencePracticeSheet } from "@/components/practice/SentencePracticeSheet";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl } from "@/lib/jingleAudio";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";


const MyPhrasesReview = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const desiredRetention = useDesiredRetention();
  const { activeDialect } = useDialect();
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  const { data: duePhrases, isLoading, refetch } = useDueUserPhrases();
  const session = useReviewSession();
  const updateReview = useUpdateUserPhraseReview();
  const deletePhrase = useDeleteUserPhrase();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [jingleLoading, setJingleLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lastAction, setLastAction] = useState<null | {
    phraseId: string;
    prevIndex: number;
    snapshot: Record<string, unknown>;
  }>(null);
  const [undoing, setUndoing] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const safeIndex =
    duePhrases && duePhrases.length > 0
      ? Math.min(currentIndex, duePhrases.length - 1)
      : 0;
  const current = duePhrases?.[safeIndex] ?? null;

  // Persist TTS audio on first generation so subsequent reviews reuse it
  // instead of calling the AI synthesis endpoint again.
  const persistPhraseAudio = current && user && !current.phrase_audio_url
    ? async (blob: Blob) => {
        const phraseId = current.id;
        const fileName = `tts/${user.id}/phrase-${phraseId}.mp3`;
        const { error: uploadError } = await supabase.storage
          .from("flashcard-audio")
          .upload(fileName, blob, { contentType: blob.type || "audio/mpeg", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
        const audioUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        const { error: updateError } = await (supabase.from("user_phrases") as any)
          .update({ phrase_audio_url: audioUrl })
          .eq("id", phraseId);
        if (updateError) throw updateError;
        current.phrase_audio_url = audioUrl;
      }
    : undefined;

  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: current?.phrase_english ?? "",
    skip: !current || Boolean(current?.phrase_audio_url),
    // The phrase audio is the English target — not the Arabic scaffold.
    voice: "en-US-JennyNeural",
    persist: persistPhraseAudio,
  });

  const playAudio = async (url: string, options?: { repairJingle?: boolean }) => {
    if (audioRef.current) audioRef.current.pause();
    if (options?.repairJingle) {
      try {
        const audioFile = await createPlayableJingleAudioFromUrl(url);
        const objectUrl = URL.createObjectURL(audioFile.blob);
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(objectUrl);
        audio.play().catch(() => {});
        return;
      } catch (err) {
        console.error("Jingle repair failed:", err);
        toast.error("الأنشودة تالفة — المس «أعد التوليد» لاستبدالها.");
        return;
      }
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
  };

  const generateJingle = async (regenerate = false) => {
    if (!current || !user) return;
    if (current.jingle_audio_url && !regenerate) {
      playAudio(current.jingle_audio_url, { repairJingle: true });
      return;
    }
    setJingleLoading(true);
    try {
      const response = await supabase.functions.invoke("generate-phrase-jingle", {
        body: {
          phrase_arabic: current.phrase_arabic,
          phrase_english: current.phrase_english,
          dialect: activeDialect,
        },
      });
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      const audioFile = await createPlayableJingleAudio(response.data);
      const fileName = `jingles/${user.id}/phrase-${current.id}-${Date.now()}.${audioFile.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const jingleUrl = urlData.publicUrl;
      const lyrics = (response.data as { lyrics?: string | null })?.lyrics ?? null;
      await (supabase.from("user_phrases") as any)
        .update({ jingle_audio_url: jingleUrl, jingle_lyrics: lyrics })
        .eq("id", current.id);
      current.jingle_audio_url = jingleUrl;
      current.jingle_lyrics = lyrics;
      toast.success("🎵 جاهزة — المس «تشغيل» للاستماع.");
      setShowLyrics(true);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("429")) toast.error("طلبات كثيرة — حاول بعد قليل");
      else if (msg.includes("402")) toast.error("نفد رصيد الذكاء الاصطناعي");
      else toast.error("تعذّر توليد الأنشودة");
    } finally {
      setJingleLoading(false);
    }
  };


  // Reset reveal between cards
  useEffect(() => {
    setShowAnswer(false);
    setShowLyrics(false);
  }, [current?.id]);

  const handleRate = async (rating: Rating) => {
    if (!current || !duePhrases) return;
    const count = duePhrases.length;

    // Snapshot current SRS state so the learner can undo an accidental tap.
    const { data: snapshot } = await (supabase
      .from("user_phrases")
      .select("ease_factor, difficulty, interval_days, repetitions, next_review_at, last_reviewed_at, lapses, is_leech") as any)
      .eq("id", current.id)
      .maybeSingle();

    const result = calculateNextReview(
      rating,
      Number(current.ease_factor) || 0,
      Number(current.difficulty) || 5,
      current.interval_days,
      current.repetitions,
      elapsedDaysSince(current.last_reviewed_at),
      { desiredRetention, fuzzSeed: current.id },
    );

    await updateReview.mutateAsync({
      phraseId: current.id,
      stability: result.stability,
      difficulty: result.difficulty,
      intervalDays: result.intervalDays,
      repetitions: result.repetitions,
      nextReviewAt: result.nextReviewAt,
      rating,
      currentLapses: current.lapses ?? 0,
    });

    const prevIndex = currentIndex;
    const newAction = snapshot
      ? {
          phraseId: current.id,
          prevIndex,
          snapshot: snapshot as Record<string, unknown>,
        }
      : null;
    if (newAction) {
      setLastAction(newAction);
    }

    setSessionCount((p) => p + 1);
    setShowAnswer(false);

    if (currentIndex < count - 1) {
      setCurrentIndex((p) => p + 1);
    } else {
      await refetch();
      setCurrentIndex(0);
    }

  };

  const handleUndo = async (action?: NonNullable<typeof lastAction>) => {
    const target = action ?? lastAction;
    if (!target || undoing) return;
    setUndoing(true);
    try {
      const { error } = await (supabase.from("user_phrases") as any)
        .update(target.snapshot)
        .eq("id", target.phraseId);
      if (error) throw error;
      setSessionCount((p) => Math.max(0, p - 1));
      setCurrentIndex(target.prevIndex);
      setShowAnswer(false);
      setLastAction(null);
      await refetch();
      toast.success("تم التراجع عن التقييم");
    } catch (err) {
      console.error("Undo failed:", err);
      toast.error("تعذّر التراجع — حاول من جديد");
    } finally {
      setUndoing(false);
    }
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false);
    if (!current) return;
    try {
      await deletePhrase.mutateAsync(current.id);
      toast.success("تمت إزالة العبارة");
      await refetch();
      setCurrentIndex(0);
    } catch {
      toast.error("تعذّرت إزالة العبارة");
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6"><PageCorner /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold mb-3">تسجيل الدخول مطلوب</h1>
          <p className="text-muted-foreground mb-8">سجّل الدخول لمراجعة عباراتك المحفوظة.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 me-2" /> تسجيل الدخول
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!duePhrases || duePhrases.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <PageCorner />
          {sessionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{sessionCount}</span>
            </div>
          )}
        </div>
        <SessionHandoff
          deckId="my-phrases"
          session={session}
          message="لا توجد عبارات مستحقة للمراجعة الآن."
          fallbackLabel="العودة إلى كلماتي"
          fallbackRoute="/my-words"
        />
      </AppShell>
    );
  }

  if (!current) return null;
  const effectiveAudio = current.phrase_audio_url || ttsUrl;

  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <PageCorner />
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border flex items-center gap-1.5">
            <MessageCircleQuestion className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium">عبارة</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <SessionProgress
        deckId="my-phrases"
        session={session}
        position={safeIndex + 1}
        total={duePhrases.length}
      />

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          <div className="rounded-3xl bg-card border border-[#2C3B74]/15 p-7 text-center space-y-5 shadow-elegant">
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
              قلها بالإنجليزية
            </p>
            <p
              className="text-2xl font-semibold text-foreground leading-relaxed"
            >
              {current.phrase_arabic}
            </p>

            {showAnswer ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4 pt-2">
                <p className="font-english text-4xl font-bold text-[#2C3B74] leading-snug">
                  {current.phrase_english}
                </p>
                {/* transliteration carries phonetic_ar — the English phrase in
                    Arabic letters, a reading aid for the answer. */}
                {current.phonetic_ar && (
                  <p className="text-sm text-primary/80">{current.phonetic_ar}</p>
                )}
                {current.notes && (
                  <p className="text-xs text-muted-foreground italic">{current.notes}</p>
                )}

                <div className="flex justify-center">
                  <AskAISentence
                    arabic={current.phrase_arabic}
                    english={current.phrase_english}
                    variant="chip"
                  />
                </div>


                {/* Circular play + secondary actions */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => effectiveAudio && playAudio(effectiveAudio)}
                    disabled={!effectiveAudio || ttsLoading}
                    aria-label="شغّل الصوت"
                    className="h-14 w-14 rounded-full flex items-center justify-center bg-primary text-primary-foreground shadow-elegant transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    {ttsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <Volume2 className="h-6 w-6" />
                    )}
                  </button>

                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateJingle()}
                      disabled={jingleLoading}
                      className="gap-1.5 rounded-full"
                    >
                      {jingleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : current.jingle_audio_url ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Music className="h-4 w-4" />
                      )}
                      {jingleLoading ? "جارٍ الإنشاء..." : current.jingle_audio_url ? "شغّل الأنشودة" : "ولّد أنشودة"}
                    </Button>

                    {current.jingle_audio_url && !jingleLoading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => generateJingle(true)}
                        title="أعد توليد الأنشودة"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>

                {current.jingle_audio_url && current.jingle_lyrics && (
                  <div className="mt-2">
                    {showLyrics ? (
                      <div className="rounded-xl bg-muted/40 border border-border p-3 text-left animate-in fade-in duration-200">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            كلمات الأنشودة
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowLyrics(false)}
                            className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                          >
                            إخفاء
                          </button>
                        </div>
                        <div
                          className="text-sm leading-relaxed font-arabic space-y-1"
                          dir="rtl"
                        >
                          {current.jingle_lyrics.split(/\r?\n/).map((line, i) => (
                            line.trim() ? (
                              <TappableArabicText
                                key={i}
                                text={line}
                                source="jingle-lyrics"
                                sentenceContext={{ arabic: current.phrase_arabic, english: current.phrase_english }}
                              />
                            ) : (
                              <div key={i} className="h-2" />
                            )
                          ))}
                        </div>

                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowLyrics(true)}
                        className="gap-1.5 text-muted-foreground text-xs"
                      >
                        أظهر الكلمات
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setShowAnswer(true);
                  if (effectiveAudio) playAudio(effectiveAudio);
                }}
                className="gap-2 w-full rounded-full border-2 border-primary/30 text-primary hover:bg-primary/8 hover:border-primary/50"
              >
                <Eye className="h-4 w-4" />
                أظهر الإنجليزية
              </Button>
            )}
          </div>


          {leechTrackingEnabled && current.is_leech && (
            <LeechHelperPanel
              kind="phrase"
              rowId={current.id}
              arabic={current.phrase_arabic}
              english={current.phrase_english}
              transliteration={current.phonetic_ar}
              dialect={activeDialect}
              mnemonic={current.mnemonic ?? null}
              invalidateKeys={[["user-phrases-due"], ["user-phrases"]]}
            />
          )}

          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              أزل من القائمة
            </Button>
          </div>
        </div>

        {/* Self rating */}
        <div className="mt-8">
          <RatingButtons
            onRate={handleRate}
            stability={Number(current.ease_factor) || 0}
            difficulty={Number(current.difficulty) || 5}
            intervalDays={current.interval_days}
            repetitions={current.repetitions}
            elapsedDays={elapsedDaysSince(current.last_reviewed_at)}
            disabled={updateReview.isPending}
          />
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPracticeOpen(true)}
              className="gap-1.5 text-muted-foreground"
              title="تدرّب على استخدام العبارة في جملة"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">تدرّب في جملة</span>
            </Button>
            {lastAction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUndo()}
                disabled={undoing}
                className="gap-1.5 text-muted-foreground"
                title="تراجع عن آخر تقييم"
              >
                {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                <span className="text-xs font-medium">تراجع</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <SentencePracticeSheet
        open={practiceOpen}
        onOpenChange={setPracticeOpen}
        targetArabic={current.phrase_arabic}
        targetEnglish={current.phrase_english}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>أتريد إزالة هذه العبارة؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستُزال العبارة من قائمتك المحفوظة. يمكنك إضافتها من جديد لاحقاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              إزالة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default MyPhrasesReview;
