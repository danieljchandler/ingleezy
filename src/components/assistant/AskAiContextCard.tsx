import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Clapperboard,
  Dumbbell,
  FileText,
  Languages,
  LayoutGrid,
  Quote,
  Sparkles,
  X,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AssistantSeed } from "@/contexts/AiAssistantContext";
import type { PageAiContext, PageAiPayload } from "@/lib/pageAiContext";
import { cn } from "@/lib/utils";

/**
 * Shows the learner what the assistant is looking at, so the panel never asks
 * about a page they can't see. Collapsed it still carries the material itself
 * (the subtitle, the sentence, the word) rather than a page title; expanded it
 * adds the translation and the surrounding page content.
 *
 * The body updates live — pages republish their context as the video advances
 * or the scene changes — so at the peek height this mirrors what's on screen
 * above the sheet.
 */

type ContextKind = PageAiContext["kind"] | "sentence";

const KIND_META: Record<ContextKind, { icon: typeof Quote; label: string }> = {
  sentence: { icon: Quote, label: "Sentence" },
  video: { icon: Clapperboard, label: "In this video" },
  story: { icon: BookOpen, label: "In this story" },
  passage: { icon: FileText, label: "In this passage" },
  drill: { icon: Dumbbell, label: "In this drill" },
  word: { icon: Languages, label: "This word" },
  phrase: { icon: Sparkles, label: "This phrase" },
  page: { icon: LayoutGrid, label: "On this page" },
};

interface AskAiContextCardProps {
  seed: AssistantSeed | null;
  payload: PageAiPayload;
  /** The registered page kind, if any — `payload` deliberately doesn't carry it. */
  pageKind?: PageAiContext["kind"];
  onClearSeed: () => void;
}

export function AskAiContextCard({ seed, payload, pageKind, onClearSeed }: AskAiContextCardProps) {
  // Open by default whenever there's real material to show; a bare page title
  // isn't worth the vertical space at the peek height.
  const hasDetail = !!seed || !!payload.content;
  const [open, setOpen] = useState(hasDetail);

  const kind: ContextKind = seed ? "sentence" : (pageKind ?? "page");
  const { icon: Icon, label } = KIND_META[kind];

  const preview = seed?.arabic ?? payload.content ?? payload.title;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary/80">
            {label}
          </span>
          {/* Expanded, the body already shows this in full — repeating a
              truncated copy in the header just reads as a duplicate. */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs text-foreground/80",
              seed && "text-right font-arabic",
            )}
            dir={seed ? "rtl" : "auto"}
            title={preview}
          >
            {open ? "" : preview}
          </span>
          {seed && (
            <button
              type="button"
              aria-label="Clear sentence context"
              onClick={onClearSeed}
              className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {hasDetail && (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={open ? "Hide context" : "Show context"}
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
                />
              </button>
            </CollapsibleTrigger>
          )}
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="mt-1.5 space-y-1 border-t border-primary/15 pt-1.5">
            {seed && (
              <>
                <p className="font-arabic text-[15px] leading-relaxed text-foreground" dir="rtl">
                  {seed.arabic}
                </p>
                {seed.english && <p className="text-xs text-muted-foreground">{seed.english}</p>}
              </>
            )}
            {payload.content && (
              <p
                dir="auto"
                // Capped: a reading passage publishes up to 1500 chars of content.
                className="max-h-24 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-muted-foreground"
              >
                {payload.content}
              </p>
            )}
            {!seed && !payload.content && payload.summary && (
              <p className="text-xs text-muted-foreground">{payload.summary}</p>
            )}
            <p className="truncate text-[10px] text-muted-foreground/70">{payload.title}</p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
