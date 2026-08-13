
-- Curriculum chat sessions table
CREATE TABLE public.curriculum_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New Session',
  target_dialect text NOT NULL DEFAULT 'Gulf',
  target_stage_id uuid NULL,
  target_cefr text NULL,
  llm_model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Curriculum chat messages table
CREATE TABLE public.curriculum_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.curriculum_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL DEFAULT '',
  llm_model text NULL,
  structured_output jsonb NULL,
  output_type text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.curriculum_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies: only admins can access
CREATE POLICY "Admins can manage chat sessions"
  ON public.curriculum_chat_sessions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can manage chat messages"
  ON public.curriculum_chat_messages
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Indexes
CREATE INDEX idx_chat_sessions_admin ON public.curriculum_chat_sessions(admin_id);
CREATE INDEX idx_chat_messages_session ON public.curriculum_chat_messages(session_id);

-- Updated_at trigger
CREATE TRIGGER update_curriculum_chat_sessions_updated_at
  BEFORE UPDATE ON public.curriculum_chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
