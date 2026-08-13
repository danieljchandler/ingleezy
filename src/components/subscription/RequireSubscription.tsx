import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Crown, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FEATURE_REQUIREMENTS, PremiumFeature, featureLabel } from '@/lib/featureAccess';

interface Props {
  feature: PremiumFeature;
  /** Render-prop alternative to children so callers can inline custom layouts. */
  children: ReactNode;
  /** Optional fallback override; defaults to a paywall card. */
  fallback?: ReactNode;
}

/**
 * Wraps premium UI. Shows a paywall card when the user lacks the required tier.
 * Loading state renders a spinner so callers don't briefly flash either branch.
 */
export const RequireSubscription = ({ feature, children, fallback }: Props) => {
  const { user } = useAuth();
  const { hasAccess, loading } = useSubscription();
  const required = FEATURE_REQUIREMENTS[feature];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasAccess(required)) {
    return <>{children}</>;
  }

  if (fallback) return <>{fallback}</>;

  return (
    <Card className="border-2 border-dashed border-primary/40 max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          {required === 'allin' ? (
            <Crown className="h-6 w-6 text-primary" />
          ) : (
            <Lock className="h-6 w-6 text-primary" />
          )}
        </div>
        <CardTitle>{featureLabel(feature)} is a premium feature</CardTitle>
        <CardDescription>
          {required === 'allin'
            ? 'Upgrade to the All-In plan to unlock this.'
            : 'Subscribe to Standard or All-In to unlock this.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button asChild>
          <Link to="/pricing">{user ? 'View plans' : 'Sign up'}</Link>
        </Button>
      </CardContent>
    </Card>
  );
};
