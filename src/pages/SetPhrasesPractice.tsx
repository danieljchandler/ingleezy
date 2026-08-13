import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useGenerateQuiz,
  useScoreVoice,
  useReviewPhrase,
  useSavePhrase,
  useLogQuizAttempt,
  type QuizItem,
} from "@/hooks/useSetPhrases";
import { Loader2, Mic, MicOff, Star, Volume2, ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  reviewMode?: boolean;
}

const SetPhrasesPractice = ({ reviewMode = false }: Props) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const occasionId = params.get("occasion") ?? undefined;

  const generate = useGenerateQuiz();
  const scoreVoice = useScoreVoice();
  const review = useReviewPhrase();
  const save = useSavePhrase();
  const logAttempt = useLogQuizAttempt();

  const [items, setItems] = useState<QuizItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState<{ correct: boolean; transcript?: string; similarity?: number; mode: "voice" | "choice" } | null>(null);
  const [recording, setRecording] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    generate.mutate({ occasionId, length: 8 }, {
      onSuccess: (data) => {
        if (!data.length) toast.error("No phrases available — ask an admin to seed some.");
        setItems(data);
      },
      onError: (e: any) => toast.error(e.message || "Failed to load quiz"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasionId]);

  const current = items[idx];

  const playAudio = (url?: string | null) => {
    if (!url) return;
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(url);
    audioRef.current = a;
    a.play().catch(() => {});
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        scoreVoice.mutate(
          { audioBase64: b64, mimeType: blob.type, phraseId: current.phrase_id, target: current.question_type === "reply" ? "reply" : "phrase" },
          {
            onSuccess: (res) => {
              setAnswered({ correct: res.accepted, transcript: res.transcript, similarity: res.similarity, mode: "voice" });
              logAttempt.mutate({
                phrase_id: current.phrase_id,
                question_type: current.question_type,
                answer_mode: "voice",
                correct: res.accepted,
                asr_transcript: res.transcript,
                asr_similarity: res.similarity,
              });
              review.mutate({ phraseId: current.phrase_id, quality: res.quality });
              if (!res.accepted && current.expected_audio_url) playAudio(current.expected_audio_url);
            },
            onError: (e: any) => toast.error(e.message || "Voice scoring failed"),
          },
        );
      };
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const pickChoice = (choice: { arabic: string; correct: boolean }) => {
    setAnswered({ correct: choice.correct, mode: "choice" });
    logAttempt.mutate({
      phrase_id: current.phrase_id,
      question_type: current.question_type,
      answer_mode: "choice",
      correct: choice.correct,
    });
    review.mutate({ phraseId: current.phrase_id, quality: choice.correct ? 4 : 1 });
    if (!choice.correct && current.expected_audio_url) playAudio(current.expected_audio_url);
  };

  const next = () => {
    setAnswered(null);
    setShowChoices(false);
    if (idx + 1 >= items.length) {
      toast.success("Session complete!");
      navigate("/set-phrases");
    } else {
      setIdx(idx + 1);
    }
  };

  if (generate.isPending) {
    return (
      <AppShell compact>
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </AppShell>
    );
  }
  if (!current) {
    return (
      <AppShell compact>
        <Card className="p-6 text-center text-sm text-muted-foreground">No phrases ready yet.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell compact>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{idx + 1} / {items.length}</span>
          <div className="flex gap-1">
            {current.occasion && <Badge variant="outline" className="text-xs">{current.occasion.name}</Badge>}
            {current.formality && <Badge variant="secondary" className="text-xs">{current.formality}</Badge>}
            {current.is_due_review && <Badge className="text-xs">due</Badge>}
          </div>
        </div>

        <Card className="p-5 space-y-4 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 border-emerald-500/20">
          {current.question_type === "reply" ? (
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Reply to this:</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xl font-semibold leading-relaxed" dir="rtl">{current.prompt.arabic}</p>
                {current.prompt.audio_url && (
                  <Button size="icon" variant="ghost" onClick={() => playAudio(current.prompt.audio_url)}>
                    <Volume2 className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Scenario:</p>
              <p className="text-base leading-relaxed">{current.prompt.english}</p>
              <p className="text-xs text-muted-foreground mt-2">What do you say?</p>
            </div>
          )}
        </Card>

        {!answered && (
          <div className="space-y-3">
            <Button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={scoreVoice.isPending}
              className="w-full h-16"
              variant={recording ? "destructive" : "default"}
            >
              {scoreVoice.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : recording ? (
                <><MicOff className="h-5 w-5 mr-2" /> Release to submit</>
              ) : (
                <><Mic className="h-5 w-5 mr-2" /> Hold to speak</>
              )}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setShowChoices((s) => !s)}>
              {showChoices ? "Hide choices" : "Show choices instead"}
            </Button>
            {showChoices && (
              <div className="space-y-2">
                {current.choices.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => pickChoice(c)}
                    className="w-full p-3 rounded-lg border border-border bg-card text-right hover:border-primary/40 active:scale-[0.99] transition"
                    dir="rtl"
                  >
                    <p className="text-lg">{c.arabic}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {answered && (
          <Card className={`p-4 space-y-3 ${answered.correct ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2">
              {answered.correct ? <Check className="h-5 w-5 text-emerald-600" /> : <X className="h-5 w-5 text-destructive" />}
              <span className="font-semibold">{answered.correct ? "Correct!" : "Not quite"}</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Correct answer:</p>
              <div className="flex items-center justify-between gap-2 mt-1">
                <p className="text-xl font-semibold" dir="rtl">{current.expected_arabic}</p>
                {current.expected_audio_url && (
                  <Button size="icon" variant="ghost" onClick={() => playAudio(current.expected_audio_url)}>
                    <Volume2 className="h-5 w-5" />
                  </Button>
                )}
              </div>
              {current.expected_transliteration && (
                <p className="text-sm text-muted-foreground italic mt-1">{current.expected_transliteration}</p>
              )}
              {current.expected_english && (
                <p className="text-sm text-muted-foreground mt-1">{current.expected_english}</p>
              )}
            </div>
            {answered.mode === "voice" && answered.transcript !== undefined && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                <p>You said: <span dir="rtl">{answered.transcript || "(nothing detected)"}</span></p>
                <p>Match: {Math.round((answered.similarity ?? 0) * 100)}%</p>
              </div>
            )}
            {current.cultural_note && (
              <p className="text-xs text-muted-foreground border-t pt-2">💡 {current.cultural_note}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => save.mutate({ phraseId: current.phrase_id, source: answered.correct ? "reviewed" : "quiz_miss" })}>
                <Star className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button className="flex-1" onClick={next}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default SetPhrasesPractice;
