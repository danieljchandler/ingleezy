import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

export interface UnknownWord {
  arabic: string;
  sentence_text?: string;
  sentence_english?: string;
}

interface MarkUnknownsContextValue {
  /** Mark-mode toggle (per-page). Pages turn this on/off; default off. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Map keyed by the cleaned Arabic word. */
  unknowns: Map<string, UnknownWord>;
  isMarked: (word: string) => boolean;
  toggle: (word: UnknownWord) => void;
  clear: () => void;
}

const MarkUnknownsContext = createContext<MarkUnknownsContextValue | null>(null);

export const MarkUnknownsProvider = ({ children }: { children: ReactNode }) => {
  const [enabled, setEnabled] = useState(false);
  const [unknowns, setUnknowns] = useState<Map<string, UnknownWord>>(new Map());

  const isMarked = useCallback((word: string) => unknowns.has(word), [unknowns]);

  const toggle = useCallback((word: UnknownWord) => {
    const key = word.arabic.trim();
    if (!key) return;
    setUnknowns((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { ...word, arabic: key });
      return next;
    });
  }, []);

  const clear = useCallback(() => setUnknowns(new Map()), []);

  const value = useMemo<MarkUnknownsContextValue>(
    () => ({ enabled, setEnabled, unknowns, isMarked, toggle, clear }),
    [enabled, unknowns, isMarked, toggle, clear]
  );

  return <MarkUnknownsContext.Provider value={value}>{children}</MarkUnknownsContext.Provider>;
};

/** Safe hook — returns no-op defaults when no provider is present. */
export const useMarkUnknowns = (): MarkUnknownsContextValue => {
  const ctx = useContext(MarkUnknownsContext);
  if (ctx) return ctx;
  return {
    enabled: false,
    setEnabled: () => {},
    unknowns: new Map(),
    isMarked: () => false,
    toggle: () => {},
    clear: () => {},
  };
};
