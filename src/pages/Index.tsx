import { useNavigate } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useReviewStats } from "@/hooks/useReview";
import { useUserVocabularyDueCount } from "@/hooks/useUserVocabulary";
import { useSRSStats } from "@/hooks/useSRSStats";
import { useUserXP } from "@/hooks/useGamification";
import { useTodayQueue } from "@/hooks/useTodayQueue";
import { Button } from "@/components/design-system";
import { Settings, Brain, LogIn, LogOut, Mic, BookOpen, Sparkles, GraduationCap, Laugh, Play, Twitter, MessageCircleQuestion, MessageSquare, MessageCircle, Globe2, Headphones, Trophy, FileText, Flame, BarChart3, PenTool, Gamepad2, Users, Swords, Newspaper, Image as ImageIcon, Languages, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { XPDisplay, StreakDisplay, WeeklyGoalCard, AchievementsGrid } from "@/components/gamification";
import ingleezyLogoAsset from "@/assets/ingleezy-logo.png.asset.json";
const lahjaLogo = ingleezyLogoAsset.url;
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { useDialect, DialectModule } from "@/contexts/DialectContext";
import { DialectRitualSwitcher } from "@/components/DialectRitualSwitcher";
import { MajlisWelcome } from "@/components/MajlisWelcome";
import { PhraseOfTheDay } from "@/components/PhraseOfTheDay";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { HomeSectionId, isSectionVisible } from "@/lib/homeLayout";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { InfoHint } from "@/components/InfoHint";
import { DailyGoalRing } from "@/components/today/DailyGoalRing";
import { TaskRow } from "@/components/today/TaskRow";
import { WatchTodayCard } from "@/components/today/WatchTodayCard";
import { getDailyGoal, setDailyGoal } from "@/lib/todayCompletion";
import { ContinueCard } from "@/components/ContinueCard";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";
import { AR } from "@/lib/strings";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { DailySoundGoalRing } from "@/components/sounds/DailySoundGoalRing";


// Daily-queue task hints, keyed by useTodayQueue's TodayTaskId — the hint
// content lives in the strings module with the rest of the chrome Arabic.
// No "listening" entry: today's video renders as WatchTodayCard at the top of
// the page rather than as a queue row, and carries its own hint.
const TASK_HINTS: Record<string, { title: string; body: string }> = AR.taskHints;

const DIALECT_MODULES: { id: DialectModule; label: string; flag: string }[] = [
  { id: 'Gulf', label: 'Gulf Arabic', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', flag: '🇪🇬' },
  { id: 'Yemeni', label: 'Yemeni Arabic', flag: '🇾🇪' },
];

const Index = () => {
  const navigate = useNavigate();
  const { activeDialect, setDialect } = useDialect();
  const {
    user,
    isAuthenticated,
    signOut,
    loading: authLoading
  } = useAuth();
  const { data: myWordsStats } = useUserVocabularyDueCount();
  const { data: stats } = useReviewStats();
  const { data: srsStats } = useSRSStats();
  // Dialect-aware placement level (see the profile fetch below) — decides
  // whether the placement banner is still worth showing.
  const [placementLevel, setPlacementLevel] = useState<string | null>(null);

  const { state: homeLayout } = useHomeLayout();
  const { isAdmin } = useAdminAuth();

  // Daily queue — inlined here (was previously a separate /today page the
  // user had to navigate to via a "Start today" card).
  const { data: xp } = useUserXP();
  const todayTasks = useTodayQueue();
  const [dailyGoal, setDailyGoalState] = useState<number>(() => getDailyGoal());
  const [goalDraft, setGoalDraft] = useState<string>(String(dailyGoal));

  useEffect(() => {
    const onGoalChange = () => setDailyGoalState(getDailyGoal());
    window.addEventListener("today:goal-changed", onGoalChange);
    return () => window.removeEventListener("today:goal-changed", onGoalChange);
  }, []);

  const xpToday = useMemo(() => {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (!xp || xp.xp_today_date !== todayUtc) return 0;
    return xp.xp_today;
  }, [xp]);

  const visibleTasks = todayTasks.filter((t) => !t.hidden);
  const tasksCompleted = visibleTasks.filter((t) => t.done).length;
  const tasksTotal = visibleTasks.length;

  // Video leads the page as a full card at the very top rather than as a row
  // buried in the queue, so it is pulled out of the list here — it still counts
  // towards the totals above, and WatchTodayCard handles its own navigation and
  // completion.
  const videoTask = visibleTasks.find((t) => t.id === "listening");
  const queueRows = visibleTasks.filter((t) => t.id !== "listening");

  // Check onboarding + placement status for authenticated users (per active dialect)
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user) return;
    const checkProfile = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('onboarding_completed, placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data && !(data as any).onboarding_completed) {
        navigate('/onboarding');
      }
      if (data) {
        const d = activeDialect.toLowerCase();
        const perDialect = (data as any)[`placement_level_${d}`];
        const fallback = activeDialect === 'Gulf' ? (data as any).placement_level : null;
        setPlacementLevel(perDialect || fallback || null);
      }
    };
    checkProfile();
  }, [isAuthenticated, authLoading, user, navigate, activeDialect]);
  const handleSignOut = async () => {
    await signOut();
  };

  // Logged-out visitors get the landing hero instead of the authed home.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  return (
    <AppShell>



      {/* Top bar with logo and auth */}
      <div className="flex items-center justify-between mb-4">
        <img src={lahjaLogo} alt="إنجليزي" className="h-24" />
        
        <div className="flex items-center gap-3">
          {!authLoading && (isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.email?.split("@")[0]}
              </span>
              <Button variant="ghost" size="icon" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground" title={AR.common.signOut} aria-label={AR.common.signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")} className="text-muted-foreground hover:text-foreground">
              <LogIn className="h-4 w-4 me-1.5" />
              {AR.common.login}
            </Button>
          ))}

          {isAuthenticated && (
            <>
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={() => navigate("/profile")} className="text-muted-foreground hover:text-foreground" title={AR.common.profile} aria-label={AR.common.profile}>
                <Users className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground" title={AR.common.settings} aria-label={AR.common.settings}>
                <Settings className="h-4 w-4" />
              </Button>
            </>
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="text-muted-foreground/50 hover:text-muted-foreground" title={AR.common.admin} aria-label={AR.common.admin}>
              <GraduationCap className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* A — Majlis welcome panel */}
      <MajlisWelcome />

      {/* Dialect Module Switcher — ritual chip + flip-card overlay */}
      <div className="mb-3">
        <DialectRitualSwitcher />
      </div>

      {(() => {
        const sections: Partial<Record<HomeSectionId, React.ReactNode>> = {
          "phrase-of-the-day": <PhraseOfTheDay key="phrase-of-the-day" />,

          "placement-banner":
            isAuthenticated && !placementLevel ? (
              <button
                key="placement-banner"
                onClick={() => navigate("/placement")}
                className={cn(
                  "w-full p-5 rounded-2xl",
                  "bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5",
                  "border-2 border-primary/30",
                  "flex items-start gap-4 text-left",
                  "transition-all duration-200",
                  "hover:border-primary/50 hover:shadow-lg active:scale-[0.99]",
                  "relative overflow-hidden"
                )}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0 relative z-10">
                  {/* No InfoHint here: the tile IS a <button>, and InfoHint is
                      deliberately a real <button> too (see its comment), so
                      nesting one inside violates DOM nesting and made the
                      routes sweep red. The tile's own copy carries the hint's
                      content. */}
                  <p className="font-bold text-foreground text-base mb-1 flex items-center gap-1.5">{AR.home.placementTitle}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {AR.home.placementBody}
                  </p>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{AR.home.placementMinutes}</Badge>
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">CEFR A1–C2</Badge>
                  </div>
                </div>
                <ChevronOpen className="h-5 w-5 text-primary shrink-0 mt-1" />
              </button>
            ) : null,

          // The daily task queue — the app's single "what do I do today" surface.
          // This used to be a separate /today page reached via a "Start today"
          // card; it's now inline so Home doesn't compete with a second home.
          "daily-queue": isAuthenticated ? (
            <div key="daily-queue" className="space-y-3">
              <div className="flex items-center gap-4">
                <DailyGoalRing current={xpToday} goal={dailyGoal} size={100} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-foreground font-heading">
                      {AR.home.today}
                    </h2>
                    <InfoHint
                      size="md"
                      title={AR.home.queueHintTitle}
                      body={AR.home.queueHintBody}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {AR.home.tasksDone(tasksCompleted, tasksTotal)}
                  </p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-1 -ms-2 h-7 text-xs">
                        <Settings2 className="h-3.5 w-3.5 me-1" />
                        {AR.home.dailyGoal}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-muted-foreground">{AR.home.dailyGoalXpLabel}</label>
                        <Input
                          type="number"
                          min={10}
                          max={1000}
                          value={goalDraft}
                          onChange={(e) => setGoalDraft(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            const n = parseInt(goalDraft, 10);
                            if (Number.isFinite(n) && n > 0) {
                              setDailyGoal(n);
                              setDailyGoalState(n);
                            }
                          }}
                        >
                          {AR.common.save}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Today's video — sits just below the daily goals and above the
                  task queue / flashcard review. Watching native video is the
                  core of the app; it used to lead the page, but now follows the
                  goals so learners see their target first. */}
              {isAuthenticated && <WatchTodayCard done={videoTask?.done} />}

              {/* Every row left in the queue marks itself complete on its own
                  real completion event, so opening one is a plain navigation —
                  marking on click would let a learner clear the day by tapping
                  through it. */}
              <div className="space-y-3">
                {queueRows.map((task) => (
                  <TaskRow
                    key={task.id}
                    title={task.title}
                    subtitle={task.subtitle}
                    countBadge={task.countBadge}
                    estMinutes={task.estMinutes}
                    icon={task.icon}
                    done={task.done}
                    hint={TASK_HINTS[task.id]}
                    onClick={() => navigate(task.route)}
                  />
                ))}
                {visibleTasks.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="font-semibold text-foreground">{AR.home.allCaughtUpTitle}</p>
                    <p className="text-sm mt-1">{AR.home.allCaughtUpBody}</p>
                  </div>
                )}
              </div>

              {tasksCompleted > 0 && tasksCompleted === tasksTotal && (
                <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 text-center">
                  <Sparkles className="h-6 w-6 mx-auto mb-1 text-primary" />
                  <p className="font-semibold text-foreground text-sm">{AR.home.goalCompleteTitle}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{AR.home.goalCompleteBody}</p>
                </div>
              )}

              {/* One entry point into the review session — "/review" walks
                  every deck with cards due (curriculum, saved words, saved
                  phrases) rather than stranding cards in a deck the learner
                  would have to remember to visit. */}
              {srsStats && srsStats.totalDueNow > 0 && (
                <button
                  onClick={() => navigate("/review")}
                  className="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-foreground">
                      {AR.home.cardsDue(srsStats.totalDueNow)}
                    </span>
                  </div>
                  <span className="text-xs text-amber-600 font-semibold">{AR.home.reviewNow} ←</span>
                </button>
              )}

              {/* Secondary progression track — distinct from the daily queue.
                  The English Sounds journey teaches the sounds Arabic
                  doesn't have; a tap opens the trail, the ring alone shows
                  today's progress toward it. */}
              <button onClick={() => navigate("/sounds")} className="w-full text-start">
                <DailySoundGoalRing className="w-full" />
              </button>
              <div className="flex gap-3">
                <XPDisplay compact className="flex-1" />
                <StreakDisplay compact />
              </div>
              <WeeklyGoalCard />
            </div>
          ) : null,
        };

        return (
          <div className="space-y-3">
            {homeLayout.order.map((id) => {
              if (!isSectionVisible(id, homeLayout)) return null;
              const node = sections[id];
              if (!node) return null;
              return <div key={id}>{node}</div>;
            })}
          </div>
        );
      })()}

      {/* Explore — secondary browsing content, below the daily queue rather
          than competing with it for the first screen. */}
      <div className="mt-6 space-y-4">
        {isAuthenticated && <ContinueCard />}
      </div>

    </AppShell>
  );
};

export default Index;

