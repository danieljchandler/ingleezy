-- Saved Ask AI conversations.
--
-- The global assistant chat is ephemeral by design — it lives in memory and
-- resets on reload. This table is the opt-in exception: a learner who wants to
-- keep a good explanation taps "Save conversation" and gets it back later at
-- /saved-chats. Nothing is written unless they ask.
--
-- Messages are stored as one jsonb array rather than a row per message: a
-- saved chat is re-read whole and never queried by individual message, and an
-- update on re-save replaces the array in place.

CREATE TABLE public.saved_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dialect text NOT NULL,
  -- First user message, truncated client-side; renameable from the list page.
  title text NOT NULL,
  -- The sentence the chat was opened about, when there was one: {arabic, english}.
  seed jsonb,
  -- Snapshot of where the chat happened: {route, title}.
  page_context jsonb,
  -- [{role: "user" | "assistant", content: text}]
  messages jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_chat_conversations_user
  ON public.saved_chat_conversations (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_chat_conversations TO authenticated;
GRANT ALL ON public.saved_chat_conversations TO service_role;

ALTER TABLE public.saved_chat_conversations ENABLE ROW LEVEL SECURITY;

-- Owner-only throughout: a conversation can quote anything the learner was
-- reading or asking, so it is theirs alone.
CREATE POLICY "Users can view their own saved conversations"
  ON public.saved_chat_conversations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saved conversations"
  ON public.saved_chat_conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved conversations"
  ON public.saved_chat_conversations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved conversations"
  ON public.saved_chat_conversations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
