import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, MessageCircleQuestion, Phone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTodayQueue } from "@/hooks/useTodayQueue";
import { useTodaysVideo } from "@/hooks/useTodaysVideo";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useDialect } from "@/contexts/DialectContext";
import { HomeSectionId, isSectionVisible } from "@/lib/homeLayout";
import { AR } from "@/lib/strings";
import { Button } from "@/components/design-system";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { NotificationBell } from "@/components/NotificationBell";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { StreakCard } from "@/components/today/StreakCard";
import { PlanCard } from "@/components/today/PlanCard";
import { PhraseOfTheDay } from "@/components/PhraseOfTheDay";
import { ContinueCard } from "@/components/ContinueCard";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";

/**
 * Today: the front door.
 *
 * One question to answer — what should I do now? — so the page is a greeting,
 * the streak, a three-step plan with one button, and a way to the tutor. It
 * replaced a dashboard of about twenty-five tap targets: a welcome panel, a
 * dialect switcher, three progress rings showing three different numbers, the
 * video card, six task rows, a cards-due banner, XP chips and weekly goals.
 * Nothing it did was lost: the queue is the plan (and its extras), the
 * dialect lives in Settings, sign-out in Settings, the sounds ring on the Talk
 * tab, and the clips feed in the library.
 *
 * The welcome copy greets in the learner's language without ornament. The
 * brand earns its appeal from the dialect in every label, not from heritage
 * motifs, so none appear here.
 */

/** Weekday, day and month in Arabic, with Western digits and the Gregorian calendar. */
const DATE_FORMAT = new Intl.DateTimeFormat("ar-u-nu-latn-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** The profile columns Today reads. Cast from `unknown`: the generated types predate the per-dialect placement columns. */
interface TodayProfile {
  display_name: string | null;
  onboarding_completed: boolean | null;
  placement_level: string | null;
  placement_level_gulf: string | null;
  placement_level_egyptian: string | null;
  placement_level_yemeni: string | null;
}

function greetingFor(hour: number): string {
  return hour < 12 ? AR.today.greetingMorning : AR.today.greetingEvening;
}

const Index = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { state: homeLayout } = useHomeLayout();
  const tasks = useTodayQueue();
  const { video: todaysVideo } = useTodaysVideo();

  // Dialect-aware placement level decides whether the placement prompt is still
  // worth showing; the display name is the greeting's.
  const [placementLevel, setPlacementLevel] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Check onboarding + placement status for authenticated users (per active dialect).
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    const checkProfile = async () => {
      const { data: row } = await supabase
        .from("profiles")
        .select("display_name, onboarding_completed, placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni")
        .eq("user_id", user.id)
        .maybeSingle();
      const data = row as unknown as TodayProfile | null;
      if (data && !data.onboarding_completed) {
        navigate("/onboarding");
      }
      if (data) {
        const key = `placement_level_${activeDialect.toLowerCase()}` as keyof TodayProfile;
        const perDialect = data[key] as string | null | undefined;
        const fallback = activeDialect === "Gulf" ? data.placement_level : null;
        setPlacementLevel(perDialect || fallback || null);
        setDisplayName(data.display_name ?? null);
      }
    };
    checkProfile();
  }, [isAuthenticated, authLoading, user, navigate, activeDialect]);

  // Logged-out visitors get the landing hero instead of the plan.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  const firstName = displayName?.split(" ")[0] || user?.email?.split("@")[0] || "";
  const greeting = greetingFor(new Date().getHours());

  const sections: Partial<Record<HomeSectionId, React.ReactNode>> = {
    "placement-banner": !placementLevel ? (
      <Link
        to="/placement"
        className="flex items-center gap-3.5 rounded-3xl border border-border bg-card p-4 transition-colors hover:bg-muted"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <GraduationCap className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-6">{AR.home.placementTitle}</span>
          <span className="block text-sm leading-6 text-muted-foreground">{AR.home.placementBody}</span>
        </span>
        <ChevronOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>
    ) : null,

    "daily-queue": (
      <div className="space-y-4">
        <StreakCard />
        <PlanCard tasks={tasks} videoTitle={todaysVideo?.title} />
      </div>
    ),

    "phrase-of-the-day": <PhraseOfTheDay />,
  };

  return (
    <AppShell>
      <header className="mb-5 flex items-center gap-3">
        <ProfileEmblem />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-[22px] text-muted-foreground">{DATE_FORMAT.format(new Date())}</p>
          <h1 className="truncate text-[26px] leading-[38px]">
            {firstName ? `${greeting}، ${firstName}` : greeting}
          </h1>
        </div>
        <NotificationBell />
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="text-muted-foreground hover:text-foreground"
            title={AR.common.admin}
            aria-label={AR.common.admin}
          >
            <GraduationCap className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div className="space-y-4">
        {homeLayout.order.map((id) => {
          if (!isSectionVisible(id, homeLayout)) return null;
          const node = sections[id];
          return node ? <div key={id}>{node}</div> : null;
        })}

        {/* The tutor, one tap away. Two doors rather than a list: the Talk tab
            has the rest. */}
        <section aria-labelledby="today-talk" className="pt-1">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 id="today-talk" className="text-[17px] leading-[26px]">{AR.today.talkTitle}</h2>
            <Link to="/talk" className="text-sm font-medium no-underline">{AR.today.talkAll}</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/how-do-i-say"
              className="flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-foreground"
            >
              <MessageCircleQuestion className="h-4 w-4 text-primary" />
              {AR.today.talkAsk}
            </Link>
            <Link
              to="/conversation"
              className="flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-foreground"
            >
              <Phone className="h-4 w-4 text-primary" />
              {AR.today.talkCall}
            </Link>
          </div>
        </section>

        <ContinueCard />
      </div>
    </AppShell>
  );
};

export default Index;
