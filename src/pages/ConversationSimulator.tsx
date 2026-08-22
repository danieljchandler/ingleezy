import { useState, useRef, useEffect, useCallback } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { streamChat, SseChatError } from "@/lib/sseChat";
import {
  Loader2,
  Send,
  Mic,
  MicOff,
  Volume2,
  RotateCcw,
  BookmarkPlus,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveVoicePanel } from "@/components/conversation/LiveVoicePanel";

interface ChatMsg {
  role: "user" | "assistant";
  /** Pure Arabic content (no correction line, no translation). */
  content: string;
  /** Optional inline correction the AI emitted ([[CORRECTION]] line). */
  correction?: string;
  /** Streaming flag for the trailing assistant bubble. */
  streaming?: boolean;
}

const STORAGE_KEY = "ingleezy_freechat_v1";
const STORAGE_TTL_MS = 4 * 60 * 60 * 1000;

// Labels are what the learner reads; hints are the English prompt sent to the
// tutor, so they stay English.
const TOPIC_SEEDS = [
  { key: "free", label: "حديث حر", hint: undefined },
  { key: "coffee", label: "قهوة ☕", hint: "ordering at a café" },
  { key: "family", label: "العائلة 👨‍👩‍👧", hint: "talking about family" },
  { key: "work", label: "العمل 💼", hint: "talking about work and daily routine" },
  { key: "travel", label: "السفر ✈️", hint: "planning a trip" },
  { key: "food", label: "الطعام 🍽️", hint: "favourite foods and dishes" },
] as const;

/** Strip a leading [[CORRECTION]] line, returning {correction, body}. */
function splitCorrection(text: string): { correction?: string; body: string } {
  const match = text.match(/^\s*\[\[CORRECTION\]\]\s*(.+?)\s*\n+([\s\S]*)$/);
  if (match) return { correction: match[1].trim(), body: match[2].trim() };
  return { body: text };
}

export default function ConversationSimulator() {
  const { activeDialect } = useDialect();
  const { user } = useAuth();
  const { placementLevel } = useUserLevel();
  const addPhrase = useAddUserPhrase();
  const { toast } = useToast();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [liveMode, setLiveMode] = useState(true);
  const [liveTopic, setLiveTopic] = useState<string | undefined>(undefined);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ttsCache = useRef<Map<string, string>>(new Map());

  const cefr = (placementLevel || "A2").toUpperCase();

  // ── Persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.dialect !== activeDialect) return;
      if (Date.now() - (parsed.savedAt ?? 0) > STORAGE_TTL_MS) return;
      if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
    } catch {/* ignore */}
     
  }, [activeDialect]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dialect: activeDialect, savedAt: Date.now(), messages }),
      );
    } catch {/* ignore */}
  }, [messages, activeDialect]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Streaming chat ───────────────────────────────────────────────────────
  const streamReply = useCallback(
    async (history: ChatMsg[], topicHint?: string) => {
      setSending(true);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Insert empty assistant bubble we'll fill in
      setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

      try {
        const acc = await streamChat({
          functionName: "free-chat",
          signal: ctrl.signal,
          body: {
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            dialect: activeDialect,
            cefrLevel: cefr,
            topicHint,
          },
          onDelta: (_delta, accumulated) => {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: accumulated, streaming: true };
              return next;
            });
          },
        });

        // Finalize: split out correction and play TTS
        const { correction, body } = splitCorrection(acc);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: body, correction, streaming: false };
          return next;
        });

        // Note: do NOT auto-play TTS here — browsers block audio without a
        // user gesture. The user taps the 🔊 button on the bubble to hear it.
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("free-chat stream error:", err);
          let errMsg = err?.message ?? "تعذّر الوصول إلى الذكاء الاصطناعي";
          if (err instanceof SseChatError) {
            if (err.status === 429) errMsg = "Slow down — too many requests. Try again in a moment.";
            else if (err.status === 402) errMsg = "نفد رصيد الذكاء الاصطناعي.";
            else if (err.status === 401) errMsg = "سجّل الدخول للدردشة.";
          }
          toast({ title: "خطأ في المحادثة", description: errMsg, variant: "destructive" });
        }
        setMessages((prev) => prev.filter((_, i) => !(i === prev.length - 1 && prev[i].streaming)));
      } finally {
        setSending(false);
      }
    },
     
    [activeDialect, cefr, toast],
  );

  // ── Send / start ─────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || sending) return;
      setInput("");
      const next: ChatMsg[] = [...messages, { role: "user", content: text }];
      setMessages(next);
      streamReply(next);
    },
    [input, sending, messages, streamReply],
  );

  const startConversation = useCallback(
    (topicHint?: string) => {
      audioRef.current?.pause();
      ttsCache.current.clear();
      setMessages([]);
      // Send an empty history so the AI opens the conversation.
      streamReply([], topicHint);
    },
    [streamReply],
  );

  // ── Mic (push-to-talk) ───────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (recording || sending || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          // The learner speaks ENGLISH here. Munsit is the Arabic recogniser,
          // and an Arabic ASR fed English does not error — it returns
          // Arabic-script noise (the exact failure score-shadow-attempt was
          // fixed for). Deepgram nova-3 EN is the same route shadowing takes.
          const formData = new FormData();
          formData.append("audio", blob, "take.webm");
          formData.append("language", "en");
          const { data, error } = await supabase.functions.invoke("deepgram-transcribe", {
            body: formData,
          });
          if (showCapToastIfLimited(error, data)) return;
          if (error) throw error;
          const text = (data as any)?.text?.trim();
          if (!text) {
            toast({ title: "لم نسمع ذلك", description: "أعد التسجيل.", variant: "destructive" });
            return;
          }
          handleSend(text);
        } catch (err: any) {
          console.error("transcribe error:", err);
          toast({ title: "تعذّر التفريغ", description: err?.message ?? "حاول من جديد", variant: "destructive" });
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err: any) {
      toast({
        title: "الميكروفون محجوب",
        description: "اسمح بالوصول إلى الميكروفون في متصفحك لاستخدام المحادثة الصوتية.",
        variant: "destructive",
      });
      console.error(err);
    }
  }, [recording, sending, transcribing, handleSend, toast]);

  const stopRecording = useCallback(() => {
    if (!recording) return;
    try { mediaRecorderRef.current?.stop(); } catch {/* ignore */}
    setRecording(false);
  }, [recording]);

  // ── TTS playback (dialect-routed) ────────────────────────────────────────
  const playMessage = useCallback(
    async (text: string, idx: number) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Create the Audio element synchronously inside the gesture so the
      // browser allows playback after the await.
      audioRef.current?.pause();
      const audio = new Audio();
      audioRef.current = audio;
      audio.onended = () => setPlayingIdx(null);
      audio.onerror = () => setPlayingIdx(null);
      setPlayingIdx(idx);

      try {
        // Cache key includes dialect — the same phrase can exist in multiple
        // dialect sessions and must not reuse another dialect's audio.
        const cacheKey = `${activeDialect}:${trimmed}`;
        let url = ttsCache.current.get(cacheKey);
        if (!url) {
          // Replies are English now — ElevenLabs multilingual handles both
          // the English and any short Arabic aside inside a correction.
          const fnName = "elevenlabs-tts";
          const body = { text: trimmed };
          const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
          const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? ANON;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: ANON,
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`${fnName} ${res.status}`);
          const blob = await res.blob();
          url = URL.createObjectURL(blob);
          ttsCache.current.set(cacheKey, url);
        }
        audio.src = url;
        await audio.play();
      } catch (err) {
        console.error("TTS error:", err);
        setPlayingIdx(null);
      }
    },
    [activeDialect],
  );


  // ── Save assistant reply as a Set Phrase ─────────────────────────────────
  const savePhrase = useCallback(
    (arabic: string) => {
      if (!user) {
        toast({ title: "سجّل الدخول لحفظ العبارات", variant: "destructive" });
        return;
      }
      addPhrase.mutate(
        {
          phrase_arabic: arabic,
          phrase_english: "", // optional — UI lets user edit later in My Phrases
          source: "free-chat",
        },
        {
          onSuccess: () => toast({ title: "حُفظت كعبارة", description: "تجدها في عباراتي." }),
          onError: (err: any) => {
            if (err?.message?.includes("موجودة")) {
              toast({ title: "محفوظة من قبل" });
            } else {
              toast({ title: "Couldn't save phrase", variant: "destructive" });
            }
          },
        },
      );
    },
    [user, addPhrase, toast],
  );

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-3">
        <PageCorner />
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{activeDialect}</Badge>
          <Badge variant="outline" className="text-xs">{cefr}</Badge>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold inline-flex items-center gap-2">حديث حر <InfoHint {...PAGE_HINTS["conversation"]} /></h1>
        <div className="flex items-center gap-2">
          <Button
            variant={liveMode ? "default" : "outline"}
            size="sm"
            onClick={() => setLiveMode((v) => !v)}
            disabled={sending}
            title="مكالمة صوتية مباشرة مع المعلّم"
          >
            <Mic className="h-4 w-4 me-1" />
            {liveMode ? "إغلاق المباشر" : "🎙️ مكالمة صوتية"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              audioRef.current?.pause();
              setMessages([]);
              try { localStorage.removeItem(STORAGE_KEY); } catch {/* ignore */}
            }}
            disabled={messages.length === 0 || sending}
          >
            <RotateCcw className="h-4 w-4 me-1" /> جديد
          </Button>
        </div>
      </div>

      {liveMode && (
        <div className="mb-4">
          <LiveVoicePanel
            dialect={activeDialect}
            difficulty={cefr === "A1" || cefr === "A2" ? "beginner" : cefr === "B1" || cefr === "B2" ? "intermediate" : "advanced"}
            topicHint={liveTopic}
            onTurnFinalized={(turn) => {
              setMessages((prev) => [...prev, { role: turn.role, content: turn.text }]);
            }}
            onExitLive={() => setLiveMode(false)}
          />
        </div>
      )}

      {/* The English / Tashkil switches lived here. Nothing on this page ever
          read them — the chat renders English unconditionally — and post-flip
          there is no Arabic in the conversation to vocalise. The same global
          preferences are still editable in Settings → تفضيلات العرض. */}

      {/* Topic seeds — only show when chat is empty */}
      {messages.length === 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-4 mb-4">
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" /> اختر موضوعاً للبدء
          </p>
          <div className="flex flex-wrap gap-2">
            {TOPIC_SEEDS.map((t) => (
              <Button
                key={t.key}
                variant="outline"
                size="sm"
                onClick={() => startConversation(t.hint)}
                disabled={sending}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            يرد عليك شريكك بالإنجليزية على مستواك ({cefr})، وتأتيك التصحيحات بلهجتك.
            المس أي كلمة لحفظها، أو احفظ الرد كاملاً كعبارة.
          </p>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="space-y-3 mb-4 max-h-[55vh] overflow-y-auto pe-1"
      >
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 bg-primary text-primary-foreground">
                  <p dir="auto" className="font-english text-base leading-relaxed">
                    {m.content}
                  </p>
                </div>
              </div>
            );
          }
          // assistant
          return (
            <div key={i} className="flex flex-col items-start gap-1.5">
              {m.correction && (
                <div className={cn(
                  "max-w-[90%] rounded-lg px-3 py-2 border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-1.5",
                )}>
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{m.correction}</span>
                </div>
              )}
              <div className="max-w-[90%] rounded-2xl rounded-tl-sm px-3 py-2 bg-muted">
                {m.content ? (
                  <p className="text-base leading-relaxed">
                    <TappableEnglishText text={m.content} source="free-chat" />
                  </p>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {!m.streaming && m.content && (
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => playMessage(m.content, i)}
                      disabled={playingIdx === i}
                    >
                      {playingIdx === i ? (
                        <Loader2 className="h-3 w-3 me-1 animate-spin" />
                      ) : (
                        <Volume2 className="h-3 w-3 me-1" />
                      )}
                      تشغيل
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => savePhrase(m.content)}
                    >
                      <BookmarkPlus className="h-3 w-3 me-1" /> احفظ العبارة
                    </Button>
                    <AskAISentence arabic={m.content} variant="chip" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {messages.length > 0 && (
        <div className="flex items-end gap-2 sticky bottom-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="اكتب بالإنجليزي…"
            dir="auto"
            disabled={sending || recording || transcribing}
            className="font-english"
          />
          <Button
            type="button"
            variant={recording ? "destructive" : "outline"}
            size="icon"
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={stopRecording}
            disabled={sending || transcribing}
            title="اضغط مطولاً للتحدث"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
