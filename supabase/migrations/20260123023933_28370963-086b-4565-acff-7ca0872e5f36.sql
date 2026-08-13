-- Create app_role enum for role-based access
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table for admin access control
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check admin role (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- Create topics table
CREATE TABLE public.topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_arabic TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📚',
    gradient TEXT NOT NULL DEFAULT 'from-blue-400 to-blue-600',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on topics
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

-- Create vocabulary_words table
CREATE TABLE public.vocabulary_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES public.topics(id) ON DELETE CASCADE NOT NULL,
    word_arabic TEXT NOT NULL,
    word_english TEXT NOT NULL,
    image_url TEXT,
    audio_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on vocabulary_words
ALTER TABLE public.vocabulary_words ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_roles (only admins can view/manage roles)
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- RLS policies for topics (public read, admin write)
CREATE POLICY "Anyone can view topics"
ON public.topics
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Admins can insert topics"
ON public.topics
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update topics"
ON public.topics
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete topics"
ON public.topics
FOR DELETE
TO authenticated
USING (public.is_admin());

-- RLS policies for vocabulary_words (public read, admin write)
CREATE POLICY "Anyone can view vocabulary words"
ON public.vocabulary_words
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Admins can insert vocabulary words"
ON public.vocabulary_words
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update vocabulary words"
ON public.vocabulary_words
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete vocabulary words"
ON public.vocabulary_words
FOR DELETE
TO authenticated
USING (public.is_admin());

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_topics_updated_at
BEFORE UPDATE ON public.topics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vocabulary_words_updated_at
BEFORE UPDATE ON public.vocabulary_words
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage buckets for flashcard content
INSERT INTO storage.buckets (id, name, public) VALUES ('flashcard-images', 'flashcard-images', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('flashcard-audio', 'flashcard-audio', true);

-- Storage policies for flashcard-images (public read, admin upload/delete)
CREATE POLICY "Anyone can view flashcard images"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'flashcard-images');

CREATE POLICY "Admins can upload flashcard images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'flashcard-images' AND public.is_admin());

CREATE POLICY "Admins can update flashcard images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'flashcard-images' AND public.is_admin())
WITH CHECK (bucket_id = 'flashcard-images' AND public.is_admin());

CREATE POLICY "Admins can delete flashcard images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'flashcard-images' AND public.is_admin());

-- Storage policies for flashcard-audio (public read, admin upload/delete)
CREATE POLICY "Anyone can view flashcard audio"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'flashcard-audio');

CREATE POLICY "Admins can upload flashcard audio"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'flashcard-audio' AND public.is_admin());

CREATE POLICY "Admins can update flashcard audio"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'flashcard-audio' AND public.is_admin())
WITH CHECK (bucket_id = 'flashcard-audio' AND public.is_admin());

CREATE POLICY "Admins can delete flashcard audio"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'flashcard-audio' AND public.is_admin());