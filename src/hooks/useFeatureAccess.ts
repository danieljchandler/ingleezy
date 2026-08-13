import { useCallback } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { FEATURE_REQUIREMENTS, PremiumFeature } from '@/lib/featureAccess';

/**
 * Imperative companion to <RequireSubscription>. Use inside event handlers
 * (e.g. "Add to flashcards" button) to gate an action without re-rendering.
 */
export const useFeatureAccess = () => {
  const { hasAccess, loading, subscribed, tier } = useSubscription();

  const canUse = useCallback(
    (feature: PremiumFeature) => hasAccess(FEATURE_REQUIREMENTS[feature]),
    [hasAccess]
  );

  return { canUse, loading, subscribed, tier };
};
