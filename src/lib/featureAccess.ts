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

/**
 * The name a learner meets on the paywall card, so it is Arabic and it matches
 * the wording of the plan bullets in SUBSCRIPTION_TIERS — someone who read
 * "محلل الميمز" on the pricing page should meet the same name at the gate.
 */
export function featureLabel(feature: PremiumFeature): string {
  switch (feature) {
    case 'transcribe': return 'أداة التفريغ';
    case 'meme_analyzer': return 'محلل الميمز';
    case 'how_do_i_say': return 'ميزة «كيف أقول…؟»';
    case 'learn_from_x': return 'التعلّم من منشورات X';
    case 'unlimited_vocab': return 'المفردات بلا حدود';
    case 'full_discover': return 'مكتبة اكتشف كاملة';
    case 'priority_ai': return 'أولوية معالجة الذكاء الاصطناعي';
    case 'early_access': return 'الوصول المبكر للميزات';
  }
}
