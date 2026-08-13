import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Checks Bible access via SQL helper:
 * admin OR (bible_reader AND NOT content_reviewer).
 */
export const useBibleAccess = () => {
  const { user, loading: authLoading } = useAuth();
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const checkedUserRef = useRef<string | null>(null);

  const checkAccess = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("has_bible_access");
      if (error) throw error;
      setHasAccess(data === true);
    } catch (err) {
      console.error("Error checking bible access:", err);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setHasAccess(false);
      setLoading(false);
      checkedUserRef.current = null;
      return;
    }

    // Avoid re-checking for the same user on token refresh
    if (checkedUserRef.current === user.id) {
      setLoading(false);
      return;
    }
    checkedUserRef.current = user.id;

    setLoading(true);
    checkAccess();
  }, [user, authLoading, checkAccess]);

  return { hasAccess, loading: authLoading || loading };
};
