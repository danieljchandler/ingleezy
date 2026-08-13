import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Brain, RefreshCw, AlertTriangle, X } from "lucide-react";


/**
 * Which deck the leech lives in.
 *
 * "word"/"phrase" are the two decks a learner builds themselves. "curriculum"
 * is the deck the app hands them — the structured material everyone works
 * through — which had no rescue at all until now: a learner failing a
 * curriculum word for the seventh time got no mnemonic, no flag, and no way to
 * reset the count, while their own saved words got all three.
 */
export type LeechKind = "word" | "phrase" | "curriculum";

interface LeechHelperPanelProps {
  /** Which deck the row belongs to — controls the table written to. */
  kind: LeechKind;
  rowId: string;
  /** Arabic text to memorize. */
  arabic: string;
  /** English meaning. */
  english: string;
  transliteration?: string | null;
  dialect: string;
  mnemonic: string | null;
  /** Invalidate which query keys after save. */
  invalidateKeys?: string[][];
}

const TABLE_BY_KIND: Record<LeechKind, "user_vocabulary" | "user_phrases" | "word_reviews"> = {
  word: "user_vocabulary",
  phrase: "user_phrases",
  // The per-user row for a curriculum word. The mnemonic goes here rather than
  // on vocabulary_words because a memory hook is personal, not content —
  // vocabulary_words is shared by every learner.
  curriculum: "word_reviews",
};

/** Only the two word decks carry a second, production-direction lapse counter. */
const HAS_PRODUCTION_LAPSES: Record<LeechKind, boolean> = {
  word: true,
  phrase: false,
  curriculum: true,
};

export function LeechHelperPanel({
  kind,
  rowId,
  arabic,
  english,
  transliteration,
  dialect,
  mnemonic: initialMnemonic,
  invalidateKeys = [],
}: LeechHelperPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mnemonic, setMnemonic] = useState<string | null>(initialMnemonic);
  const [mnLoading, setMnLoading] = useState(false);

  useEffect(() => {
    setMnemonic(initialMnemonic);
  }, [rowId, initialMnemonic]);

  const invalidate = () => {
    invalidateKeys.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: key }),
    );
  };


  const generateMnemonic = async () => {
    setMnLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mnemonic", {
        body: {
          arabic,
          english,
          transliteration,
          dialect,
          // The function interpolates this straight into its prompt ("Arabic
          // ${kind}s they keep forgetting"), so it takes the noun, not the deck
          // name — a curriculum card is still a word.
          kind: kind === "phrase" ? "phrase" : "word",
        },
      });
      if (error) throw new Error(error.message || "Failed");
      const text = (data as { mnemonic?: string })?.mnemonic;
      if (!text) throw new Error("Empty mnemonic");
      setMnemonic(text);
      await (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update({ mnemonic: text })
        .eq("id", rowId);
      invalidate();
      toast.success("Mnemonic ready!");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("429")) toast.error("Rate limited — try again shortly");
      else if (msg.includes("402")) toast.error("AI credits exhausted");
      else toast.error("Failed to generate mnemonic");
    } finally {
      setMnLoading(false);
    }
  };


  const dismissLeech = async () => {
    try {
      await (supabase.from(TABLE_BY_KIND[kind]) as any)
        .update({
          is_leech: false,
          lapses: 0,
          ...(HAS_PRODUCTION_LAPSES[kind] ? { production_lapses: 0 } : {}),
        })
        .eq("id", rowId);
      invalidate();
      toast.success("Cleared — we'll stop flagging this card.");
    } catch {
      toast.error("Couldn't clear leech status");
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 p-4 text-left">
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">
            Stuck on this one?
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            You've missed it a few times. Let AI help you lock it in.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={dismissLeech}
          title="Not stuck — clear leech flag"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mnemonic */}
      {mnemonic ? (
        <div className="mb-3 rounded-lg bg-card border border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
              <Brain className="h-3 w-3" /> Mnemonic
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={generateMnemonic}
              disabled={mnLoading}
              title="Regenerate mnemonic"
            >
              {mnLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{mnemonic}</p>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full mb-2 gap-1.5"
          onClick={generateMnemonic}
          disabled={mnLoading}
        >
          {mnLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {mnLoading ? "Crafting mnemonic..." : "Generate AI mnemonic"}
        </Button>
      )}
    </div>
  );
}

