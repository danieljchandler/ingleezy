import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/uiPrefs";
import { vibrate } from "@/lib/tapFeedback";

interface PopItem {
  id: number;
  amount: number;
}

let counter = 0;
const listeners = new Set<(p: PopItem) => void>();

/** Fire a floating "+N XP" pill from anywhere in the alphabet flow. */
export function fireXPPopup(amount = 5) {
  const item: PopItem = { id: ++counter, amount };
  listeners.forEach((l) => l(item));
}

/**
 * Mount once near the top of a page. Listens for fireXPPopup() calls and
 * renders a floating, fading "+N XP" pill. Skipped when reduced motion is on.
 */
export const XPPopupHost = () => {
  const [items, setItems] = useState<PopItem[]>([]);

  useEffect(() => {
    const handler = (p: PopItem) => {
      if (prefersReducedMotion()) return;
      vibrate([8, 30, 8]);
      setItems((prev) => [...prev, p]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== p.id));
      }, 900);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex flex-col items-center gap-1">
      {items.map((i) => (
        <span
          key={i.id}
          className="animate-xp-float rounded-full bg-[#4A7A40] text-white text-sm font-bold px-3 py-1 shadow-lg"
        >
          +{i.amount} XP
        </span>
      ))}
    </div>
  );
};
