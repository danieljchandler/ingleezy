
-- Create institutions table for official teams/schools
CREATE TABLE public.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_arabic text,
  institution_type text NOT NULL DEFAULT 'university',
  logo_url text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add institution columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  ADD COLUMN custom_institution text,
  ADD COLUMN show_institution boolean NOT NULL DEFAULT true;

-- RLS for institutions
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view institutions" ON public.institutions
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage institutions" ON public.institutions
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Update trigger for institutions
CREATE TRIGGER update_institutions_updated_at
  BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
