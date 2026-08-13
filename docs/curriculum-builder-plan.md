# Internal Curriculum Builder - Implementation Plan

## Overview
Add a chat-based curriculum builder to the admin section where admins can converse with multiple AI models to create lessons, vocabulary, and flashcards — organized by Gulf Arabic dialect and country. Chat conversations are persisted. Lesson content goes through a "preview & approve" flow before being saved to the database.

---

## Phase 1: Database Schema (Supabase Migration)

### New Tables

**`curriculum_chat_sessions`** — Persisted chat conversations
- `id` UUID PK
- `admin_id` UUID FK → auth.users (the admin who owns the session)
- `title` TEXT (auto-generated from first message, editable)
- `target_dialect` TEXT — one of: `'Gulf'`, `'Saudi'`, `'Kuwaiti'`, `'Emirati'`, `'Bahraini'`, `'Qatari'`, `'Omani'`
- `target_stage_id` UUID FK → curriculum_stages (optional — which stage this session is building for)
- `target_cefr` TEXT (optional — e.g. 'A1', 'A2')
- `llm_model` TEXT — last-used model ID for this session
- `status` TEXT DEFAULT `'active'` — `'active'` | `'archived'`
- `created_at`, `updated_at` TIMESTAMPTZ

**`curriculum_chat_messages`** — Individual messages in a chat
- `id` UUID PK
- `session_id` UUID FK → curriculum_chat_sessions ON DELETE CASCADE
- `role` TEXT — `'user'` | `'assistant'` | `'system'`
- `content` TEXT — the message text (markdown supported)
- `llm_model` TEXT — which model generated this response (null for user messages)
- `structured_output` JSONB — if the assistant produced a lesson/vocab preview, the parsed JSON goes here
- `output_type` TEXT — `null` | `'lesson_preview'` | `'vocab_preview'` | `'flashcard_preview'`
- `created_at` TIMESTAMPTZ

**`curriculum_chat_approvals`** — Track what was approved from chat into real curriculum
- `id` UUID PK
- `message_id` UUID FK → curriculum_chat_messages
- `session_id` UUID FK → curriculum_chat_sessions
- `approval_type` TEXT — `'lesson'` | `'vocabulary'` | `'flashcard'`
- `target_lesson_id` UUID FK → lessons (the created/updated lesson)
- `approved_by` UUID FK → auth.users
- `approved_at` TIMESTAMPTZ DEFAULT now()

RLS: All tables admin-only (read + write gated by `is_admin()`).

---

## Phase 2: Edge Function — `curriculum-chat`

A new Supabase edge function that handles the multi-LLM chat.

### Request
```json
{
  "messages": [{ "role": "user|assistant|system", "content": "..." }],
  "model": "gemini-2.5-flash|qwen3-235b|gemma-3-12b|fanar|falcon-h1r",
  "dialect": "Saudi|Kuwaiti|Emirati|Bahraini|Qatari|Omani|Gulf",
  "stage_context": { "name": "Foundations", "cefr": "Pre-A1 → A1" },
  "mode": "chat|generate_lesson|generate_vocab"
}
```

### Behavior
- Routes to the correct LLM based on `model` field (reuses the existing `callAI`/`callFanar` patterns from `how-do-i-say`)
- Injects a curriculum-building system prompt that understands:
  - The 6-stage curriculum structure
  - Gulf Arabic dialect specialization
  - Lesson JSON schema (title, vocab words, flashcard specs, etc.)
  - Country-specific vocabulary differences
- When `mode` is `generate_lesson` or `generate_vocab`, appends instructions asking the LLM to return structured JSON alongside natural language explanation
- Streams response back (or returns full response if streaming not supported by gateway)
- Logs to `llm_usage_logs`

### System Prompt Strategy
The system prompt will include:
1. The curriculum stage descriptions (from `curriculum_stages` table)
2. The target dialect and country context
3. The output JSON schema for lessons/vocabulary
4. Instructions to provide cultural notes, dialect-specific word choices, and transliterations
5. Knowledge of what country-specific differences exist (e.g., Saudi "إيش" vs Kuwaiti "شنو" for "what")

---

## Phase 3: Frontend — Chat UI Components

### New Files

**`src/pages/admin/CurriculumBuilder.tsx`** — Main page
- Split layout: sidebar (session list) + main area (chat)
- Header with dialect selector dropdown and model selector dropdown
- "New Session" button
- Session list showing title, dialect badge, date, status

**`src/components/admin/curriculum-builder/ChatSidebar.tsx`** — Session list
- Lists all `curriculum_chat_sessions` for the admin
- Search/filter by dialect, stage, date
- Click to load a session
- Archive/delete sessions

**`src/components/admin/curriculum-builder/ChatWindow.tsx`** — The chat interface
- Message list with role-based styling (user right-aligned, assistant left-aligned)
- Markdown rendering for assistant messages (using existing Markdown or a lightweight renderer)
- Auto-scroll to bottom on new messages
- "Generating..." indicator with model name badge

**`src/components/admin/curriculum-builder/ChatInput.tsx`** — Message composer
- Textarea with Shift+Enter for newlines, Enter to send
- Quick action buttons above input:
  - "Generate Lesson" — pre-fills a structured prompt asking for a full lesson
  - "Generate Vocabulary" — asks for a word list for a topic
  - "Generate Flashcards" — asks for flashcard-ready content
  - "Compare Dialects" — asks the LLM to show how a concept differs across Gulf countries
- Model selector chip (shows current model, click to switch mid-conversation)

**`src/components/admin/curriculum-builder/LessonPreviewCard.tsx`** — Rich preview
- When assistant message has `output_type === 'lesson_preview'`, render a structured card:
  - Lesson title (Arabic + English)
  - Stage & CEFR level
  - Dialect badge
  - Word count
  - Vocabulary table (Arabic | Transliteration | English | Category)
  - Cultural notes section
  - "Approve & Add to Curriculum" button
  - "Edit Before Saving" button (opens inline editor)
  - "Regenerate" button

**`src/components/admin/curriculum-builder/VocabPreviewCard.tsx`** — Vocabulary preview
- Table of words with: Arabic, English, transliteration, category, teaching note
- Checkboxes to select which words to include
- "Add Selected to Lesson" dropdown (pick existing lesson or create new)
- Option to auto-generate audio (ElevenLabs TTS) and images for selected words

**`src/components/admin/curriculum-builder/DialectSelector.tsx`** — Country/dialect picker
- Gulf (generic) + 6 country-specific options with flag icons
- Sets context for the entire session
- Shows on session creation and in the chat header

**`src/components/admin/curriculum-builder/ModelSelector.tsx`** — LLM picker
- Dropdown showing available models:
  - Gemini 2.5 Flash (Lovable) — fast, reliable
  - Qwen3-235B (OpenRouter) — strong reasoning
  - Gemma 3 12B (OpenRouter) — good Arabic
  - Fanar — Gulf Arabic specialist
  - Falcon-H1R — Arabic-native model
- Shows which model generated each message (badge on message)
- Can switch models mid-conversation to compare outputs

---

## Phase 4: Hooks & State Management

**`src/hooks/useCurriculumChat.ts`** — Core chat hook
- Manages `sessions` query (list), `activeSession` query, `messages` query
- `sendMessage(content, mode?)` mutation — persists user message, calls edge function, persists response
- `createSession(dialect, stageId?)` mutation
- `switchModel(model)` — updates session's `llm_model`
- `archiveSession(id)` mutation
- Handles loading/streaming state
- Parses structured output from responses and sets `output_type`

**`src/hooks/useCurriculumApproval.ts`** — Approval flow
- `approveLesson(messageId, lessonData)` — creates lesson + vocabulary in DB, records approval
- `approveVocabulary(messageId, words[], targetLessonId)` — inserts words into existing lesson
- `generateAudio(words[])` — calls ElevenLabs TTS for each word (with Farasa diacritization first)
- `generateImages(words[])` — calls generate-flashcard-image for concrete/action words

---

## Phase 5: Routing & Navigation

Add to `App.tsx`:
```tsx
<Route path="curriculum-builder" element={<CurriculumBuilder />} />
<Route path="curriculum-builder/:sessionId" element={<CurriculumBuilder />} />
```

Add to admin Dashboard quick actions — a prominent card:
- "Curriculum Builder" with a chat/sparkle icon
- Description: "Chat with AI to create lessons and vocabulary"

---

## Phase 6: Creative Additions / My Suggestions

### 1. Dialect Comparison Mode
When creating vocabulary, the admin can ask "How does this lesson differ for Saudi vs Kuwaiti?" and the LLM returns a side-by-side comparison table showing dialect-specific word choices, pronunciation differences, and cultural context. This gets stored in the lesson's JSONB metadata.

### 2. Curriculum Gap Analysis
A button that analyzes the current curriculum state (stages, lessons, word counts) and asks the LLM: "What topics/vocabulary are missing for Stage X targeting CEFR Y?" — gives the admin a roadmap of what to build next.

### 3. Quick Templates
Pre-built prompt templates for common lesson types:
- "Greetings & Introductions for [country]"
- "Restaurant & Food vocabulary"
- "Numbers, Dates & Time"
- "Family & Relationships"
- "Workplace Arabic"
- "Slang & Informal Speech for [country]"

### 4. Auto-Enrichment Pipeline
After a lesson is approved, automatically:
1. Run Farasa diacritization on all Arabic words
2. Generate ElevenLabs audio for each word
3. Run CAMeL dialect verification to confirm the words match the target dialect
4. Generate flashcard images for concrete/action words
This runs as a background pipeline so the admin doesn't have to trigger each step manually.

### 5. Export/Import Chat Context
Allow admins to export a chat session as JSON (for backup or sharing with other admins) and import sessions. Useful if building curriculum collaboratively.

---

## Implementation Order

1. **Migration** — Create the 3 new tables
2. **Edge function** — `curriculum-chat` with multi-LLM routing
3. **Core components** — ChatWindow, ChatInput, ChatSidebar, ModelSelector, DialectSelector
4. **Hooks** — useCurriculumChat, useCurriculumApproval
5. **Preview cards** — LessonPreviewCard, VocabPreviewCard with approve flow
6. **Page & routing** — CurriculumBuilder page, add routes, dashboard card
7. **Auto-enrichment** — Farasa + ElevenLabs + image generation pipeline
8. **Creative features** — Gap analysis, dialect comparison, templates

---

## Files to Create
- `supabase/migrations/20260304100000_curriculum_chat.sql`
- `supabase/functions/curriculum-chat/index.ts`
- `src/pages/admin/CurriculumBuilder.tsx`
- `src/components/admin/curriculum-builder/ChatSidebar.tsx`
- `src/components/admin/curriculum-builder/ChatWindow.tsx`
- `src/components/admin/curriculum-builder/ChatInput.tsx`
- `src/components/admin/curriculum-builder/LessonPreviewCard.tsx`
- `src/components/admin/curriculum-builder/VocabPreviewCard.tsx`
- `src/components/admin/curriculum-builder/DialectSelector.tsx`
- `src/components/admin/curriculum-builder/ModelSelector.tsx`
- `src/hooks/useCurriculumChat.ts`
- `src/hooks/useCurriculumApproval.ts`

## Files to Modify
- `src/App.tsx` — Add routes
- `src/pages/admin/Dashboard.tsx` — Add quick action card
- `src/integrations/supabase/types.ts` — Will need regeneration after migration
