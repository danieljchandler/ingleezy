import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useWeeklyGoal } from "@/hooks/useGamification";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * A — Majlis welcome panel
 * Layered hero: Sadu watermark, time-of-day Arabic greeting, dialect chip,
 * streak flame, and weekly XP ring composed in one card.
 */

const DIALECT_GLYPH: Record<string, string> = {
  Gulf: "🌊",
  Egyptian: "🇪🇬",
  Yemeni: "🇾🇪",
};

// One chip style for every dialect — the brand is a restrained indigo system,
// not a rainbow, and the flag glyph already says which dialect this is.
const DIALECT_ACCENT: Record<string, string> = {
  Gulf: "from-[#7184C6]/20 to-[#3A508E]/5 border-[#3A508E]/30 text-[#2C3B74] dark:text-periwinkle",
  Egyptian: "from-[#7184C6]/20 to-[#3A508E]/5 border-[#3A508E]/30 text-[#2C3B74] dark:text-periwinkle",
  Yemeni: "from-[#7184C6]/20 to-[#3A508E]/5 border-[#3A508E]/30 text-[#2C3B74] dark:text-periwinkle",
};

function greetingFor(hour: number): { ar: string; en: string } {
  if (hour < 5) return { ar: "تصبح على خير", en: "Late night" };
  if (hour < 12) return { ar: "صَبَاحُ الخَيْر", en: "Good morning" };
  if (hour < 17) return { ar: "نَهَارَك سَعِيد", en: "Good afternoon" };
  if (hour < 22) return { ar: "مَسَاءُ الخَيْر", en: "Good evening" };
  return { ar: "تصبح على خير", en: "Good night" };
}

export function MajlisWelcome() {
  const { user, isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { data: weekly } = useWeeklyGoal();

  const { data: streak } = useQuery({
    queryKey: ["review-streak", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("review_streaks")
        .select("current_streak")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile-name", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const greeting = greetingFor(new Date().getHours());
  const name = profile?.display_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "";

  const earned = weekly?.earned_xp ?? 0;
  const target = Math.max(weekly?.target_xp ?? 100, 1);
  const pct = Math.min(100, Math.round((earned / target) * 100));

  // Ring math
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  const dialectAccent = DIALECT_ACCENT[activeDialect] ?? DIALECT_ACCENT.Gulf;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl mb-4",
        "bg-[#F7F8FC] border border-[#2C3B74]/20 dark:bg-card dark:border-border",
        "px-4 py-4 sm:px-5 sm:py-5",
        "shadow-[0_1px_0_0_rgba(27,37,52,0.04),0_8px_24px_-12px_rgba(27,37,52,0.18)]"
      )}
    >
      {/* Sadu pattern watermark */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.55] pointer-events-none"
        style={{
          backgroundImage: "url(/assets/sadu-watermark.svg)",
          backgroundSize: "44px 44px",
          backgroundRepeat: "repeat",
        }}
      />
      {/* Warm radial highlight */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-[#7184C6]/15 blur-3xl pointer-events-none"
      />

      <div className="relative flex items-start gap-4">
        {/* Left: greeting */}
        <div className="flex-1 min-w-0">
          <p
            className="text-2xl sm:text-3xl leading-tight text-[#2C3B74] dark:text-periwinkle font-arabic"
            dir="rtl"
          >
            {greeting.ar}
          </p>
          <p
            className="mt-1 text-sm text-[#2C3B74]/70 dark:text-muted-foreground"
          >
            {greeting.en}
            {isAuthenticated && name ? `, ${name}` : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Dialect chip */}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
                "text-[11px] font-semibold border bg-gradient-to-r",
                dialectAccent
              )}
            >
              <span className="text-xs leading-none">{DIALECT_GLYPH[activeDialect] ?? "🗣️"}</span>
              {activeDialect}
            </span>

            {/* Streak flame */}
            {isAuthenticated && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
                  "text-[11px] font-semibold border",
                  (streak?.current_streak ?? 0) > 0
                    ? "bg-gradient-to-r from-[#D98A3D]/20 to-[#D98A3D]/5 border-[#D98A3D]/40 text-[#8F5A24] dark:text-accent"
                    : "bg-[#2C3B74]/5 border-[#2C3B74]/15 text-[#2C3B74]/60 dark:bg-white/5 dark:border-white/10 dark:text-muted-foreground"
                )}
                title={`${streak?.current_streak ?? 0}-day streak`}
              >
                <Flame
                  className={cn(
                    "h-3 w-3",
                    (streak?.current_streak ?? 0) > 0 ? "text-accent" : "text-[#2C3B74]/40 dark:text-muted-foreground/60"
                  )}
                />
                {streak?.current_streak ?? 0}d
              </span>
            )}
          </div>
        </div>

        {/* Right: XP ring */}
        {isAuthenticated && (
          <div className="shrink-0 relative w-[64px] h-[64px]" title={`${earned} / ${target} XP this week`}>
            <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
              <circle
                cx="32"
                cy="32"
                r={R}
                stroke="#2C3B74"
                strokeOpacity={0.12}
                strokeWidth="5"
                fill="none"
              />
              <circle
                cx="32"
                cy="32"
                r={R}
                stroke="#2C3B74"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                className="transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span
                className="text-[15px] font-bold text-[#2C3B74]"
              >
                {earned}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[#2C3B74]/60 mt-0.5">
                XP
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
