import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bookmark, Flag, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { buildPagePayload } from "@/lib/pageAiContext";
import { supabase } from "@/integrations/supabase/client";
import { streamChat, SseChatError } from "@/lib/sseChat";
import { showCapToast } from "@/lib/handleCapResponse";
import { TinyMarkdown } from "@/components/shared/TinyMarkdown";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { SavePhraseDialog } from "./SavePhraseDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** First run of Arabic script in a reply — the pre-fill for "save phrase". */
function firstArabicRun(text: string): string | null {
  const match = text.match(/[؀-ۿ][؀-ۿ\s،؟ـ]*/);
  const run = match?.[0]?.trim();
  return run && run.length > 1 ? run : null;
}

const SUGGESTED_SEEDED = [
  "Why is it translated like this?",
  "Explain the grammar",
  "Tell me more",
  "Give me alternatives",
];

const SUGGESTED_PAGE = [
  "What am I looking at?",
  "Explain this in simple terms",
  "Quiz me on this",
  "What should I learn next?",
];

interface ChatTabProps {
  /** Fired when the composer takes focus, so a peeking sheet can expand first. */
  onComposerFocus?: () => void;
}

export function ChatTab({ onComposerFocus }: ChatTabProps = {}) {
  const { seed, messages, setMessages, pageContext } = useAiAssistant();
  const { activeDialect } = useDialect();
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phraseToSave, setPhraseToSave] = useState<string | null>(null);
  // Message indexes already reported this session — one flag per reply.
  const [reported, setReported] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A learner's flag goes to the native-review queue, not straight into
  // training data — natives decide what was actually wrong.
  const reportMessage = useCallback(async (index: number, content: string) => {
    setReported((prev) => new Set(prev).add(index));
    const { error } = await supabase.functions.invoke("report-content", {
      body: { kind: "assistant_message", dialect: activeDialect, text: content },
    });
    if (error) {
      setReported((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      toast.error("Couldn't send the report — try again in a moment.");
      return;
    }
    toast.success("Thanks — a native speaker will take a look.");
  }, [activeDialect]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(nextMessages);
      setInput("");
      setLoading(true);

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        await streamChat({
          functionName: "assistant-chat",
          signal: ctrl.signal,
          body: {
            dialect: activeDialect,
            messages: nextMessages,
            seed: seed ?? undefined,
            pageContext: buildPagePayload(pathname, pageContext),
          },
          onDelta: (_delta, accumulated) => {
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: accumulated };
              return copy;
            });
          },
        });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          if (err instanceof SseChatError) {
            if (err.status === 429) {
              showCapToast((err.body as Parameters<typeof showCapToast>[0]) ?? {});
            } else if (err.status === 402) {
              toast.error("AI credits exhausted");
            } else if (err.status === 401) {
              toast.error("Please sign in to chat");
            } else {
              toast.error("Couldn't reach the assistant");
            }
          } else {
            console.error(err);
            toast.error("Something went wrong");
          }
          // Drop the empty assistant placeholder, keep the user's message.
          setMessages((prev) =>
            prev.length && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content
              ? prev.slice(0, -1)
              : prev,
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [messages, setMessages, loading, activeDialect, seed, pathname, pageContext],
  );

  if (!user && !authLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to ask the AI tutor about anything you see in the app.
        </p>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  const suggestions = seed ? SUGGESTED_SEEDED : SUGGESTED_PAGE;

  return (
    <>
      {/* min-h-0 so this can actually shrink inside the sheet's bounded column. */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {seed
                ? "Ask anything — translation choices, grammar, vocabulary, culture…"
                : "Ask about what's on this page, or anything about Arabic."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const savable = m.role === "assistant" && !loading ? firstArabicRun(m.content) : null;
          return (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary/10 ml-6"
                  : "bg-muted/50 mr-6 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
              )}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <>
                    <TinyMarkdown
                      source={m.content}
                      renderArabicRun={(text) => (
                        <TappableArabicText
                          text={text}
                          source="ask-ai"
                          className="inline"
                          sentenceContext={seed ? { arabic: seed.arabic, english: seed.english } : undefined}
                        />
                      )}
                    />
                    {!loading && (
                      <div className="mt-1.5 flex items-center gap-3">
                        {savable && (
                          <button
                            type="button"
                            onClick={() => setPhraseToSave(savable)}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                          >
                            <Bookmark className="h-3 w-3" />
                            Save phrase
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={reported.has(i)}
                          onClick={() => reportMessage(i, m.content)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60 disabled:hover:text-muted-foreground"
                        >
                          <Flag className="h-3 w-3" />
                          {reported.has(i) ? "Reported" : "Report"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          );
        })}
      </div>

      <SavePhraseDialog
        open={phraseToSave !== null}
        onOpenChange={(open) => !open && setPhraseToSave(null)}
        initialArabic={phraseToSave ?? ""}
      />

      <div className="flex shrink-0 gap-2 border-t p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={onComposerFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask a question…"
          rows={1}
          className="resize-none min-h-[40px] text-sm"
          disabled={loading}
        />
        <Button
          size="icon"
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
