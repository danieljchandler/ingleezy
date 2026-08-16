import { useNavigate } from "react-router-dom";
import { AR } from "@/lib/strings";
import { Check, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { DiscoverPreviewCard } from "@/components/discover/DiscoverPreviewCard";
import { useTodaysVideo } from "@/hooks/useTodaysVideo";
import { markTaskCompletedToday } from "@/lib/todayCompletion";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

/**
 * The home page's lead: today's video.
 *
 * Video is the app's core loop, and it used to sit at the bottom of the home
 * page under everything else — a learner had to scroll past the whole daily
 * queue to reach the one thing they came for. It now opens the page.
 *
 * It stays a member of the daily queue for accounting (the "listening" task —
 * that id is what completions are stored under, so it is kept even though the
 * task now reads as watching), but it renders here instead of as a row, so the
 * queue's "n of m tasks done" still counts it without the title appearing
 * twice on one screen.
 */

interface WatchTodayCardProps {
  /** Whether the queue's video task is already ticked off for today. */
  done?: boolean;
  className?: string;
}

export function WatchTodayCard({ done = false, className }: WatchTodayCardProps) {
  const navigate = useNavigate();
  const { video, isFromAnotherDialect, isLoading } = useTodaysVideo();

  // Nothing published at all — render nothing rather than a dead frame at the
  // very top of the page.
  if (!video) {
    return isLoading ? (
      <div
        className={cn("rounded-2xl border-2 border-primary/10 bg-card animate-pulse", className)}
        style={{ aspectRatio: "4 / 3" }}
        aria-hidden
      />
    ) : null;
  }

  const open = () => {
    // The video page has no completion event of its own, so opening the clip is
    // the signal available — same rule the task row used when it lived in the
    // queue.
    markTaskCompletedToday("listening");
    navigate(`/discover/${video.id}`);
  };

  return (
    <div className={cn("mb-4", className)}>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Play className="h-4 w-4 text-primary fill-primary" aria-hidden />
        </div>
        <h2
          className="text-lg font-bold text-foreground flex items-center gap-1.5"
        >
          {AR.queue.watchVideo}
          <InfoHint
            title={AR.queue.videoHintTitle}
            body={AR.queue.videoHintBody}
          />
        </h2>
        {done && (
          <span className="ms-auto inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
            <Check className="h-3 w-3" aria-hidden />
            {AR.queue.watched}
          </span>
        )}
      </div>

      {isFromAnotherDialect && (
        // Better than hiding the card on a dialect we have not filmed much of
        // yet — but the learner should know why the badge says Egyptian.
        <p className="text-xs text-muted-foreground mb-2">
          Nothing new in your dialect yet — here's a {video.dialect} clip to keep your ear in.
        </p>
      )}

      <DiscoverPreviewCard video={video} onClick={open} />

      <button
        onClick={() => navigate("/discover")}
        className="mt-2 text-xs text-primary font-semibold flex items-center gap-0.5 mx-auto"
      >
        كل المقاطع <ChevronOpen className="h-3 w-3" />
      </button>
    </div>
  );
}
