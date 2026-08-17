import { Link } from "react-router-dom";
import {
  BookOpen, Languages, FileText, Heart, BarChart3, Trophy, Users, User, Settings,
  CreditCard, GraduationCap, Newspaper, Compass, MessageCircleQuestion, Laugh,
  Twitter, Mic, BookOpenText, ChevronLeft, CalendarCheck, MessagesSquare,
  SpellCheck, Target, TriangleAlert, Headset, type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useUserXP } from "@/hooks/useGamification";
import { useSRSStats } from "@/hooks/useSRSStats";
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
 * Three things changed. Numbers come first, because the reason to open your
 * own page is to see where you are. The library is four blocks, since those
 * are the only entries here that hold your own material. And everything else
 * is a label under an icon: the descriptions were what made the page long, and
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
 */
const practice = (signedIn: boolean): Item[] => [
  { label: "يومك", icon: CalendarCheck, to: "/today" },
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
  const { isAuthenticated } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { data: xp } = useUserXP();
  const { data: srs } = useSRSStats();

  return (
    <AppShell>
      <h1 className="pb-1 pt-1 text-[26px] font-bold leading-tight">أنا</h1>
      <p className="pb-5 text-sm text-muted-foreground">مكتبتك وأدواتك وحسابك.</p>

      {/* Where you are, before what you can do. Numerals are set in the
          display face, which has no Arabic glyphs — Latin digits only, which
          is exactly what this is. */}
      <div className="mb-7 grid grid-cols-3 overflow-hidden rounded-2xl bg-[#2C3B74] text-white">
        <Stat value={xp?.level ?? 1} label="مستواك" />
        <Stat value={srs?.totalCards ?? 0} label="كلماتك" divided />
        <Stat value={srs?.totalDueNow ?? 0} label="مستحقة الآن" divided />
      </div>

      <Section title="مكتبتك">
        <div className="grid grid-cols-2 gap-2.5">
          {visible(library(isAuthenticated)).map(({ label, icon: Icon, to }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-border bg-card p-4",
                "transition-transform active:scale-[0.98]",
              )}
            >
              <Icon className="h-5 w-5 shrink-0 text-periwinkle" />
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
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {visible(account(isAuthenticated, isAdmin)).map(({ label, icon: Icon, to }) => (
            <li key={to} className="border-b border-border last:border-0">
              <Link to={to} className="flex items-center gap-3 px-4 py-3.5 text-sm">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                <ChevronLeft className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </AppShell>
  );
};

function Stat({ value, label, divided }: { value: number; label: string; divided?: boolean }) {
  return (
    <div className={cn("px-3 py-4 text-center", divided && "border-s border-white/15")}>
      <div className="font-display text-2xl not-italic leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] text-white/65">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
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
            "flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-2 py-4",
            "transition-transform active:scale-[0.98]",
          )}
        >
          <Icon className="h-5 w-5 text-periwinkle" />
          <span className="text-center text-[11px] font-medium leading-tight">{label}</span>
        </Link>
      ))}
    </div>
  );
}

export default MeHub;
