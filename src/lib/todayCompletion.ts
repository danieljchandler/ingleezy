// Per-day task completion tracking via localStorage.
// Keyed by YYYY-MM-DD so it auto-resets at midnight (local time).

const KEY_PREFIX = "today.completed.";
const GOAL_KEY = "today.goal";
const DEFAULT_GOAL = 100;

const todayKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${KEY_PREFIX}${y}-${m}-${day}`;
};

const safeRead = (): Set<string> => {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
};

const safeWrite = (set: Set<string>) => {
  try {
    localStorage.setItem(todayKey(), JSON.stringify([...set]));
  } catch {
    // ignore (private mode, iframe, etc.)
  }
};

export const isTaskCompletedToday = (taskId: string): boolean => {
  return safeRead().has(taskId);
};

export const markTaskCompletedToday = (taskId: string) => {
  const set = safeRead();
  set.add(taskId);
  safeWrite(set);
  window.dispatchEvent(new CustomEvent("today:tasks-changed"));
};

export const getCompletedToday = (): string[] => [...safeRead()];

export const getDailyGoal = (): number => {
  try {
    const v = localStorage.getItem(GOAL_KEY);
    if (!v) return DEFAULT_GOAL;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
  } catch {
    return DEFAULT_GOAL;
  }
};

export const setDailyGoal = (goal: number) => {
  try {
    localStorage.setItem(GOAL_KEY, String(goal));
    window.dispatchEvent(new CustomEvent("today:goal-changed"));
  } catch {
    // ignore
  }
};
