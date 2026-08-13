import { useEffect, useState } from "react";

const KEY = "mywords.newCap";
const DEFAULT = 10;
export const NEW_CAP_OPTIONS = [5, 10, 20, 50, 999] as const;
export type NewCapValue = (typeof NEW_CAP_OPTIONS)[number];

function read(): NewCapValue {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseInt(raw, 10) : DEFAULT;
    return (NEW_CAP_OPTIONS as readonly number[]).includes(n)
      ? (n as NewCapValue)
      : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function useNewCardCap() {
  const [cap, setCapState] = useState<NewCapValue>(DEFAULT);

  useEffect(() => {
    setCapState(read());
  }, []);

  const setCap = (n: NewCapValue) => {
    setCapState(n);
    try {
      localStorage.setItem(KEY, String(n));
    } catch {
      /* ignore */
    }
  };

  return { cap, setCap };
}

export const formatCap = (n: number) => (n >= 999 ? "∞" : String(n));
