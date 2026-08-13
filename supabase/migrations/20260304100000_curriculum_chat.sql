-- ============================================================
-- Curriculum Chat Tables
-- Persisted chat sessions for the internal curriculum builder.
-- ============================================================

-- 1. Chat sessions
CREATE TABLE public.curriculum_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  target_dialect TEXT NOT NULL DEFAULT 'Gulf'
    CHECK (target_dialect IN ('Gulf','Saudi','Kuwaiti','Emirati','Bahraini','Qatari','Omani')),
  target_stage_id UUID REFERENCES public.curriculum_stages(id) ON DELETE SET NULL,
  target_cefr TEXT,
  llm_model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view chat sessions"
ON public.curriculum_chat_sessions FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can insert chat sessions"
ON public.curriculum_chat_sessions FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update chat sessions"
ON public.curriculum_chat_sessions FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete chat sessions"
ON public.curriculum_chat_sessions FOR DELETE TO authenticated
USING (public.is_admin());

CREATE TRIGGER update_curriculum_chat_sessions_updated_at
BEFORE UPDATE ON public.curriculum_chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Chat messages
CREATE TABLE public.curriculum_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.curriculum_chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  llm_model TEXT,
  structured_output JSONB,
  output_type TEXT CHECK (output_type IS NULL OR output_type IN ('lesson_preview','vocab_preview','flashcard_preview')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view chat messages"
ON public.curriculum_chat_messages FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can insert chat messages"
ON public.curriculum_chat_messages FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete chat messages"
ON public.curriculum_chat_messages FOR DELETE TO authenticated
USING (public.is_admin());

CREATE INDEX idx_chat_messages_session ON public.curriculum_chat_messages(session_id, created_at);

-- 3. Approval tracking
CREATE TABLE public.curriculum_chat_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.curriculum_chat_messages(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.curriculum_chat_sessions(id) ON DELETE CASCADE,
  approval_type TEXT NOT NULL CHECK (approval_type IN ('lesson','vocabulary','flashcard')),
  target_lesson_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL,
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_chat_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view approvals"
ON public.curriculum_chat_approvals FOR SELECT TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can insert approvals"
ON public.curriculum_chat_approvals FOR INSERT TO authenticated
WITH CHECK (public.is_admin());
