-- Create a table for user's saved phrases (from "How do I say?" feature)
CREATE TABLE public.user_phrases (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    phrase_arabic TEXT NOT NULL,
    phrase_english TEXT NOT NULL,
    transliteration TEXT,
    notes TEXT,
    source TEXT DEFAULT 'how-do-i-say',

    -- SRS fields (same pattern as user_vocabulary)
    ease_factor NUMERIC NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_reviewed_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- Prevent duplicate phrases per user
    UNIQUE(user_id, phrase_arabic)
);

-- Enable Row Level Security
ALTER TABLE public.user_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own phrases"
ON public.user_phrases
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own phrases"
ON public.user_phrases
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own phrases"
ON public.user_phrases
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own phrases"
ON public.user_phrases
FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for automatic timestamp updates
CREATE TRIGGER update_user_phrases_updated_at
BEFORE UPDATE ON public.user_phrases
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for efficient queries
CREATE INDEX idx_user_phrases_user_id ON public.user_phrases(user_id);
CREATE INDEX idx_user_phrases_next_review ON public.user_phrases(user_id, next_review_at);
