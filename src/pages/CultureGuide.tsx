import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  Loader2,
  LogIn,
  UserCheck,
  Bot,
  User as UserIcon,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

type Msg = { role: "user" | "assistant"; content: string };

const GULF_SUGGESTIONS = [
  "My colleague invited me to their home for dinner in Saudi. What should I bring?",
  "زميلي عزمني على قهوة، شلون أرد؟",
  "How do I politely decline an invitation in the Gulf?",
  "What's the etiquette for meeting someone's parents for the first time?",
  "كيف أتصرف في مجلس رجال؟",
];

const EGYPTIAN_SUGGESTIONS = [
  "My colleague invited me to their home for dinner in Cairo. What should I bring?",
  "زميلي عزمني على قهوة، أرد إزاي؟",
  "How do I politely decline an invitation in Egypt?",
  "What's the etiquette for meeting someone's parents for the first time in Egypt?",
  "إزاي أتصرف في عزومة عند ناس أول مرة؟",
];

const YEMENI_SUGGESTIONS = [
  "My colleague invited me for qat in Sana'a. What should I know?",
  "زميلي عزمني على قات، كيف أتصرف؟",
  "How do I politely greet elders in Yemen?",
  "What's the etiquette for visiting someone's مفرج for the first time?",
  "كيف أتصرف في جلسة قات أول مرة؟",
];

const MAX_HUMAN_REVIEWS_PER_MONTH = 5;

const CultureGuide = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Count human review requests this month
  const { data: reviewCount = 0, refetch: refetchCount } = useQuery({
    queryKey: ["human-review-count", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("human_review_requests")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", startOfMonth.toISOString());
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!user,
  });

  const canRequestHumanReview = reviewCount < MAX_HUMAN_REVIEWS_PER_MONTH;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const streamChat = useCallback(
    async (allMessages: Msg[]) => {
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let assistantSoFar = "";

      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/culture-guide`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ messages: allMessages, dialect: activeDialect }),
            signal: controller.signal,
          }
        );

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Error ${resp.status}`);
        }

        if (!resp.body) throw new Error("No stream body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        const upsert = (chunk: string) => {
          assistantSoFar += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
              );
            }
            return [...prev, { role: "assistant", content: assistantSoFar }];
          });
        };

        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              streamDone = true;
              break;
            }
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) upsert(content);
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Something went wrong";
        toast.error(msg);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    []
  );

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isStreaming) return;
    if (content.length > 2000) {
      toast.error("Message too long (max 2000 characters)");
      return;
    }

    const userMsg: Msg = { role: "user", content };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    await streamChat(updated);
  };

  const handleHumanReview = async () => {
    if (!user || !canRequestHumanReview) return;
    if (messages.length < 2) {
      toast.error("Have a conversation first, then request a review");
      return;
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

    const { error } = await supabase.from("human_review_requests").insert({
      user_id: user.id,
      conversation_context: conversationText.slice(0, 5000),
      ai_response: lastAssistant?.content?.slice(0, 3000) ?? "",
    });

    if (error) {
      toast.error("Failed to submit review request");
    } else {
      toast.success("Review requested! An expert will look into this.");
      refetchCount();
    }
  };

  if (authLoading) {
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
        <div className="mb-6">
          <HomeButton />
        </div>
        <div className="text-center max-w-sm mx-auto py-12">
          <LogIn className="h-7 w-7 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-xl font-bold text-foreground mb-3">Login Required</h1>
          <p className="text-muted-foreground mb-8">
            Sign in to get culturally-aware advice for {activeDialect === 'Egyptian' ? 'Egyptian' : activeDialect === 'Yemeni' ? 'Yemeni' : 'Gulf'} situations.
          </p>
          <Button onClick={() => navigate("/auth")}>
            <LogIn className="h-4 w-4 mr-2" />
            Login
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        {canRequestHumanReview && messages.length >= 2 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleHumanReview}
            className="gap-1.5 text-xs"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Ask a human ({MAX_HUMAN_REVIEWS_PER_MONTH - reviewCount} left)
          </Button>
        )}
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">
          What should I do? <InfoHint {...PAGE_HINTS["culture-guide"]} />
        </h1>
        <p className="text-sm text-muted-foreground">
          Describe a situation — get culturally appropriate {activeDialect === 'Egyptian' ? 'Egyptian' : activeDialect === 'Yemeni' ? 'Yemeni' : 'Gulf'} Arabic advice
        </p>
      </div>

      {/* Chat area */}
      <div className="flex-1 space-y-4 mb-4 min-h-[200px] max-h-[60vh] overflow-y-auto">
        {messages.length === 0 && (
          <div className="space-y-2 pt-4">
            <p className="text-xs text-muted-foreground font-medium mb-3">
              Try asking about…
            </p>
            {(activeDialect === 'Egyptian' ? EGYPTIAN_SUGGESTIONS : activeDialect === 'Yemeni' ? YEMENI_SUGGESTIONS : GULF_SUGGESTIONS).map((s, i) => (
              <button
                key={i}
                onClick={() => handleSend(s)}
                className="w-full text-left p-3 rounded-xl bg-card border border-border text-sm text-foreground hover:border-primary/40 transition-colors"
                dir="auto"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2.5",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-card border border-border text-foreground rounded-bl-md"
              )}
              dir="auto"
            >
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                <UserIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {!canRequestHumanReview && messages.length >= 2 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            You've used all {MAX_HUMAN_REVIEWS_PER_MONTH} human review requests this month
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-background pt-2 pb-1">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your situation…"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            disabled={isStreaming}
            maxLength={2000}
            dir="auto"
          />
          <Button
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
};

export default CultureGuide;
