/**
 * Centralized application configuration.
 *
 * All hardcoded values that were previously scattered across components should
 * live here so they can be found and changed in one place.
 */

// ─── Dialects ────────────────────────────────────────────────────────────────

export const DIALECTS = ['Gulf', 'Egyptian', 'Yemeni'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_FLAGS: Record<Dialect, string> = {
  Gulf: '🇸🇦',
  Egyptian: '🇪🇬',
  Yemeni: '🇾🇪',
};

export const DIALECT_LABELS: Record<Dialect, string> = {
  Gulf: 'Gulf Arabic',
  Egyptian: 'Egyptian Arabic',
  Yemeni: 'Yemeni Arabic',
};

/**
 * `discover_videos.dialect` is written by the AI analysis pipeline, which for
 * the Gulf module stores the specific country it detected (Saudi, Kuwaiti,
 * UAE, Bahraini, Qatari, Omani) rather than the bare module name — Egyptian
 * and Yemeni are always stored as their module name. Anything filtering
 * videos by dialect module needs to match every raw value that belongs to
 * that module, or Gulf-tagged-by-country videos silently disappear from a
 * "Gulf" filter.
 */
export const DIALECT_MODULE_VALUES: Record<Dialect, readonly string[]> = {
  Gulf: ['Gulf', 'Saudi', 'Kuwaiti', 'UAE', 'Bahraini', 'Qatari', 'Omani'],
  Egyptian: ['Egyptian'],
  Yemeni: ['Yemeni'],
};

// ─── Difficulty levels ───────────────────────────────────────────────────────

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// ─── Learning ────────────────────────────────────────────────────────────────

/** Number of new words introduced per learning batch. */
export const LEARN_BATCH_SIZE = 5;

/** Delay (ms) before auto-playing audio after a card appears. */
export const AUDIO_AUTOPLAY_DELAY_MS = 300;

/** Delay (ms) after answering before moving to the next quiz card. */
export const QUIZ_ADVANCE_DELAY_MS = 1500;

// ─── Review / Spaced Repetition ──────────────────────────────────────────────

/** XP awarded per review rating. */
export const REVIEW_XP: Record<string, number> = {
  again: 5,
  hard: 10,
  good: 15,
  easy: 20,
};

// ─── Weekly goals ────────────────────────────────────────────────────────────

export const WEEKLY_GOALS = [
  { label: 'Casual', reviews: 20, xp: 100 },
  { label: 'Regular', reviews: 50, xp: 250 },
  { label: 'Serious', reviews: 100, xp: 500 },
  { label: 'Intense', reviews: 200, xp: 1000 },
] as const;

// ─── Gamification ────────────────────────────────────────────────────────────

/** XP required for each level (index = level number, 0-based). */
export const XP_PER_LEVEL = 100;

// ─── Supabase ────────────────────────────────────────────────────────────────

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
