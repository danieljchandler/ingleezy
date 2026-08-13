-- Create user_follows table for friend/follow relationships
CREATE TABLE public.user_follows (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    follower_id UUID NOT NULL,
    following_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id)
);

-- Create challenges table for user-to-user challenges
CREATE TABLE public.challenges (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    challenger_id UUID NOT NULL,
    challenged_id UUID NOT NULL,
    challenge_type TEXT NOT NULL DEFAULT 'xp_race',
    target_xp INTEGER NOT NULL DEFAULT 100,
    duration_days INTEGER NOT NULL DEFAULT 7,
    status TEXT NOT NULL DEFAULT 'pending',
    challenger_progress INTEGER NOT NULL DEFAULT 0,
    challenged_progress INTEGER NOT NULL DEFAULT 0,
    winner_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
    completed_at TIMESTAMP WITH TIME ZONE,
    CHECK (challenger_id != challenged_id)
);

-- Enable RLS
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

-- User follows policies
CREATE POLICY "Users can view follows involving them or public profiles"
ON public.user_follows FOR SELECT
USING (
    auth.uid() = follower_id OR 
    auth.uid() = following_id OR
    EXISTS (SELECT 1 FROM profiles WHERE user_id = following_id AND show_on_leaderboard = true)
);

CREATE POLICY "Users can follow others"
ON public.user_follows FOR INSERT
WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
ON public.user_follows FOR DELETE
USING (auth.uid() = follower_id);

-- Challenges policies
CREATE POLICY "Users can view their challenges"
ON public.challenges FOR SELECT
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

CREATE POLICY "Users can create challenges"
ON public.challenges FOR INSERT
WITH CHECK (auth.uid() = challenger_id);

CREATE POLICY "Users can update challenges they're part of"
ON public.challenges FOR UPDATE
USING (auth.uid() = challenger_id OR auth.uid() = challenged_id);

-- Add indexes for performance
CREATE INDEX idx_user_follows_follower ON public.user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON public.user_follows(following_id);
CREATE INDEX idx_challenges_challenger ON public.challenges(challenger_id);
CREATE INDEX idx_challenges_challenged ON public.challenges(challenged_id);
CREATE INDEX idx_challenges_status ON public.challenges(status);