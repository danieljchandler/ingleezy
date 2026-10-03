import { Link } from "react-router-dom";
import {
  BookOpen, Languages, FileText, Heart, BarChart3, Trophy, Users, User, Settings,
  CreditCard, GraduationCap, Newspaper, Compass, MessageCircleQuestion, Laugh,
  Twitter, Mic, BookOpenText, MessagesSquare,
  SpellCheck, Target, TriangleAlert, Headset, type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { Art } from "@/components/brand/Art";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useUserXP } from "@/hooks/useGamification";
import { useSRSStats } from "@/hooks/useSRSStats";
import { useReviewStreak } from "@/hooks/useReviewStreak";
import { AR } from "@/lib/strings";
import { cn } from "@/lib/utils";

/**
 * Your account, your library, your tools.
 *
 * This was twenty rows in five sections, every one a rounded card with an icon
 * chip and a sentence of description, and five different accent colours left
 * over from before the brand. Reading all of it took longer than doing any of
 * it — which is the failure mode of a hub: it becomes a page you scan rather
 * than a page you use.
 *
 * Three things changed. Where you are comes first, because the reason to open
 * your own page is to see it: your name and level, the week you have had (a
 * bar per day, tall where you studied), and the two numbers that matter, the
 * run and the words. The library is four blocks, since those are the only
 * entries here that hold your own material. And everything else is a label
 * under an icon: the descriptions were what made the page long, and
 * "محلل الميمز" does not need a sentence explaining it once you have seen the
 * icon next to it.
 */

interface Item {
  label: string;
  icon: LucideIcon;
  to: string;
  show?: boolean;
}

/** Your own material. The only entries that are yours rather than the app's. */
const library = (signedIn: boolean): Item[] => [
  { label: "كلماتي", icon: BookOpen, to: "/my-words", show: signedIn },
  { label: "ترجمات محفوظة", icon: Languages, to: "/translate/saved", show: signedIn },
  { label: "نصوصي المفرّغة", icon: FileText, to: "/my-transcriptions", show: signedIn },
  { label: "فيديوهات أعجبتني", icon: Heart, to: "/liked-videos", show: signedIn },
];

/** Tools and content, one grid. The old split between them was a distinction
 *  the learner never had to make: both are things you go and do. */
const tools = (signedIn: boolean): Item[] => [
  { label: "ترجم", icon: Languages, to: "/translate" },
  { label: "فرّغ صوتاً", icon: Mic, to: "/transcribe" },
  { label: "ارفع درساً", icon: GraduationCap, to: "/tutor-upload", show: signedIn },
  { label: "كيف أقول؟", icon: MessageCircleQuestion, to: "/how-do-i-say" },
  { label: "قصص", icon: BookOpenText, to: "/stories" },
  { label: "أخبار السوق", icon: Newspaper, to: "/souq-news" },
  { label: "محلل الميمز", icon: Laugh, to: "/meme" },
  { label: "منشور X", icon: Twitter, to: "/learn-from-x" },
  { label: "ماذا أفعل؟", icon: Compass, to: "/culture-guide" },
];

/**
 * Practice modes that had no door left.
 *
 * These were only ever linked from the two hub screens the chooser replaced,
 * so deleting those hubs made five working features unreachable — the kind of
 * hole a navigation rewrite leaves that nothing fails on, because an
 * unreachable route still passes every test written about it.
 *
 * "Your day" used to lead this list. Today is the front door and a dock tab
 * now, so a second door here would only be a duplicate.
 */
const practice = (signedIn: boolean): Item[] => [
  { label: "محادثة", icon: MessagesSquare, to: "/conversation" },
  { label: "قواعد", icon: SpellCheck, to: "/grammar" },
  { label: "تحدّي اليوم", icon: Target, to: "/daily-challenge" },
  { label: "أخطاؤك", icon: TriangleAlert, to: "/mistakes", show: signedIn },
  { label: "تصحيح من متحدث", icon: Headset, to: "/native-feedback", show: signedIn },
];

const progress = (signedIn: boolean): Item[] => [
  { label: "إحصاءاتك", icon: BarChart3, to: "/analytics", show: signedIn },
  { label: "لوحة الصدارة", icon: Trophy, to: "/leaderboard" },
  { label: "الأصدقاء", icon: Users, to: "/friends", show: signedIn },
];

const account = (signedIn: boolean, admin: boolean): Item[] => [
  { label: "الملف الشخصي", icon: User, to: "/profile", show: signedIn },
  { label: "الإعدادات", icon: Settings, to: "/settings", show: signedIn },
  { label: "الأسعار والباقات", icon: CreditCard, to: "/pricing" },
  { label: "الإدارة", icon: GraduationCap, to: "/admin", show: admin },
];

const visible = (items: Item[]) => items.filter((i) => i.show !== false);

const MeHub = () => {
  const { user, isAuthenticated } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { data: xp } = useUserXP();
  const { data: srs } = useSRSStats();
  const { days, week } = useReviewStreak();

  const { data: displayName } = useQuery({
    queryKey: ["me-display-name", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data?.display_name as string | null | undefined) ?? null;
    },
    enabled: !!user,
  });

  const name = displayName?.trim() || user?.email?.split("@")[0] || "";
  const activeDays = week.filter((day) => day.done).length;
  const due = srs?.totalDueNow ?? 0;
  const words = srs?.totalCards ?? 0;

  return (
    <AppShell>
      <header className="mb-4 flex items-center gap-3.5 pt-1">
        <span
          aria-hidden
          className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full text-[26px] font-semibold text-foreground"
          style={{ background: "radial-gradient(circle at 30% 30%, hsl(var(--wash-gold)) 0%, hsl(var(--wash-teal)) 55%, hsl(var(--wash-sage)) 100%)" }}
        >
          {name ? name.charAt(0).toLocaleUpperCase() : "أ"}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[28px] leading-10">{name || "أنا"}</h1>
          <p className="text-sm leading-[22px] text-muted-foreground">
            المستوى {xp?.level ?? 1} · مكتبتك وأدواتك وحسابك
          </p>
        </div>
      </header>

      {/* The week: a bar per day, tall where the learner studied. Gold for
          today once it is kept, firoza for the rest. */}
      <section aria-labelledby="me-week" className="mb-3 rounded-[28px] bg-card p-[18px] shadow-card">
        <span className="inline-block rounded-full bg-tint-sage px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-success-ink">
          هالأسبوع
        </span>
        <p id="me-week" className="mt-1 font-display text-[56px] leading-[66px] tabular-nums">
          {activeDays}
          <span className="text-2xl text-muted-foreground">/7</span>
        </p>
        <p className="text-sm leading-[22px] text-muted-foreground">أيام تعلّمت فيها خلال آخر سبعة أيام.</p>
        <ol aria-label={AR.today.lastSevenDays} className="mt-3 grid h-24 grid-cols-7 items-end gap-2">
          {week.map((day) => (
            <li
              key={day.date}
              aria-label={day.done ? AR.today.dayDone : day.isToday ? AR.today.dayToday : undefined}
              className="flex h-full flex-col items-center justify-end gap-1.5"
            >
              <span
                className={cn(
                  "w-full rounded-[10px]",
                  day.done ? (day.isToday ? "h-[74px] bg-accent" : "h-[62px] bg-primary") : "h-[26px] bg-muted",
                )}
              />
              <span className={cn("text-[11px] leading-[14px]", day.isToday ? "font-bold" : "text-muted-foreground")}>
                {day.label}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <StatTile art="flame" value={days} label={AR.today.streakUnit(days)} />
        <StatTile art="book" value={words} label={AR.today.wordsUnit(words)} to="/my-words" />
      </div>

      {due > 0 && (
        <Link
          to="/review"
          className="mb-7 flex items-center gap-3 rounded-3xl bg-primary px-4 py-3.5 text-primary-foreground no-underline shadow-card transition-transform active:scale-[0.99]"
        >
          <span className="font-display text-2xl tabular-nums">{due}</span>
          <span className="flex-1 text-[15px] font-semibold">مستحقة الآن · راجعها</span>
          <ChevronOpen className="h-5 w-5" />
        </Link>
      )}
      {due === 0 && <div className="mb-4" />}

      <Section title="مكتبتك">
        <div className="grid grid-cols-2 gap-2.5">
          {visible(library(isAuthenticated)).map(({ label, icon: Icon, to }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-3xl bg-card p-3 text-foreground no-underline shadow-soft",
                "transition-transform active:scale-[0.98]",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-tint-firoza text-primary dark:text-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="تدرّب">
        <Grid items={visible(practice(isAuthenticated))} />
      </Section>

      <Section title="أدواتك">
        <Grid items={visible(tools(isAuthenticated))} />
      </Section>

      <Section title="تقدّمك">
        <Grid items={visible(progress(isAuthenticated))} />
      </Section>

      <Section title="حسابك">
        {/* Deliberately the quietest thing on the page. Settings are what you
            come for once, not what you come for. */}
        <ul className="overflow-hidden rounded-3xl bg-card shadow-soft">
          {visible(account(isAuthenticated, isAdmin)).map(({ label, icon: Icon, to }) => (
            <li key={to} className="border-b border-border last:border-0">
              <Link to={to} className="flex items-center gap-3 px-4 py-3.5 text-sm text-foreground no-underline hover:bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                <ChevronOpen className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </AppShell>
  );
};

function StatTile({ art, value, label, to }: { art: "flame" | "book"; value: number; label: string; to?: string }) {
  const body = (
    <>
      <Art name={art} className="h-12 w-12 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="font-display text-2xl leading-[30px] tabular-nums">{value}</span>
        <span className="text-[13px] leading-[18px] text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const shape = "flex h-[92px] items-center gap-2 rounded-[22px] bg-card px-3.5 text-foreground no-underline shadow-soft";
  return to ? (
    <Link to={to} className={cn(shape, "transition-transform active:scale-[0.98]")}>
      {body}
    </Link>
  ) : (
    <div className={shape}>{body}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 px-1 font-sans text-[15px] font-semibold leading-6">{title}</h2>
      {children}
    </section>
  );
}

/** Icon over label, three across. No descriptions: they were the length. */
function Grid({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map(({ label, icon: Icon, to }) => (
        <Link
          key={to}
          to={to}
          className={cn(
            "flex flex-col items-center gap-2 rounded-3xl bg-card px-2 py-3.5 text-foreground no-underline shadow-soft",
            "transition-transform active:scale-[0.98]",
          )}
        >
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-tint-firoza text-primary dark:text-foreground">
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-center text-xs font-medium leading-tight">{label}</span>
        </Link>
      ))}
    </div>
  );
}

export default MeHub;
