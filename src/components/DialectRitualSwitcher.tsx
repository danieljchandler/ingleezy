import { useEffect, useRef, useState, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { useDialect, DialectModule } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";
import dallahAsset from "@/assets/dallah-icon.png.asset.json";

type Meta = {
  id: DialectModule;
  arabic: string;
  english: string;
  flag: string;
  tag: string;          // short cultural tag (English)
  tagArabic: string;    // poetic Arabic phrase
  vibe: string;         // one-line cultural sketch
  /** HSL string used purely for the ritual wash + card accent */
  hsl: string;
};

const DIALECTS: Meta[] = [
  {
    id: "Gulf",
    arabic: "خليجي",
    english: "Gulf Arabic",
    flag: "🗺️",
    tag: "Majlis · Pearls · Coastal trade",
    tagArabic: "مرحبا بالمعازيب",
    vibe: "The unhurried cadence of the majlis — coffee, oud, the Gulf wind.",
    hsl: "12 68% 32%",
  },
  {
    id: "Egyptian",
    arabic: "مصري",
    english: "Egyptian Arabic",
    flag: "🇪🇬",
    tag: "Cairo streets · Cinema · Wit",
    tagArabic: "أهلاً يا باشا",
    vibe: "Quick, warm, theatrical — the lingua franca of Arab cinema.",
    hsl: "38 85% 45%",
  },
  {
    id: "Yemeni",
    arabic: "يمني",
    english: "Yemeni Arabic",
    flag: "🇾🇪",
    tag: "Highlands · Honey · Ancient poetry",
    tagArabic: "حياك الله",
    vibe: "Mountain Arabic — old vowels, deep hospitality, slow verse.",
    hsl: "0 70% 42%",
  },
];

interface Props {
  className?: string;
}

export const DialectRitualSwitcher = ({ className }: Props) => {
  const { activeDialect, setDialect } = useDialect();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [flippingId, setFlippingId] = useState<DialectModule | null>(null);
  const [washHsl, setWashHsl] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const current = DIALECTS.find((d) => d.id === activeDialect) ?? DIALECTS[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while overlay open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handlePick = (meta: Meta) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (meta.id === activeDialect) {
      setOpen(false);
      return;
    }
    setFlippingId(meta.id);
    setWashHsl(meta.hsl);
    setDialect(meta.id);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setFlippingId(null);
      setWashHsl(null);
      closeTimerRef.current = null;
    }, 260);
  };

  const overlay = open && mounted
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Choose dialect"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close dialect picker"
            onClick={() => !flippingId && setOpen(false)}
            className="absolute inset-0 z-0 bg-background/80 backdrop-blur-md animate-fade-up"
          />

          {/* Color wash for the transition moment */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-0 transition-opacity duration-[400ms] ease-out",
              washHsl ? "opacity-60" : "opacity-0"
            )}
            style={{
              background: washHsl
                ? `radial-gradient(circle at 50% 50%, hsl(${washHsl} / 0.6), hsl(${washHsl} / 0) 70%)`
                : undefined,
            }}
          />

          {/* Card stack */}
          <div className="relative z-10 w-full max-w-md animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                  Hakiya · حكية
                </span>
                <h2 className="text-t-title font-bold text-foreground">
                  Choose your dialect
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !flippingId && setOpen(false)}
                className="p-2 rounded-full hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-3">
              {DIALECTS.map((d) => {
                const isActive = d.id === activeDialect;
                const isFlipping = flippingId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handlePick(d)}
                    disabled={!!flippingId}
                    className={cn(
                      "w-full text-left rounded-2xl border-2 p-4",
                      "transition-all duration-300",
                      "[transform-style:preserve-3d]",
                      "disabled:cursor-default",
                      isActive
                        ? "border-current shadow-md"
                        : "border-border bg-card hover:shadow-md hover:-translate-y-0.5",
                      isFlipping && "[transform:rotateY(180deg)]"
                    )}
                    style={{
                      color: isActive ? `hsl(${d.hsl})` : undefined,
                      backgroundColor: isActive
                        ? `hsl(${d.hsl} / 0.08)`
                        : undefined,
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="flex items-center justify-center w-14 h-14 rounded-xl text-2xl shrink-0"
                        style={{
                          backgroundColor: `hsl(${d.hsl} / 0.12)`,
                          color: `hsl(${d.hsl})`,
                        }}
                        aria-hidden
                      >
                        {d.id === "Gulf" ? (
                          <img src={dallahAsset.url} alt="" className="w-8 h-8 object-contain" />
                        ) : (
                          d.flag
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span
                            className="font-arabic text-2xl font-bold leading-none"
                            dir="rtl"
                            style={{ color: `hsl(${d.hsl})` }}
                          >
                            {d.arabic}
                          </span>
                          <span
                            className="font-arabic text-sm text-muted-foreground"
                            dir="rtl"
                          >
                            {d.tagArabic}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {d.english}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                          {d.tag}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                          {d.vibe}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Switching dialect re-tunes prompts, audio voices, and your review queue.
            </p>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {/* Chip */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Active dialect: ${current.english}. Tap to change.`}
        className={cn(
          "group w-full flex items-center justify-between gap-3",
          "px-4 py-3 rounded-2xl",
          "bg-card border-2 border-border",
          "shadow-sm hover:shadow-md hover:border-primary/40",
          "transition-all duration-200 active:scale-[0.99]",
          className
        )}
        style={{
          // Tint the left edge with the active dialect color as a subtle stamp
          backgroundImage: `linear-gradient(90deg, hsl(${current.hsl} / 0.10) 0%, transparent 35%)`,
        }}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span
            className="flex items-center justify-center w-9 h-9 rounded-xl text-lg shrink-0"
            style={{
              backgroundColor: `hsl(${current.hsl} / 0.15)`,
              color: `hsl(${current.hsl})`,
            }}
            aria-hidden
          >
            {current.id === "Gulf" ? (
              <img src={dallahAsset.url} alt="" className="w-5 h-5 object-contain" />
            ) : (
              current.flag
            )}
          </span>
          <span className="flex flex-col items-start min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Active dialect
            </span>
            <span className="flex items-baseline gap-2 min-w-0">
              <span
                className="font-arabic text-lg font-bold leading-none truncate"
                dir="rtl"
                style={{ color: `hsl(${current.hsl})` }}
              >
                {current.arabic}
              </span>
              <span className="text-sm font-medium text-foreground truncate">
                {current.english}
              </span>
            </span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </button>

      {/* Ritual overlay */}
      {overlay}
    </>
  );
};

export default DialectRitualSwitcher;
