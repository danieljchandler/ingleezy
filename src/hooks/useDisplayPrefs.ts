import { useCallback, useEffect, useState } from "react";
import {
  DisplayPrefs,
  loadDisplayPrefs,
  saveDisplayPrefs,
  subscribeDisplayPrefs,
} from "@/lib/displayPrefs";

/**
 * Reactive hook for global display preferences.
 * Stays in sync across components, tabs, and the Settings editor.
 */
export function useDisplayPrefs() {
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => loadDisplayPrefs());

  useEffect(() => subscribeDisplayPrefs(() => setPrefs(loadDisplayPrefs())), []);

  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDisplayPrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
