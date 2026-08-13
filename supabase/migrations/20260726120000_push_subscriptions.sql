-- Web push subscriptions, so a reminder can reach a learner who hasn't opened
-- the app.
--
-- src/hooks/useSmartNotifications.ts already works out what's worth saying
-- ("12 cards due", "your streak ends today") but it runs as a TanStack
-- query inside the app — so it can only remind someone who is already looking
-- at it. That is the one person who doesn't need reminding.
--
-- One row per (user, endpoint): a learner may be subscribed on a phone and a
-- laptop, and each browser instance has its own endpoint and keypair.

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- The push service URL the browser gave us. Unique per browser install.
  endpoint text NOT NULL,
  -- Encryption material from PushSubscription.getKey().
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- IANA zone from the browser, so a "you haven't reviewed today" nudge fires
  -- in the learner's evening rather than at UTC midnight.
  timezone text,
  user_agent text,
  -- Cleared when the push service reports the subscription gone (404/410), so
  -- dead endpoints stop being retried without losing the record immediately.
  disabled_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subscriptions_active
  ON public.push_subscriptions (user_id)
  WHERE disabled_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Owner-only throughout. The sender runs under the service role, which bypasses
-- these — a user must never be able to read another learner's endpoint, since
-- possession of an endpoint plus keys is enough to push to that device.
CREATE POLICY "Users can view their own push subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own push subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own push subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own push subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
