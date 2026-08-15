import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SoundAudioButton } from "@/components/sounds/SoundAudioButton";
import {
  buildDrill,
  keystrokeMatches,
  scoreDrill,
  SPELLING_STAGES,
  type DrillItem,
} from "@/lib/typingDrills";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { labelForKind } from "@/lib/mistakes";
import { CheckCircle2, Ear, Loader2, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Written production (C3) — the fourth skill.
 *
 * Two halves. "Write": reply in ENGLISH to an incoming English text message
 * and get the reply corrected, with each mistake explained in the learner's
 * dialect (and quietly fed into the weak-set loop the rest of the app drills
 * from). "Typing": progressive Arabic keyboard drills — a Hakiya leftover
 * that still teaches the Arabic script to Arabic speakers, kept running only
 * until the English Sounds rebuild decides whether it becomes a Latin
 * keyboard drill or goes.
 */

interface WritingPrompt {
  scenario_arabic: string;
  message_english: string;
  message_arabic: string;
}

interface Correction {
  original: string;
  corrected: string;
  kind: string;
  explanation: string;
}

interface WritingReview {
  understandable: boolean;
  verdict_arabic: string;
  corrected_english: string;
  corrected_arabic: string;
  corrections: Correction[];
  tips?: string[];
}

const MAX_CHARS = 600;

// ── Write tab ────────────────────────────────────────────────────────────────

const WriteTab = () => {
  const { activeDialect } = useDialect();
  const [prompt, setPrompt] = useState<WritingPrompt | null>(null);
  const [promptLoading, setPromptLoading] = useState(true);
  const [showGloss, setShowGloss] = useState(false);
  const [text, setText] = useState("");
  const [review, setReview] = useState<WritingReview | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPrompt = useCallback(async () => {
    setPromptLoading(true);
    setReview(null);
    setText("");
    setShowGloss(false);
    const { data, error } = await supabase.functions.invoke("writing-coach", {
      body: { action: "prompt", dialect: activeDialect },
    });
    if (!error && data?.prompt?.message_english) {
      setPrompt(data.prompt as WritingPrompt);
    } else {
      setPrompt(null);
      const message = (data as { message?: string } | null)?.message;
      if (message) toast.error(message);
    }
    setPromptLoading(false);
  }, [activeDialect]);

  useEffect(() => {
    void loadPrompt();
  }, [loadPrompt]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("writing-coach", {
      body: {
        action: "review",
        dialect: activeDialect,
        text: trimmed,
        promptEnglish: prompt?.message_english ?? "",
      },
    });
    setBusy(false);
    if (error || !data?.review) {
      const message = (data as { message?: string } | null)?.message;
      toast.error(message ?? "تعذّرت المراجعة — جرّب مرة ثانية.");
      return;
    }
    setReview(data.review as WritingReview);
  };

  return (
    <div className="space-y-4">
      {promptLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> نجيب لك شي ترد عليه…
        </div>
      ) : prompt ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{prompt.scenario_arabic}</p>
          <div className="mt-2 max-w-[85%] rounded-2xl rounded-tl-sm bg-primary/10 px-4 py-3">
            <p className="font-english text-lg leading-relaxed">{prompt.message_english}</p>
            {showGloss && (
              <p className="mt-2 text-sm text-muted-foreground">{prompt.message_arabic}</p>
            )}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setShowGloss((s) => !s)}
          >
            {showGloss ? "أخفِ الترجمة" : "ورّني الترجمة"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          ما قدرنا نجيب رسالة. اكتب أي شي بالإنجليزي تحت وبنصحّحه لك برضه.
        </div>
      )}

      <div className="space-y-2">
        <Textarea
          dir="ltr"
          lang="en"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          placeholder="اكتب ردك بالإنجليزي هنا…"
          className="min-h-28 font-english text-lg"
          disabled={busy}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length}/{MAX_CHARS}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadPrompt()} disabled={busy}>
              <RefreshCw className="me-1 h-3.5 w-3.5" /> سؤال جديد
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="me-1 h-3.5 w-3.5" />}
              صحّح لي
            </Button>
          </div>
        </div>
      </div>

      {review && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">{review.verdict_arabic}</p>

          <div className="rounded-lg bg-emerald-500/10 px-4 py-3">
            <p className="font-english text-lg leading-relaxed">{review.corrected_english}</p>
            <p className="mt-1 text-sm text-muted-foreground">{review.corrected_arabic}</p>
          </div>

          {review.corrections.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> ما فيه شي نصلحه — كتابتك طبيعية.
            </p>
          ) : (
            <ul className="space-y-2">
              {review.corrections.map((c, i) => (
                <li key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div className="font-english">
                    <span className="text-red-600 line-through decoration-red-400/60">{c.original}</span>
                    <span className="mx-2 text-muted-foreground">←</span>
                    <span className="text-emerald-700 dark:text-emerald-400">{c.corrected}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 text-[10px]">{labelForKind(c.kind)}</Badge>
                    <p className="text-muted-foreground">{c.explanation}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(review.tips?.length ?? 0) > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              {review.tips!.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ── Spelling tab ─────────────────────────────────────────────────────────────
//
// Was a progressive Arabic-keyboard drill — a Hakiya leftover that taught the
// Arabic script to Arabic speakers, which the English Sounds rebuild retired.
// This is its replacement: hear the word, type its spelling. See
// src/lib/typingDrills.ts for why English needed a spelling drill rather than
// a keyboard-layout one.

const BEST_KEY = "spelling-trainer-best";

function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

const SpellingTab = () => {
  const [stageIndex, setStageIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [typed, setTyped] = useState(0);
  const [errors, setErrors] = useState(0);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [best, setBest] = useState<Record<string, number>>(() => readBest());
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The pending "advance to the next word" timer, so a stage switch or an
   * unmount can cancel it. Without this, finishing a word and immediately
   * switching stages left the 400ms timeout to fire against the NEW stage's
   * freshly-reset state — using the OLD word's typed/error counts, since
   * that's what its closure captured — silently corrupting whichever stage
   * the learner had switched to. Unmounting mid-timeout is the same bug in
   * miniature: a `setState` on a component that's already gone.
   */
  const advanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const drill = useMemo(() => buildDrill(stageIndex), [stageIndex]);
  const item: DrillItem | undefined = drill[itemIndex];
  const score = scoreDrill(typed, errors);

  const reset = useCallback((stage: number) => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setStageIndex(stage);
    setItemIndex(0);
    setInputValue("");
    setTyped(0);
    setErrors(0);
    setDone(false);
  }, []);

  const finish = useCallback((finalTyped: number, finalErrors: number) => {
    setDone(true);
    const accuracy = scoreDrill(finalTyped, finalErrors).accuracy;
    setBest((prev) => {
      const key = String(stageIndex);
      if ((prev[key] ?? 0) >= accuracy) return prev;
      const next = { ...prev, [key]: accuracy };
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the run still works, the best just isn't remembered.
      }
      return next;
    });
  }, [stageIndex]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!item || done) return;
    const value = e.target.value.slice(0, item.target.length);

    // A character was added (not a backspace) — score it against the target.
    // Computed into locals rather than read back from state, which would
    // still hold the previous keystroke's value by the time this runs.
    let nextTyped = typed;
    let nextErrors = errors;
    if (value.length > inputValue.length) {
      const addedChar = value[value.length - 1];
      const expected = item.target[value.length - 1];
      nextTyped = typed + 1;
      if (!keystrokeMatches(addedChar, expected)) {
        nextErrors = errors + 1;
        setFlash(true);
        setTimeout(() => setFlash(false), 250);
      }
      setTyped(nextTyped);
      setErrors(nextErrors);
    }

    setInputValue(value);

    if (value.length === item.target.length) {
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        if (itemIndex + 1 >= drill.length) {
          finish(nextTyped, nextErrors);
        } else {
          setItemIndex((i) => i + 1);
          setInputValue("");
        }
      }, 400);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SPELLING_STAGES.map((stage) => (
          <button
            key={stage.index}
            type="button"
            onClick={() => reset(stage.index)}
            className={
              stage.index === stageIndex
                ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            المرحلة {stage.index + 1} · <span className="font-english" dir="ltr">{stage.title}</span>
            {best[String(stage.index)] !== undefined && (
              <span className="ms-1 text-[10px]">الأفضل {best[String(stage.index)]}%</span>
            )}
          </button>
        ))}
      </div>

      {done ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
          <p className="mt-2 text-lg font-semibold">دقة {score.accuracy}%</p>
          <p className="text-sm text-muted-foreground">
            {score.typed} حرف، {score.errors} أخطاء.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => reset(stageIndex)}>
              <RefreshCw className="me-1 h-3.5 w-3.5" /> إعادة
            </Button>
            {stageIndex + 1 < SPELLING_STAGES.length && (
              <Button size="sm" onClick={() => reset(stageIndex + 1)}>المرحلة الجاية</Button>
            )}
          </div>
        </div>
      ) : item ? (
        <div
          className={`rounded-xl border bg-card p-6 text-center transition-colors ${flash ? "border-red-400" : "border-border"}`}
        >
          <p className="text-xs text-muted-foreground">
            {itemIndex + 1} / {drill.length} · {score.accuracy}%
          </p>
          <div className="mt-3 flex justify-center">
            <SoundAudioButton text={item.display} size="lg" autoplay label="شغّل الكلمة" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.ar}</p>
          <input
            ref={inputRef}
            dir="ltr"
            lang="en"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={inputValue}
            onChange={handleChange}
            aria-label="اكتب الكلمة"
            className="font-english mt-4 w-full max-w-[240px] rounded-lg border-2 border-border bg-background px-4 py-2 text-center text-2xl tracking-wide outline-none focus:border-primary"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">اسمع الكلمة ثم اكتب تهجئتها.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">ما فيه تمرين لهذي المرحلة.</p>
      )}
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

const WritingPractice = () => {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">الكتابة</h1>
            <p className="text-sm text-muted-foreground">
              راسل بإنجليزية طبيعية — وتدرّب على تهجئة أصعب أصواتها في نفس الوقت.
            </p>
          </div>
          <HomeButton />
        </div>

        <Tabs defaultValue="write">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="write">
              <PenLine className="me-1.5 h-4 w-4" /> اكتب
            </TabsTrigger>
            <TabsTrigger value="spelling">
              <Ear className="me-1.5 h-4 w-4" /> التهجئة
            </TabsTrigger>
          </TabsList>
          <TabsContent value="write" className="mt-4">
            <WriteTab />
          </TabsContent>
          <TabsContent value="spelling" className="mt-4">
            <SpellingTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
};

export default WritingPractice;
