import { useCallback, useEffect, useState } from "react";
import {
  loadFeatureHintsEnabled,
  saveFeatureHintsEnabled,
  subscribeFeatureHints,
} from "@/lib/featureHints";

/** Reactive hook for the global "show feature hints" preference. */
export function useFeatureHints() {
  const [enabled, setEnabled] = useState<boolean>(() => loadFeatureHintsEnabled());

  useEffect(() => subscribeFeatureHints(() => setEnabled(loadFeatureHintsEnabled())), []);

  const setEnabledPersist = useCallback((value: boolean) => {
    setEnabled(value);
    saveFeatureHintsEnabled(value);
  }, []);

  return { enabled, setEnabled: setEnabledPersist };
}
