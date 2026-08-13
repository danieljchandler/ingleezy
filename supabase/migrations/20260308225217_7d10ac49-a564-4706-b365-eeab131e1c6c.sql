
CREATE TABLE public.human_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_context text NOT NULL,
  ai_response text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_response text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.human_review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own requests"
  ON public.human_review_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own requests"
  ON public.human_review_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all requests"
  ON public.human_review_requests FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can update requests"
  ON public.human_review_requests FOR UPDATE TO authenticated
  USING (is_admin());
