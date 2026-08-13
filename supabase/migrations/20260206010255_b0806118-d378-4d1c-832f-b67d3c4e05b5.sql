-- Create a table for saved transcriptions
CREATE TABLE public.saved_transcriptions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    raw_transcript_arabic TEXT NOT NULL,
    lines JSONB NOT NULL DEFAULT '[]'::jsonb,
    vocabulary JSONB NOT NULL DEFAULT '[]'::jsonb,
    grammar_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    cultural_context TEXT,
    audio_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.saved_transcriptions ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own transcriptions" 
ON public.saved_transcriptions 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transcriptions" 
ON public.saved_transcriptions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transcriptions" 
ON public.saved_transcriptions 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transcriptions" 
ON public.saved_transcriptions 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_saved_transcriptions_updated_at
BEFORE UPDATE ON public.saved_transcriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();