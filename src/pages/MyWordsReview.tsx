import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateUserVocabularyReview } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { HomeButton } from "@/components/HomeButton";
import { RatingButtons } from "@/components/review/RatingButtons";
import { AppShell } from "@/components/layout/AppShell";
import { Loader2, Trophy, LogIn, Eye, Volume2, Music, RefreshCw, Sparkles, Play, Brain, Mic2, Quote, Undo2, MessageSquarePlus } from "lucide-react";
import { SentencePracticeSheet } from "@/components/practice/SentencePracticeSheet";
import { LeechHelperPanel } from "@/components/review/LeechHelperPanel";
import { SiblingWordsPanel } from "@/components/review/SiblingWordsPanel";
import { RootFamilySheet } from "@/components/vocab/RootFamilySheet";
import { useLeechPrefs } from "@/hooks/useLeechPrefs";
import { GenerateImageDialog } from "@/components/mywords/GenerateImageDialog";
import { useUpdateUserVocabularyImage } from "@/hooks/useUserVocabulary";
import { PronunciationButton } from "@/components/review/PronunciationButton";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";

import { Button } from "@/components/ui/button";
import { Rating, calculateNextReview, elapsedDaysSince } from "@/lib/spacedRepetition";
import { useDesiredRetention } from "@/hooks/useDesiredRetention";
import { buildReviewOrder, scheduleDirectionFor, type CardDirection } from "@/lib/reviewOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { ReviewClozeCard } from "@/components/review/ReviewClozeCard";
import { useTranscriptCloze } from "@/hooks/useTranscriptCloze";
import { useNewCardCap, NEW_CAP_OPTIONS, formatCap } from "@/hooks/useNewCardCap";
import { useRemainingNewCardBudget, useClaimNewCard } from "@/hooks/useNewCardBudget";
import { useReviewSession } from "@/hooks/useReviewSession";
import { SessionHandoff } from "@/components/review/SessionHandoff";
import { SessionProgress } from "@/components/review/SessionProgress";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl } from "@/lib/jingleAudio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Shared with the curriculum deck via src/lib/reviewOrder.ts. This deck doesn't
// serve `audio` cards yet, but the ordering treats every direction alike.
type CardType = CardDirection;

interface DueCard {
  id: string;
  word_arabic: string;
  word_english: string;
  // active SRS fields for the chosen direction
  ease_factor: number;
  difficulty: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
  last_reviewed_at: string | null;
  card_type: CardType;
  // production lock state (used when rating recognition)
  production_locked: boolean;
  word_audio_url: string | null;
  sentence_audio_url: string | null;
  image_url: string | null;
  jingle_audio_url: string | null;
  jingle_lyrics: string | null;
  sentence_text: string | null;
  sentence_english: string | null;
  lapses: number;
  production_lapses: number;
  is_leech: boolean;
  mnemonic: string | null;
  root: string | null;
  /**
   * The card's own dialect. Carried because a mixed-dialect session serves all
   * three decks at once, so the app's active dialect cannot say which one this
   * card belongs to — and root siblings are scoped per card.
   */
  dialect: string;
  transliteration: string | null;
}

interface RawRow {
  id: string;
  word_arabic: string;
  word_english: string;
  transliteration: string | null;
  ease_factor: number;
  difficulty: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  production_ease_factor: number;
  production_difficulty: number;
  production_interval_days: number;
  production_repetitions: number;
  production_next_review_at: string | null;
  production_last_reviewed_at: string | null;
  word_audio_url: string | null;
  sentence_audio_url: string | null;
  image_url: string | null;
  jingle_audio_url: string | null;
  jingle_lyrics: string | null;
  sentence_text: string | null;
  sentence_english: string | null;
  lapses: number | null;
  production_lapses: number | null;
  is_leech: boolean | null;
  mnemonic: string | null;
  root: string | null;
  dialect: string | null;
}

const MyWordsReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const desiredRetention = useDesiredRetention();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  /**
   * Review every dialect at once, as MyWordsSection's "Mixed" toggle promises.
   *
   * That toggle counts across all dialects but used to open a bare
   * /review/my-words, and this deck reads the globally active dialect — so a
   * learner told "Review 3 due" across three modules arrived at a session
   * holding only one of them, with nothing on either screen explaining the gap.
   */
  const mixAll = searchParams.get("mixed") === "1";
  const { enabled: leechTrackingEnabled } = useLeechPrefs();
  const updateReview = useUpdateUserVocabularyReview();
  const { cap: newCap, setCap: setNewCap } = useNewCardCap();
  const { remaining: remainingNewBudget } = useRemainingNewCardBudget(newCap);
  const claimNewCard = useClaimNewCard();
  const session = useReviewSession();
  const queryClient = useQueryClient();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [jingleLoading, setJingleLoading] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  /** Canonical root key of the family sheet, or null when it is closed. */
  const [familyKey, setFamilyKey] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<null | {
    cardId: string;
    cardType: CardType;
    prevIndex: number;
    snapshot: Record<string, unknown>;
  }>(null);
  const [undoing, setUndoing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackAudioUrlRef = useRef<string | null>(null);
  const ratingInFlightRef = useRef(false);
  const updateImage = useUpdateUserVocabularyImage();

  const playAudio = async (url: string, options?: { repairJingle?: boolean }) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (fallbackAudioUrlRef.current) {
      URL.revokeObjectURL(fallbackAudioUrlRef.current);
      fallbackAudioUrlRef.current = null;
    }
    if (options?.repairJingle) {
      try {
        const audioFile = await createPlayableJingleAudioFromUrl(url);
        const repairedUrl = URL.createObjectURL(audioFile.blob);
        fallbackAudioUrlRef.current = repairedUrl;
        const repairedAudio = new Audio(repairedUrl);
        audioRef.current = repairedAudio;
        await repairedAudio.play();
        return;
      } catch (repairErr) {
        console.error("Jingle audio repair failed:", repairErr);
        toast.error(
          repairErr instanceof Error && repairErr.message.includes("regenerate")
            ? "This jingle file is corrupted. Tap Regenerate jingle to replace it."
            : "Couldn't play that audio. Try regenerating it.",
        );
        return;
      }
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    try {
      await audio.play();
    } catch (err: any) {
      console.error("Audio playback error:", err);
      if (err?.name === "NotAllowedError") return;
      toast.error("Couldn't play that audio. Try regenerating it.");
    }
  };

  useEffect(() => {
    return () => {
      if (fallbackAudioUrlRef.current) URL.revokeObjectURL(fallbackAudioUrlRef.current);
    };
  }, []);

  const { data: dueWords, isLoading, refetch } = useQuery({
    queryKey: [
      "user-vocabulary-due-words",
      user?.id,
      mixAll ? "all" : activeDialect,
      newCap,
      remainingNewBudget,
    ],
    queryFn: async (): Promise<DueCard[]> => {
      if (!user) return [];
      const now = new Date().toISOString();

      // Fetch all rows that are due in either direction. We do two queries
      // and merge so each direction can be tagged independently.
      const baseSelect =
        "id, word_arabic, word_english, ease_factor, difficulty, interval_days, repetitions, next_review_at, last_reviewed_at, production_ease_factor, production_difficulty, production_interval_days, production_repetitions, production_next_review_at, production_last_reviewed_at, word_audio_url, sentence_audio_url, image_url, jingle_audio_url, jingle_lyrics, sentence_text, sentence_english, lapses, production_lapses, is_leech, mnemonic, root, dialect";

      // PostgREST caps unbounded selects at 1000 rows, and large decks pass that
      // easily. Page through so a big backlog doesn't silently truncate (which
      // looked like cards failing to load).
      const PAGE = 1000;
      const fetchAllPages = async (
        build: (from: number, to: number) => any,
      ): Promise<RawRow[]> => {
        const out: RawRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error) throw error;
          const page = (data ?? []) as RawRow[];
          out.push(...page);
          if (page.length < PAGE) break;
        }
        return out;
      };

      const recogRows = await fetchAllPages((from, to) => {
        let q = (supabase
          .from("user_vocabulary")
          .select(baseSelect)
          .eq("user_id", user.id)
          .lte("next_review_at", now)
          .order("next_review_at", { ascending: true })
          .range(from, to) as any);
        if (!mixAll) q = q.eq("dialect", activeDialect);
        return q;
      });

      const prodRows = await fetchAllPages((from, to) => {
        let q = (supabase
          .from("user_vocabulary")
          .select(baseSelect)
          .eq("user_id", user.id)
          .not("production_next_review_at", "is", null)
          .lte("production_next_review_at", now)
          .order("production_next_review_at", { ascending: true })
          .range(from, to) as any);
        if (!mixAll) q = q.eq("dialect", activeDialect);
        return q;
      });


      const cards: DueCard[] = [];
      for (const r of (recogRows || []) as RawRow[]) {
        cards.push({
          id: r.id,
          word_arabic: r.word_arabic,
          word_english: r.word_english,
          transliteration: null,
          ease_factor: r.ease_factor,
          difficulty: r.difficulty ?? 5.0,
          interval_days: r.interval_days,
          repetitions: r.repetitions,
          due_at: r.next_review_at,
          last_reviewed_at: r.last_reviewed_at,
          card_type: "recognition",
          production_locked: r.production_next_review_at === null,
          word_audio_url: r.word_audio_url,
          sentence_audio_url: r.sentence_audio_url,
          image_url: r.image_url,
          jingle_audio_url: r.jingle_audio_url,
          jingle_lyrics: (r as any).jingle_lyrics ?? null,
          sentence_text: r.sentence_text,
          sentence_english: r.sentence_english,
          lapses: r.lapses ?? 0,
          production_lapses: r.production_lapses ?? 0,
          is_leech: r.is_leech ?? false,
          mnemonic: r.mnemonic,
          root: (r as any).root ?? null,
          dialect: r.dialect ?? activeDialect,
        });
      }
      for (const r of (prodRows || []) as RawRow[]) {
        cards.push({
          id: r.id,
          word_arabic: r.word_arabic,
          word_english: r.word_english,
          transliteration: null,
          ease_factor: r.production_ease_factor,
          difficulty: r.production_difficulty ?? 5.0,
          interval_days: r.production_interval_days,
          repetitions: r.production_repetitions,
          due_at: r.production_next_review_at!,
          last_reviewed_at: r.production_last_reviewed_at,
          card_type: "production",
          production_locked: false,
          word_audio_url: r.word_audio_url,
          sentence_audio_url: r.sentence_audio_url,
          image_url: r.image_url,
          jingle_audio_url: r.jingle_audio_url,
          jingle_lyrics: (r as any).jingle_lyrics ?? null,
          sentence_text: r.sentence_text,
          sentence_english: r.sentence_english,
          lapses: r.lapses ?? 0,
          production_lapses: r.production_lapses ?? 0,
          is_leech: r.is_leech ?? false,
          mnemonic: r.mnemonic,
          root: (r as any).root ?? null,
          dialect: r.dialect ?? activeDialect,
        });
      }

      // Ordering (due-date priority, new-card cap, direction interleaving) lives
      // in src/lib/reviewOrder.ts so the curriculum deck gets the same treatment
      // — it previously had neither interleaving nor a cap.
      //
      // The cap is the user's session preference, further limited by how many
      // new cards they've already studied today (server-persisted, so it
      // survives reloads) — see useNewCardBudget.
      return buildReviewOrder(cards, {
        newCardCap: Math.min(newCap, remainingNewBudget),
      });
    },
    enabled: !!user,
  });

  const currentWord = dueWords && dueWords.length > 0
    ? dueWords[Math.min(currentIndex, dueWords.length - 1)]
    : null;
  const isProduction = currentWord?.card_type === "production";

  // Session breakdown for the New / Review header chips
  const remainingFromIndex = (dueWords || []).slice(currentIndex);
  const newRemaining = remainingFromIndex.filter((c) => c.repetitions === 0).length;
  const reviewRemaining = remainingFromIndex.length - newRemaining;

  // Cloze variant: enable for recognition cards that have sentence context
  // containing the target word AND at least 3 distractor words available.
  // Falls back to auto-mined sentences from the user's saved transcripts (#13).
  //
  // Robustness: some saved cards have `word_arabic` / `word_english` swapped
  // (e.g. an English gloss in `word_arabic`). Pick whichever side actually
  // contains Arabic characters so the multiple-choice options never end up
  // in English when Arabic is the only logical answer.
  const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const pickArabic = (a?: string | null, b?: string | null): string | null => {
    if (a && ARABIC_RE.test(a)) return a;
    if (b && ARABIC_RE.test(b)) return b;
    return null;
  };
  const currentArabic = currentWord
    ? pickArabic(currentWord.word_arabic, currentWord.word_english)
    : null;
  const distractorPool = (dueWords || [])
    .map((d) => pickArabic(d.word_arabic, d.word_english))
    .filter((w): w is string => !!w && w !== currentArabic);
  const sentenceHasOwnWord =
    !!currentWord?.sentence_text &&
    !!currentArabic &&
    currentWord.sentence_text.includes(currentArabic);
  // Look up a transcript-sourced cloze sentence only when the card lacks one.
  const { data: transcriptCloze } = useTranscriptCloze({
    wordArabic: currentArabic ?? undefined,
    dialect: activeDialect,
    enabled: !!currentWord && !!currentArabic && !sentenceHasOwnWord && !isProduction,
  });
  const clozeSentenceText = sentenceHasOwnWord
    ? currentWord!.sentence_text!
    : transcriptCloze?.arabic ?? null;
  const clozeSentenceEnglish = sentenceHasOwnWord
    ? currentWord?.sentence_english ?? null
    : transcriptCloze?.english ?? null;
  const clozeSentenceAudio = sentenceHasOwnWord
    ? currentWord?.sentence_audio_url ?? null
    : null;
  const clozeFromTranscript = !sentenceHasOwnWord && !!transcriptCloze;
  const useCloze =
    !isProduction &&
    !!currentArabic &&
    !!clozeSentenceText &&
    distractorPool.length >= 3 &&
    currentIndex % 2 === 0;

  // TTS fallback when no recorded word_audio_url is available.
  // When generated for the first time, upload the blob to storage and
  // persist the URL on the card so subsequent reviews skip the TTS call.
  const persistWordAudio = currentWord && user && !currentWord.word_audio_url
    ? async (blob: Blob) => {
        const wordId = currentWord.id;
        const fileName = `tts/${user.id}/word-${wordId}.mp3`;
        const { error: uploadError } = await supabase.storage
          .from("flashcard-audio")
          .upload(fileName, blob, { contentType: blob.type || "audio/mpeg", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
        const audioUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        const { error: updateError } = await supabase
          .from("user_vocabulary")
          .update({ word_audio_url: audioUrl })
          .eq("id", wordId);
        if (updateError) throw updateError;
        queryClient.setQueriesData<DueCard[] | undefined>(
          { queryKey: ["user-vocabulary-due-words"] },
          (prev) => prev?.map((c) => (c.id === wordId ? { ...c, word_audio_url: audioUrl } : c)),
        );
      }
    : undefined;

  const { ttsUrl: wordTtsUrl, isLoading: wordTtsLoading } = useAzureTTS({
    text: currentWord?.word_arabic ?? "",
    skip: !currentWord || Boolean(currentWord.word_audio_url),
    dialect: activeDialect,
    persist: persistWordAudio,
  });

  const effectiveWordAudio = currentWord?.word_audio_url || wordTtsUrl;

  // Reset reveal state on card change
  useEffect(() => {
    setShowAnswer(false);
    setShowContext(false);
    setShowLyrics(false);
  }, [currentWord?.id, currentWord?.card_type]);

  // Audio never autoplays on card change. The learner taps "Play" or
  // "Reveal Arabic" to hear the word — this preserves the recall exercise
  // and prevents the Arabic audio from playing while only English is shown.

  const generateJingle = async (word: DueCard, regenerate = false) => {
    if (!user) return;
    if (word.jingle_audio_url && !regenerate) {
      playAudio(word.jingle_audio_url, { repairJingle: true });
      return;
    }
    setJingleLoading(true);
    try {
      const response = await supabase.functions.invoke("generate-word-jingle", {
        body: {
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          dialect: activeDialect,
        },
      });
      if (showCapToastIfLimited(response.error, response.data)) {
        setJingleLoading(false);
        return;
      }
      if (response.error) throw new Error(response.error.message || "Failed to generate jingle");
      const audioFile = await createPlayableJingleAudio(response.data);
      const fileName = `jingles/${user.id}/${word.id}-${Date.now()}.${audioFile.extension}`;
      const { error: uploadError } = await supabase.storage
        .from("flashcard-audio")
        .upload(fileName, audioFile.blob, { contentType: audioFile.mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("flashcard-audio").getPublicUrl(fileName);
      const jingleUrl = urlData.publicUrl;
      const lyrics = (response.data as { lyrics?: string | null })?.lyrics ?? null;
      await supabase
        .from("user_vocabulary")
        .update({ jingle_audio_url: jingleUrl, jingle_lyrics: lyrics } as any)
        .eq("id", word.id);
      // Patch the cached list in place so we don't refetch + reorder the queue
      // while the user is listening to the freshly generated jingle.
      queryClient.setQueriesData<DueCard[] | undefined>(
        { queryKey: ["user-vocabulary-due-words"] },
        (prev) =>
          prev?.map((c) =>
            c.id === word.id ? { ...c, jingle_audio_url: jingleUrl, jingle_lyrics: lyrics } : c,
          ),
      );
      setShowLyrics(true);
      toast.success("🎵 Jingle created — tap Play jingle to listen.");
    } catch (err: any) {
      console.error("Jingle generation error:", err);
      if (err?.message?.includes("Rate limit") || err?.message?.includes("429")) {
        toast.error("Rate limited — try again in a moment");
      } else if (err?.message?.includes("402") || err?.message?.includes("Credits")) {
        toast.error("AI credits exhausted — please add funds");
      } else {
        toast.error("Failed to generate jingle");
      }
    } finally {
      setJingleLoading(false);
    }
  };

  const handleRate = async (rating: Rating) => {
    if (!dueWords || !dueWords[currentIndex]) return;
    // Guard against a double-tap firing two ratings for the same card before
    // the mutation resolves (which double-counts sessionCount and skips a card).
    if (ratingInFlightRef.current) return;
    ratingInFlightRef.current = true;
    const card = dueWords[currentIndex];
    const wordCount = dueWords.length;

    try {
      // Snapshot the current DB row so the learner can undo this rating.
      const snapshotFields = card.card_type === "production"
        ? "production_ease_factor, production_difficulty, production_interval_days, production_repetitions, production_next_review_at, production_last_reviewed_at, production_lapses, is_leech"
        : "ease_factor, difficulty, interval_days, repetitions, next_review_at, last_reviewed_at, lapses, is_leech, production_next_review_at";
      const { data: snapshot } = await (supabase
        .from("user_vocabulary")
        .select(snapshotFields as never) as any)
        .eq("id", card.id)
        .maybeSingle();

      const result = calculateNextReview(
        rating,
        card.ease_factor,
        card.difficulty ?? 5.0,
        card.interval_days,
        card.repetitions,
        elapsedDaysSince(card.last_reviewed_at),
        { desiredRetention, fuzzSeed: card.id },
      );

      const wasNew = card.repetitions === 0;

      await updateReview.mutateAsync({
        wordId: card.id,
        stability: result.stability,
        difficulty: result.difficulty,
        intervalDays: result.intervalDays,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
        // Audio cards share the recognition schedule — see scheduleDirectionFor.
        cardType: scheduleDirectionFor(card.card_type),
        rating,
        productionLocked: card.production_locked,
        currentLapses: card.lapses,
        currentProductionLapses: card.production_lapses,
      });

      // Claim daily new-card budget on the card's first-ever rating (not on
      // every fetch), so the counter is reload-proof and never double-counts.
      if (wasNew) claimNewCard.mutate();

      const prevIndex = currentIndex;
      const newAction = snapshot
        ? {
            cardId: card.id,
            cardType: card.card_type,
            prevIndex,
            snapshot: snapshot as Record<string, unknown>,
          }
        : null;
      if (newAction) {
        setLastAction(newAction);
      }

      setSessionCount((prev) => prev + 1);
      setShowAnswer(false);

      if (currentIndex < wordCount - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        await refetch();
        setCurrentIndex(0);
      }
    } catch (err) {
      // Don't strand the learner on a frozen card with no feedback. The card
      // wasn't updated in the DB, so it stays due and returns on the next fetch.
      console.error("Failed to save review rating:", err);
      toast.error("Couldn't save your rating — it will come back around. Try again.");
      setShowAnswer(false);
      if (currentIndex < wordCount - 1) {
        setCurrentIndex((prev) => prev + 1);
      }
    } finally {
      ratingInFlightRef.current = false;
    }
  };

  const handleUndo = async (action?: NonNullable<typeof lastAction>) => {
    const target = action ?? lastAction;
    if (!target || undoing) return;
    setUndoing(true);
    try {
      const { error } = await supabase
        .from("user_vocabulary")
        .update(target.snapshot as never)
        .eq("id", target.cardId);
      if (error) throw error;
      setSessionCount((prev) => Math.max(0, prev - 1));
      setCurrentIndex(target.prevIndex);
      setShowAnswer(false);
      setLastAction(null);
      await queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due-words"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
      toast.success("Rating undone");
    } catch (err) {
      console.error("Undo failed:", err);
      toast.error("Couldn't undo — try again");
    } finally {
      setUndoing(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your reviews...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell compact>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">Sign in to review your words.</p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" /> Login
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!dueWords || dueWords.length === 0) {
    return (
      <AppShell compact>
        <div className="flex items-center justify-between mb-6">
          <HomeButton />
          {sessionCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{sessionCount}</span>
            </div>
          )}
        </div>
        <SessionHandoff
          deckId="my-words"
          session={session}
          message="No saved words due for review right now."
          fallbackLabel="Back to My Words"
          fallbackRoute="/my-words"
        />
      </AppShell>
    );
  }

  const safeIndex = Math.min(currentIndex, dueWords.length - 1);
  if (safeIndex !== currentIndex) {
    setCurrentIndex(safeIndex);
  }

  if (!currentWord) return null;


  return (
    <AppShell compact>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <HomeButton />
        <div className="flex items-center gap-2">
          <Select
            value={String(newCap)}
            onValueChange={(v) => setNewCap(Number(v) as never)}
          >
            <SelectTrigger
              className="h-8 w-auto gap-1 px-2.5 text-xs font-medium"
              aria-label="New cards per session"
              title="New cards per session"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <SelectValue>{formatCap(newCap)}/day</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {NEW_CAP_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {formatCap(n)} new / session
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="px-3 py-1.5 rounded-lg bg-card border border-border flex items-center gap-1.5">

            {isProduction ? <Mic2 className="h-3.5 w-3.5 text-primary" /> : <Brain className="h-3.5 w-3.5 text-primary" />}
            <span className="text-sm font-medium text-foreground">
              {isProduction ? "Produce" : "Recognize"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border">
            <Trophy className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{sessionCount}</span>
          </div>
        </div>
      </div>

      {/* Progress */}
      <SessionProgress
        deckId="my-words"
        session={session}
        position={safeIndex + 1}
        total={dueWords.length}
      >
        <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {newRemaining} new
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {reviewRemaining} review
          </span>
        </div>
      </SessionProgress>

      {/* Card */}
      <div className="py-4">
        <div className="max-w-sm mx-auto">
          {useCloze ? (
            <div>
              <ReviewClozeCard
                wordArabic={currentArabic!}
                wordEnglish={currentWord.word_english}
                sentenceText={clozeSentenceText!}
                sentenceEnglish={clozeSentenceEnglish}
                sentenceAudioUrl={clozeSentenceAudio}
                distractors={distractorPool}
              />
              {clozeFromTranscript && transcriptCloze && (
                <p className="mt-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  From your transcript · {transcriptCloze.transcriptionTitle}
                </p>
              )}
            </div>
          ) : (
          <div className="rounded-2xl bg-card border border-border p-8 text-center">
            {/* Image if available */}
            {currentWord.image_url && (
              <div className="mb-4 rounded-lg overflow-hidden bg-muted aspect-[4/3] flex items-center justify-center">
                <img
                  src={currentWord.image_url}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            {/* Generate image button */}
            <div className="mb-6 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageDialogOpen(true)}
                className="gap-1.5 text-muted-foreground"
              >
                <Sparkles className="h-4 w-4" />
                {currentWord.image_url ? "Regenerate Image" : "Generate Image"}
              </Button>
            </div>

            {/* Prompt area */}
            {isProduction ? (
              <>
                {!showAnswer ? (
                  <>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                      Say it in Arabic
                    </p>
                    <p className="text-2xl font-semibold text-foreground mb-6">
                      {currentWord.word_english}
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className="text-4xl font-bold text-foreground mb-1 animate-in fade-in duration-200"
                      style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      dir="rtl"
                    >
                      {currentWord.word_arabic}
                    </p>
                    {currentWord.transliteration && (
                      <p className="text-sm text-muted-foreground italic mb-5">{currentWord.transliteration}</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <p
                  className="text-4xl font-bold text-foreground mb-1"
                  style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                  dir="rtl"
                >
                  {currentWord.word_arabic}
                </p>
                {currentWord.transliteration && (
                  <p className="text-sm text-muted-foreground italic mb-5">{currentWord.transliteration}</p>
                )}
              </>
            )}

            {/* Ask AI about this word */}
            {(!isProduction || showAnswer) && currentArabic && (
              <div className="flex justify-center mb-4 -mt-2">
                <AskAISentence
                  arabic={currentArabic}
                  english={currentWord.word_english}
                  variant="chip"
                />
              </div>
            )}


            {/* Audio buttons */}
            <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
              <Button
                variant="default"
                size="sm"
                onClick={() => effectiveWordAudio && playAudio(effectiveWordAudio)}
                disabled={!effectiveWordAudio || wordTtsLoading}
                className="gap-1.5"
              >
                {wordTtsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isProduction && !showAnswer ? "Hear it" : "Play"}
              </Button>
              {currentWord.sentence_audio_url && (showAnswer || !isProduction) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playAudio(currentWord.sentence_audio_url!)}
                  className="gap-1.5"
                >
                  <Volume2 className="h-4 w-4" />
                  Sentence
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => generateJingle(currentWord)}
                disabled={jingleLoading}
                className="gap-1.5"
              >
                {jingleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : currentWord.jingle_audio_url ? <Play className="h-4 w-4" /> : <Music className="h-4 w-4" />}
                {jingleLoading ? "Creating..." : currentWord.jingle_audio_url ? "Play jingle" : "Generate jingle"}
              </Button>

              {currentWord.jingle_audio_url && !jingleLoading && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => generateJingle(currentWord, true)}
                  title="Regenerate jingle"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>

            {currentWord.jingle_audio_url && currentWord.jingle_lyrics && (
              <div className="mb-4">
                {showLyrics ? (
                  <div className="rounded-lg bg-muted/40 border border-border p-3 text-left animate-in fade-in duration-200 max-w-md mx-auto">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Jingle lyrics
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowLyrics(false)}
                        className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                      >
                        Hide
                      </button>
                    </div>
                    <div
                      className="text-sm leading-relaxed space-y-1"
                      dir="rtl"
                      style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                    >
                      {currentWord.jingle_lyrics.split(/\r?\n/).map((line, i) => (
                        line.trim() ? (
                          <TappableArabicText
                            key={i}
                            text={line}
                            source="jingle-lyrics"
                            sentenceContext={{ arabic: currentWord.sentence_text || undefined, english: currentWord.sentence_english || undefined }}
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
                    Show lyrics
                  </Button>
                )}
              </div>
            )}


            {/* Pronunciation practice — only meaningful once Arabic is visible */}
            {(showAnswer || !isProduction) && (
              <div className="mb-6">
                <PronunciationButton word={currentWord.word_arabic} />
              </div>
            )}

            {/* Reveal */}
            {isProduction ? (
              !showAnswer && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAnswer(true);
                    if (effectiveWordAudio) playAudio(effectiveWordAudio);
                  }}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Eye className="h-4 w-4" />
                  Reveal Arabic
                </Button>
              )
            ) : (
              <>
                {showAnswer && (
                  <div className="animate-in fade-in duration-200 mb-4">
                    <p className="text-xl text-muted-foreground">{currentWord.word_english}</p>
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
                    Reveal English
                  </Button>
                )}
              </>
            )}

            {/* Original sentence context (where the word was first saved) */}
            {currentWord.sentence_text && (showAnswer || !isProduction) && (
              <div className="mt-6 max-w-md mx-auto">
                {!showContext ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowContext(true)}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <Quote className="h-4 w-4" />
                    Show original sentence
                  </Button>
                ) : (
                  <div className="text-left bg-muted/40 border-l-2 border-primary/40 rounded-r p-3 animate-in fade-in duration-200">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                      Original context
                    </p>
                    <p
                      className="text-base text-foreground/90 font-arabic leading-relaxed"
                      dir="rtl"
                      style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                    >
                      {currentWord.sentence_text}
                    </p>
                    {currentWord.sentence_english && (
                      <p className="text-xs text-muted-foreground mt-1.5 italic">
                        {currentWord.sentence_english}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {showAnswer && (
            <SiblingWordsPanel
              root={currentWord.root}
              currentWordId={currentWord.id}
              // The card's dialect, not the app's: in a mixed session the deck
              // spans all three, and the active one is right for at most one.
              dialect={currentWord.dialect}
              onPlayAudio={playAudio}
              onOpenFamily={setFamilyKey}
            />
          )}

          {leechTrackingEnabled && currentWord.is_leech && (
            <LeechHelperPanel
              kind="word"
              rowId={currentWord.id}
              arabic={currentWord.word_arabic}
              english={currentWord.word_english}
              dialect={activeDialect}
              mnemonic={currentWord.mnemonic}
              invalidateKeys={[["user-vocabulary-due-words"]]}
            />
          )}
        </div>

        {/* Self-rating always visible */}
        <div className="mt-10">
          <RatingButtons
            onRate={handleRate}
            stability={currentWord.ease_factor}
            difficulty={currentWord.difficulty ?? 5.0}
            intervalDays={currentWord.interval_days}
            repetitions={currentWord.repetitions}
            elapsedDays={elapsedDaysSince(currentWord.last_reviewed_at)}
            disabled={updateReview.isPending}
          />
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPracticeOpen(true)}
              className="gap-1.5 text-muted-foreground"
              title="Practice using this word in a sentence"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Practice a sentence</span>
            </Button>
            {lastAction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUndo()}
                disabled={undoing}
                className="gap-1.5 text-muted-foreground"
                title="Undo last rating"
              >
                {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                <span className="text-xs font-medium">Undo</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <GenerateImageDialog
        word={currentWord}
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        onImageSaved={async (wordId, imageUrl) => {
          await updateImage.mutateAsync({ wordId, imageUrl });
        }}
      />

      <SentencePracticeSheet
        open={practiceOpen}
        onOpenChange={setPracticeOpen}
        targetArabic={currentWord.word_arabic}
        targetEnglish={currentWord.word_english}
      />

      <RootFamilySheet
        familyKey={familyKey}
        onOpenChange={(open) => !open && setFamilyKey(null)}
        onPlayAudio={playAudio}
      />
    </AppShell>
  );
};

export default MyWordsReview;
