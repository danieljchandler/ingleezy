
-- Content tables for admin-approved learning materials

-- Grammar exercises
CREATE TABLE public.grammar_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'verb-conjugation',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  question_arabic TEXT NOT NULL,
  question_english TEXT NOT NULL,
  grammar_point TEXT NOT NULL DEFAULT '',
  choices JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_index INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily challenges
CREATE TABLE public.daily_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_date DATE,
  challenge_type TEXT NOT NULL DEFAULT 'vocab',
  title TEXT NOT NULL DEFAULT '',
  title_arabic TEXT NOT NULL DEFAULT '',
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listening exercises
CREATE TABLE public.listening_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL DEFAULT 'dictation',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  audio_text TEXT NOT NULL DEFAULT '',
  audio_text_english TEXT NOT NULL DEFAULT '',
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  hint TEXT,
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reading passages
CREATE TABLE public.reading_passages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  title_english TEXT NOT NULL DEFAULT '',
  passage TEXT NOT NULL DEFAULT '',
  passage_english TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  vocabulary JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  cultural_note TEXT,
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vocab game sets
CREATE TABLE public.vocab_game_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type TEXT NOT NULL DEFAULT 'matching',
  title TEXT NOT NULL DEFAULT '',
  word_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty TEXT NOT NULL DEFAULT 'beginner',
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation scenarios
CREATE TABLE public.conversation_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  title_arabic TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'Beginner',
  icon_name TEXT NOT NULL DEFAULT 'MessageCircle',
  example_exchanges JSONB NOT NULL DEFAULT '[]'::jsonb,
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  session_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.grammar_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocab_game_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_scenarios ENABLE ROW LEVEL SECURITY;

-- RLS: Anyone can read published content, admins can manage all
CREATE POLICY "Anyone can view published grammar exercises" ON public.grammar_exercises FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert grammar exercises" ON public.grammar_exercises FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update grammar exercises" ON public.grammar_exercises FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete grammar exercises" ON public.grammar_exercises FOR DELETE USING (is_admin());

CREATE POLICY "Anyone can view published daily challenges" ON public.daily_challenges FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert daily challenges" ON public.daily_challenges FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update daily challenges" ON public.daily_challenges FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete daily challenges" ON public.daily_challenges FOR DELETE USING (is_admin());

CREATE POLICY "Anyone can view published listening exercises" ON public.listening_exercises FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert listening exercises" ON public.listening_exercises FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update listening exercises" ON public.listening_exercises FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete listening exercises" ON public.listening_exercises FOR DELETE USING (is_admin());

CREATE POLICY "Anyone can view published reading passages" ON public.reading_passages FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert reading passages" ON public.reading_passages FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update reading passages" ON public.reading_passages FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete reading passages" ON public.reading_passages FOR DELETE USING (is_admin());

CREATE POLICY "Anyone can view published vocab game sets" ON public.vocab_game_sets FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert vocab game sets" ON public.vocab_game_sets FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update vocab game sets" ON public.vocab_game_sets FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete vocab game sets" ON public.vocab_game_sets FOR DELETE USING (is_admin());

CREATE POLICY "Anyone can view published conversation scenarios" ON public.conversation_scenarios FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "Admins can insert conversation scenarios" ON public.conversation_scenarios FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update conversation scenarios" ON public.conversation_scenarios FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete conversation scenarios" ON public.conversation_scenarios FOR DELETE USING (is_admin());

-- Updated_at triggers
CREATE TRIGGER update_grammar_exercises_updated_at BEFORE UPDATE ON public.grammar_exercises FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_challenges_updated_at BEFORE UPDATE ON public.daily_challenges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_listening_exercises_updated_at BEFORE UPDATE ON public.listening_exercises FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reading_passages_updated_at BEFORE UPDATE ON public.reading_passages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vocab_game_sets_updated_at BEFORE UPDATE ON public.vocab_game_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_conversation_scenarios_updated_at BEFORE UPDATE ON public.conversation_scenarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
