import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserXP, useUserAchievements, calculateLevel, xpProgressInLevel } from "@/hooks/useGamification";
import { ArrowLeft, Flame, Sparkles, BookOpen, Trophy, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReferralCard } from "@/components/social/ReferralCard";
import { LevelJourneyCard } from "@/components/social/LevelJourneyCard";

interface DialectStudy {
  dialect: string;
  wordCount: number;
  matureCount: number;
}

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  preferred_dialect: string | null;
}

const DIALECT_META: Record<string, { label: string; arabic: string; color: string; emoji: string }> = {
  Gulf:     { label: "Gulf",     arabic: "خليجي", color: "12 68% 32%", emoji: "🗺️" },
  Egyptian: { label: "Egyptian", arabic: "مصري",  color: "38 85% 45%",  emoji: "🌅" },
  Yemeni:   { label: "Yemeni",   arabic: "يمني",  color: "0 70% 42%",   emoji: "🏔️" },
};

const Profile = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: xpRow } = useUserXP();
  const { data: achievements } = useUserAchievements();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [dialectStudy, setDialectStudy] = useState<DialectStudy[]>([]);
  const [streak, setStreak] = useState<{ current: number; longest: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/auth");
  }, [authLoading, isAuthenticated, navigate]);

  const loadProfile = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: prof }, { data: vocab }, { data: streakRow }] = await Promise.all([
        (supabase.from("profiles" as never) as any)
          .select("display_name, avatar_url, created_at, preferred_dialect")
          .eq("user_id", user.id)
          .maybeSingle(),
        (supabase.from("user_vocabulary" as never) as any)
          .select("dialect, interval_days")
          .eq("user_id", user.id),
        (supabase.from("review_streaks" as never) as any)
          .select("current_streak, longest_streak")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      setProfile(prof ?? null);

      const buckets: Record<string, DialectStudy> = {};
      (vocab ?? []).forEach((row: any) => {
        const d = row.dialect ?? "Gulf";
        if (!buckets[d]) buckets[d] = { dialect: d, wordCount: 0, matureCount: 0 };
        buckets[d].wordCount += 1;
        if ((row.interval_days ?? 0) >= 7) buckets[d].matureCount += 1;
      });
      setDialectStudy(Object.values(buckets).sort((a, b) => b.wordCount - a.wordCount));

      setStreak({
        current: streakRow?.current_streak ?? 0,
        longest: streakRow?.longest_streak ?? 0,
      });
    } catch (e) {
      setError("تعذّر تحميل بيانات الملف الشخصي. حاول من جديد.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalXp = xpRow?.total_xp ?? 0;
  const level = calculateLevel(totalXp);
  const progress = xpProgressInLevel(totalXp);
  const totalWords = dialectStudy.reduce((s, d) => s + d.wordCount, 0);
  const totalMature = dialectStudy.reduce((s, d) => s + d.matureCount, 0);
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("ar-u-nu-latn", { month: "short", year: "numeric" })
    : "—";
  const initial = (profile?.display_name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  return (
    <AppShell>
      <div className="px-4 pt-4 pb-24">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" /> رجوع
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings")} className="gap-1.5">
            <SettingsIcon className="h-4 w-4" /> الإعدادات
          </Button>
        </div>

        {error && (
          <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-6 text-center mb-4">
            <p className="text-sm text-destructive font-medium">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={loadProfile}>
              أعد المحاولة
            </Button>
          </div>
        )}

        {/* ── Passport cover ── */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-desert-red bg-card-cream shadow-card">
          {/* Sadu watermark */}
          <div
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage: "url(/assets/sadu-watermark.svg)",
              backgroundSize: "260px",
              backgroundRepeat: "repeat",
            }}
          />
          {/* Corner stamp */}
          <div className="absolute top-3 right-3 rotate-6 rounded-md border-2 border-desert-red/80 px-2 py-1 text-[10px] tracking-[0.18em] uppercase font-heading text-desert-red/80">
            Ingleezy · جواز
          </div>

          <div className="relative p-5 flex flex-col items-center text-center">
            <div className="relative">
              <Avatar className="h-24 w-24 ring-4 ring-desert-red/15 border-2 border-desert-red/40">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="text-2xl font-heading bg-muted">{initial}</AvatarFallback>
              </Avatar>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-desert-red px-2.5 py-0.5 text-[11px] font-heading font-bold text-primary-foreground shadow-button">
                LV {level}
              </div>
            </div>

            <h1 className="mt-5 text-title font-heading font-bold text-foreground">
              {loading ? <Skeleton className="h-7 w-40 mx-auto" /> : (profile?.display_name ?? "مسافر")}
            </h1>
            <p className="text-overline mt-1">عضو منذ {memberSince}</p>

            {/* XP rail */}
            <div className="mt-4 w-full max-w-xs">
              <div className="flex justify-between text-caption mb-1">
                <span>{progress.current} XP</span>
                <span>{progress.needed} للمستوى {level + 1}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-desert-red to-primary transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Headline stats ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <StatCard icon={<Flame className="h-4 w-4" />} label="السلسلة" value={streak?.current ?? 0} sub={`الأفضل ${streak?.longest ?? 0}`} />
          <StatCard icon={<BookOpen className="h-4 w-4" />} label="الكلمات" value={totalWords} sub={`${totalMature} متقنة`} />
          <StatCard icon={<Trophy className="h-4 w-4" />} label="الأوسمة" value={achievements?.length ?? 0} sub="مكتسبة" />
        </div>

        {/* ── Assessed level ── */}
        <section className="mt-6">
          <LevelJourneyCard />
        </section>

        {/* ── Referrals ── */}
        <section className="mt-6">
          <ReferralCard />
        </section>

        {/* ── Dialect stamps ── */}
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-subtitle font-heading font-bold">كلماتك حسب اللهجة</h2>
            <span className="text-caption">{dialectStudy.length === 1 ? "طابع واحد" : dialectStudy.length === 2 ? "طابعان" : `${dialectStudy.length} طوابع`}</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          ) : dialectStudy.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-desert-red/40 bg-card-cream/60 p-8 text-center">
              <p className="text-body-strong font-heading">لا طوابع بعد</p>
              <p className="text-caption mt-1">احفظ كلمة لتكسب أول طابع.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dialectStudy.map((d) => {
                const meta = DIALECT_META[d.dialect] ?? { label: d.dialect, arabic: d.dialect, color: "8 45% 38%", emoji: "✦" };
                return (
                  <div
                    key={d.dialect}
                    className="relative rounded-2xl border-2 bg-card-cream p-4 overflow-hidden shadow-soft"
                    style={{ borderColor: `hsl(${meta.color} / 0.6)` }}
                  >
                    {/* Faux postage perforation */}
                    <div
                      className="absolute inset-y-0 left-0 w-1"
                      style={{
                        background: `repeating-linear-gradient(to bottom, hsl(${meta.color}) 0 4px, transparent 4px 8px)`,
                      }}
                    />
                    <div className="flex items-start justify-between">
                      <div className="text-2xl leading-none">{meta.emoji}</div>
                      <span
                        className="text-overline rounded-full px-2 py-0.5"
                        style={{
                          color: `hsl(${meta.color})`,
                          background: `hsl(${meta.color} / 0.1)`,
                        }}
                      >
                        {d.matureCount}/{d.wordCount}
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="text-arabic-display text-xl">{meta.arabic}</div>
                    </div>
                    <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${d.wordCount === 0 ? 0 : Math.round((d.matureCount / d.wordCount) * 100)}%`,
                          background: `hsl(${meta.color})`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Recent badges ── */}
        <section className="mt-6">
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-subtitle font-heading font-bold">أحدث الأوسمة</h2>
            {(achievements?.length ?? 0) > 6 && (
              <button onClick={() => navigate("/leaderboard")} className="text-caption underline">
                عرض الكل
              </button>
            )}
          </div>
          {(achievements?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-desert-red/40 bg-card-cream/60 p-6 text-center">
              <Sparkles className="h-5 w-5 mx-auto text-muted-foreground" />
              <p className="text-caption mt-2">اكسب أول وسام بإكمال تحدي اليوم.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(achievements ?? []).slice(0, 6).map((ua) => (
                <div
                  key={ua.id}
                  className={cn(
                    "rounded-2xl border-2 border-desert-red/30 bg-card-cream p-3 text-center shadow-soft",
                  )}
                >
                  <div className="text-2xl">{ua.achievement?.icon ?? "🏅"}</div>
                  <div className="text-caption mt-1 font-medium text-foreground truncate">
                    {ua.achievement?.name ?? "وسام"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
};

const StatCard = ({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: number | string; sub: string }) => (
  <div className="rounded-2xl border-2 border-desert-red/30 bg-card-cream px-3 py-3 text-center shadow-soft">
    <div className="flex items-center justify-center gap-1 text-desert-red/80">
      {icon}
      <span className="text-overline">{label}</span>
    </div>
    <div className="mt-1 text-title font-heading font-bold tabular-nums">{value}</div>
    <div className="text-caption">{sub}</div>
  </div>
);

export default Profile;
