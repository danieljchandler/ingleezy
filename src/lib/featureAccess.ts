// Central registry of premium features and the minimum tier required.
// Keep this list in sync with marketing copy on the Pricing page.
//
// Tiers (ascending): 'free' < 'standard' < 'allin'
// A feature requiring 'standard' is unlocked for both Standard and All-In subscribers.
// A feature requiring 'allin' is unlocked only for All-In subscribers.

export type FeatureTier = 'free' | 'standard' | 'allin';

export type PremiumFeature =
  // Standard tier
  | 'transcribe'
  | 'meme_analyzer'
  | 'how_do_i_say'
  | 'learn_from_x'
  // All-In tier
  | 'unlimited_vocab'
  | 'full_discover'
  | 'priority_ai'
  | 'early_access';

export const FEATURE_REQUIREMENTS: Record<PremiumFeature, Exclude<FeatureTier, 'free'>> = {
  transcribe: 'standard',
  meme_analyzer: 'standard',
  how_do_i_say: 'standard',
  learn_from_x: 'standard',
  unlimited_vocab: 'allin',
  full_discover: 'allin',
  priority_ai: 'allin',
  early_access: 'allin',
};

// Free-tier soft caps. Enforced at the call site (e.g. when adding a word).
export const FREE_TIER_LIMITS = {
  vocabularyWords: 10,
  discoverVideosPerDay: 3,
} as const;

export const STANDARD_TIER_LIMITS = {
  vocabularyWords: 100,
} as const;

export function featureLabel(feature: PremiumFeature): string {
  switch (feature) {
    case 'transcribe': return 'Transcribe tool';
    case 'meme_analyzer': return 'Meme Analyzer';
    case 'how_do_i_say': return 'How Do I Say';
    case 'learn_from_x': return 'Learn from X posts';
    case 'unlimited_vocab': return 'Unlimited vocabulary';
    case 'full_discover': return 'Full Discover library';
    case 'priority_ai': return 'Priority AI processing';
    case 'early_access': return 'Early access features';
  }
}
