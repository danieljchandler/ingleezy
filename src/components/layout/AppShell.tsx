import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AppDock, shouldShowDock } from "@/components/shell/AppDock";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";
import { AskAiFab } from "@/components/assistant/AskAiFab";
import { useAiAssistant } from "@/contexts/AiAssistantContext";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Use compact padding for learning/review screens */
  compact?: boolean;
}

/**
 * AppShell - Consistent layout wrapper for all pages
 *
 * Provides unified spacing with full-page Sadu border background.
 * Use compact mode for immersive learning screens.
 */
export function AppShell({ children, className, compact = false }: AppShellProps) {
  const { pathname } = useLocation();
  const showNav = shouldShowDock(pathname);
  // The Ask AI panel is non-modal, so the page has to make room for it rather
  // than sit underneath it.
  const { isOpen: aiOpen } = useAiAssistant();

  return (
    <div
      className={cn(
        "min-h-[100dvh] relative bg-background",
        "transition-[padding] duration-300 ease-lahja motion-reduce:transition-none",
        // Only from lg: below that there isn't room to inset without squeezing
        // the text column, so the rail simply overlaps (still readable — no scrim).
        aiOpen && "lg:pe-[28rem]",
        className,
      )}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Sadu watermark, recolored into the brand's periwinkle — the cultural
          motif at a whisper, on the cool ground, in place of Hakiya's warm
          kilim photograph. */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none opacity-[0.5] dark:opacity-[0.25]"
        style={{
          backgroundImage: "url(/assets/sadu-watermark.svg)",
          backgroundSize: "44px 44px",
          backgroundRepeat: "repeat",
        }}
      />
      <div className={cn(
        "relative mx-auto w-full max-w-2xl animate-fade-up",
        compact ? "px-4 py-5 sm:px-5 sm:py-6" : "px-4 pt-4 pb-8 sm:px-6 md:pt-6 md:pb-12",
        // Clearance for the dock, at every width. The md: variant above is a
        // separate group as far as tailwind-merge is concerned, so a bare
        // pb-24 loses to md:pb-12 from 768px up — which left 48px of room
        // under a bar that is taller than that, and put whatever sat at the
        // bottom of a page underneath it. The old five-tab bar happened to be
        // 47px and cleared it by one pixel, so nothing showed until the bar
        // was replaced.
        showNav && "pb-24 md:pb-24",
        // Let the page scroll clear of the bottom sheet, or its lower half is
        // unreachable while the panel is open.
        aiOpen && "max-sm:pb-[60dvh]",
      )}>
        {children}
      </div>
      <AppDock />
      <FeedbackWidget />
      <AskAiFab />
    </div>
  );
}

