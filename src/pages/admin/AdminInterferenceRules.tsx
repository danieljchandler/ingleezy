import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Check, Archive, Trash2, ArrowLeft, Pencil, Save, X, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * The L1-Interference Rulebook — the English-target mirror of the Dialect
 * Rulebook. Rows document how Arabic speakers' L1 shapes their English
 * (article drops, copula omission, /p/→/b/, calques …). Approved rules are
 * rendered into every English-target generation prompt (englishHelpers.ts),
 * and the matchable categories feed the transfer-error detector.
 *
 * Simpler than AdminDialectRules by design: no violations digest, no native
 * review, no AI drafter yet — this manages a curated linguistic inventory,
 * not a mined stream.
 */

type RuleStatus = 'draft' | 'approved' | 'retired';
type RuleSource = 'manual' | 'ai_generated' | 'corpus_mined';

// Mirrors the CHECK constraint on interference_rules.category.
const CATEGORIES = [
  'article',
  'copula',
  'phonology',
  'preposition',
  'calque',
  'word_order',
  'morphology',
  'spelling',
  'register',
] as const;

// Rules apply to all Arabic speakers unless scoped to one L1 dialect.
const DIALECT_SCOPES = ['All', 'Gulf', 'Egyptian', 'Yemeni'] as const;

interface Rule {
  id: string;
  dialect: string | null;
  category: string;
  rule: string;
  explanation_ar: string | null;
  examples: { good?: string[]; bad?: string[] } | null;
  priority: number;
  status: RuleStatus;
  source: RuleSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_BADGE: Record<RuleStatus, string> = {
  draft: 'bg-amber-500/15 text-amber-700 border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  retired: 'bg-muted text-muted-foreground border-border',
};

/** Categories the transfer detector string-matches; the rest are prompt-only. */
const DETECTABLE = new Set(['calque', 'preposition', 'spelling']);

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

interface RuleFormState {
  dialect: string;
  category: string;
  rule: string;
  explanation_ar: string;
  good: string;
  bad: string;
  priority: number;
  notes: string;
}

const emptyForm: RuleFormState = {
  dialect: 'All',
  category: 'article',
  rule: '',
  explanation_ar: '',
  good: '',
  bad: '',
  priority: 3,
  notes: '',
};

function RuleForm({
  value,
  onChange,
}: {
  value: RuleFormState;
  onChange: (next: RuleFormState) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Applies to speakers of</label>
          <Select value={value.dialect} onValueChange={(dialect) => onChange({ ...value, dialect })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIALECT_SCOPES.map((d) => (
                <SelectItem key={d} value={d}>{d === 'All' ? 'All Arabic speakers' : d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Category</label>
          <Select value={value.category} onValueChange={(category) => onChange({ ...value, category })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}{DETECTABLE.has(c) ? ' (detector-matched)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Priority (1–5)</label>
          <Input
            type="number"
            min={1}
            max={5}
            value={value.priority}
            onChange={(e) =>
              onChange({ ...value, priority: Math.max(1, Math.min(5, Number(e.target.value) || 3)) })
            }
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Rule (English, for the generation prompt)
        </label>
        <Textarea
          placeholder="e.g. Arabic has no indefinite article, so learners drop a/an…"
          value={value.rule}
          onChange={(e) => onChange({ ...value, rule: e.target.value })}
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Explanation for learners (Arabic — Fusha)
        </label>
        <Textarea
          dir="rtl"
          className="font-arabic"
          placeholder="لا توجد أداة تنكير في العربية…"
          value={value.explanation_ar}
          onChange={(e) => onChange({ ...value, explanation_ar: e.target.value })}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            ❌ Arabic-shaped English (one per line)
          </label>
          <Textarea
            placeholder={'I am student\nopen the light'}
            value={value.bad}
            onChange={(e) => onChange({ ...value, bad: e.target.value })}
            rows={3}
          />
          {DETECTABLE.has(value.category) && (
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2">
              This category feeds the transfer-error detector: each ❌ line is matched
              literally in learner English, and the ✅ line at the same position becomes
              its suggestion. Keep lines short (≤5 words), English-only, and wrong in{' '}
              <em>any</em> context.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            ✅ Natural English (aligned by line)
          </label>
          <Textarea
            placeholder={'I am a student\nturn on the light'}
            value={value.good}
            onChange={(e) => onChange({ ...value, good: e.target.value })}
            rows={3}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Notes (internal)</label>
        <Input
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

function toPatch(form: RuleFormState) {
  return {
    dialect: form.dialect === 'All' ? null : form.dialect,
    category: form.category,
    rule: form.rule.trim(),
    explanation_ar: form.explanation_ar.trim() || null,
    priority: form.priority,
    notes: form.notes.trim() || null,
    examples: { good: lines(form.good), bad: lines(form.bad) },
  };
}

const AdminInterferenceRules = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<RuleFormState>(emptyForm);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['interference_rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interference_rules' as never)
        .select('*')
        .order('priority', { ascending: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
  });

  const grouped = useMemo(() => {
    const g = { draft: [], approved: [], retired: [] } as Record<RuleStatus, Rule[]>;
    (rules ?? []).forEach((r) => g[r.status]?.push(r));
    return g;
  }, [rules]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.rule.trim()) throw new Error('The rule text is required.');
      const { error } = await supabase
        .from('interference_rules' as never)
        .insert([{ ...toPatch(form), status: 'draft', source: 'manual' }] as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule drafted' });
      setForm(emptyForm);
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['interference_rules'] });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Failed to create rule', description: err.message }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="text-right">
            <h1 className="text-2xl font-semibold">Interference Rulebook</h1>
            <p className="text-sm text-muted-foreground">
              How Arabic shapes learners' English — steering every English generation
            </p>
          </div>
        </div>

        <Card className="border-primary/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">New rule</CardTitle>
            {!creating && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add rule
              </Button>
            )}
          </CardHeader>
          {creating && (
            <CardContent className="space-y-3">
              <RuleForm value={form} onChange={setForm} />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
                  {create.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1" />
                  )}
                  Save draft
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="approved" className="w-full">
            <TabsList>
              <TabsTrigger value="draft">
                Drafts <Badge variant="outline" className="ml-2">{grouped.draft.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="approved">
                Approved <Badge variant="outline" className="ml-2">{grouped.approved.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="retired">
                Retired <Badge variant="outline" className="ml-2">{grouped.retired.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {(['draft', 'approved', 'retired'] as RuleStatus[]).map((s) => (
              <TabsContent key={s} value={s} className="space-y-3 mt-4">
                {grouped[s].length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No {s} rules.</p>
                ) : (
                  grouped[s].map((r) => <RuleRow key={r.id} rule={r} />)
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
};

const RuleRow = ({ rule }: { rule: Rule }) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const fromRule = (): RuleFormState => ({
    dialect: rule.dialect ?? 'All',
    category: rule.category,
    rule: rule.rule,
    explanation_ar: rule.explanation_ar ?? '',
    good: (rule.examples?.good ?? []).join('\n'),
    bad: (rule.examples?.bad ?? []).join('\n'),
    priority: rule.priority,
    notes: rule.notes ?? '',
  });
  const [draft, setDraft] = useState<RuleFormState>(fromRule);

  useEffect(() => {
    setDraft(fromRule());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['interference_rules'] });

  const updateStatus = useMutation({
    mutationFn: async (status: RuleStatus) => {
      const patch: Record<string, unknown> = { status };
      if (status === 'approved') {
        const { data: u } = await supabase.auth.getUser();
        patch.approved_by = u.user?.id;
        patch.approved_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from('interference_rules' as never)
        .update(patch as never)
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      toast({ title: `Rule ${status}` });
      invalidate();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('interference_rules' as never)
        .delete()
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule deleted' });
      invalidate();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('interference_rules' as never)
        .update(toPatch(draft) as never)
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule saved' });
      setEditing(false);
      invalidate();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const good = rule.examples?.good ?? [];
  const bad = rule.examples?.bad ?? [];

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE[rule.status]}>{rule.status}</Badge>
          <Badge variant="outline">{rule.dialect ?? 'All dialects'}</Badge>
          <Badge variant="outline">P{rule.priority}</Badge>
          <Badge variant="outline">{rule.category}</Badge>
          {DETECTABLE.has(rule.category) && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              detector
            </Badge>
          )}
          <div className="flex-1" />
          {!editing && (
            <>
              {rule.status !== 'approved' && (
                <Button size="sm" variant="default" onClick={() => updateStatus.mutate('approved')}>
                  <Check className="h-4 w-4 mr-1" /> Approve
                </Button>
              )}
              {rule.status !== 'retired' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('retired')}>
                  <Archive className="h-4 w-4 mr-1" /> Retire
                </Button>
              )}
              {rule.status === 'retired' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('draft')}>
                  Reopen
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm('Delete this rule permanently?')) remove.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <RuleForm value={draft} onChange={setDraft} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm">{rule.rule}</p>
            {rule.explanation_ar && (
              <p className="text-sm font-arabic text-muted-foreground" dir="rtl">
                {rule.explanation_ar}
              </p>
            )}
            {(bad.length > 0 || good.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="space-y-1">
                  {bad.map((b, i) => (
                    <p key={i} className="text-destructive/90">❌ {b}</p>
                  ))}
                </div>
                <div className="space-y-1">
                  {good.map((g, i) => (
                    <p key={i} className="text-emerald-700 dark:text-emerald-400">✅ {g}</p>
                  ))}
                </div>
              </div>
            )}
            {rule.notes && <p className="text-xs text-muted-foreground">{rule.notes}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminInterferenceRules;
