import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface PersistedEntry<T> {
  data: T;
  savedAt: number;
}

/**
 * useState wrapper that persists to localStorage with a TTL.
 * On mount, restores the last value if it hasn't expired.
 * Writes to localStorage on every state change (debounced).
 */
export function useSessionPersist<T>(
  key: string,
  initialValue: T,
  ttlMs: number = DEFAULT_TTL_MS
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const storageKey = `session_${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initialValue;
      const entry: PersistedEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.savedAt > ttlMs) {
        localStorage.removeItem(storageKey);
        return initialValue;
      }
      return entry.data;
    } catch {
      return initialValue;
    }
  });

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      const entry: PersistedEntry<T> = { data: value, savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(entry));
    } catch {
      // quota exceeded — ignore
    }
  }, [value, storageKey]);

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return [value, setValue, clear];
}

/**
 * Persist a whole object of state fields at once under a single key.
 * Good for pages with many related state vars.
 */
export function useSessionState<T extends Record<string, any>>(
  key: string,
  initialState: T,
  ttlMs: number = DEFAULT_TTL_MS
): { state: T; update: (partial: Partial<T>) => void; clear: () => void; restored: boolean } {
  const storageKey = `session_${key}`;
  // Whether state was rehydrated from storage. Determined once, synchronously,
  // inside the state initializer below — using a ref avoids updating a second
  // hook during render (a React anti-pattern that caused an extra render).
  const restoredRef = useRef(false);

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initialState;
      const entry: PersistedEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.savedAt > ttlMs) {
        localStorage.removeItem(storageKey);
        return initialState;
      }
      restoredRef.current = true;
      return { ...initialState, ...entry.data };
    } catch {
      return initialState;
    }
  });

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      const entry: PersistedEntry<T> = { data: state, savedAt: Date.now() };
      localStorage.setItem(storageKey, JSON.stringify(entry));
    } catch {}
  }, [state, storageKey]);

  const update = useCallback((partial: Partial<T>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey);
    setState(initialState);
  }, [storageKey, initialState]);

  return { state, update, clear, restored: restoredRef.current };
}
