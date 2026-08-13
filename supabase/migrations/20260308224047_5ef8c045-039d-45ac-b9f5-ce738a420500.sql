
CREATE TABLE public.content_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  url text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.content_import_logs ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to insert their own log
CREATE POLICY "Users can insert their own logs"
  ON public.content_import_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow anon inserts (for non-logged-in users, user_id will be null)
CREATE POLICY "Anon users can insert logs"
  ON public.content_import_logs
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- Only admins can read logs
CREATE POLICY "Admins can view all logs"
  ON public.content_import_logs
  FOR SELECT
  TO authenticated
  USING (is_admin());
