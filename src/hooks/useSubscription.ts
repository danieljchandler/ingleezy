import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type SubscriptionTier = 'standard' | 'allin' | null;

interface SubscriptionState {
  subscribed: boolean;
  tier: SubscriptionTier;
  subscriptionEnd: string | null;
  loading: boolean;
}

/**
 * Flip to true once yearly prices exist in Stripe (under the same two
 * products, so tier detection keeps working) and the edge-function secrets
 * STRIPE_ANNUAL_PRICE_STANDARD / STRIPE_ANNUAL_PRICE_ALLIN are set — the
 * pricing page then shows the billing toggle, defaulting to annual. Until
 * then the toggle stays hidden and nothing changes.
 */
export const ANNUAL_BILLING_AVAILABLE = false;

export type BillingCadence = 'monthly' | 'annual';

export const SUBSCRIPTION_TIERS = {
  standard: {
    name: 'Standard',
    price: 5,
    /** Yearly price in dollars — two months free vs 12 × monthly. */
    annualPrice: 50,
    priceId: 'price_1T8t8sHVAO3F9uuDOpwSh2zQ',
    productId: 'prod_U77NfmTFN3mabx',
    features: [
      'AI-powered Transcribe tool',
      'Meme Analyzer',
      'How Do I Say feature',
      '100 vocabulary words',
      'Basic Discover content',
    ],
  },
  allin: {
    name: 'All-In',
    price: 15,
    annualPrice: 150,
    priceId: 'price_1T8t9QHVAO3F9uuDvaRVzEg4',
    productId: 'prod_U77OH1rRl0YAiF',
    features: [
      'Everything in Standard',
      'Unlimited vocabulary storage',
      'Full Discover content library',
      'Priority AI processing',
      'Early access to new features',
    ],
  },
} as const;

export const useSubscription = () => {
  const { user, session } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    subscribed: false,
    tier: null,
    subscriptionEnd: null,
    loading: true,
  });

  const checkSubscription = useCallback(async () => {
    if (!session?.access_token) {
      setState({ subscribed: false, tier: null, subscriptionEnd: null, loading: false });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        console.error('Error checking subscription:', error);
        setState(prev => ({ ...prev, loading: false }));
        return;
      }

      setState({
        subscribed: data.subscribed || false,
        tier: data.tier || null,
        subscriptionEnd: data.subscription_end || null,
        loading: false,
      });
    } catch (err) {
      console.error('Error checking subscription:', err);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [session?.access_token]);

  // Check subscription on mount and when user changes
  useEffect(() => {
    if (user) {
      checkSubscription();
    } else {
      setState({ subscribed: false, tier: null, subscriptionEnd: null, loading: false });
    }
  }, [user, checkSubscription]);

  // Auto-refresh every minute
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(checkSubscription, 60000);
    return () => clearInterval(interval);
  }, [user, checkSubscription]);

  const createCheckout = useCallback(async (tier: 'standard' | 'allin', cadence: BillingCadence = 'monthly') => {
    if (!session?.access_token) {
      throw new Error('Must be logged in to subscribe');
    }

    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { tier, cadence },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, [session?.access_token]);

  const openCustomerPortal = useCallback(async () => {
    if (!session?.access_token) {
      throw new Error('Must be logged in to manage subscription');
    }

    const { data, error } = await supabase.functions.invoke('customer-portal', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, [session?.access_token]);

  // Helper to check if user has access to a feature
  const hasAccess = useCallback((requiredTier: 'standard' | 'allin' = 'standard') => {
    if (!state.subscribed) return false;
    if (requiredTier === 'standard') return true; // Any subscription grants standard access
    return state.tier === 'allin';
  }, [state.subscribed, state.tier]);

  return {
    ...state,
    checkSubscription,
    createCheckout,
    openCustomerPortal,
    hasAccess,
  };
};
