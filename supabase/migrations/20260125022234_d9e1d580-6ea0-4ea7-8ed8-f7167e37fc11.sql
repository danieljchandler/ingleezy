-- Table to track user review progress for each word using SM-2 algorithm
CREATE TABLE public.word_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    word_id UUID NOT NULL REFERENCES public.vocabulary_words(id) ON DELETE CASCADE,
    -- SM-2 algorithm fields
    ease_factor DECIMAL(4,2) NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    -- Review scheduling
    last_reviewed_at TIMESTAMP WITH TIME ZONE,
    next_review_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    -- Ensure one review record per user per word
    UNIQUE(user_id, word_id)
);

-- Enable RLS
ALTER TABLE public.word_reviews ENABLE ROW LEVEL SECURITY;

-- Users can only see their own reviews
CREATE POLICY "Users can view their own reviews"
ON public.word_reviews
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own reviews
CREATE POLICY "Users can insert their own reviews"
ON public.word_reviews
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own reviews
CREATE POLICY "Users can update their own reviews"
ON public.word_reviews
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own reviews
CREATE POLICY "Users can delete their own reviews"
ON public.word_reviews
FOR DELETE
USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_word_reviews_updated_at
BEFORE UPDATE ON public.word_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for efficient due-word queries
CREATE INDEX idx_word_reviews_next_review ON public.word_reviews(user_id, next_review_at);
CREATE INDEX idx_word_reviews_word_id ON public.word_reviews(word_id);