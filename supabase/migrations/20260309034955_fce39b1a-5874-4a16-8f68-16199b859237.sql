
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS preferred_dialect text DEFAULT 'Gulf',
ADD COLUMN IF NOT EXISTS proficiency_level text DEFAULT 'beginner',
ADD COLUMN IF NOT EXISTS weekly_goal text DEFAULT 'casual',
ADD COLUMN IF NOT EXISTS learning_reason text;
