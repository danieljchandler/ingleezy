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

const DIALECT_ACCENT: Record<string, string> = {
  Gulf: "from-teal-500/15 to-teal-700/5 border-teal-700/30 text-teal-800",
  Egyptian: "from-amber-400/20 to-amber-600/5 border-amber-600/30 text-amber-800",
  Yemeni: "from-red-500/15 to-red-800/5 border-red-700/30 text-red-800",
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
        "bg-[#F9F7F2] border border-[#5C3A46]/20",
        "px-4 py-4 sm:px-5 sm:py-5",
        "shadow-[0_1px_0_0_rgba(92,58,70,0.04),0_8px_24px_-12px_rgba(92,58,70,0.18)]"
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
        className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-[#C5A67A]/15 blur-3xl pointer-events-none"
      />

      <div className="relative flex items-start gap-4">
        {/* Left: greeting */}
        <div className="flex-1 min-w-0">
          <p
            className="text-2xl sm:text-3xl leading-tight text-[#5C3A46] font-arabic"
            dir="rtl"
          >
            {greeting.ar}
          </p>
          <p
            className="mt-1 text-sm text-[#5C3A46]/70"
            style={{ fontFamily: "'Open Sans', sans-serif" }}
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
                    ? "bg-gradient-to-r from-orange-400/15 to-red-500/10 border-orange-500/40 text-orange-700"
                    : "bg-[#5C3A46]/5 border-[#5C3A46]/15 text-[#5C3A46]/60"
                )}
                title={`${streak?.current_streak ?? 0}-day streak`}
              >
                <Flame
                  className={cn(
                    "h-3 w-3",
                    (streak?.current_streak ?? 0) > 0 ? "text-orange-500" : "text-[#5C3A46]/40"
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
                stroke="#5C3A46"
                strokeOpacity={0.12}
                strokeWidth="5"
                fill="none"
              />
              <circle
                cx="32"
                cy="32"
                r={R}
                stroke="#5C3A46"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                className="transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span
                className="text-[15px] font-bold text-[#5C3A46]"
                style={{ fontFamily: "'Montserrat', sans-serif" }}
              >
                {earned}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[#5C3A46]/60 mt-0.5">
                XP
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
