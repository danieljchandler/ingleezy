/**
 * Centralized application configuration.
 *
 * All hardcoded values that were previously scattered across components should
 * live here so they can be found and changed in one place.
 */

// ─── The learner's native dialect ─────────────────────────────────────────────

/**
 * Which Arabic the learner already speaks — chosen at onboarding, switchable
 * afterwards, and read by everything that renders a scaffold.
 *
 * The identifiers are Hakiya's and the values in the database are unchanged,
 * but the meaning is inverted. In Hakiya this was the dialect being *studied*:
 * picking Egyptian asked for Egyptian content to learn. In Ingleezy the studied
 * language is English and this is the language it gets explained in, so picking
 * Egyptian asks for glosses, translations, grammar notes and coaching in
 * Egyptian. Nothing here selects content any more; it selects voice.
 *
 * Which is why the labels are Arabic. They are the app naming the learner's own
 * dialect back to them, in it — "Gulf Arabic" was Hakiya describing a course
 * catalogue to an English speaker.
 */
export const DIALECTS = ['Gulf', 'Egyptian', 'Yemeni'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_LABELS: Record<Dialect, string> = {
  Gulf: 'خليجي',
  Egyptian: 'مصري',
  Yemeni: 'يمني',
};

/**
 * The same three in Latin script.
 *
 * Not a translation — a transliteration, which is what the dialect is actually
 * called by the people who speak it. It exists so a chip can carry two scripts
 * without repeating itself: label both fields from `DIALECT_LABELS` and the
 * dialect switcher renders "خليجي · خليجي".
 */
export const DIALECT_LATIN: Record<Dialect, string> = {
  Gulf: 'Khaleeji',
  Egyptian: 'Masri',
  Yemeni: 'Yamani',
};

/**
 * Gulf gets a map rather than a flag on purpose: it spans six countries, and
 * picking one of them names the wrong nationality for five sets of learners.
 * Egyptian and Yemeni each map to exactly one, so they keep theirs.
 */
export const DIALECT_FLAGS: Record<Dialect, string> = {
  Gulf: '🗺️',
  Egyptian: '🇪🇬',
  Yemeni: '🇾🇪',
};

/**
 * Still content-facing, and the one place the dialect narrows what a learner is
 * shown: Hakiya-bridged clips carry a dialect, so a Gulf learner's immersion
 * feed prefers Gulf ones. Native English content is unfiltered by this.
 *
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

/**
 * The reverse: a raw stored value back to the module it belongs to.
 *
 * Anything that *displays* a dialect needs this rather than the raw column,
 * because "Kuwaiti" has no entry in `DIALECT_LABELS` and rendering the column
 * directly puts a Latin-script identifier in front of an Arabic-speaking
 * learner. Unrecognised values fall back to Gulf, matching the default
 * everywhere else.
 */
export function dialectModuleOf(raw: string | null | undefined): Dialect {
  if (!raw) return 'Gulf';
  const match = DIALECTS.find((dialect) =>
    DIALECT_MODULE_VALUES[dialect].some((value) => value.toLowerCase() === raw.toLowerCase()),
  );
  return match ?? 'Gulf';
}

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
