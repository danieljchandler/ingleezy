import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

import { useAzurePronunciation, scoreBand } from "@/hooks/useAzurePronunciation";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { PageCorner } from "@/components/shell/PageCorner";
import { SessionFrame } from "@/components/session/SessionFrame";
import { PronunciationResultCard } from "@/components/pronunciation/PronunciationResultCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Mic, MicOff, RotateCcw, Loader2, Trophy, Headphones } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { englishSpeechUrl } from "@/lib/englishSpeech";
import { arCount } from "@/lib/strings";
import { ShadowPlayer } from "@/components/pronunciation/ShadowPlayer";
import { useShadowQueue } from "@/hooks/useShadowQueue";
import { useDialect } from "@/contexts/DialectContext";
import { ChevronBack, ChevronOpen, IconNext } from "@/components/shared/DirectionalIcon";

const MAX_DURATION_MS = 5000;

interface VocabWord {
  id: string;
  word_arabic: string;
  word_english: string;
  word_audio_url?: string | null;
  sentence_text?: string | null;
  sentence_english?: string | null;
}

const PronunciationPractice = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { assess, result, isLoading, error, reset } = useAzurePronunciation();
  const { activeDialect } = useDialect();
  // The studied language is English; the learner's dialect only buckets the
  // recorded errors. (Word/sentence modes assess English — shadow mode still
  // echoes native Arabic clips and scores through the Munsit path.)
  const assessLocale = "en-US";

  const [words, setWords] = useState<VocabWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [mode, setMode] = useState<"word" | "sentence" | "shadow">("word");
  const [sessionScores, setSessionScores] = useState<number[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [showMeaning, setShowMeaning] = useState(false);

  // The learner's last take, to play back beside the model.
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch user vocabulary words
  useEffect(() => {
    if (!user) return;

    const fetchWords = async () => {
      setWordsLoading(true);
      const { data, error } = await supabase
        .from("user_vocabulary")
        .select("id, word_arabic, word_english, word_audio_url, sentence_text, sentence_english")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (data && !error) {
        setWords(data);
      }
      setWordsLoading(false);
    };

    fetchWords();
  }, [user]);

  const currentWord = words[currentIndex];
  // The ENGLISH side is what the learner pronounces now; the Arabic is its
  // meaning, behind the reveal.
  const referenceText = mode === "sentence" && currentWord?.sentence_english
    ? currentWord.sentence_english
    : currentWord?.word_english || "";

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    clearTimeout(timerRef.current);
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    reset();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          setTakeUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          const res = await assess(blob, referenceText, assessLocale, activeDialect);
          if (res) {
            setSessionScores((prev) => [...prev, res.overall]);
          }
        }
      };

      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, MAX_DURATION_MS);
    } catch {
      console.error("Microphone access denied");
    }
  }, [referenceText, assess, reset, assessLocale, activeDialect]);

  const play = (url: string) => {
    playerRef.current?.pause();
    const audio = new Audio(url);
    playerRef.current = audio;
    audio.play().catch(() => {/* a blocked or failed play just stays silent */});
  };

  const playModel = async () => {
    setModelLoading(true);
    try {
      play(await englishSpeechUrl(referenceText));
    } catch (err) {
      console.warn("Model pronunciation unavailable:", err);
    } finally {
      setModelLoading(false);
    }
  };

  // Stop playback when leaving the page. The ref is read at unmount on
  // purpose: the player playing then is the one to stop, not the one (if any)
  // that existed when this effect ran.
  useEffect(
    () => () => {
      playerRef.current?.pause();
    },
    [],
  );
  useEffect(() => () => { if (takeUrl) URL.revokeObjectURL(takeUrl); }, [takeUrl]);

  const goToNext = () => {
    reset();
    setCurrentIndex((prev) => Math.min(prev + 1, words.length - 1));
  };

  const goToPrev = () => {
    reset();
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const sessionAverage =
    sessionScores.length > 0
      ? Math.round(sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length)
      : 0;

  const band = result ? scoreBand(result.overall) : null;

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="mb-8"><PageCorner /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">تدريب النطق</h1>
          <p className="text-muted-foreground mb-6">سجّل الدخول للتدرب على نطقك بالإنجليزية</p>
          <Button onClick={() => navigate("/auth")}>تسجيل الدخول</Button>
        </div>
      </AppShell>
    );
  }

  if (wordsLoading) {
    return (
      <AppShell>
        <div className="mb-8"><PageCorner /></div>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (words.length === 0) {
    return (
      <AppShell>
        <div className="mb-8"><PageCorner /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">تدريب النطق</h1>
          <p className="text-muted-foreground mb-6">
            احفظ بعض الكلمات أولاً، ثم عد للتدرب على نطقها!
          </p>
          <Button onClick={() => navigate("/my-words")}>اذهب إلى كلماتي</Button>
        </div>
      </AppShell>
    );
  }

  const switchMode = (next: typeof mode) => {
    setMode(next);
    reset();
  };

  const recordControl = (
    <div className="flex flex-col items-center gap-2.5">
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        aria-label={isRecording ? "أوقف التسجيل" : "سجّل نطقك"}
        className={cn(
          "grid h-[76px] w-[76px] place-items-center rounded-full text-primary-foreground transition-all duration-200",
          isRecording
            ? "scale-105 animate-pulse bg-destructive ring-8 ring-destructive/15"
            : "bg-primary ring-8 ring-primary/10 hover:scale-105",
        )}
      >
        {isRecording ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
      </button>
      <p className="text-sm text-muted-foreground">
        {isRecording ? "المس لإيقاف التسجيل" : "المس لتسجيل نطقك"}
      </p>
    </div>
  );

  // The bottom slot: the mic until there is a score, then what to do next.
  const action =
    mode === "shadow" ? undefined : isLoading ? (
      <LoadingPanel task="pronunciation" variant="inline" size="sm" />
    ) : result ? (
      <div className="mx-auto flex w-full max-w-md gap-2">
        <Button variant="outline" size="lg" className="flex-1 gap-1.5" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          حاول من جديد
        </Button>
        {currentIndex < words.length - 1 && (
          <Button size="lg" className="flex-1 gap-1.5" onClick={goToNext}>
            الكلمة التالية
            <IconNext className="h-4 w-4" />
          </Button>
        )}
      </div>
    ) : (
      recordControl
    );

  return (
    <AppShell compact>
      <SessionFrame
        onExit={() => navigate("/talk")}
        position={currentIndex + 1}
        total={mode === "shadow" ? 0 : words.length}
        trailing={
          mode !== "shadow" && (
            <span className="text-sm text-muted-foreground">
              كلمة {currentIndex + 1} من {words.length}
            </span>
          )
        }
        meta={
          sessionScores.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span>متوسط الجلسة:</span>
              <span className={cn("font-bold", scoreBand(sessionAverage).color)}>{sessionAverage}</span>
              <span>·</span>
              <span>{arCount(sessionScores.length, { one: "محاولة واحدة", two: "محاولتين", few: "محاولات", many: "محاولة" })}</span>
            </span>
          )
        }
        action={action}
      >
        <div className="mx-auto w-full max-w-md space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="inline-flex items-center gap-2 text-[22px] font-bold leading-8">
              تمرين النطق <InfoHint {...PAGE_HINTS["pronunciation"]} size="md" />
            </h1>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showMeaning} onCheckedChange={setShowMeaning} />
              المعنى
            </label>
          </div>

          {/* What to practise: one word, its saved sentence, or native clips. */}
          <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
            {(
              [
                { key: "word", label: "كلمة", disabled: false },
                { key: "sentence", label: "جملة", disabled: !currentWord?.sentence_english },
                { key: "shadow", label: "محاكاة", disabled: false },
              ] as const
            ).map(({ key, label, disabled }) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                disabled={disabled}
                onClick={() => switchMode(key)}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-40",
                  mode === key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "shadow" && <Headphones className="h-3.5 w-3.5" />}
                {label}
              </button>
            ))}
          </div>

          {mode === "shadow" ? (
            <ShadowMode showEnglish={showMeaning} onScore={(s) => setSessionScores((prev) => [...prev, s])} />
          ) : (
            <>
              {/* The English to say, big; its meaning behind the switch. */}
              <section aria-label="قل هذا" className="rounded-[28px] bg-card px-6 py-8 text-center shadow-card">
                <p
                  className={cn(
                    "break-words font-english font-bold",
                    mode === "sentence" ? "text-[28px] leading-10" : "text-[44px] leading-[52px]",
                  )}
                >
                  {referenceText}
                </p>
                {showMeaning && (
                  <p dir="rtl" className="mt-3 text-lg text-muted-foreground animate-in fade-in duration-200">
                    {mode === "sentence" && currentWord?.sentence_text
                      ? currentWord.sentence_text
                      : currentWord?.word_arabic}
                  </p>
                )}
              </section>

              {error && (
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <span>{error}</span>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw className="me-1 h-3.5 w-3.5" />
                    أعد المحاولة
                  </Button>
                </div>
              )}

              {result && (
                <PronunciationResultCard
                  result={result}
                  referenceText={referenceText}
                  onPlayModel={playModel}
                  modelLoading={modelLoading}
                  onPlayTake={takeUrl ? () => play(takeUrl) : undefined}
                />
              )}

              {!result && (
                <div className="flex justify-between">
                  <Button variant="ghost" size="sm" onClick={goToPrev} disabled={currentIndex === 0}>
                    <ChevronBack className="me-1 h-4 w-4" />
                    السابق
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={goToNext}
                    disabled={currentIndex === words.length - 1}
                  >
                    التالي
                    <ChevronOpen className="ms-1 h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SessionFrame>
    </AppShell>
  );
};

interface ShadowModeProps {
  showEnglish: boolean;
  onScore: (overall: number) => void;
}

const ShadowMode = ({ showEnglish, onScore }: ShadowModeProps) => {
  const navigate = useNavigate();
  const { clips, loading, error, refresh } = useShadowQueue(20);
  const [threshold, setThreshold] = useState(75);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [index, setIndex] = useState(0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        {error}
        <Button variant="outline" size="sm" onClick={refresh} className="ms-2">أعد المحاولة</Button>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-[28px] bg-card px-6 py-10 text-center shadow-card">
        <Headphones className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
        <h3 className="mb-2 font-semibold">لا توجد مقاطع أصلية بعد</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          تشغّل المحاكاة مقاطع بأصوات متحدثين أصليين. تصفح الفيديوهات أو ارفع صوتاً لبناء قائمة.
        </p>
        <div className="flex justify-center gap-2">
          <Button size="sm" onClick={() => navigate("/discover")}>تصفح الفيديوهات</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/transcribe")}>ارفع صوتاً</Button>
        </div>
      </div>
    );
  }

  if (index >= clips.length) {
    return (
      <div className="rounded-[28px] bg-card px-6 py-10 text-center shadow-card">
        <Trophy className="mx-auto mb-3 h-12 w-12 text-primary" />
        <h3 className="mb-1 text-lg font-semibold">انتهت الجلسة</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          قلّدت {arCount(clips.length, { one: "مقطعاً واحداً", two: "مقطعين", few: "مقاطع", many: "مقطعاً" })}
        </p>
        <Button onClick={() => { setIndex(0); refresh(); }}>جلسة جديدة</Button>
      </div>
    );
  }

  const clip = clips[index];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          مقطع {index + 1} من {clips.length}
        </span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <span className="text-muted-foreground">تقدّم تلقائي</span>
          <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} />
        </label>
      </div>
      <Progress value={(index / clips.length) * 100} className="h-2" />
      <ShadowPlayer
        key={clip.id}
        clip={clip}
        threshold={threshold}
        autoAdvance={autoAdvance}
        showEnglish={showEnglish}
        onResult={onScore}
        onNext={() => setIndex((i) => i + 1)}
      />
      <p className="text-center text-xs text-muted-foreground">
        نصيحة: السماعات تحسّن التقييم، لأنها تمنع صوت المقطع من الوصول للمايك.
      </p>
    </div>
  );
};

export default PronunciationPractice;

