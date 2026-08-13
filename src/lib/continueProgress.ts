// Tracks the user's last activity so the Home screen can offer
// a "Continue where you left off" card.

export type ContinueKind = "story" | "video" | "lesson";

export interface ContinueEntry {
  kind: ContinueKind;
  /** Internal route to navigate to (e.g. "/stories/abc"). */
  route: string;
  /** Primary label shown on the card (story / video / topic title). */
  title: string;
  /** Secondary label (e.g. "Scene 3 of 8", "at 1:24", "Word 4 of 5"). */
  subtitle?: string;
  /** Dialect this entry belongs to. Used to scope the card to the active module. */
  dialect?: string;
  updatedAt: number;
}

const STORAGE_KEY = "hakiya:continue:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_WRITE_INTERVAL_MS = 5000; // throttle noisy writers (e.g. video timer)

let lastWriteAt = 0;
let lastWriteKey = "";

export function recordContinue(entry: Omit<ContinueEntry, "updatedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${entry.kind}:${entry.route}:${entry.subtitle ?? ""}:${entry.dialect ?? ""}`;
    const now = Date.now();
    if (key === lastWriteKey && now - lastWriteAt < MIN_WRITE_INTERVAL_MS) return;
    lastWriteKey = key;
    lastWriteAt = now;
    const full: ContinueEntry = { ...entry, updatedAt: now };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
    // Notify same-tab listeners (the storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent("hakiya:continue-changed"));
  } catch {
    // quota / private mode — ignore
  }
}

export function getContinue(): ContinueEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContinueEntry;
    if (!parsed || typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearContinue(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("hakiya:continue-changed"));
  } catch {}
}

export function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
