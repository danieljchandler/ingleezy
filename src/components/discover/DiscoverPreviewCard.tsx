import { memo } from "react";
import { Play, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/videoEmbed";

export interface DiscoverVideo {
  id: string;
  title: string;
  title_arabic?: string | null;
  thumbnail_url?: string | null;
  dialect?: string | null;
  difficulty?: string | null;
  duration_seconds?: number | null;
  cefr_level?: string | null;
  difficulty_metrics?: { words_per_minute?: number | null; rare_word_ratio?: number | null } | null;
}

interface DiscoverPreviewCardProps {
  video: DiscoverVideo;
  onClick: () => void;
}

export const DiscoverPreviewCard = memo(function DiscoverPreviewCard({ video, onClick }: DiscoverPreviewCardProps) {
  /**
   * The whole card, spoken.
   *
   * A button's label replaces its contents for assistive technology, so
   * "Watch video: Ordering coffee in Doha" was the entire card as far as a
   * screen reader was concerned. The dialect, the level and the running time —
   * the things a sighted learner scans to choose between videos — all sit
   * inside the button and were therefore inaudible. Folding them into the label
   * puts the same information in both places.
   */
  const label = [
    `Watch video: ${video.title}`,
    video.dialect,
    video.cefr_level,
    video.duration_seconds ? formatDuration(video.duration_seconds) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "w-full rounded-2xl overflow-hidden border-2 border-primary/20 bg-card",
        "text-left transition-all duration-200",
        "hover:shadow-xl hover:border-primary/40 active:scale-[0.99]",
        "shadow-lg"
      )}
    >
      {/* Video thumbnail styled like a social feed post */}
      <div className="relative aspect-[4/3] bg-foreground/5 overflow-hidden">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Play className="h-16 w-16 text-muted-foreground/20" aria-hidden="true" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/10 to-transparent" />

        {/* Play indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center backdrop-blur-sm shadow-2xl">
            <Play className="h-7 w-7 text-primary-foreground fill-primary-foreground ml-1" aria-hidden="true" />
          </div>
        </div>

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="font-bold text-lg text-background leading-tight mb-2 line-clamp-2">
            {video.title}
          </h3>
          {video.title_arabic && (
            <p className="text-background/80 text-base mb-3 line-clamp-1" dir="rtl">
              {video.title_arabic}
            </p>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {video.dialect && (
              <Badge className="bg-primary/80 text-primary-foreground border-none text-xs backdrop-blur-sm">
                {video.dialect}
              </Badge>
            )}
            {video.cefr_level ? (
              <Badge className="bg-primary text-primary-foreground border-none text-xs backdrop-blur-sm font-bold">
                {video.cefr_level}
              </Badge>
            ) : video.difficulty && (
              <Badge className="bg-background/20 text-background border-none text-xs backdrop-blur-sm">
                {video.difficulty}
              </Badge>
            )}
            {typeof video.difficulty_metrics?.words_per_minute === "number" && (
              <Badge className="bg-background/20 text-background border-none text-xs backdrop-blur-sm">
                {Math.round(video.difficulty_metrics.words_per_minute)} wpm
              </Badge>
            )}
            {video.duration_seconds && (
              <Badge className="bg-background/20 text-background border-none text-xs backdrop-blur-sm">
                {formatDuration(video.duration_seconds)}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* CTA bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-primary">ابدأ المشاهدة</span>
        </div>
        <ChevronRight className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
    </button>
  );
});
