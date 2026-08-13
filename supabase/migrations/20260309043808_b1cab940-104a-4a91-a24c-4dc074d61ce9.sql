
-- Vocab Battles table for async turn-based battles
CREATE TABLE public.vocab_battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id uuid NOT NULL,
  opponent_id uuid NOT NULL,
  -- Questions are stored as JSONB array of {word_arabic, word_english, choices[], correct_index}
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_count integer NOT NULL DEFAULT 10,
  time_limit_seconds integer NOT NULL DEFAULT 60,
  -- Scores (null until played)
  challenger_score integer,
  challenger_time_ms integer,
  challenger_played_at timestamptz,
  opponent_score integer,
  opponent_time_ms integer,
  opponent_played_at timestamptz,
  -- Status: pending (waiting for opponent), in_progress (opponent playing), completed
  status text NOT NULL DEFAULT 'pending',
  winner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  completed_at timestamptz,
  CONSTRAINT different_players CHECK (challenger_id <> opponent_id)
);

-- Enable RLS
ALTER TABLE public.vocab_battles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view battles they're part of" ON public.vocab_battles
  FOR SELECT USING (auth.uid() = challenger_id OR auth.uid() = opponent_id);

CREATE POLICY "Users can create battles as challenger" ON public.vocab_battles
  FOR INSERT WITH CHECK (auth.uid() = challenger_id);

CREATE POLICY "Users can update battles they're part of" ON public.vocab_battles
  FOR UPDATE USING (auth.uid() = challenger_id OR auth.uid() = opponent_id);

-- Index for faster queries
CREATE INDEX vocab_battles_challenger_idx ON public.vocab_battles(challenger_id);
CREATE INDEX vocab_battles_opponent_idx ON public.vocab_battles(opponent_id);
CREATE INDEX vocab_battles_status_idx ON public.vocab_battles(status);
