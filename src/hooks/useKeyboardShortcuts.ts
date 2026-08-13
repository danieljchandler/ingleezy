import { useEffect } from "react";
import type { Rating } from "@/lib/spacedRepetition";

interface UseReviewKeyboardOptions {
  /** Whether the answer is currently visible. */
  showAnswer: boolean;
  /** Flip card to show answer. */
  onFlip: () => void;
  /** Submit a rating. */
  onRate: (rating: Rating) => void;
  /** Whether the keyboard shortcuts should be active. */
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for the flashcard review screen.
 *
 * When answer is hidden:
 *   - Space / Enter: flip card (show answer)
 *
 * When answer is shown:
 *   - 1 / a: Again
 *   - 2 / h: Hard
 *   - 3 / g: Good
 *   - 4 / e: Easy
 */
export function useReviewKeyboard({
  showAnswer,
  onFlip,
  onRate,
  enabled = true,
}: UseReviewKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (!showAnswer) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onFlip();
        }
      } else {
        switch (e.key) {
          case "1":
          case "a":
            e.preventDefault();
            onRate("again");
            break;
          case "2":
          case "h":
            e.preventDefault();
            onRate("hard");
            break;
          case "3":
          case "g":
            e.preventDefault();
            onRate("good");
            break;
          case "4":
          case "e":
            e.preventDefault();
            onRate("easy");
            break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAnswer, onFlip, onRate, enabled]);
}
