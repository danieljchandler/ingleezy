-- Create a table for user's personal vocabulary (from transcriptions, etc.)
CREATE TABLE public.user_vocabulary (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    word_arabic TEXT NOT NULL,
    word_english TEXT NOT NULL,
    root TEXT,
    source TEXT DEFAULT 'transcription',
    
    -- SRS fields (same as word_reviews)
    ease_factor NUMERIC NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    next_review_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_reviewed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    -- Prevent duplicate words per user
    UNIQUE(user_id, word_arabic)
);

-- Enable Row Level Security
ALTER TABLE public.user_vocabulary ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own vocabulary" 
ON public.user_vocabulary 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own vocabulary" 
ON public.user_vocabulary 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vocabulary" 
ON public.user_vocabulary 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vocabulary" 
ON public.user_vocabulary 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_user_vocabulary_updated_at
BEFORE UPDATE ON public.user_vocabulary
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for efficient queries
CREATE INDEX idx_user_vocabulary_user_id ON public.user_vocabulary(user_id);
CREATE INDEX idx_user_vocabulary_next_review ON public.user_vocabulary(user_id, next_review_at);