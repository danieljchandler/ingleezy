// Why a learner is here.
//
// Written to `profiles.learning_reason` (a column that existed in the schema
// from early on but was never populated) and read server-side by
// supabase/functions/_shared/learnerProfile.ts, which tells content generators
// what kinds of situation to write about.
//
// Distinct from the weekly-goal options, which capture only *intensity* —
// "20 min/day" says nothing about whether you need to talk to in-laws or to
// contractors. Shared between Onboarding and Settings so the two can't drift.

export interface LearningReason {
  id: string;
  /** Stored on the profile and shown to the model, so keep it self-describing. */
  label: string;
  desc: string;
  icon: string;
}

export const LEARNING_REASONS: LearningReason[] = [
  { id: 'work', label: 'Work', desc: 'Colleagues, meetings, the office', icon: '💼' },
  { id: 'family', label: 'Family & partner', desc: 'In-laws, relatives, home life', icon: '🏡' },
  { id: 'living', label: 'Living there', desc: 'Shops, taxis, neighbours, admin', icon: '🧭' },
  { id: 'travel', label: 'Travel', desc: 'Getting around and being polite', icon: '✈️' },
  { id: 'faith', label: 'Faith & study', desc: 'Religious and scholarly contexts', icon: '📖' },
  { id: 'media', label: 'Media & culture', desc: 'Shows, music, social media', icon: '🎬' },
];

/** The label stored on the profile, or null when nothing is selected. */
export function reasonLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEARNING_REASONS.find((r) => r.id === id)?.label ?? id;
}

/**
 * Map a stored label back to its id, so Settings can pre-select what onboarding
 * saved. Falls back to matching the raw value (a hand-edited or legacy reason
 * round-trips as itself rather than silently clearing).
 */
export function reasonIdFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  return (
    LEARNING_REASONS.find((r) => r.label === label)?.id ??
    LEARNING_REASONS.find((r) => r.id === label)?.id ??
    null
  );
}
