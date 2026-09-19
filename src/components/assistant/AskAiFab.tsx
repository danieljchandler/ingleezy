import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { shouldShowDock } from "@/components/shell/AppDock";
import { cn } from "@/lib/utils";

/**
 * Floating "Ask AI" button, mounted in AppShell next to the feedback FAB.
 * Stacks above it (the feedback widget owns bottom-20 / md:bottom-6).
 *
 * On a session screen it sits higher. Those routes hide the dock — the app
 * already treats them as immersive — and SessionFrame puts a full-width
 * primary action at the bottom of them, which bottom-20 lands directly on
 * top of. Hiding the button there instead would take Ask AI away from
 * curriculum review, which has no other way in (MyWordsReview does: an
 * AskAISentence inside the card).
 * Cmd/Ctrl+K opens the assistant from anywhere (Cmd+/ belongs to feedback).
 * Must do no fetching on mount — the route sweep renders every page.
 */
export function AskAiFab({ className }: { className?: string }) {
  const { openChat, isOpen, close } = useAiAssistant();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) close();
        else openChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, openChat, close]);

  const hidden = useMemo(
    () =>
      pathname.startsWith("/auth") ||
      pathname.startsWith("/onboarding") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/reset-password"),
    [pathname],
  );

  if (hidden) return null;

  // Where the dock is hidden, a SessionFrame owns the bottom of the screen.
  const ownsItsBottom = !shouldShowDock(pathname);

  return (
    <button
      type="button"
      aria-label="اسأل الذكاء"
      data-feedback-ignore="true"
      onClick={() => openChat()}
      className={cn(
        "fixed right-3 z-40 flex items-center gap-1.5 rounded-full",
        "bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
        "md:right-6",
        ownsItsBottom ? "bottom-36 md:bottom-24" : "bottom-20 md:bottom-6",
        "h-10 pe-3 ps-2.5",
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0" />
      <span className="text-[13px] font-semibold leading-none tracking-tight">اسأل الذكاء</span>
    </button>
  );
}
