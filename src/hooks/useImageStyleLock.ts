import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hakiya:imageStyleLock:v1";

export interface ImageStyleLock {
  enabled: boolean;
  description: string;
  seed: string;
}

const DEFAULT_DESCRIPTION =
  "warm soft natural lighting, shallow depth of field, photo-realistic stock-photo aesthetic, neutral beige background, centered subject, no text, no watermark";

function generateSeed(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function readState(): ImageStyleLock {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        description: typeof parsed.description === "string" ? parsed.description : DEFAULT_DESCRIPTION,
        seed: typeof parsed.seed === "string" && parsed.seed ? parsed.seed : generateSeed(),
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, description: DEFAULT_DESCRIPTION, seed: generateSeed() };
}

export function useImageStyleLock() {
  const [state, setState] = useState<ImageStyleLock>(() => readState());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const setEnabled = useCallback((enabled: boolean) => {
    setState((s) => ({ ...s, enabled }));
  }, []);

  const setDescription = useCallback((description: string) => {
    setState((s) => ({ ...s, description }));
  }, []);

  const regenerateSeed = useCallback(() => {
    setState((s) => ({ ...s, seed: generateSeed() }));
  }, []);

  return { ...state, setEnabled, setDescription, regenerateSeed };
}

/** Compose final custom_instructions string for the image edge function. */
export function composeStyledInstructions(
  userInstructions: string | undefined,
  lock: Pick<ImageStyleLock, "enabled" | "description" | "seed">,
): string | undefined {
  const base = (userInstructions ?? "").trim();
  if (!lock.enabled) return base || undefined;
  const styleLine = `Maintain a consistent personal aesthetic (style seed ${lock.seed}): ${lock.description.trim()}`;
  return base ? `${base}\n${styleLine}` : styleLine;
}

export const DEFAULT_STYLE_DESCRIPTION = DEFAULT_DESCRIPTION;
