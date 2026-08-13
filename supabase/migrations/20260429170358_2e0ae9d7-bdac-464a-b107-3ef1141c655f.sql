CREATE TABLE public.bible_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  book_usfm TEXT NOT NULL,
  book_name TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER NOT NULL DEFAULT 1,
  verse_end INTEGER NOT NULL DEFAULT 1,
  dialect TEXT NOT NULL DEFAULT 'Gulf',
  dialect_verses JSONB NOT NULL DEFAULT '[]'::jsonb,
  formal_verses JSONB NOT NULL DEFAULT '[]'::jsonb,
  english_verses JSONB NOT NULL DEFAULT '[]'::jsonb,
  cultural_note TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bible_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bible readers can view published lessons"
ON public.bible_lessons
FOR SELECT
USING (
  (published = true AND (public.has_role(auth.uid(), 'bible_reader') OR public.has_role(auth.uid(), 'admin')))
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can insert bible lessons"
ON public.bible_lessons
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update bible lessons"
ON public.bible_lessons
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete bible lessons"
ON public.bible_lessons
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_bible_lessons_updated_at
BEFORE UPDATE ON public.bible_lessons
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_bible_lessons_dialect_published ON public.bible_lessons (dialect, published, display_order);