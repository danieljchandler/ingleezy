-- Create video_likes table for simple like/unlike functionality
CREATE TABLE public.video_likes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    video_id UUID NOT NULL REFERENCES public.discover_videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(video_id, user_id)
);

-- Enable RLS
ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own likes"
ON public.video_likes FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can view likes on published videos for counts"
ON public.video_likes FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.discover_videos 
        WHERE id = video_likes.video_id AND published = true
    )
);

CREATE POLICY "Users can like videos"
ON public.video_likes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unlike videos"
ON public.video_likes FOR DELETE
USING (auth.uid() = user_id);

-- Index for performance
CREATE INDEX idx_video_likes_video_id ON public.video_likes(video_id);
CREATE INDEX idx_video_likes_user_id ON public.video_likes(user_id);