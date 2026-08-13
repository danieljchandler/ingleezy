import { useCallback, useEffect, useState } from "react";
import {
  loadLeechTrackingEnabled,
  saveLeechTrackingEnabled,
  subscribeLeechPrefs,
} from "@/lib/leechPrefs";

/** Reactive hook for the global "track leeches" preference. */
export function useLeechPrefs() {
  const [enabled, setEnabled] = useState<boolean>(() => loadLeechTrackingEnabled());

  useEffect(() => subscribeLeechPrefs(() => setEnabled(loadLeechTrackingEnabled())), []);

  const setEnabledPersist = useCallback((value: boolean) => {
    setEnabled(value);
    saveLeechTrackingEnabled(value);
  }, []);

  return { enabled, setEnabled: setEnabledPersist };
}
