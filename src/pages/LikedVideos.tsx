import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useLikedVideos } from "@/hooks/useVideoLikes";
import { cn } from "@/lib/utils";
import { Heart, Play, Loader2 } from "lucide-react";
import { formatDuration } from "@/lib/videoEmbed";
import type { DiscoverVideo } from "@/hooks/useDiscoverVideos";
import { arCount } from "@/lib/strings";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

const LikedVideoCard = ({
  video,
  onClick,
}: {
  video: DiscoverVideo;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full rounded-2xl overflow-hidden border border-border bg-card text-left",
      "transition-all duration-200 hover:border-primary/40 hover:shadow-md active:scale-[0.99]",
      "flex gap-0"
    )}
  >
    {/* Thumbnail */}
    <div className="relative w-28 shrink-0 bg-muted overflow-hidden">
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="h-8 w-8 text-muted-foreground/30" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/10" />
      {video.duration_seconds && (
        <div className="absolute bottom-1 right-1">
          <span className="text-xs font-medium text-white bg-black/60 px-1.5 py-0.5 rounded">
            {formatDuration(video.duration_seconds)}
          </span>
        </div>
      )}
    </div>

    {/* Content */}
    <div className="flex-1 p-3 min-w-0">
      <p
        className="font-semibold text-foreground text-sm line-clamp-2 mb-1"
        style={{ fontFamily: "'Montserrat', sans-serif" }}
      >
        {video.title}
      </p>
      {video.title_arabic && (
        <p
          className="text-xs text-muted-foreground line-clamp-1 mb-2"
          dir="rtl"
          style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
        >
          {video.title_arabic}
        </p>
      )}
      <div className="flex gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
        <Badge variant="outline" className="text-xs">{video.difficulty}</Badge>
      </div>
    </div>
  </button>
);

const LikedVideos = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: videos, isLoading } = useLikedVideos();

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center">
          <Heart className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            سجّل الدخول لرؤية الفيديوهات التي أعجبتك
          </h2>
          <Button onClick={() => navigate("/auth")}>تسجيل الدخول</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Heart className="h-6 w-6 text-primary fill-primary/30" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">فيديوهات أعجبتني <InfoHint {...PAGE_HINTS["liked-videos"]} /></h1>
            <p className="text-sm text-muted-foreground">
              {videos?.length
                ? arCount(videos.length, {
                    one: "فيديو واحد أعجبك",
                    two: "فيديوهان أعجباك",
                    few: "فيديوهات أعجبتك",
                    many: "فيديو أعجبك",
                  })
                : "الفيديوهات التي أعجبتك"}
            </p>
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : videos && videos.length > 0 ? (
          <div className="space-y-3">
            {videos.map((video) => (
              <LikedVideoCard
                key={video.id}
                video={video}
                onClick={() => navigate(`/discover/${video.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Heart className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">لا فيديوهات بعد</p>
            <p className="text-sm text-muted-foreground/70 mb-4">
              المس ❤️ على أي فيديو ليُحفظ هنا
            </p>
            <Button onClick={() => navigate("/discover")}>
              <Play className="h-4 w-4 me-2" />
              تصفّح المقاطع
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default LikedVideos;
