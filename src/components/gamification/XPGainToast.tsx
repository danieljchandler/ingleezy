import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface XPGainToastProps {
  amount: number;
  onComplete?: () => void;
}

export function XPGainToast({ amount, onComplete }: XPGainToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, 3500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed top-20 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 px-4 py-2 rounded-full",
        "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground",
        "shadow-lg shadow-primary/30",
        "animate-in fade-in slide-in-from-top-4 duration-300"
      )}
    >
      <Sparkles className="h-4 w-4" />
      <span className="font-bold">+{amount} XP</span>
    </div>
  );
}
