import { useCallback, useEffect, useState } from "react";
import {
  loadRootFamiliesEnabled,
  saveRootFamiliesEnabled,
  subscribeRootFamilyPrefs,
} from "@/lib/rootFamilyPrefs";

/** Reactive hook for the global "show related words from the same root" preference. */
export function useRootFamilyPrefs() {
  const [enabled, setEnabled] = useState<boolean>(() => loadRootFamiliesEnabled());

  useEffect(() => subscribeRootFamilyPrefs(() => setEnabled(loadRootFamiliesEnabled())), []);

  const setEnabledPersist = useCallback((value: boolean) => {
    setEnabled(value);
    saveRootFamiliesEnabled(value);
  }, []);

  return { enabled, setEnabled: setEnabledPersist };
}
