import { Fragment, useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { IconBack } from "@/components/shared/DirectionalIcon";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { dialectName, hasArabic } from "@/lib/watch";
import { splitLatinRuns } from "@/lib/latinRuns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import { streamChat, SseChatError } from "@/lib/sseChat";
import {
  Loader2,
  Send,
  Mic,
  Phone,
  Volume2,
  RotateCcw,
  BookmarkPlus,
  Sparkles,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveVoicePanel } from "@/components/conversation/LiveVoicePanel";
import { Art } from "@/components/brand/Art";

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

const DEFAULT_TOPIC = TOPIC_SEEDS[0].label;

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
  /** The topic the learner picked, for the header. Kept with the thread. */
  const [topic, setTopic] = useState<string>(DEFAULT_TOPIC);
  /** Play the tutor's replies at 0.75×. */
  const [slow, setSlow] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
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
      if (typeof parsed.topic === "string") setTopic(parsed.topic);
    } catch {/* ignore */}
     
  }, [activeDialect]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dialect: activeDialect, savedAt: Date.now(), messages, topic }),
      );
    } catch {/* ignore */}
  }, [messages, activeDialect, topic]);

  // The page scrolls, not a box inside it, so follow the newest message down.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
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
    (seed: (typeof TOPIC_SEEDS)[number]) => {
      audioRef.current?.pause();
      ttsCache.current.clear();
      setMessages([]);
      setTopic(seed.label);
      // Send an empty history so the AI opens the conversation.
      streamReply([], seed.hint);
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
          const b64 = await blobToBase64(blob);
          const { data, error } = await supabase.functions.invoke("munsit-transcribe", {
            body: { audioBase64: b64, mimeType: "audio/webm" },
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
        // Both: loading a source resets playbackRate to defaultPlaybackRate.
        audio.defaultPlaybackRate = slow ? 0.75 : 1;
        audio.playbackRate = slow ? 0.75 : 1;
        await audio.play();
      } catch (err) {
        console.error("TTS error:", err);
        setPlayingIdx(null);
      }
    },
    [activeDialect, slow],
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

  const hasThread = messages.length > 0;
  const clearThread = () => {
    audioRef.current?.pause();
    setMessages([]);
    setTopic(DEFAULT_TOPIC);
    try { localStorage.removeItem(STORAGE_KEY); } catch {/* ignore */}
  };

  return (
    <div
      className="flex min-h-[100dvh] flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* A session screen, like Watch: its own header, no dock. The way out is
          the back arrow, to the Talk tab this page is opened from. */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2">
          <Link
            to="/talk"
            aria-label="رجوع"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-muted"
          >
            <IconBack className="h-6 w-6" />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="inline-flex items-center gap-1.5 text-[19px] leading-[28px]">
              {liveMode ? "مكالمة مع المعلّم" : topic}
              <InfoHint {...PAGE_HINTS["conversation"]} />
            </h1>
            <p className="text-[13px] leading-5 text-muted-foreground">
              التصحيح بال{dialectName(activeDialect)} · المستوى <bdi>{cefr}</bdi>
            </p>
          </div>
          <button
            type="button"
            onClick={clearThread}
            disabled={!hasThread || sending}
            aria-label="محادثة جديدة"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-muted disabled:opacity-30"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 pb-4 pt-4">
        {liveMode ? (
          <LiveVoicePanel
            dialect={activeDialect}
            difficulty={cefr === "A1" || cefr === "A2" ? "beginner" : cefr === "B1" || cefr === "B2" ? "intermediate" : "advanced"}
            topicHint={liveTopic}
            onTurnFinalized={(turn) => {
              setMessages((prev) => [...prev, { role: turn.role, content: turn.text }]);
            }}
            onExitLive={() => setLiveMode(false)}
          />
        ) : !hasThread ? (
          <>
            {/* A blank chat box in a language the learner cannot yet write is a
                dead start; the tutor opens the conversation instead. */}
            <section
              aria-labelledby="chat-topics"
              className="rounded-[28px] bg-card p-5 shadow-card"
            >
              <p className="inline-flex items-center gap-1.5 rounded-full bg-tint-gold px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-accent-ink">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> المعلّم يبدأ، وأنت ترد
              </p>
              <h2 id="chat-topics" className="mt-2 text-[22px] leading-8">
                اختر موضوعاً للبدء
              </h2>
              <p className="mt-1 text-[15px] leading-6 text-muted-foreground">
                يرد عليك شريكك بالإنجليزية على مستواك (<bdi>{cefr}</bdi>)، وتأتيك التصحيحات بلهجتك.
                المس أي كلمة لحفظها، أو احفظ الرد كاملاً كعبارة.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {TOPIC_SEEDS.map((t) => (
                  <Button
                    key={t.key}
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => startConversation(t)}
                    disabled={sending}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </section>

            <button
              type="button"
              onClick={() => setLiveMode(true)}
              className="mt-3 flex w-full items-center gap-3.5 rounded-3xl bg-card shadow-soft px-4 py-4 text-start transition-colors hover:bg-muted"
            >
              <Art name="mic" className="h-14 w-14 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold leading-6">مكالمة صوتية مع المعلّم</span>
                <span className="block text-sm leading-6 text-muted-foreground">تكلّم وهو يسمعك، بدون ما تضغط أي زر.</span>
              </span>
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3.5">
            {messages.map((m, i) => {
              if (m.role === "user") {
                // The tutor's correction is about this line, so it sits under
                // it rather than on top of the reply that carried it.
                const next = messages[i + 1];
                const correction = next?.role === "assistant" ? next.correction : undefined;
                return (
                  <Fragment key={i}>
                    <p
                      dir="auto"
                      className={cn(
                        "max-w-[85%] self-end rounded-[22px] rounded-se-md bg-primary px-4 py-3 text-base leading-6 text-primary-foreground",
                        !hasArabic(m.content) && "font-english",
                      )}
                    >
                      {m.content}
                    </p>
                    {correction && <CorrectionCard text={correction} />}
                  </Fragment>
                );
              }
              const correctedAbove = messages[i - 1]?.role === "user";
              return (
                <Fragment key={i}>
                  {m.correction && !correctedAbove && <CorrectionCard text={m.correction} />}
                  <div className="flex max-w-[90%] flex-col items-start gap-1 self-start">
                    <div className="rounded-[22px] rounded-ss-md bg-card px-4 py-3 shadow-soft">
                      {m.content ? (
                        <p lang="en" className="font-english text-base leading-7">
                          <TappableEnglishText text={m.content} source="free-chat" />
                        </p>
                      ) : (
                        <span role="status" aria-label="المعلّم يكتب…" className="flex h-7 items-center gap-1">
                          {[0, 150, 300].map((delay) => (
                            <span
                              key={delay}
                              className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60"
                              style={{ animationDelay: `${delay}ms` }}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                    {!m.streaming && m.content && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-primary hover:text-primary"
                          onClick={() => playMessage(m.content, i)}
                          disabled={playingIdx === i}
                        >
                          {playingIdx === i ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                          اسمع
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-muted-foreground"
                          onClick={() => savePhrase(m.content)}
                        >
                          <BookmarkPlus className="h-4 w-4" /> احفظ العبارة
                        </Button>
                        <AskAISentence arabic={m.content} variant="chip" />
                      </div>
                    )}
                  </div>
                </Fragment>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* Composer: once the tutor has spoken. Speaking is the point, so the mic
          is the big button; typing is there for when speaking isn't possible,
          and the mic turns into send as soon as there is text to send. */}
      {!liveMode && hasThread && (
        <footer
          className="sticky bottom-0 z-30 rounded-t-[28px] bg-card px-3 pt-3 shadow-elegant"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p aria-live="polite" className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground">
                {recording
                  ? "أسمعك… اترك الزر لما تخلص"
                  : transcribing
                  ? "نكتب اللي قلته…"
                  : "اضغط مطولاً وتكلّم"}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={slow}
                  onClick={() => setSlow((v) => !v)}
                  className={cn(
                    "flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors",
                    slow ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-tint-firoza",
                  )}
                >
                  أبطأ
                </button>
                <button
                  type="button"
                  onClick={() => setLiveMode(true)}
                  disabled={sending}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-tint-firoza disabled:opacity-40"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  مكالمة صوتية
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                className={cn("h-12 flex-1 rounded-full px-5 text-base", input && !hasArabic(input) && "font-english")}
              />
              {input.trim() ? (
                <Button
                  type="button"
                  size="icon"
                  aria-label="أرسل"
                  className="h-14 w-14 shrink-0"
                  onClick={() => handleSend()}
                  disabled={sending}
                >
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </Button>
              ) : (
                <button
                  type="button"
                  aria-label="اضغط مطولاً وتكلّم"
                  onPointerDown={startRecording}
                  onPointerUp={stopRecording}
                  onPointerLeave={stopRecording}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={sending || transcribing}
                  className={cn(
                    "grid h-14 w-14 shrink-0 touch-none select-none place-items-center rounded-full text-primary-foreground transition-colors disabled:opacity-50",
                    recording ? "bg-destructive ring-4 ring-destructive/15" : "bg-primary ring-4 ring-primary/10",
                  )}
                >
                  {transcribing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
                </button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

/**
 * The tutor's fix for the learner's last line: an Arabic sentence with the
 * English inside it. The English runs are isolated and set in the English
 * face, highlighted like everything else being studied.
 */
function CorrectionCard({ text }: { text: string }) {
  return (
    <section
      aria-label="تصحيح"
      className="w-full max-w-[85%] self-end rounded-[22px] bg-card px-4 pb-4 pt-3 shadow-card"
    >
      <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-tint-gold px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-accent-ink">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden /> تصحيح
      </p>
      <p dir="auto" className="text-[15px] leading-7 text-foreground">
        {splitLatinRuns(text).map((run, i) =>
          run.latin ? (
            <bdi key={i} className="rounded-md bg-tint-gold px-1 font-english font-semibold">
              {run.text}
            </bdi>
          ) : (
            <Fragment key={i}>{run.text}</Fragment>
          ),
        )}
      </p>
    </section>
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}
