import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useLearningAnalytics } from "@/hooks/useAnalytics";
import { useSRSStats } from "@/hooks/useSRSStats";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { SRSForecastChart } from "@/components/srs/SRSForecastChart";
import { SRSStageBar } from "@/components/srs/SRSStageBar";
import {
  BarChart3,
  BookOpen,
  Brain,
  Target,
  Flame,
  Trophy,
  TrendingUp,
  Loader2,
  Zap,
  Star,
  Clock,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  LineChart,
  Line,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  AreaChart,
  Area,
} from "recharts";

const StatCard = ({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
}: {
  icon: any;
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
}) => (
  <div className={cn(
    "rounded-xl p-4 space-y-1 border",
    accent
      ? "bg-primary/5 border-primary/20"
      : "bg-card border-border"
  )}>
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className={cn("h-4 w-4", accent && "text-primary")} />
      <span className="text-xs font-medium">{label}</span>
    </div>
    <p className={cn("text-2xl font-bold", accent ? "text-primary" : "text-foreground")}>{value}</p>
    {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
  </div>
);

const STAGE_COLORS = [
  "hsl(var(--muted-foreground))",
  "hsl(210, 80%, 60%)",
  "hsl(190, 70%, 50%)",
  "hsl(160, 70%, 45%)",
  "hsl(130, 65%, 45%)",
  "hsl(80, 70%, 45%)",
];

const LearningAnalytics = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: analytics, isLoading } = useLearningAnalytics();
  const { data: srsStats } = useSRSStats();

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center space-y-4">
          <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Sign in to see your learning analytics</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  if (isLoading || !analytics) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  const masteryPercent = analytics.totalWords > 0
    ? Math.round((analytics.masteredWords / analytics.totalWords) * 100)
    : 0;

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">Learning Analytics <InfoHint {...PAGE_HINTS["learning-analytics"]} /></h1>
            <p className="text-sm text-muted-foreground">Your complete progress overview</p>
          </div>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={BookOpen} label="Total Words" value={analytics.totalWords} accent />
          <StatCard icon={Star} label="Mastered" value={analytics.masteredWords} sublabel={`${masteryPercent}%`} />
          <StatCard icon={Target} label="Accuracy" value={`${analytics.accuracy}%`} sublabel={`${analytics.totalReviews} reviews`} />
          <StatCard icon={Zap} label="XP" value={analytics.totalXP.toLocaleString()} sublabel={`Level ${analytics.level}`} />
          <StatCard icon={Flame} label="Streak" value={analytics.currentStreak} sublabel={`Best: ${analytics.longestStreak}`} />
          <StatCard icon={Clock} label="Study Time" value={`${analytics.studyMinutes}m`} sublabel="estimated" />
        </div>

        {/* This Week Summary */}
        <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-2xl p-4 space-y-2">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> This Week
          </h2>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-2xl font-bold text-primary">{analytics.wordsLearnedThisWeek}</span>
              <span className="text-muted-foreground ml-1">new words</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-foreground">{analytics.challengesCompleted}</span>
              <span className="text-muted-foreground ml-1">challenges</span>
            </div>
          </div>
        </div>

        {/* Skill Radar Chart */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" /> Skill Breakdown
          </h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={analytics.skillRadar} outerRadius="70%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis
                  dataKey="skill"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Word Mastery Breakdown */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Word Mastery
            </h2>
            <span className="text-sm text-primary font-medium">{masteryPercent}%</span>
          </div>
          <Progress value={masteryPercent} className="h-3" />

          <div className="space-y-2 pt-2">
            {analytics.stageBreakdown.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{stage.stage}</span>
                <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: analytics.totalWords > 0 ? `${(stage.count / analytics.totalWords) * 100}%` : "0%",
                      backgroundColor: STAGE_COLORS[i],
                      minWidth: stage.count > 0 ? "8px" : "0px",
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-foreground w-8 text-right">{stage.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* SRS Review Forecast */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            📅 Review Forecast (7 days)
          </h2>
          <p className="text-xs text-muted-foreground">Combined across curriculum and your saved words</p>
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-3">
            <p className="text-xs text-muted-foreground">Due today</p>
            <p className="text-2xl font-bold text-primary">{srsStats?.forecast[0]?.count ?? 0}</p>
          </div>
          <SRSForecastChart forecast={srsStats?.forecast ?? []} />
        </div>

        {/* SRS Card Health */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            🧠 Card Health
          </h2>
          <SRSStageBar
            stages={srsStats?.stageBreakdown ?? {
              new: 0,
              learning: 0,
              familiar: 0,
              practiced: 0,
              strong: 0,
              mastered: 0,
            }}
            total={srsStats?.totalCards ?? 0}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Retention rate</p>
              <p className="text-lg font-bold text-foreground">{srsStats?.retentionRate ?? 0}%</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Total cards</p>
              <p className="text-lg font-bold text-foreground">{srsStats?.totalCards ?? 0}</p>
              <p className="text-xs text-muted-foreground">
                curriculum: {srsStats?.curriculumCards ?? 0} · my words: {srsStats?.myWordsCards ?? 0}
              </p>
            </div>
          </div>
        </div>

        {/* Vocab Growth Over Time */}
        {analytics.vocabGrowth.length > 1 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Vocabulary Growth
            </h2>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.vocabGrowth}>
                  <defs>
                    <linearGradient id="vocabGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => {
                      const date = new Date(d);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <Tooltip
                    formatter={(value: number) => [`${value} words`, "Total"]}
                    labelFormatter={(label: string) =>
                      new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="hsl(var(--primary))"
                    fillOpacity={1}
                    fill="url(#vocabGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Daily Activity */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Daily Activity (14 days)
          </h2>

          {analytics.dailyActivity.some((d) => d.reviews > 0) ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.dailyActivity}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => {
                      const date = new Date(d);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value}`,
                      name === "reviews" ? "Reviews" : "Correct",
                    ]}
                    labelFormatter={(label: string) =>
                      new Date(label).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    }
                  />
                  <Bar dataKey="reviews" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">No activity yet — start reviewing!</p>
            </div>
          )}
        </div>

        {/* Weekly Accuracy Trend */}
        {analytics.weeklyAccuracy.some((w) => w.accuracy > 0) && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Accuracy Trend (4 weeks)
            </h2>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.weeklyAccuracy}>
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={30} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Accuracy"]} />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Mistakes */}
        {analytics.topMistakes.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Words to Focus On
            </h2>
            <div className="space-y-2">
              {analytics.topMistakes.map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-base font-arabic text-foreground w-24 text-right" dir="rtl">{w.word}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-destructive/60"
                      style={{ width: `${w.errorRate}%` }}
                    />
                  </div>
                  <span className="text-xs text-destructive font-medium w-10 text-right">{w.errorRate}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Insights */}
        <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-2xl p-4 space-y-2">
          <h2 className="font-semibold text-foreground">💡 Insights</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {analytics.totalWords === 0 && (
              <li>• Start learning to see your progress here!</li>
            )}
            {analytics.accuracy < 60 && analytics.totalReviews > 10 && (
              <li>• Your accuracy is below 60% — try reviewing at a slower pace</li>
            )}
            {analytics.accuracy >= 80 && analytics.totalReviews > 10 && (
              <li>• Great accuracy ({analytics.accuracy}%)! You're retaining well 💪</li>
            )}
            {analytics.currentStreak >= 7 && (
              <li>• Amazing {analytics.currentStreak}-day streak! Keep it up! 🔥</li>
            )}
            {analytics.currentStreak === 0 && analytics.longestStreak > 0 && (
              <li>• Your best streak was {analytics.longestStreak} days — start a new one today!</li>
            )}
            {analytics.masteredWords > 0 && (
              <li>• You've mastered {analytics.masteredWords} words — that's real progress! ⭐</li>
            )}
            {analytics.learningWords > analytics.masteredWords && analytics.totalWords > 5 && (
              <li>• {analytics.learningWords} words in progress — keep reviewing daily</li>
            )}
            {analytics.wordsLearnedThisWeek >= 10 && (
              <li>• {analytics.wordsLearnedThisWeek} new words this week — impressive pace! 🚀</li>
            )}
            {analytics.topMistakes.length > 0 && (
              <li>• Focus on your challenging words above to boost accuracy</li>
            )}
          </ul>
        </div>
      </div>
    </AppShell>
  );
};

export default LearningAnalytics;
