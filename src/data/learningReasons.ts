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
  /** Stored on the profile and shown to the model, so keep it self-describing
   *  ENGLISH — the generators read it. labelAr/descAr are what the learner sees. */
  label: string;
  desc: string;
  labelAr: string;
  descAr: string;
  icon: string;
}

export const LEARNING_REASONS: LearningReason[] = [
  { id: 'work', label: 'Work', desc: 'Colleagues, meetings, the office', labelAr: 'العمل', descAr: 'زملاء واجتماعات ومكتب', icon: '💼' },
  { id: 'family', label: 'Family & partner', desc: 'In-laws, relatives, home life', labelAr: 'العائلة والشريك', descAr: 'أقارب وحياة البيت', icon: '🏡' },
  { id: 'living', label: 'Living abroad', desc: 'Shops, transport, neighbours, admin', labelAr: 'العيش في الخارج', descAr: 'متاجر ومواصلات وجيران ومعاملات', icon: '🧭' },
  { id: 'travel', label: 'Travel', desc: 'Getting around and being polite', labelAr: 'السفر', descAr: 'التنقل والمجاملات', icon: '✈️' },
  { id: 'faith', label: 'Study & scholarship', desc: 'Academic and scholarly contexts', labelAr: 'الدراسة والعلم', descAr: 'سياقات أكاديمية وعلمية', icon: '📖' },
  { id: 'media', label: 'Media & culture', desc: 'Shows, music, social media', labelAr: 'الإعلام والثقافة', descAr: 'مسلسلات وموسيقى وسوشيال ميديا', icon: '🎬' },
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
