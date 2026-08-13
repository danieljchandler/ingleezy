import { Sparkles, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { cn } from "@/lib/utils";

interface AskAISentenceProps {
  arabic: string;
  english?: string;
  /** Visual variant for the trigger button */
  variant?: "icon" | "chip";
  className?: string;
}

/**
 * The "Ask AI" affordance attached to sentences across the app. It used to
 * carry its own per-sentence chat dialog; now it opens the global assistant
 * panel seeded with the sentence, so the same conversation offers text or
 * live voice and knows the page the sentence came from.
 */
export const AskAISentence = ({
  arabic,
  english,
  variant = "icon",
  className,
}: AskAISentenceProps) => {
  const { openChat } = useAiAssistant();
  const open = () => openChat({ arabic, english });

  if (variant === "chip") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={open}
        className={cn(
          "h-7 gap-1 rounded-full border-primary/40 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary",
          className,
        )}
      >
        <Sparkles className="h-3 w-3" />
        Ask AI
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Ask AI about this sentence"
      onClick={open}
      className={cn("h-7 w-7 text-muted-foreground hover:text-primary", className)}
    >
      <MessageCircleQuestion className="h-4 w-4" />
    </Button>
  );
};
