# Database Restructuring Plan: Lesson Plan Import System

## Goal
Restructure the database from flat topic-based organization to a curriculum hierarchy (Stage → Lesson → Vocabulary) so that uploading a lesson plan xlsx auto-creates a lesson and imports its vocabulary.

## Current State
- `topics` table: flat categories (Colors, Animals, Home, etc.)
- `vocabulary_words` table: words linked to a topic via `topic_id`
- Admin manages topics → words manually

## Target State
- `curriculum_stages` table: top-level groupings (Stage 1: Foundations, Stage 2: Building Blocks, etc.)
- `lessons` table: individual lessons within a stage (replaces `topics` as the organizational unit)
- `vocabulary_words` table: words now linked to a `lesson_id` instead of `topic_id`
- Admin can upload an xlsx lesson plan → lesson + vocab auto-created

## Migration Strategy
- Keep `topics` table intact (rename conceptually to `lessons` via a new table)
- Add `curriculum_stages` and `lessons` tables
- Migrate existing topics into lessons under a "Legacy" or manually-assigned stage
- Add `lesson_id` to `vocabulary_words` alongside `topic_id` (backward-compatible transition)
- Eventually `topic_id` becomes nullable / deprecated

---

## Step-by-Step Implementation

### Step 1: New SQL Migration — Create curriculum tables

Create migration file: `supabase/migrations/20260224000000_curriculum_restructure.sql`

**New tables:**

```sql
-- curriculum_stages: Stage 1 (Foundations), Stage 2 (Building Blocks), etc.
CREATE TABLE public.curriculum_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- "Foundations"
  name_arabic TEXT,                      -- Arabic name
  stage_number INTEGER NOT NULL UNIQUE,  -- 1, 2, 3...
  cefr_level TEXT,                       -- "Pre-A1 → A1"
  description TEXT,                      -- Summary
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- lessons: individual lessons within a stage
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id UUID REFERENCES public.curriculum_stages(id) ON DELETE CASCADE NOT NULL,
  lesson_number INTEGER NOT NULL,         -- 1, 2, 3... within stage
  title TEXT NOT NULL,                    -- "Objects — The World Around You"
  title_arabic TEXT,
  description TEXT,                       -- From lesson overview
  duration_minutes INTEGER,               -- ~15 minutes
  cefr_target TEXT,                       -- "Pre-A1"
  approach TEXT,                          -- "GPA Phase 1 — Here & Now"
  unlock_condition TEXT,                  -- "≥9/12 correct on final tap quiz"
  icon TEXT NOT NULL DEFAULT '📚',
  gradient TEXT NOT NULL DEFAULT 'bg-gradient-green',
  display_order INTEGER NOT NULL DEFAULT 0,
  -- Lesson plan metadata (stored from xlsx import)
  lesson_sequence JSONB DEFAULT '[]'::jsonb,   -- From 🗺️ Lesson Sequence sheet
  image_scenes JSONB DEFAULT '[]'::jsonb,      -- From 🖼️ Image Scenes sheet
  flashcard_spec JSONB DEFAULT '[]'::jsonb,    -- From 🃏 Flashcard Spec sheet
  real_world_prompts JSONB DEFAULT '[]'::jsonb,-- From 💬 Real-World Prompts sheet
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(stage_id, lesson_number)
);
```

**Modify vocabulary_words:**
```sql
-- Add lesson_id column (nullable for backward compat during migration)
ALTER TABLE public.vocabulary_words
  ADD COLUMN lesson_id UUID REFERENCES public.lessons(id) ON DELETE CASCADE,
  ADD COLUMN transliteration TEXT,
  ADD COLUMN category TEXT,
  ADD COLUMN image_scene_description TEXT,
  ADD COLUMN teaching_note TEXT;
```

**Migrate existing data:**
```sql
-- Create a default "Legacy Topics" stage for existing data
INSERT INTO public.curriculum_stages (name, stage_number, description, display_order)
VALUES ('Legacy Topics', 0, 'Vocabulary organized by topic from before curriculum restructuring', 0);

-- Create a lesson for each existing topic
INSERT INTO public.lessons (stage_id, lesson_number, title, title_arabic, icon, gradient, display_order)
SELECT
  (SELECT id FROM public.curriculum_stages WHERE stage_number = 0),
  t.display_order + 1,
  t.name,
  t.name_arabic,
  t.icon,
  t.gradient,
  t.display_order
FROM public.topics t;

-- Link existing vocabulary_words to their new lesson
UPDATE public.vocabulary_words vw
SET lesson_id = l.id
FROM public.topics t
JOIN public.lessons l ON l.title = t.name
  AND l.stage_id = (SELECT id FROM public.curriculum_stages WHERE stage_number = 0)
WHERE vw.topic_id = t.id;
```

**RLS policies** (same pattern as topics/vocabulary_words):
- Public read for both new tables
- Admin write for both new tables

**Triggers:**
- `updated_at` triggers on both new tables

### Step 2: Create Supabase Edge Function for XLSX Import

Create `supabase/functions/import-lesson-plan/index.ts`

This function:
1. Receives an xlsx file upload
2. Parses all 6 sheets (Overview, Vocabulary, Lesson Sequence, Image Scenes, Flashcard Spec, Real-World Prompts)
3. Creates a `lesson` row with metadata from Overview sheet + JSONB data from other sheets
4. Creates `vocabulary_words` rows from the Vocabulary sheet, linked to the new lesson
5. Returns the created lesson ID

**Parsing logic** (based on the xlsx structure we analyzed):
- Sheet "📋 Lesson Overview": Extract stage, lesson number, duration, CEFR target, approach, unlock condition
- Sheet "📖 Vocabulary": Extract word rows (#, Arabic, Translit, English, Category, Image Scene, Teaching Note)
- Sheet "🗺️ Lesson Sequence": Store as JSONB array
- Sheet "🖼️ Image Scenes": Store as JSONB array
- Sheet "🃏 Flashcard Spec": Store as JSONB array
- Sheet "💬 Real-World Prompts": Store as JSONB array

### Step 3: Update TypeScript Types

Update `src/integrations/supabase/types.ts`:
- Add `curriculum_stages` table type
- Add `lessons` table type
- Add new columns to `vocabulary_words` type (`lesson_id`, `transliteration`, `category`, `image_scene_description`, `teaching_note`)

### Step 4: Create New Hooks

**`src/hooks/useStages.ts`** — Fetch all curriculum stages with lesson counts
**`src/hooks/useLesson.ts`** — Fetch a single lesson with its vocabulary words
**`src/hooks/useLessons.ts`** — Fetch lessons for a stage
**`src/hooks/useLessonImport.ts`** — Upload xlsx and trigger import

### Step 5: Update Existing Hooks

- **`useTopics.ts`** → Keep working but now queries `lessons` table (aliased, or we add a compatibility layer)
- **`useAllWords.ts`** → Update join to use `lessons` instead of (or in addition to) `topics`
- **`useTopic.ts`** → Update to fetch from `lessons` table
- **`useReview.ts`** → Update topic joins to use `lessons`

### Step 6: Create Admin Lesson Import Page

**`src/pages/admin/LessonImport.tsx`**:
- File upload dropzone for xlsx
- Preview of parsed data before confirming import
- Stage selector (which stage does this lesson belong to?)
- Auto-detect stage from the "Stage" field in Overview sheet
- Show parsed vocabulary count
- Confirm button → calls edge function → redirects to lesson detail

### Step 7: Create Admin Stage/Lesson Management Pages

**`src/pages/admin/Stages.tsx`** — List all stages, create/edit stages
**`src/pages/admin/StageForm.tsx`** — Create/edit a stage
**`src/pages/admin/Lessons.tsx`** — List lessons in a stage, reorder
**`src/pages/admin/LessonDetail.tsx`** — View lesson metadata + manage vocab

### Step 8: Update Existing Admin Pages

- **Dashboard.tsx** → Show stages/lessons counts instead of just topics
- **Topics.tsx** → Becomes the Lessons list (or redirect to new Lessons page)
- **Words.tsx** → Works with `lesson_id` param instead of `topicId`
- **WordForm.tsx** → Insert with `lesson_id`
- **BulkWordImport.tsx** → Works with `lesson_id`

### Step 9: Update Frontend Learning Pages

- **Index.tsx** → Navigate to stages/lessons instead of flat topic list
- **Learn.tsx** → Accept `lessonId` param, fetch from lessons table
- **Quiz.tsx** → Accept `lessonId` param
- **TopicCard.tsx** → Rename/adapt to LessonCard or keep compatible

### Step 10: Update App Routes

```tsx
// New routes
<Route path="/stages" element={<Stages />} />
<Route path="/stages/:stageId" element={<StageLessons />} />
<Route path="/learn/:lessonId" element={<Learn />} />

// Admin routes
<Route path="stages" element={<AdminStages />} />
<Route path="stages/new" element={<StageForm />} />
<Route path="stages/:stageId/edit" element={<StageForm />} />
<Route path="lessons" element={<AdminLessons />} />
<Route path="lessons/import" element={<LessonImport />} />
<Route path="lessons/:lessonId" element={<LessonDetail />} />
<Route path="lessons/:lessonId/words" element={<Words />} />
<Route path="lessons/:lessonId/words/new" element={<WordForm />} />
<Route path="lessons/:lessonId/words/:wordId/edit" element={<WordForm />} />
<Route path="lessons/:lessonId/words/bulk" element={<BulkWordImport />} />
```

---

## File Change Summary

### New Files
1. `supabase/migrations/20260224000000_curriculum_restructure.sql`
2. `supabase/functions/import-lesson-plan/index.ts`
3. `src/hooks/useStages.ts`
4. `src/hooks/useLesson.ts`
5. `src/hooks/useLessons.ts`
6. `src/hooks/useLessonImport.ts`
7. `src/pages/admin/LessonImport.tsx`
8. `src/pages/admin/Stages.tsx`
9. `src/pages/admin/StageForm.tsx`

### Modified Files
1. `src/integrations/supabase/types.ts` — Add new table types
2. `src/hooks/useTopics.ts` — Query lessons table
3. `src/hooks/useAllWords.ts` — Join with lessons
4. `src/hooks/useTopic.ts` — Fetch from lessons
5. `src/hooks/useReview.ts` — Update joins
6. `src/pages/Index.tsx` — Stage/lesson navigation
7. `src/pages/Learn.tsx` — Use lessonId
8. `src/pages/Quiz.tsx` — Use lessonId
9. `src/pages/admin/Dashboard.tsx` — Show stages/lessons stats + import action
10. `src/pages/admin/Words.tsx` — Use lessonId param
11. `src/pages/admin/WordForm.tsx` — Use lessonId param
12. `src/pages/admin/BulkWordImport.tsx` — Use lessonId param
13. `src/App.tsx` — Add new routes
14. `src/components/design-system/TopicCard.tsx` — Minor updates for lesson compat
