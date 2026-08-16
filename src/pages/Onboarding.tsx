import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { markTourPending } from '@/components/onboarding/OnboardingTour';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  Globe2,
  GraduationCap,
  Target,
  Check
} from 'lucide-react';
import { getTopicCategories } from '@/data/listenTopics';
import { LEARNING_REASONS, reasonLabel } from '@/data/learningReasons';
import { ChevronBack, ChevronOpen } from '@/components/shared/DirectionalIcon';
const lahjaIcon = "/brand/ingleezy-icon.svg";

type Step = 'welcome' | 'dialect' | 'level' | 'purpose' | 'goal';

const STEPS: Step[] = ['welcome', 'dialect', 'level', 'purpose', 'goal'];

// Must match DialectModule ('Gulf' | 'Egyptian' | 'Yemeni') — the only values
// DialectContext actually recognizes. Anything else silently falls back to
// Gulf, which previously happened for every Saudi/Kuwaiti/Emirati/etc. pick,
// while Egyptian and Yemeni (real, supported dialects) weren't offered at all.
const DIALECTS = [
  { id: 'Gulf', labelAr: 'خليجي', desc: 'لهجة أهل الخليج', flag: '🌊' },
  { id: 'Egyptian', labelAr: 'مصري', desc: 'اللهجة المصرية', flag: '🇪🇬' },
  { id: 'Yemeni', labelAr: 'يمني', desc: 'اللهجة اليمنية', flag: '🇾🇪' },
];

const LEVELS = [
  { id: 'beginner', label: 'مبتدئ تماماً', desc: 'لا أعرف أي إنجليزية', icon: '🌱', cefr: 'Pre-A1' },
  { id: 'basic', label: 'أساسي', desc: 'أعرف بعض الكلمات والتحيات', icon: '📖', cefr: 'A1' },
  { id: 'elementary', label: 'ابتدائي', desc: 'أستطيع تكوين جمل بسيطة', icon: '🗣️', cefr: 'A2' },
  { id: 'intermediate', label: 'متوسط', desc: 'أستطيع إجراء محادثات بسيطة', icon: '💬', cefr: 'B1' },
  { id: 'advanced', label: 'متقدم', desc: 'أفهم معظم الإنجليزية المحكية', icon: '🎯', cefr: 'B2+' },
];

const GOALS = [
  { id: 'casual', label: 'خفيف', desc: '5 دقائق يومياً · 2-3 أيام أسبوعياً', icon: '☕', reviewTarget: 20, xpTarget: 100 },
  { id: 'regular', label: 'منتظم', desc: '10 دقائق يومياً · 4-5 أيام أسبوعياً', icon: '📚', reviewTarget: 50, xpTarget: 300 },
  { id: 'serious', label: 'جاد', desc: '20 دقيقة يومياً · كل يوم', icon: '🔥', reviewTarget: 100, xpTarget: 500 },
  { id: 'intensive', label: 'مكثّف', desc: '+30 دقيقة يومياً · كل يوم', icon: '🚀', reviewTarget: 150, xpTarget: 750 },
];


const Onboarding = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading } = useAuth();
  const [step, setStep] = useState<Step>('welcome');
  const [dialect, setDialect] = useState('Gulf');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('regular');
  const [reason, setReason] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Same taxonomy the Listen catalog uses, scoped to the dialect just picked —
  // no second topic vocabulary to keep in sync.
  const topicCategories = getTopicCategories(dialect);

  const toggleInterest = (id: string) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/auth');
    }
  }, [loading, isAuthenticated, navigate]);

  const currentStepIndex = STEPS.indexOf(step);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;

  const next = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex]);
    }
  };

  const prev = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex]);
    }
  };

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const selectedGoal = GOALS.find((g) => g.id === goal);

      const { error } = await supabase
        .from('profiles' as any)
        .update({
          onboarding_completed: true,
          preferred_dialect: dialect,
          proficiency_level: level,
          weekly_goal: goal,
          // Both feed the server-side learner profile that content generators
          // are conditioned on. Nullable/empty is fine — the profile simply
          // omits whatever it doesn't know.
          learning_reason: reasonLabel(reason),
          interests,
        } as any)
        .eq('user_id', user.id);

      if (error) throw error;

      // Set weekly goal based on selection
      if (selectedGoal) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekStartStr = weekStart.toISOString().split('T')[0];

        await supabase.from('weekly_goals').upsert({
          user_id: user.id,
          week_start_date: weekStartStr,
          target_reviews: selectedGoal.reviewTarget,
          target_xp: selectedGoal.xpTarget,
        } as any, { onConflict: 'user_id,week_start_date' });
      }

      markTourPending();
      toast.success('أهلاً بك في إنجليزي! 🎉');
      navigate('/');
    } catch (e) {
      console.error(e);
      toast.error('تعذّر حفظ التفضيلات');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto py-6">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            الخطوة {currentStepIndex + 1} من {STEPS.length}
          </p>
        </div>

        {/* ─── WELCOME ─────────────────────────── */}
        {step === 'welcome' && (
          <div className="text-center space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <img src="/brand/ingleezy-icon.svg" alt="Ingleezy" className="h-20 w-20 mx-auto" />
            <div>
              <h1 className="text-3xl font-bold font-heading text-foreground mb-3">
                أهلاً وسهلاً!
              </h1>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                مرحباً بك في إنجليزي
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                تعلّم الإنجليزية من محادثات حقيقية وفيديوهات ودروس تفاعلية.
                لنخصص تجربة تعلمك.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <Globe2 className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">شرح بلهجتك</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <GraduationCap className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">6 مراحل تعلم</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-3 text-center">
                <Sparkles className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">مدعوم بالذكاء الاصطناعي</p>
              </div>
            </div>
            <Button onClick={next} className="w-full h-12 text-base">
              لنبدأ <ChevronOpen className="h-5 w-5 ms-1" />
            </Button>
          </div>
        )}

        {/* ─── DIALECT ─────────────────────────── */}
        {step === 'dialect' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                ما لهجتك؟
              </h2>
              <p className="text-muted-foreground text-sm">
                سنشرح الإنجليزية بلهجتك — ويمكنك تغييرها لاحقاً
              </p>
            </div>

            <div className="space-y-2">
              {DIALECTS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDialect(d.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    dialect === d.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{d.flag}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground block">{d.labelAr}</span>
                    <p className="text-xs text-muted-foreground">{d.desc}</p>
                  </div>
                  {dialect === d.id && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronBack className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                متابعة <ChevronOpen className="h-4 w-4 ms-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── LEVEL ─────────────────────────── */}
        {step === 'level' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                ما مستواك في الإنجليزية؟
              </h2>
              <p className="text-muted-foreground text-sm">
                سنكيّف المحتوى ليناسب مهاراتك
              </p>
            </div>

            {/* Placement Quiz CTA */}
            <button
              onClick={() => navigate('/placement')}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all duration-200 text-left"
            >
              <span className="text-2xl">🧠</span>
              <div className="flex-1">
                <span className="font-semibold text-foreground">غير متأكد؟ خذ اختبار تحديد المستوى</span>
                <p className="text-xs text-muted-foreground">20 سؤالاً متكيّفاً لتحديد مستواك</p>
              </div>
              <ChevronOpen className="h-5 w-5 text-primary shrink-0" />
            </button>

            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    level === l.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{l.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{l.label}</span>
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{l.cefr}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{l.desc}</p>
                  </div>
                  {level === l.id && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronBack className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                متابعة <ChevronOpen className="h-4 w-4 ms-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── PURPOSE ─────────────────────────── */}
        {step === 'purpose' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                لماذا تريد تعلم الإنجليزية؟
              </h2>
              <p className="text-muted-foreground text-sm">
                يحدد هذا المواقف والمواضيع التي نكتب عنها. الاختياران غير إلزاميين.
              </p>
            </div>

            <div className="space-y-2">
              {LEARNING_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReason((prev) => (prev === r.id ? null : r.id))}
                  aria-pressed={reason === r.id}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    reason === r.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground block">{r.labelAr}</span>
                    <p className="text-xs text-muted-foreground">{r.descAr}</p>
                  </div>
                  {reason === r.id && <Check className="h-5 w-5 text-primary shrink-0" />}
                </button>
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground mb-1">
                مواضيع تستمتع بها
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                اختر ما يعجبك — سنعتمد عليها في القصص والاستماع.
              </p>
              <div className="flex flex-wrap gap-2">
                {topicCategories.map((c) => {
                  const selected = interests.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleInterest(c.id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-full border-2 text-sm transition-all duration-200',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground font-medium'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/30'
                      )}
                    >
                      <span>{c.emoji}</span>
                      <span>{c.labelAr}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronBack className="h-4 w-4" />
              </Button>
              <Button onClick={next} className="flex-1 h-11">
                متابعة <ChevronOpen className="h-4 w-4 ms-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── GOAL ─────────────────────────── */}
        {step === 'goal' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center">
              <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
                حدد هدفك الأسبوعي
              </h2>
              <p className="text-muted-foreground text-sm">
                كم من الوقت يمكنك تخصيصه للتعلم؟
              </p>
            </div>

            <div className="space-y-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all duration-200 text-left',
                    goal === g.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{g.icon}</span>
                  <div className="flex-1">
                    <span className="font-semibold text-foreground block">{g.label}</span>
                    <p className="text-xs text-muted-foreground">{g.desc}</p>
                  </div>
                  {goal === g.id && (
                    <Check className="h-5 w-5 text-primary shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={prev} className="h-11">
                <ChevronBack className="h-4 w-4" />
              </Button>
              <Button onClick={finish} disabled={saving} className="flex-1 h-11">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Target className="h-4 w-4 me-1" />
                    ابدأ التعلم!
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Onboarding;
