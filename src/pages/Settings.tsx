import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { IconBack } from '@/components/shared/DirectionalIcon';
import { Loader2, Check, User, Globe2, Target, Eye, Heart, Camera, AlertTriangle, Info, Compass, Bell } from 'lucide-react';
import { HomeLayoutEditor } from '@/components/settings/HomeLayoutEditor';
import { DisplayPrefsEditor } from '@/components/settings/DisplayPrefsEditor';
import { useLeechPrefs } from '@/hooks/useLeechPrefs';
import { useRootFamilyPrefs } from '@/hooks/useRootFamilyPrefs';
import { useFeatureHints } from '@/hooks/useFeatureHints';
import { useSubscription } from '@/hooks/useSubscription';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getTopicCategories } from '@/data/listenTopics';
import { LEARNING_REASONS, reasonLabel, reasonIdFromLabel } from '@/data/learningReasons';
import { ChevronOpen } from '@/components/shared/DirectionalIcon';

// The learner's OWN dialect (their L1) — it shapes the Arabic scaffold, not
// what they study. IDs are stored values; labels are what they see.
const DIALECTS = [
  { id: 'Gulf', labelAr: 'خليجي', flag: '🌊' },
  { id: 'Egyptian', labelAr: 'مصري', flag: '🇪🇬' },
  { id: 'Saudi', labelAr: 'سعودي', flag: '🇸🇦' },
  { id: 'Kuwaiti', labelAr: 'كويتي', flag: '🇰🇼' },
  { id: 'Emirati', labelAr: 'إماراتي', flag: '🇦🇪' },
  { id: 'Qatari', labelAr: 'قطري', flag: '🇶🇦' },
  { id: 'Bahraini', labelAr: 'بحريني', flag: '🇧🇭' },
  { id: 'Omani', labelAr: 'عماني', flag: '🇴🇲' },
];

// English proficiency. IDs are stored values.
const LEVELS = [
  { id: 'beginner', label: 'مبتدئ تماماً', cefr: 'Pre-A1', icon: '🌱' },
  { id: 'basic', label: 'أساسي', cefr: 'A1', icon: '📖' },
  { id: 'elementary', label: 'ابتدائي', cefr: 'A2', icon: '🗣️' },
  { id: 'intermediate', label: 'متوسط', cefr: 'B1', icon: '💬' },
  { id: 'advanced', label: 'متقدم', cefr: 'B2+', icon: '🎯' },
];

const GOALS = [
  { id: 'casual', label: 'خفيف', desc: '5 دقائق يومياً', icon: '☕', reviewTarget: 20, xpTarget: 100 },
  { id: 'regular', label: 'منتظم', desc: '10 دقائق يومياً', icon: '📚', reviewTarget: 50, xpTarget: 300 },
  { id: 'serious', label: 'جاد', desc: '20 دقيقة يومياً', icon: '🔥', reviewTarget: 100, xpTarget: 500 },
  { id: 'intensive', label: 'مكثّف', desc: '+30 دقيقة يومياً', icon: '🚀', reviewTarget: 150, xpTarget: 750 },
];

const Settings = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const { enabled: leechEnabled, setEnabled: setLeechEnabled } = useLeechPrefs();
  const { enabled: rootFamiliesEnabled, setEnabled: setRootFamiliesEnabled } = useRootFamilyPrefs();
  const { enabled: hintsEnabled, setEnabled: setHintsEnabled } = useFeatureHints();
  const { subscribed, tier, openCustomerPortal } = useSubscription();
  const [clearingLeeches, setClearingLeeches] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      await openCustomerPortal();
    } catch (e) {
      toast.error('تعذّر فتح بوابة الاشتراك', {
        description: e instanceof Error ? e.message : 'حاول من جديد.',
      });
    } finally {
      setOpeningPortal(false);
    }
  };

  const clearAllLeeches = async () => {
    if (!user) return;
    setClearingLeeches(true);
    try {
      await Promise.all([
        (supabase.from('user_vocabulary') as any)
          .update({ is_leech: false, lapses: 0, production_lapses: 0 })
          .eq('user_id', user.id),
        (supabase.from('user_phrases') as any)
          .update({ is_leech: false, lapses: 0 })
          .eq('user_id', user.id),
      ]);
      toast.success('أزيلت كل علامات التعثر.');
    } catch {
      toast.error('تعذّرت إزالة علامات التعثر');
    } finally {
      setClearingLeeches(false);
    }
  };
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [dialect, setDialect] = useState('Gulf');
  const [level, setLevel] = useState('beginner');
  const [goal, setGoal] = useState('regular');
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
  const [contributeAudio, setContributeAudio] = useState(false);
  const [desiredRetention, setDesiredRetention] = useState<number>(0.9);
  // Purpose + topics. Both feed the server-side learner profile that content
  // generators read, so editing them here changes what gets generated next.
  const [reason, setReason] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);

  const push = usePushNotifications();

  // Same taxonomy the Listen catalog uses, scoped to the selected dialect.
  const topicCategories = getTopicCategories(dialect);

  const toggleInterest = (id: string) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/auth');
      return;
    }
    if (!user) return;

    const load = async () => {
      const { data } = await supabase
        .from('profiles' as any)
        .select('display_name, avatar_url, preferred_dialect, proficiency_level, weekly_goal, show_on_leaderboard, learning_reason, interests, contribute_audio, desired_retention')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const p = data as any;
        setDisplayName(p.display_name || '');
        setAvatarUrl(p.avatar_url || null);
        setDialect(p.preferred_dialect || 'Gulf');
        setLevel(p.proficiency_level || 'beginner');
        setGoal(p.weekly_goal || 'regular');
        setShowOnLeaderboard(p.show_on_leaderboard ?? true);
        setContributeAudio(p.contribute_audio === true);
        setDesiredRetention(
          typeof p.desired_retention === 'number' && p.desired_retention >= 0.7 && p.desired_retention <= 0.97
            ? p.desired_retention
            : 0.9,
        );
        setReason(reasonIdFromLabel(p.learning_reason));
        setInterests(Array.isArray(p.interests) ? p.interests : []);
      }
      setLoading(false);
    };
    load();
  }, [user, authLoading, isAuthenticated, navigate]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast.error('اختر ملف صورة');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('يجب أن تكون الصورة أصغر من 5MB');
      return;
    }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const newUrl = `${pub.publicUrl}?t=${Date.now()}`;

      const { error: updErr } = await supabase
        .from('profiles' as any)
        .update({ avatar_url: newUrl } as any)
        .eq('user_id', user.id);
      if (updErr) throw updErr;

      setAvatarUrl(newUrl);
      toast.success('تم تحديث صورة الملف الشخصي!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'تعذّر رفع الصورة');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles' as any)
        .update({
          display_name: displayName.trim() || null,
          preferred_dialect: dialect,
          proficiency_level: level,
          weekly_goal: goal,
          show_on_leaderboard: showOnLeaderboard,
          contribute_audio: contributeAudio,
          desired_retention: desiredRetention,
          learning_reason: reasonLabel(reason),
          interests,
        } as any)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update weekly goal targets
      const selectedGoal = GOALS.find((g) => g.id === goal);
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

      toast.success('تم حفظ الإعدادات!');
    } catch (e) {
      console.error(e);
      toast.error('تعذّر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (authLoading || loading) {
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
      <div className="max-w-lg mx-auto py-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <IconBack className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold font-heading text-foreground">الإعدادات</h1>
        </div>

        <div className="space-y-8">
          {/* Profile Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="h-4 w-4" />
              الملف الشخصي
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20 border-2 border-border">
                  <AvatarImage src={avatarUrl || undefined} alt="صورة الملف الشخصي" />
                  <AvatarFallback className="text-lg font-semibold">
                    {(displayName || user?.email || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {uploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  <Camera className="h-4 w-4 me-2" />
                  {avatarUrl ? 'غيّر الصورة' : 'ارفع صورة'}
                </Button>
                <p className="text-xs text-muted-foreground">JPG أو PNG، حتى 5MB</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName" className="text-foreground">الاسم الظاهر</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="اسمك الظاهر"
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                {user?.email}
              </p>
            </div>
          </section>

          {/* Dialect Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Globe2 className="h-4 w-4" />
              لهجتك
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DIALECTS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDialect(d.id)}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-xl border-2 transition-all duration-200 text-left',
                    dialect === d.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-lg">{d.flag}</span>
                  <span className="font-medium text-foreground text-sm min-w-0">{d.labelAr}</span>
                  {dialect === d.id && <Check className="h-4 w-4 text-primary ms-auto shrink-0" />}
                </button>
              ))}
            </div>
          </section>

          {/* Level Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Target className="h-4 w-4" />
              مستواك في الإنجليزية
            </div>
            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 text-left',
                    level === l.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-xl">{l.icon}</span>
                  <span className="font-medium text-foreground text-sm flex-1">{l.label}</span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{l.cefr}</span>
                  {level === l.id && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </section>

          {/* Goal Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Target className="h-4 w-4" />
              الهدف الأسبوعي
            </div>
            <div className="grid grid-cols-2 gap-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200',
                    goal === g.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{g.icon}</span>
                  <span className="font-semibold text-foreground text-sm">{g.label}</span>
                  <span className="text-xs text-muted-foreground">{g.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* What you want English for — feeds generated content */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Compass className="h-4 w-4" />
              لماذا تتعلم الإنجليزية؟
            </div>
            <p className="text-xs text-muted-foreground">
              يحدد المواقف والمواضيع في قصصك وتمارين الاستماع والتدريبات.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LEARNING_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setReason((prev) => (prev === r.id ? null : r.id))}
                  aria-pressed={reason === r.id}
                  className={cn(
                    'flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200',
                    reason === r.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-primary/30'
                  )}
                >
                  <span className="text-2xl">{r.icon}</span>
                  <span className="font-semibold text-foreground text-sm">{r.labelAr}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
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
          </section>

          {/* Library */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Heart className="h-4 w-4" />
              مكتبتي
            </div>
            <button
              onClick={() => navigate('/liked-videos')}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <Heart className="h-5 w-5 text-primary fill-primary/30" />
                <div className="text-left">
                  <p className="font-medium text-foreground text-sm">فيديوهات أعجبتني</p>
                  <p className="text-xs text-muted-foreground">الفيديوهات التي حفظتها</p>
                </div>
              </div>
              <ChevronOpen className="h-4 w-4 text-muted-foreground" />
            </button>
          </section>

          {/* Home Layout */}
          <HomeLayoutEditor />

          {/* Global Display Preferences */}
          <DisplayPrefsEditor />

          {/* Feature Hints */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Info className="h-4 w-4" />
              تلميحات الميزات
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pe-3">
                <p className="font-medium text-foreground text-sm">أظهر تلميحات الميزات</p>
                <p className="text-xs text-muted-foreground">
                  أيقونات (i) صغيرة في أنحاء التطبيق تشرح كل ميزة. أطفئها متى ألفت المكان.
                </p>
              </div>
              <Switch checked={hintsEnabled} onCheckedChange={setHintsEnabled} />
            </div>
          </section>

          {/* Review Preferences */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <AlertTriangle className="h-4 w-4" />
              تفضيلات المراجعة
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pe-3">
                <p className="font-medium text-foreground text-sm">علّم البطاقات الصعبة كبطاقات متعثرة</p>
                <p className="text-xs text-muted-foreground">
                  بعد عدة أخطاء، تظهر وسيلة تذكّر وأنشودة من الذكاء الاصطناعي لتساعدك على الحفظ.
                </p>
              </div>
              <Switch checked={leechEnabled} onCheckedChange={setLeechEnabled} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pe-3">
                <p className="font-medium text-foreground text-sm">أظهر كلمات من نفس العائلة</p>
                <p className="text-xs text-muted-foreground">
                  تحت البطاقة التي أجبت عنها، تظهر بهدوء كلماتك الأخرى من نفس عائلة
                  الكلمة — <span className="font-english">act, action, active, actor</span>.
                </p>
              </div>
              <Switch checked={rootFamiliesEnabled} onCheckedChange={setRootFamiliesEnabled} />
            </div>
            <div className="p-3 rounded-xl bg-card border border-border">
              <p className="font-medium text-foreground text-sm">كثافة المراجعة</p>
              <p className="text-xs text-muted-foreground mb-2">
                إلى أي درجة تريد أن تتذكر البطاقات وقت المراجعة. الأخف يعني مراجعات أقل
                وأبعد ونسياناً أكثر قليلاً؛ والمكثف عكس ذلك.
              </p>
              <div className="flex gap-2" role="radiogroup" aria-label="كثافة المراجعة">
                {[
                  { value: 0.85, label: 'أخف' },
                  { value: 0.9, label: 'قياسي' },
                  { value: 0.95, label: 'مكثف' },
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={Math.abs(desiredRetention - value) < 0.001 ? 'default' : 'outline'}
                    role="radio"
                    aria-checked={Math.abs(desiredRetention - value) < 0.001}
                    onClick={() => setDesiredRetention(value)}
                    className="flex-1"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pe-3">
                <p className="font-medium text-foreground text-sm">ساهم بتسجيلات تدريبي</p>
                <p className="text-xs text-muted-foreground">
                  احتفظ بمقاطع نطقي (مع العبارة التي كنت أقولها ونتيجتي) للمساعدة في تحسين
                  التعرف على الكلام. مطفأ افتراضياً؛ يُخزَّن بخصوصية ولا يُنشر أبداً، ويمكنك
                  إيقافه متى شئت — راجع الشروط للتفاصيل.
                </p>
              </div>
              <Switch checked={contributeAudio} onCheckedChange={setContributeAudio} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={clearAllLeeches}
              disabled={clearingLeeches}
            >
              {clearingLeeches ? <Loader2 className="h-4 w-4 animate-spin" /> : 'أزل كل علامات التعثر'}
            </Button>
          </section>

          {/* Reminders. Hidden entirely when the browser can't do push or the
              deployment has no VAPID key — a dead toggle is worse than none. */}
          {push.isSupported && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                <Bell className="h-4 w-4" />
                التذكيرات
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border">
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm">تذكيرات المراجعة</p>
                  <p className="text-xs text-muted-foreground">
                    {push.permission === 'denied'
                      ? 'محظورة في إعدادات المتصفح — اسمح بالإشعارات لهذا الموقع لتفعيلها.'
                      : 'تنبيه مسائي واحد عندما تكون لديك بطاقات بانتظارك.'}
                  </p>
                </div>
                <Switch
                  checked={push.isSubscribed}
                  disabled={push.isBusy || push.permission === 'denied'}
                  onCheckedChange={(next) => {
                    if (next) void push.subscribe();
                    else void push.unsubscribe();
                  }}
                />
              </div>
            </section>
          )}

          {/* Privacy Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Eye className="h-4 w-4" />
              الخصوصية
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div>
                <p className="font-medium text-foreground text-sm">أظهرني في لوحة الصدارة</p>
                <p className="text-xs text-muted-foreground">يمكن للآخرين رؤية اسمك ونقاطك</p>
              </div>
              <Switch checked={showOnLeaderboard} onCheckedChange={setShowOnLeaderboard} />
            </div>
          </section>

          {/* Subscription */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Heart className="h-4 w-4" />
              الاشتراك
            </div>
            <div className="p-3 rounded-xl bg-card border border-border space-y-2">
              <p className="text-sm font-medium text-foreground">
                {subscribed ? `الباقة الفعّالة: ${tier === 'allin' ? 'الشاملة' : 'القياسية'}` : 'الباقة المجانية'}
              </p>
              <p className="text-xs text-muted-foreground">
                {subscribed
                  ? 'أدر الفواتير أو حدّث طريقة الدفع أو ألغِ متى شئت.'
                  : 'رقِّ اشتراكك لإزالة الحدود اليومية وفتح كل شيء.'}
              </p>
              {subscribed ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleManageSubscription}
                  disabled={openingPortal}
                >
                  {openingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إدارة الاشتراك'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/pricing')}>
                  عرض الباقات
                </Button>
              )}
            </div>
          </section>

          {/* Save + Sign Out */}
          <div className="space-y-3 pb-8">
            <Button onClick={save} disabled={saving} className="w-full h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ التغييرات'}
            </Button>
            <Button variant="outline" onClick={handleSignOut} className="w-full h-11 text-destructive hover:text-destructive">
              تسجيل الخروج
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default Settings;
