import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns true when the signed-in user is a beta tester (or admin).
 * Used to surface the in-app Feedback widget.
 */
export function useBetaTester() {
  const { user } = useAuth();
  const [isBetaTester, setIsBetaTester] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setIsBetaTester(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .rpc("is_beta_tester")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[useBetaTester] check failed:", error.message);
          setIsBetaTester(false);
        } else {
          setIsBetaTester(data === true);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { isBetaTester, loading };
}
