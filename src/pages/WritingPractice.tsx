import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArabicKeyboard } from "@/components/writing/ArabicKeyboard";
import {
  buildDrill,
  keystrokeMatches,
  scoreDrill,
  TYPING_STAGES,
  type DrillItem,
} from "@/lib/typingDrills";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { labelForKind } from "@/lib/mistakes";
import { CheckCircle2, Keyboard, Loader2, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Written production (C3) — the fourth skill.
 *
 * Two halves. "Write": reply to an incoming dialect text message and get the
 * reply corrected against the same Rulebook that governs generation, with
 * each mistake explained (and quietly fed into the weak-set loop the rest of
 * the app drills from). "Typing": progressive Arabic keyboard drills in the
 * Alphabet Journey's letter order, so the mechanical skill of producing the
 * script keeps pace with recognising it.
 */

interface WritingPrompt {
  scenario_english: string;
  message_arabic: string;
  message_transliteration: string;
  message_english: string;
}

interface Correction {
  original: string;
  corrected: string;
  kind: string;
  explanation: string;
}

interface WritingReview {
  understandable: boolean;
  verdict: string;
  corrected_arabic: string;
  corrected_transliteration: string;
  corrected_english: string;
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
    if (!error && data?.prompt?.message_arabic) {
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
        promptArabic: prompt?.message_arabic ?? "",
      },
    });
    setBusy(false);
    if (error || !data?.review) {
      const message = (data as { message?: string } | null)?.message;
      toast.error(message ?? "Couldn't review that — try again.");
      return;
    }
    setReview(data.review as WritingReview);
  };

  return (
    <div className="space-y-4">
      {promptLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Getting you something to reply to…
        </div>
      ) : prompt ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{prompt.scenario_english}</p>
          <div className="mt-2 max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/10 px-4 py-3">
            <p dir="rtl" className="font-arabic text-lg leading-relaxed">{prompt.message_arabic}</p>
            {showGloss && (
              <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                <p>{prompt.message_transliteration}</p>
                <p>{prompt.message_english}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setShowGloss((s) => !s)}
          >
            {showGloss ? "Hide translation" : "Show translation"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Couldn't load a prompt. Write anything in Arabic below and get it corrected anyway.
        </div>
      )}

      <div className="space-y-2">
        <Textarea
          dir="rtl"
          lang="ar"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          placeholder="اكتب ردك هنا…"
          className="min-h-28 font-arabic text-lg"
          disabled={busy}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length}/{MAX_CHARS}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadPrompt()} disabled={busy}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> New prompt
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              Get corrections
            </Button>
          </div>
        </div>
      </div>

      {review && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">{review.verdict}</p>

          <div className="rounded-lg bg-emerald-500/10 px-4 py-3">
            <p dir="rtl" className="font-arabic text-lg leading-relaxed">{review.corrected_arabic}</p>
            <p className="mt-1 text-sm text-muted-foreground">{review.corrected_transliteration}</p>
            <p className="text-sm text-muted-foreground">{review.corrected_english}</p>
          </div>

          {review.corrections.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Nothing to fix — that reads naturally.
            </p>
          ) : (
            <ul className="space-y-2">
              {review.corrections.map((c, i) => (
                <li key={i} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div dir="rtl" className="font-arabic">
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
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {review.tips!.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ── Typing tab ───────────────────────────────────────────────────────────────

const BEST_KEY = "typing-trainer-best";

function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

const TypingTab = () => {
  const [stageIndex, setStageIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [errors, setErrors] = useState(0);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [best, setBest] = useState<Record<string, number>>(() => readBest());
  const focusRef = useRef<HTMLDivElement>(null);

  const drill = useMemo(() => buildDrill(stageIndex), [stageIndex]);
  const item: DrillItem | undefined = drill[itemIndex];
  const score = scoreDrill(typed, errors);

  const reset = useCallback((stage: number) => {
    setStageIndex(stage);
    setItemIndex(0);
    setCharIndex(0);
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

  const handleChar = useCallback(
    (char: string) => {
      if (!item || done) return;
      const expected = item.target[charIndex];
      if (!expected) return;
      const nextTyped = typed + 1;
      setTyped(nextTyped);
      if (keystrokeMatches(char, expected)) {
        if (charIndex + 1 >= item.target.length) {
          if (itemIndex + 1 >= drill.length) {
            finish(nextTyped, errors);
          } else {
            setItemIndex((i) => i + 1);
            setCharIndex(0);
          }
        } else {
          setCharIndex((i) => i + 1);
        }
      } else {
        setErrors((e) => e + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 250);
      }
    },
    [item, done, charIndex, typed, itemIndex, drill.length, errors, finish],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key.length === 1) {
      e.preventDefault();
      handleChar(e.key);
    }
  };

  const expectedChar = item?.target[charIndex];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TYPING_STAGES.map((stage) => (
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
            Stage {stage.index + 1} · {stage.title}
            {best[String(stage.index)] !== undefined && (
              <span className="ml-1 text-[10px]">best {best[String(stage.index)]}%</span>
            )}
          </button>
        ))}
      </div>

      {done ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
          <p className="mt-2 text-lg font-semibold">{score.accuracy}% accuracy</p>
          <p className="text-sm text-muted-foreground">
            {score.typed} keystrokes, {score.errors} slips.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => reset(stageIndex)}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Again
            </Button>
            {stageIndex + 1 < TYPING_STAGES.length && (
              <Button size="sm" onClick={() => reset(stageIndex + 1)}>Next stage</Button>
            )}
          </div>
        </div>
      ) : item ? (
        <div
          ref={focusRef}
          tabIndex={0}
          role="application"
          aria-label="typing drill"
          onKeyDown={onKeyDown}
          className={`rounded-xl border bg-card p-6 text-center outline-none transition-colors focus:ring-2 focus:ring-primary/40 ${flash ? "border-red-400" : "border-border"}`}
          onClick={() => focusRef.current?.focus()}
        >
          <p className="text-xs text-muted-foreground">
            {itemIndex + 1} / {drill.length} · {item.kind === "letter" ? "letter" : "word"} · {score.accuracy}%
          </p>
          <p dir="rtl" className="mt-3 font-arabic text-4xl tracking-wide">
            {[...item.target].map((c, i) => (
              <span
                key={i}
                className={
                  i < charIndex
                    ? "text-emerald-600"
                    : i === charIndex
                      ? "text-primary underline decoration-2 underline-offset-8"
                      : "text-muted-foreground/60"
                }
              >
                {c}
              </span>
            ))}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.translit}
            {item.english ? ` — ${item.english}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tap the glowing key, or type on your keyboard.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No drill for this stage.</p>
      )}

      {!done && <ArabicKeyboard highlight={expectedChar} onKey={handleChar} />}
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
            <h1 className="text-2xl font-bold">Writing</h1>
            <p className="text-sm text-muted-foreground">
              Text like a native — and learn the keyboard while you're at it.
            </p>
          </div>
          <HomeButton />
        </div>

        <Tabs defaultValue="write">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="write">
              <PenLine className="mr-1.5 h-4 w-4" /> Write
            </TabsTrigger>
            <TabsTrigger value="typing">
              <Keyboard className="mr-1.5 h-4 w-4" /> Typing
            </TabsTrigger>
          </TabsList>
          <TabsContent value="write" className="mt-4">
            <WriteTab />
          </TabsContent>
          <TabsContent value="typing" className="mt-4">
            <TypingTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
};

export default WritingPractice;
