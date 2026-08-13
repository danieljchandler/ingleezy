
REVOKE EXECUTE ON FUNCTION public.award_xp(integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_achievement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_checkpoint(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_review_count() FROM anon;
