import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

import { useAzurePronunciation, scoreBand, type PronunciationResult, type WordResult } from "@/hooks/useAzurePronunciation";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mic, MicOff, RotateCcw, Loader2, ChevronRight, ChevronLeft, Trophy, Target, ArrowRight, Languages, Headphones } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { useRef } from "react";
import { ShadowPlayer } from "@/components/pronunciation/ShadowPlayer";
import { useShadowQueue } from "@/hooks/useShadowQueue";
import { useDialect } from "@/contexts/DialectContext";

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
        <div className="mb-8"><HomeButton /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Pronunciation Practice</h1>
          <p className="text-muted-foreground mb-6">Sign in to practice your English pronunciation</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  if (wordsLoading) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (words.length === 0) {
    return (
      <AppShell>
        <div className="mb-8"><HomeButton /></div>
        <div className="text-center py-16">
          <Mic className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Pronunciation Practice</h1>
          <p className="text-muted-foreground mb-6">
            Add some words to your vocabulary first, then come back to practice!
          </p>
          <Button onClick={() => navigate("/my-words")}>Go to My Words</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6"><HomeButton /></div>

      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-between mb-1">
            <div />
            <h1 className="text-2xl font-bold font-heading inline-flex items-center gap-2">Pronunciation Practice <InfoHint {...PAGE_HINTS["pronunciation"]} size="md" /></h1>
            <div className="flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">ع</span>
              <Switch checked={showMeaning} onCheckedChange={setShowMeaning} className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Word {currentIndex + 1} of {words.length}
          </p>
        </div>

        {/* Session stats bar */}
        {sessionScores.length > 0 && (
          <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-2 mb-6">
            <div className="flex items-center gap-2 text-sm">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Session avg:</span>
              <span className={cn("font-bold", scoreBand(sessionAverage).color)}>
                {sessionAverage}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="h-4 w-4" />
              {sessionScores.length} attempts
            </div>
          </div>
        )}

        {/* Progress */}
        <Progress value={((currentIndex + 1) / words.length) * 100} className="mb-6 h-1.5" />

        {/* Mode toggle */}
        <div className="flex justify-center gap-2 mb-6">
          <Button
            variant={mode === "word" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("word"); reset(); }}
          >
            Word
          </Button>
          <Button
            variant={mode === "sentence" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("sentence"); reset(); }}
            disabled={!currentWord?.sentence_english}
          >
            Sentence
          </Button>
          <Button
            variant={mode === "shadow" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("shadow"); reset(); }}
            className="gap-1.5"
          >
            <Headphones className="h-3.5 w-3.5" />
            Shadow
          </Button>
        </div>

        {mode === "shadow" && (
          <ShadowMode showEnglish={showMeaning} onScore={(s) => setSessionScores((prev) => [...prev, s])} />
        )}
        {mode !== "shadow" && (
        <>


        {/* Word card */}
        <div className="bg-card border-2 border-border rounded-2xl p-8 text-center mb-6">
          {/* The English to pronounce */}
          <p className="text-4xl font-bold mb-3 leading-relaxed font-english">
            {referenceText}
          </p>

          {/* Arabic meaning behind the reveal */}
          {showMeaning && (
            <p dir="rtl" className="text-muted-foreground text-lg mb-4 animate-in fade-in duration-200 font-arabic">
              {mode === "sentence" && currentWord?.sentence_text
                ? currentWord.sentence_text
                : currentWord?.word_arabic}
            </p>
          )}

          {/* Deck audio is Arabic-era (the saved word's Arabic pronunciation),
              so no "listen first" here until English card audio exists. */}
        </div>

        {/* Recording area */}
        <div className="flex flex-col items-center gap-4 mb-6">
          {!result && !isLoading && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200",
                isRecording
                  ? "bg-destructive text-destructive-foreground animate-pulse scale-110 shadow-lg shadow-destructive/30"
                  : "bg-primary text-primary-foreground hover:scale-105 shadow-lg shadow-primary/30"
              )}
            >
              {isRecording ? (
                <MicOff className="h-8 w-8" />
              ) : (
                <Mic className="h-8 w-8" />
              )}
            </button>
          )}

          {!result && !isLoading && (
            <p className="text-sm text-muted-foreground">
              {isRecording ? "Tap to stop recording" : "Tap to record your pronunciation"}
            </p>
          )}

          {isLoading && (
            <LoadingPanel task="pronunciation" variant="inline" size="sm" />
          )}

          {error && (
            <div className="text-sm text-destructive text-center">
              {error}
              <Button variant="ghost" size="sm" onClick={reset} className="ml-2">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        {result && band && (
          <div className="bg-card border-2 border-border rounded-2xl p-6 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Score circle */}
            <div className="text-center mb-4">
              <div className={cn(
                "inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-2",
                result.overall >= 90 ? "border-green-500" :
                result.overall >= 75 ? "border-blue-500" :
                result.overall >= 60 ? "border-yellow-500" : "border-red-500"
              )}>
                <span className={cn("text-3xl font-bold", band.color)}>
                  {Math.round(result.overall)}
                </span>
              </div>
              <p className={cn("text-lg font-semibold", band.color)}>{band.label}</p>
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Accuracy", value: result.accuracy },
                { label: "Fluency", value: result.fluency },
                { label: "Completeness", value: result.completeness },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-xl font-bold text-foreground">{Math.round(value)}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Per-word breakdown */}
            {result.words.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Word Breakdown
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {result.words.map((w: WordResult, i: number) => {
                    const wb = scoreBand(w.accuracy);
                    return (
                      <div
                        key={i}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-sm font-medium bg-muted border border-border",
                          wb.color
                        )}
                      >
                        <span>{w.word}</span>
                        <span className="text-xs ml-1 opacity-70">{Math.round(w.accuracy)}</span>
                        {w.errorType !== "None" && (
                          <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">
                            {w.errorType}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-1.5" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Try Again
              </Button>
              {currentIndex < words.length - 1 && (
                <Button className="flex-1 gap-1.5" onClick={goToNext}>
                  Next Word
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        {!result && (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToNext}
              disabled={currentIndex === words.length - 1}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
        </>
        )}
      </div>
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
        <Button variant="outline" size="sm" onClick={refresh} className="ml-2">Retry</Button>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-2xl">
        <Headphones className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <h3 className="font-semibold mb-2">No native clips available yet</h3>
        <p className="text-sm text-muted-foreground mb-4 px-6">
          Shadow mode plays real native-speaker clips. Browse videos or upload audio to build a queue.
        </p>
        <div className="flex gap-2 justify-center">
          <Button size="sm" onClick={() => navigate("/discover")}>Browse videos</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/transcribe")}>Upload audio</Button>
        </div>
      </div>
    );
  }

  if (index >= clips.length) {
    return (
      <div className="text-center py-10 bg-card border-2 border-border rounded-2xl">
        <Trophy className="h-12 w-12 text-primary mx-auto mb-3" />
        <h3 className="font-semibold text-lg mb-1">Session complete</h3>
        <p className="text-sm text-muted-foreground mb-4">{clips.length} clips shadowed</p>
        <Button onClick={() => { setIndex(0); refresh(); }}>New session</Button>
      </div>
    );
  }

  const clip = clips[index];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Clip {index + 1} / {clips.length}</span>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Auto-advance</span>
          <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4" />
        </label>
      </div>
      <Progress value={(index / clips.length) * 100} className="h-1.5" />
      <ShadowPlayer
        key={clip.id}
        clip={clip}
        threshold={threshold}
        autoAdvance={autoAdvance}
        showEnglish={showEnglish}
        onResult={onScore}
        onNext={() => setIndex((i) => i + 1)}
      />
      <p className="text-[10px] text-center text-muted-foreground/70">
        Tip: headphones improve scoring by preventing the source audio from leaking into your mic.
      </p>
    </div>
  );
};

export default PronunciationPractice;

