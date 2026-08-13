-- Policies on public tables call is_admin()/has_role()/is_recorder() in their USING
-- clauses. These functions had EXECUTE for `authenticated` only, so any request
-- that reaches PostgREST as `anon` (token not yet attached / just expired)
-- aborted with "permission denied for function is_admin" instead of simply
-- returning no rows. That surfaced as flashcard decks failing to load.
-- All three are SECURITY DEFINER and resolve auth.uid() -> NULL for anon, so
-- granting EXECUTE is safe: they return false.
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_recorder() TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon;