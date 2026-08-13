import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  useSubscription,
  ANNUAL_BILLING_AVAILABLE,
  SUBSCRIPTION_TIERS,
  type BillingCadence,
} from '@/hooks/useSubscription';
import { AppShell } from '@/components/layout/AppShell';
import { HomeButton } from '@/components/HomeButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Crown, Sparkles, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InfoHint } from '@/components/InfoHint';
import { PAGE_HINTS } from '@/lib/pageHints';

const Pricing = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { subscribed, tier, loading: subLoading, createCheckout, openCustomerPortal } = useSubscription();
  // Annual is the default when available: it is the plan most learners should
  // take (two months free) and the one the business should lead with.
  const [cadence, setCadence] = useState<BillingCadence>(
    ANNUAL_BILLING_AVAILABLE ? 'annual' : 'monthly',
  );

  const handleSubscribe = async (selectedTier: 'standard' | 'allin') => {
    if (!user) {
      navigate('/auth');
      return;
    }

    try {
      await createCheckout(selectedTier, cadence);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to start checkout. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleManageSubscription = async () => {
    try {
      await openCustomerPortal();
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to open subscription management. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const loading = authLoading || subLoading;

  return (
    <AppShell>
      <div className="mb-8">
        <HomeButton />
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-3 font-heading inline-flex items-center gap-2 justify-center">
            Choose Your Plan <InfoHint {...PAGE_HINTS["pricing"]} size="md" />
          </h1>
          <p className="text-muted-foreground text-lg">
            Unlock the full power of Hakiya to accelerate your Arabic learning
          </p>
          <Badge variant="outline" className="mt-3">
            Hakiya is in closed beta — pricing below reflects our upcoming public launch
          </Badge>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Current subscription banner */}
            {subscribed && tier && (
              <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Crown className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    You're on the <span className="text-primary">{SUBSCRIPTION_TIERS[tier].name}</span> plan
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleManageSubscription}>
                  <Settings className="h-4 w-4 mr-2" />
                  Manage
                </Button>
              </div>
            )}

            {ANNUAL_BILLING_AVAILABLE && (
              <div className="mb-6 flex items-center justify-center gap-2">
                <Button
                  variant={cadence === 'annual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCadence('annual')}
                >
                  Annual
                  <Badge variant="secondary" className="ml-2">2 months free</Badge>
                </Button>
                <Button
                  variant={cadence === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCadence('monthly')}
                >
                  Monthly
                </Button>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              {/* Free tier */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-xl">Free</CardTitle>
                  <CardDescription>Get started with the basics</CardDescription>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">$0</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {[
                      'Browse vocabulary topics',
                      'Basic flashcard review',
                      '10 vocabulary words',
                      'Limited Discover videos',
                    ].map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" disabled>
                    Current Plan
                  </Button>
                </CardFooter>
              </Card>

              {/* Standard tier */}
              <Card className={`border-2 ${tier === 'standard' ? 'border-primary' : 'border-border'}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.standard.name}</CardTitle>
                    {tier === 'standard' && (
                      <Badge variant="default" className="bg-primary">Your Plan</Badge>
                    )}
                  </div>
                  <CardDescription>For serious learners</CardDescription>
                  <div className="mt-4">
                    {cadence === 'annual' ? (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.standard.annualPrice}</span>
                        <span className="text-muted-foreground">/year</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ${(SUBSCRIPTION_TIERS.standard.annualPrice / 12).toFixed(2)}/month, billed yearly
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.standard.price}</span>
                        <span className="text-muted-foreground">/month</span>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {SUBSCRIPTION_TIERS.standard.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {tier === 'standard' ? (
                    <Button variant="outline" className="w-full" onClick={handleManageSubscription}>
                      Manage Subscription
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={() => handleSubscribe('standard')}>
                      {user ? 'Subscribe' : 'Sign Up to Subscribe'}
                    </Button>
                  )}
                </CardFooter>
              </Card>

              {/* All-In tier */}
              <Card className={`border-2 ${tier === 'allin' ? 'border-primary' : 'border-accent'} relative`}>
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-accent text-accent-foreground">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Best Value
                  </Badge>
                </div>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.allin.name}</CardTitle>
                    {tier === 'allin' && (
                      <Badge variant="default" className="bg-primary">Your Plan</Badge>
                    )}
                  </div>
                  <CardDescription>Unlimited everything</CardDescription>
                  <div className="mt-4">
                    {cadence === 'annual' ? (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.allin.annualPrice}</span>
                        <span className="text-muted-foreground">/year</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ${(SUBSCRIPTION_TIERS.allin.annualPrice / 12).toFixed(2)}/month, billed yearly
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.allin.price}</span>
                        <span className="text-muted-foreground">/month</span>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {SUBSCRIPTION_TIERS.allin.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {tier === 'allin' ? (
                    <Button variant="outline" className="w-full" onClick={handleManageSubscription}>
                      Manage Subscription
                    </Button>
                  ) : (
                    <Button className="w-full bg-accent hover:bg-accent/90" onClick={() => handleSubscribe('allin')}>
                      {user ? 'Subscribe' : 'Sign Up to Subscribe'}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-8">
              All plans include a 7-day money-back guarantee. Cancel anytime.
            </p>

            {/* FAQ */}
            <section className="mt-16 max-w-3xl mx-auto">
              <h2 className="text-2xl font-bold text-center mb-8 font-heading">
                Frequently asked questions
              </h2>
              <div className="space-y-6">
                {[
                  {
                    q: 'Which dialects are included?',
                    a: 'Every paid plan unlocks all active dialect modules — Gulf, Egyptian, and Yemeni — with native audio, immersion-first lessons, and the MSA bridge track. New dialects roll out to All-In subscribers first.',
                  },
                  {
                    q: 'What counts toward the vocabulary limit?',
                    a: 'Only words you actively save to "My Words" count. Browsing topics, transcripts, and Discover videos is unlimited. Free covers 10 saved words, Standard 100, and All-In is uncapped.',
                  },
                  {
                    q: 'Can I switch plans or cancel later?',
                    a: 'Yes. Upgrade, downgrade, or cancel anytime from the Manage Subscription button. Cancellations stay active until the end of the billing period — no surprise charges.',
                  },
                  {
                    q: 'Do I keep my progress if I downgrade?',
                    a: 'Always. Your streak, XP, saved words, and review history are tied to your account, not your plan. If you exceed a lower tier\'s limits, older items go read-only until you upgrade again.',
                  },
                  {
                    q: 'Is there a free trial?',
                    a: 'The Free plan is permanent — use it as long as you like. Paid plans come with a 7-day money-back guarantee instead of a time-boxed trial, so you can fully test every feature.',
                  },
                  {
                    q: 'Do you offer student or annual pricing?',
                    a: 'Annual plans (2 months free) and student discounts are coming shortly after launch. Email hello@hakiya.app to be notified.',
                  },
                ].map(({ q, a }) => (
                  <div key={q} className="border-b border-border pb-4">
                    <h3 className="font-semibold text-foreground mb-2">{q}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default Pricing;
