import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bookmark, MessageCircleQuestion, Captions, RotateCcw, Play, Flame } from "lucide-react";
import { AppDock } from "@/components/shell/AppDock";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { useDiscoverFeed, type FeedItem } from "@/hooks/useDiscoverFeed";
import { useCurrentStreak } from "@/hooks/useGamification";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { useAuth } from "@/hooks/useAuth";
import { IngleezyMark } from "@/components/brand/IngleezyMark";
import { AppShell } from "@/components/layout/AppShell";
import { LandingHero } from "@/components/LandingHero";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";

/**
 * The home screen: real English, one clip at a time.
 *
 * The app used to open on a checklist — a greeting, a goal ring, and four
 * task rows. That is a fine dashboard and a poor front door for something
 * people are meant to open out of habit. This opens on content, the way every
 * app this audience already uses does, and the tasks move to the chooser.
 *
 * Vertical scroll moves through clips. A horizontal swipe toward the start
 * edge opens the chooser — see useSwipeSurfaces for why that direction is the
 * forward one in an RTL app.
 *
 * The action rail is where the old hub lists went. "Transcribe" and "Ask" were
 * destinations you navigated to and then had to feed with content; here they
 * are buttons on the clip in front of you, which is what they always were.
 */

const Feed = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const { data: feed, isLoading } = useDiscoverFeed(seed);
  const { data: streak } = useCurrentStreak();
  const swipe = useSwipeSurfaces({ onNext: () => navigate("/choose") });

  const items = useMemo(() => feed?.items ?? [], [feed]);

  // A visitor who has never signed in has no feed to show — the recommender
  // is keyed on their history — so the front door stays the landing page for
  // them. Dropping a stranger into an empty video feed would be the worst
  // possible first impression of an app whose whole pitch is the content.
  if (!authLoading && !isAuthenticated) {
    return (
      <AppShell>
        <LandingHero />
        <Footer />
      </AppShell>
    );
  }

  return (
    <div
      {...swipe}
      className="dark relative min-h-[100dvh] bg-black text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Chrome floats over the media rather than pushing it down — the clip
          is the page, so nothing above it should claim vertical space. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <div className="pointer-events-auto">
          <ProfileEmblem hasNews={isAuthenticated} />
        </div>
        <div className="pointer-events-auto flex items-center gap-4 text-sm">
          <span className="border-b-2 border-white pb-0.5 font-semibold">لك</span>
          <Link to="/discover" className="text-white/60">تتابع</Link>
        </div>
        {/* The streak opens your day, not your account. Tapping a number to
            find out where that number came from is the only thing this chip
            can mean, and /today is the page that answers it. */}
        <Link
          to="/today"
          className="pointer-events-auto flex items-center gap-1 font-display text-sm not-italic text-accent"
        >
          <Flame className="h-4 w-4" />
          <span className="tabular-nums">{streak ?? 0}</span>
        </Link>
      </header>

      {isLoading ? (
        <div className="flex min-h-[100dvh] items-center justify-center">
          <IngleezyMark animate className="h-12 text-periwinkle" label="جارٍ التحميل" />
        </div>
      ) : items.length === 0 ? (
        <EmptyFeed />
      ) : (
        <ul className="h-[100dvh] snap-y snap-mandatory overflow-y-auto overscroll-y-contain">
          {items.map((item) => (
            <li key={item.video.id} className="relative h-[100dvh] snap-start snap-always">
              <Clip video={item.video} feed={item} />
            </li>
          ))}
        </ul>
      )}

      <AppDock />
    </div>
  );
};

/**
 * One clip. The thumbnail stands in until the learner taps play — autoplaying
 * an embed per card would burn data on a phone and is the single fastest way
 * to make a feed feel expensive to open.
 */
function Clip({ video, feed }: {
  video: { id: string; title: string; title_arabic: string | null; thumbnail_url: string | null; duration_seconds: number | null };
  feed?: FeedItem;
}) {
  const mins = video.duration_seconds
    ? `${Math.floor(video.duration_seconds / 60)}:${String(video.duration_seconds % 60).padStart(2, "0")}`
    : null;
  // The recommender computes a reason and a coverage number per item and the
  // feed used to throw both away — the one page every learner sees showed
  // none of its own personalisation. The chip is the recommender's voice.
  const coverage = feed && feed.comprehension !== 0.5 ? Math.round(feed.comprehension * 100) : null;

  return (
    <>
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#2C3B74] via-[#3A508E] to-[#7184C6]" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(rgba(6,10,18,0.55)_0%,transparent_22%,transparent_45%,rgba(6,10,18,0.92)_100%)]"
      />

      <Link
        to={`/discover/${video.id}`}
        aria-label={`شغّل ${video.title}`}
        className="absolute inset-0 z-10 grid place-items-center"
      >
        <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 backdrop-blur">
          <Play className="h-7 w-7 fill-white" />
        </span>
      </Link>

      {/* Verbs, applied to this clip. This rail is why the hub lists could go. */}
      <div className="absolute bottom-40 end-2 z-20 grid gap-4">
        <RailButton icon={Bookmark} label="احفظ" to={`/discover/${video.id}`} />
        <RailButton icon={MessageCircleQuestion} label="اسأل" to="/how-do-i-say" />
        <RailButton icon={Captions} label="النص" to={`/discover/${video.id}`} />
        <RailButton icon={RotateCcw} label="أعد" to={`/discover/${video.id}`} />
      </div>

      <div className="absolute inset-x-0 bottom-28 z-20 px-3.5">
        <div className="mb-2 flex items-center gap-1.5">
          {mins && (
            <span className="inline-block rounded bg-black/50 px-2 py-0.5 font-display text-[10px] not-italic tabular-nums">
              {mins}
            </span>
          )}
          {feed?.reason && (
            <span className="inline-block rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/90">
              {feed.reason}
            </span>
          )}
        </div>
        {coverage !== null && (
          <div className="mb-2 h-1 w-24 overflow-hidden rounded-full bg-white/20" title={`تعرف ${coverage}% من كلماته`}>
            <div
              className={cn(
                "h-full rounded-full",
                coverage >= 90 ? "bg-emerald-400" : coverage >= 70 ? "bg-amber-400" : "bg-rose-400",
              )}
              style={{ width: `${Math.max(6, coverage)}%` }}
            />
          </div>
        )}
        <p dir="ltr" className="font-english text-[19px] font-semibold leading-snug">
          {video.title}
        </p>
        {video.title_arabic && (
          <p className="mt-1 text-[13px] text-white/75">{video.title_arabic}</p>
        )}
      </div>
    </>
  );
}

function RailButton({
  icon: Icon,
  label,
  to,
}: {
  icon: typeof Bookmark;
  label: string;
  to: string;
}) {
  return (
    <Link to={to} aria-label={label} className="grid justify-items-center gap-1">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-black/45 backdrop-blur">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[9px] text-white/85">{label}</span>
    </Link>
  );
}

/**
 * An empty feed is the real risk of this whole format — a video app with no
 * videos is worse than a list. So the empty state does not apologise; it hands
 * over the two things that work without a library behind them.
 */
function EmptyFeed() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-8 text-center">
      <IngleezyMark className="h-14 text-periwinkle" />
      <div>
        <p className="text-lg font-semibold">ما فيه مقاطع جديدة الحين</p>
        <p className="mt-1 text-sm text-white/60">
          ارفع مقطعاً تحبه وحوّله لدرس، أو اختر مهارة تتدرب عليها.
        </p>
      </div>
      <div className="flex gap-2.5">
        <Link
          to="/tutor-upload"
          className="rounded-xl bg-periwinkle px-4 py-2.5 text-sm font-semibold text-[#0E131C]"
        >
          ارفع مقطعاً
        </Link>
        <Link
          to="/choose"
          className={cn(
            "rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold",
            "transition-colors active:bg-white/10",
          )}
        >
          اختر مهارة
        </Link>
      </div>
    </div>
  );
}

export default Feed;
