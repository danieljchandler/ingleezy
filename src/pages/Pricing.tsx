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
import { PageCorner } from '@/components/shell/PageCorner';
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
        title: 'خطأ',
        description: 'تعذّر بدء عملية الدفع. حاول من جديد.',
        variant: 'destructive',
      });
    }
  };

  const handleManageSubscription = async () => {
    try {
      await openCustomerPortal();
    } catch (err) {
      toast({
        title: 'خطأ',
        description: 'تعذّر فتح إدارة الاشتراك. حاول من جديد.',
        variant: 'destructive',
      });
    }
  };

  const loading = authLoading || subLoading;

  return (
    <AppShell>
      <div className="mb-8">
        <PageCorner />
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-foreground mb-3 font-heading inline-flex items-center gap-2 justify-center">
            اختر باقتك <InfoHint {...PAGE_HINTS["pricing"]} size="md" />
          </h1>
          <p className="text-muted-foreground text-lg">
            افتح إمكانات إنجليزي كاملة وسرّع تعلمك للإنجليزية
          </p>
          <Badge variant="outline" className="mt-3">
            إنجليزي في مرحلة تجريبية مغلقة — الأسعار أدناه للإطلاق العام القادم
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
                    أنت على باقة <span className="text-primary">{SUBSCRIPTION_TIERS[tier].name}</span>
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleManageSubscription}>
                  <Settings className="h-4 w-4 me-2" />
                  إدارة
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
                  سنوي
                  <Badge variant="secondary" className="ms-2">شهران مجاناً</Badge>
                </Button>
                <Button
                  variant={cadence === 'monthly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCadence('monthly')}
                >
                  شهري
                </Button>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              {/* Free tier */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-xl">مجاني</CardTitle>
                  <CardDescription>ابدأ بالأساسيات</CardDescription>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">$0</span>
                    <span className="text-muted-foreground">/شهرياً</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {[
                      'تصفح مواضيع المفردات',
                      'مراجعة أساسية بالبطاقات',
                      '10 كلمات محفوظة',
                      'فيديوهات محدودة في اكتشف',
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
                    باقتك الحالية
                  </Button>
                </CardFooter>
              </Card>

              {/* Standard tier */}
              <Card className={`border-2 ${tier === 'standard' ? 'border-primary' : 'border-border'}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.standard.name}</CardTitle>
                    {tier === 'standard' && (
                      <Badge variant="default" className="bg-primary">باقتك</Badge>
                    )}
                  </div>
                  <CardDescription>للمتعلم الجاد</CardDescription>
                  <div className="mt-4">
                    {cadence === 'annual' ? (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.standard.annualPrice}</span>
                        <span className="text-muted-foreground">/year</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ${(SUBSCRIPTION_TIERS.standard.annualPrice / 12).toFixed(2)}/شهرياً، تُدفع سنوياً
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.standard.price}</span>
                        <span className="text-muted-foreground">/شهرياً</span>
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
                      إدارة الاشتراك
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={() => handleSubscribe('standard')}>
                      {user ? 'اشترك' : 'أنشئ حساباً للاشتراك'}
                    </Button>
                  )}
                </CardFooter>
              </Card>

              {/* All-In tier */}
              <Card className={`border-2 ${tier === 'allin' ? 'border-primary' : 'border-accent'} relative`}>
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-accent text-accent-foreground">
                    <Sparkles className="h-3 w-3 me-1" />
                    الأفضل قيمة
                  </Badge>
                </div>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{SUBSCRIPTION_TIERS.allin.name}</CardTitle>
                    {tier === 'allin' && (
                      <Badge variant="default" className="bg-primary">باقتك</Badge>
                    )}
                  </div>
                  <CardDescription>كل شيء بلا حدود</CardDescription>
                  <div className="mt-4">
                    {cadence === 'annual' ? (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.allin.annualPrice}</span>
                        <span className="text-muted-foreground">/year</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ${(SUBSCRIPTION_TIERS.allin.annualPrice / 12).toFixed(2)}/شهرياً، تُدفع سنوياً
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${SUBSCRIPTION_TIERS.allin.price}</span>
                        <span className="text-muted-foreground">/شهرياً</span>
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
                      إدارة الاشتراك
                    </Button>
                  ) : (
                    <Button className="w-full bg-accent hover:bg-accent/90" onClick={() => handleSubscribe('allin')}>
                      {user ? 'اشترك' : 'أنشئ حساباً للاشتراك'}
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
                الأسئلة الشائعة
              </h2>
              <div className="space-y-6">
                {[
                  {
                    q: 'هل الشرح متاح بلهجتي؟',
                    a: 'نعم. كل الباقات تشرح الإنجليزية بلهجتك — خليجي أو مصري أو يمني — مع الفصحى كطبقة إضافية. اللهجة تحدد لغة الشرح، لا ما تدرسه: المحتوى الإنجليزي واحد للجميع.',
                  },
                  {
                    q: 'ما الذي يُحتسب ضمن حد المفردات؟',
                    a: 'الكلمات التي تحفظها في «كلماتي» فقط. تصفح المواضيع والتفريغات وفيديوهات اكتشف بلا حدود. المجانية تشمل 10 كلمات محفوظة، والقياسية 100، والشاملة بلا حد.',
                  },
                  {
                    q: 'هل أستطيع تغيير الباقة أو الإلغاء لاحقاً؟',
                    a: 'نعم. رقِّ أو خفِّض أو ألغِ متى شئت من زر إدارة الاشتراك. يبقى الإلغاء سارياً حتى نهاية فترة الفوترة — بلا رسوم مفاجئة.',
                  },
                  {
                    q: 'هل أحتفظ بتقدّمي إن خفّضت الباقة؟',
                    a: 'دائماً. سلسلتك ونقاطك وكلماتك المحفوظة وسجل مراجعاتك مرتبطة بحسابك لا بباقتك. وإن تجاوزت حدود الباقة الأدنى، تصبح العناصر الأقدم للقراءة فقط حتى ترقّي مجدداً.',
                  },
                  {
                    q: 'هل توجد تجربة مجانية؟',
                    a: 'الباقة المجانية دائمة — استخدمها ما شئت. أما الباقات المدفوعة فتأتي بضمان استرداد خلال 7 أيام بدل تجربة محدودة بوقت، لتجرّب كل ميزة بالكامل.',
                  },
                  {
                    q: 'هل لديكم أسعار للطلاب أو اشتراك سنوي؟',
                    a: 'الاشتراك السنوي (شهران مجاناً) وخصومات الطلاب قادمة بعد الإطلاق بقليل. راسلنا على hello@ingleezy.app لنخبرك.',
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
