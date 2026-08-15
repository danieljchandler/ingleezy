import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDiscoverVideos } from "@/hooks/useDiscoverVideos";
import { useDiscoverFeed, type FeedItem } from "@/hooks/useDiscoverFeed";
import type { DiscoverVideo } from "@/hooks/useDiscoverVideos";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Play, Shuffle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/videoEmbed";
import { ContentRequestBar } from "@/components/discover/ContentRequestBar";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useComprehensionMap } from "@/hooks/useComprehensionMap";
import {
  comprehensionBarClass,
  comprehensionLabel,
  type Comprehension,
} from "@/lib/comprehension";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Values are matched against DB columns — only the display labels are Arabic.
const DIALECTS = ["All", "Gulf", "Egyptian", "Yemeni", "MSA", "Levantine", "Maghrebi"];
const DIALECT_LABELS: Record<string, string> = {
  All: "الكل", Gulf: "خليجي", Egyptian: "مصري", Yemeni: "يمني",
  MSA: "فصحى", Levantine: "شامي", Maghrebi: "مغاربي",
};
const DIFFICULTIES = ["All", "Beginner", "Intermediate", "Advanced", "Expert"];
const DIFFICULTY_LABELS: Record<string, string> = {
  All: "الكل", Beginner: "مبتدئ", Intermediate: "متوسط", Advanced: "متقدم", Expert: "خبير",
};

function difficultyColor(d: string) {
  switch (d) {
    case "Beginner": return "bg-primary/10 text-primary border-primary/20";
    case "Intermediate": return "bg-accent/10 text-accent border-accent/20";
    case "Advanced": return "bg-secondary/10 text-secondary border-secondary/20";
    case "Expert": return "bg-destructive/10 text-destructive border-destructive/20";
    default: return "bg-muted text-muted-foreground";
  }
}

function comprehensionTone(c: number) {
  if (c >= 0.8) return "bg-emerald-500";
  if (c >= 0.5) return "bg-amber-500";
  return "bg-rose-500";
}

interface CardProps {
  video: DiscoverVideo;
  onClick: () => void;
  feed?: FeedItem;
  /** Transcript-level coverage for the signed-in learner (browse tab). */
  comprehension?: Comprehension;
}

function VideoCard({ video, onClick, feed, comprehension }: CardProps) {
  return (
    <button
      onClick={onClick}
      aria-label={`فيديو: ${video.title} — ${video.dialect}, ${video.difficulty}`}
      className={cn(
        "rounded-xl overflow-hidden border border-border bg-card",
        "text-left transition-all duration-200",
        "hover:shadow-md hover:border-primary/20 active:scale-[0.98]",
      )}
    >
      <div className="relative aspect-video bg-muted">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play className="h-10 w-10 text-muted-foreground/30" />
          </div>
        )}
        {video.duration_seconds && (
          <span className="absolute bottom-2 right-2 bg-foreground/80 text-background text-xs px-1.5 py-0.5 rounded">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
        {feed && (
          <div className="absolute top-2 left-2 bg-background/90 backdrop-blur text-foreground text-[11px] font-medium px-2 py-0.5 rounded-full border border-border flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            {feed.reason}
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm text-foreground line-clamp-2 mb-2">
          {video.title}
        </h3>
        {feed && (
          <div className="mb-2" title={`الفهم ~ ${Math.round(feed.comprehension * 100)}%`}>
            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full transition-all", comprehensionTone(feed.comprehension))}
                style={{ width: `${Math.max(6, Math.round(feed.comprehension * 100))}%` }}
              />
            </div>
          </div>
        )}
        {/* Browse-tab coverage: measured over the WHOLE transcript against the
            learner's real decks, unlike the feed bar's curated-vocab sample. */}
        {comprehension && (
          <div className="mb-2">
            <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{comprehensionLabel(comprehension.band)}</span>
              <span>تعرف {Math.round(comprehension.coverage * 100)}% من الكلمات</span>
            </div>
            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full transition-all", comprehensionBarClass(comprehension.band))}
                style={{ width: `${Math.max(6, Math.round(comprehension.coverage * 100))}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex gap-1.5 flex-wrap">
          {video.source === "hakiya" && (
            <Badge variant="outline" className="text-xs bg-accent/10 text-accent-foreground border-accent/40">
              عربي · انغماس
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">{DIALECT_LABELS[video.dialect] ?? video.dialect}</Badge>
          <Badge variant="outline" className={cn("text-xs", difficultyColor(video.difficulty))}>
            {DIFFICULTY_LABELS[video.difficulty] ?? video.difficulty}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">{video.platform}</Badge>
        </div>
      </div>
    </button>
  );
}

const Discover = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { user } = useAuth();
  const [tab, setTab] = useState<string>(user ? "feed" : "browse");
  const [seed, setSeed] = useState(() => Math.floor(Date.now() / (15 * 60 * 1000)));
  const { difficulty: levelDifficulty, hasTakenPlacement } = useUserLevel();

  // Browse state
  const [search, setSearch] = useState("");
  const [dialect, setDialect] = useState<string>(activeDialect);
  // Default the difficulty filter to the learner's placement level (still a
  // plain dropdown they can override) instead of always showing everything.
  const [difficulty, setDifficulty] = useState(() =>
    hasTakenPlacement
      ? levelDifficulty.charAt(0).toUpperCase() + levelDifficulty.slice(1)
      : "All"
  );

  const { data: browseVideos, isLoading: isBrowseLoading } = useDiscoverVideos({
    dialect: dialect === "All" ? undefined : dialect,
    difficulty: difficulty === "All" ? undefined : difficulty,
    search: search || undefined,
  });

  // Transcript-level coverage per video, from the decks already in cache.
  // Empty until the learner has saved enough words for it to mean anything.
  const comprehensionMap = useComprehensionMap(browseVideos);
  const [justRightOnly, setJustRightOnly] = useState(false);
  const shelfVideos = useMemo(() => {
    if (!browseVideos) return browseVideos;
    if (!justRightOnly || comprehensionMap.size === 0) return browseVideos;
    // "Just right" = the comprehensible-input sweet spot and above: ≥70% of
    // the transcript's words already known. Unmeasured videos (no transcript
    // yet) are excluded rather than guessed at.
    return browseVideos.filter((v) => {
      const c = comprehensionMap.get(v.id);
      return c !== undefined && c.band !== "challenge";
    });
  }, [browseVideos, justRightOnly, comprehensionMap]);

  const { data: feed, isLoading: isFeedLoading, isFetching: isFeedFetching } = useDiscoverFeed(seed);

  const feedItems = useMemo(() => feed?.items ?? [], [feed]);

  return (
    <AppShell>
      <HomeButton />

      <h1
        className="text-2xl font-bold text-foreground mb-2 inline-flex items-center gap-2"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        اكتشف
        <InfoHint {...PAGE_HINTS["discover"]} size="md" />
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        شاهد فيديوهات بالإنجليزية مع ترجمة عربية متزامنة
      </p>

      <div className="mb-6">
        <ContentRequestBar />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="feed" disabled={!user}>
            <Sparkles className="h-4 w-4 me-1.5" />
            لك
          </TabsTrigger>
          <TabsTrigger value="browse">تصفح</TabsTrigger>
        </TabsList>

        <TabsContent value="feed" className="mt-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">
              {feed?.coldStart
                ? "اختيارات رائجة — أكمل اختبار تحديد المستوى لتخصيصها لك."
                : "مرتبة حسب ما تعرفه وطريقة مشاهدتك."}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeed((s) => s + 1)}
              disabled={isFeedFetching}
            >
              <Shuffle className={cn("h-4 w-4 me-1.5", isFeedFetching && "animate-spin")} />
              خلط
            </Button>
          </div>

          {isFeedLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : feedItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {feedItems.map((item) => (
                <VideoCard
                  key={item.video_id}
                  video={item.video}
                  feed={item}
                  onClick={() => navigate(`/discover/${item.video_id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Sparkles className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">لا توجد اختيارات مخصصة بعد</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                شاهد بعض الفيديوهات واحفظ مفردات لتشغيل صفحتك المخصصة.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="browse" className="mt-0">
          <div className="space-y-3 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن فيديوهات..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
                aria-label="ابحث عن فيديوهات"
              />
            </div>
            <div className="flex gap-2">
              <Select value={dialect} onValueChange={setDialect}>
                <SelectTrigger className="flex-1 min-w-0">
                  <SelectValue placeholder="اللهجة" />
                </SelectTrigger>
                <SelectContent>
                  {DIALECTS.map((d) => (
                    <SelectItem key={d} value={d}>{DIALECT_LABELS[d] ?? d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="flex-1 min-w-0">
                  <SelectValue placeholder="المستوى" />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => (
                    <SelectItem key={d} value={d}>{DIFFICULTY_LABELS[d] ?? d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {comprehensionMap.size > 0 && (
              <Button
                variant={justRightOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setJustRightOnly((v) => !v)}
                aria-pressed={justRightOnly}
                className="gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                مناسب لي تماماً
              </Button>
            )}
          </div>

          {isBrowseLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : shelfVideos && shelfVideos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {shelfVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onClick={() => navigate(`/discover/${video.id}`)}
                  comprehension={comprehensionMap.get(video.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <Play className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">
                {justRightOnly ? "لا شيء في نطاقك المريح بعد" : "لم يتم العثور على فيديوهات"}
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {justRightOnly
                  ? "احفظ مزيداً من الكلمات، أو أوقف الفلتر لتتصفح كل شيء."
                  : "عد لاحقاً لمحتوى جديد"}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
};

export default Discover;
