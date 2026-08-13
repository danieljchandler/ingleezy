import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const LABELS = [
  "",
  "Not useful",
  "Somewhat useful",
  "Good",
  "Great",
  "Love it — more like this!",
];

interface VideoRatingProps {
  videoId: string;
  userId: string | undefined;
}

export const VideoRating = ({ videoId, userId }: VideoRatingProps) => {
  const [rating, setRating] = useState<number | null>(null);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch existing rating
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("video_ratings")
      .select("rating")
      .eq("video_id", videoId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setRating(data.rating);
      });
  }, [videoId, userId]);

  const submitRating = async (value: number) => {
    if (!userId) {
      toast.error("Please log in to rate videos");
      return;
    }
    setSaving(true);
    setRating(value);

    const { error } = await supabase
      .from("video_ratings")
      .upsert(
        { video_id: videoId, user_id: userId, rating: value, updated_at: new Date().toISOString() },
        { onConflict: "video_id,user_id" }
      );

    setSaving(false);
    if (error) {
      console.error("Rating error:", error);
      toast.error("Failed to save rating");
      setRating(null);
    } else {
      toast.success(LABELS[value]);
    }
  };

  const displayValue = hoveredStar ?? rating ?? 0;

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <p className="text-sm font-medium text-muted-foreground">
        {rating ? "Your rating" : "Rate this video"}
      </p>
      <div
        className="flex gap-1"
        onMouseLeave={() => setHoveredStar(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={saving}
            onClick={() => submitRating(star)}
            onMouseEnter={() => setHoveredStar(star)}
            className={cn(
              "p-1 transition-transform hover:scale-110 focus:outline-none",
              saving && "opacity-50 pointer-events-none"
            )}
            aria-label={`Rate ${star} out of 5`}
          >
            <Star
              className={cn(
                "h-7 w-7 transition-colors",
                star <= displayValue
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/40"
              )}
            />
          </button>
        ))}
      </div>
      {displayValue > 0 && (
        <p className="text-xs text-muted-foreground animate-in fade-in duration-150">
          {LABELS[displayValue]}
        </p>
      )}
    </div>
  );
};
