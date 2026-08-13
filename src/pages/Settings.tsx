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
import { Loader2, Check, ArrowLeft, User, Globe2, Target, Eye, Heart, ChevronRight, Camera, AlertTriangle, Info, Compass, Bell } from 'lucide-react';
import { HomeLayoutEditor } from '@/components/settings/HomeLayoutEditor';
import { DisplayPrefsEditor } from '@/components/settings/DisplayPrefsEditor';
import { useLeechPrefs } from '@/hooks/useLeechPrefs';
import { useRootFamilyPrefs } from '@/hooks/useRootFamilyPrefs';
import { useFeatureHints } from '@/hooks/useFeatureHints';
import { useSubscription } from '@/hooks/useSubscription';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getTopicCategories } from '@/data/listenTopics';
import { LEARNING_REASONS, reasonLabel, reasonIdFromLabel } from '@/data/learningReasons';

const DIALECTS = [
  { id: 'Gulf', label: 'Gulf Arabic', labelAr: 'خليجي', flag: '🌊' },
  { id: 'Egyptian', label: 'Egyptian Arabic', labelAr: 'مصري', flag: '🇪🇬' },
  { id: 'Saudi', label: 'Saudi', labelAr: 'سعودي', flag: '🇸🇦' },
  { id: 'Kuwaiti', label: 'Kuwaiti', labelAr: 'كويتي', flag: '🇰🇼' },
  { id: 'Emirati', label: 'Emirati', labelAr: 'إماراتي', flag: '🇦🇪' },
  { id: 'Qatari', label: 'Qatari', labelAr: 'قطري', flag: '🇶🇦' },
  { id: 'Bahraini', label: 'Bahraini', labelAr: 'بحريني', flag: '🇧🇭' },
  { id: 'Omani', label: 'Omani', labelAr: 'عماني', flag: '🇴🇲' },
];

const LEVELS = [
  { id: 'beginner', label: 'Complete Beginner', cefr: 'Pre-A1', icon: '🌱' },
  { id: 'basic', label: 'Basic', cefr: 'A1', icon: '📖' },
  { id: 'elementary', label: 'Elementary', cefr: 'A2', icon: '🗣️' },
  { id: 'intermediate', label: 'Intermediate', cefr: 'B1', icon: '💬' },
  { id: 'advanced', label: 'Advanced', cefr: 'B2+', icon: '🎯' },
];

const GOALS = [
  { id: 'casual', label: 'Casual', desc: '5 min/day', icon: '☕', reviewTarget: 20, xpTarget: 100 },
  { id: 'regular', label: 'Regular', desc: '10 min/day', icon: '📚', reviewTarget: 50, xpTarget: 300 },
  { id: 'serious', label: 'Serious', desc: '20 min/day', icon: '🔥', reviewTarget: 100, xpTarget: 500 },
  { id: 'intensive', label: 'Intensive', desc: '30+ min/day', icon: '🚀', reviewTarget: 150, xpTarget: 750 },
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
      toast.error('Unable to open subscription portal', {
        description: e instanceof Error ? e.message : 'Please try again.',
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
      toast.success('Cleared all leech flags.');
    } catch {
      toast.error('Failed to clear leech flags');
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
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB');
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
      toast.success('Profile picture updated!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to upload picture');
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

      toast.success('Settings saved!');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save settings');
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
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold font-heading text-foreground">Settings</h1>
        </div>

        <div className="space-y-8">
          {/* Profile Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="h-4 w-4" />
              Profile
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20 border-2 border-border">
                  <AvatarImage src={avatarUrl || undefined} alt="Profile picture" />
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
                  <Camera className="h-4 w-4 mr-2" />
                  {avatarUrl ? 'Change picture' : 'Upload picture'}
                </Button>
                <p className="text-xs text-muted-foreground">JPG or PNG, up to 5MB</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName" className="text-foreground">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
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
              Preferred Dialect
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
                  <div className="min-w-0">
                    <span className="font-medium text-foreground text-sm block">{d.label}</span>
                    <span className="text-xs text-muted-foreground" dir="rtl">{d.labelAr}</span>
                  </div>
                  {dialect === d.id && <Check className="h-4 w-4 text-primary ml-auto shrink-0" />}
                </button>
              ))}
            </div>
          </section>

          {/* Level Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Target className="h-4 w-4" />
              Proficiency Level
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
              Weekly Goal
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

          {/* What you want Arabic for — feeds generated content */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Compass className="h-4 w-4" />
              What you're learning for
            </div>
            <p className="text-xs text-muted-foreground">
              Shapes the situations and topics in your stories, listening and drills.
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
                  <span className="font-semibold text-foreground text-sm">{r.label}</span>
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
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Library */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Heart className="h-4 w-4" />
              My Library
            </div>
            <button
              onClick={() => navigate('/liked-videos')}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <Heart className="h-5 w-5 text-primary fill-primary/30" />
                <div className="text-left">
                  <p className="font-medium text-foreground text-sm">Liked Videos</p>
                  <p className="text-xs text-muted-foreground">Videos you've saved</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
              Feature Hints
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pr-3">
                <p className="font-medium text-foreground text-sm">Show feature hints</p>
                <p className="text-xs text-muted-foreground">
                  Small (i) icons across the app explain what each feature does. Turn off once you know your way around.
                </p>
              </div>
              <Switch checked={hintsEnabled} onCheckedChange={setHintsEnabled} />
            </div>
          </section>

          {/* Review Preferences */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <AlertTriangle className="h-4 w-4" />
              Review Preferences
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pr-3">
                <p className="font-medium text-foreground text-sm">Flag difficult cards as "leeches"</p>
                <p className="text-xs text-muted-foreground">
                  After several misses, show an AI mnemonic and memory jingle to help you remember.
                </p>
              </div>
              <Switch checked={leechEnabled} onCheckedChange={setLeechEnabled} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div className="min-w-0 pr-3">
                <p className="font-medium text-foreground text-sm">Show related words from the same root</p>
                <p className="text-xs text-muted-foreground">
                  Under a card you've answered, quietly list the other words you know that are built
                  from its Arabic root — كتب, كتاب, مكتب.
                </p>
              </div>
              <Switch checked={rootFamiliesEnabled} onCheckedChange={setRootFamiliesEnabled} />
            </div>
            <div className="p-3 rounded-xl bg-card border border-border">
              <p className="font-medium text-foreground text-sm">Review intensity</p>
              <p className="text-xs text-muted-foreground mb-2">
                How reliably you want to remember cards at review time. Lighter means fewer,
                longer-spaced reviews and a little more forgetting; intense means the reverse.
              </p>
              <div className="flex gap-2" role="radiogroup" aria-label="Review intensity">
                {[
                  { value: 0.85, label: 'Lighter' },
                  { value: 0.9, label: 'Standard' },
                  { value: 0.95, label: 'Intense' },
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
              <div className="min-w-0 pr-3">
                <p className="font-medium text-foreground text-sm">Contribute my practice recordings</p>
                <p className="text-xs text-muted-foreground">
                  Keep my pronunciation clips (with the phrase I was saying and my score) to help
                  improve Arabic speech recognition. Off by default; stored privately, never
                  published, and you can turn this off anytime — see the Terms for details.
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
              {clearingLeeches ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Clear all leech flags'}
            </Button>
          </section>

          {/* Reminders. Hidden entirely when the browser can't do push or the
              deployment has no VAPID key — a dead toggle is worse than none. */}
          {push.isSupported && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                <Bell className="h-4 w-4" />
                Reminders
              </div>
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border">
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm">Review reminders</p>
                  <p className="text-xs text-muted-foreground">
                    {push.permission === 'denied'
                      ? 'Blocked in your browser settings — allow notifications for this site to enable.'
                      : 'One evening nudge when you have cards waiting.'}
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
              Privacy
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
              <div>
                <p className="font-medium text-foreground text-sm">Show on Leaderboard</p>
                <p className="text-xs text-muted-foreground">Others can see your name and XP</p>
              </div>
              <Switch checked={showOnLeaderboard} onCheckedChange={setShowOnLeaderboard} />
            </div>
          </section>

          {/* Subscription */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Heart className="h-4 w-4" />
              Subscription
            </div>
            <div className="p-3 rounded-xl bg-card border border-border space-y-2">
              <p className="text-sm font-medium text-foreground">
                {subscribed ? `Active plan: ${tier === 'allin' ? 'All-In' : 'Standard'}` : 'Free plan'}
              </p>
              <p className="text-xs text-muted-foreground">
                {subscribed
                  ? 'Manage billing, update payment method, or cancel anytime.'
                  : 'Upgrade to remove daily limits and unlock everything.'}
              </p>
              {subscribed ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleManageSubscription}
                  disabled={openingPortal}
                >
                  {openingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Manage subscription'}
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/pricing')}>
                  View plans
                </Button>
              )}
            </div>
          </section>

          {/* Save + Sign Out */}
          <div className="space-y-3 pb-8">
            <Button onClick={save} disabled={saving} className="w-full h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={handleSignOut} className="w-full h-11 text-destructive hover:text-destructive">
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default Settings;
