import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import borderFullPageImg from "@/assets/border-full-page.webp";
import { BottomNav, shouldShowBottomNav } from "@/components/layout/BottomNav";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
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
  const showNav = shouldShowBottomNav(pathname);
  // The Ask AI panel is non-modal, so the page has to make room for it rather
  // than sit underneath it.
  const { isOpen: aiOpen } = useAiAssistant();

  return (
    <div
      className={cn(
        "min-h-[100dvh] relative bg-white",
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
      {/* Background image layer with reduced opacity */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `url(${borderFullPageImg})`,
          backgroundSize: "cover",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          opacity: 0.95,
          pointerEvents: "none",
        }}
      />
      <div className={cn(
        "relative mx-auto w-full max-w-2xl animate-fade-up",
        compact ? "px-4 py-5 sm:px-5 sm:py-6" : "px-4 pt-4 pb-8 sm:px-6 md:pt-6 md:pb-12",
        showNav && "pb-24",
        // Let the page scroll clear of the bottom sheet, or its lower half is
        // unreachable while the panel is open.
        aiOpen && "max-sm:pb-[60dvh]",
      )}>
        {children}
      </div>
      <BottomNav />
      <OnboardingTour />
      <FeedbackWidget />
      <AskAiFab />
    </div>
  );
}

