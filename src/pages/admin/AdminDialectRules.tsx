import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDialect } from '@/contexts/DialectContext';
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
import { Loader2, Sparkles, Check, Archive, Trash2, ArrowLeft, Pencil, Save, X, AlertTriangle, RefreshCw, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RuleStatus = 'draft' | 'approved' | 'retired';
type RuleSource = 'manual' | 'ai_generated' | 'corpus_mined';

interface Rule {
  id: string;
  dialect: string;
  category: string;
  rule: string;
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

const SOURCE_BADGE: Record<RuleSource, string> = {
  manual: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  ai_generated: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  corpus_mined: 'bg-teal-500/10 text-teal-700 border-teal-500/30',
};

// Per-dialect words that are valid (or dialect-neutral) and must NEVER end
// up as forbidden tokens. Kept in sync with ALWAYS_ALLOWED in
// supabase/functions/_shared/msaLeakDetector.ts so admins get the same
// guidance the runtime detector uses.
const ADMIN_ALWAYS_ALLOWED: Record<string, string[]> = {
  Gulf: ['أنا','هو','هي','من','في','ما','لي','لك','معي','اليوم','بكرة','أمس','البيت','بيت','الكتاب','السوق','القهوة','صديقي','حالك','كبير','صغير','كيف','وين','شلون','شلونك','شو','هالحين','بغيت','أبي','يبي','زين','كويس','مرحبا'],
  Egyptian: ['أنا','هو','هي','من','في','ما','لي','لك','معي','النهارده','بكرة','إمبارح','البيت','بيت','الكتاب','السوق','القهوة','صحبي','صاحبي','كبير','صغير','كيف','إزاي','فين','ليه','كده','ده','دي','عايز','عاوز','كويس','مرحبا','أهلا'],
  Yemeni: ['أنا','هو','هي','من','في','ما','لي','لك','معي','اليوم','بكرة','أمس','البيت','بيت','الكتاب','السوق','القهوة','صديقي','صاحبي','حالك','كبير','صغير','كيف','كيفك','وين','ليش','ذحين','ذلحين','الحين','لاحين','بغيت','يبغى','أبغى','أبي','أشتي','أشرب','شلون','شلونك','شفيك','وش','زين','هني','مرة','قات','شو','هذا','هذه','عندما','بس','اللي','مش','مو','عشان','أيش','حق','شوي','لما','زي','طيب','عاد','ذا','ذي'],
};

function normalizeArabicClient(s: string): string {
  if (!s) return '';
  return s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\s+/g, ' ')
    .trim();
}

function BadExamplesHelp({ value, dialect }: { value: string; dialect: string }) {
  const allowedRaw = ADMIN_ALWAYS_ALLOWED[dialect] ?? [];
  const allowed = new Set(allowedRaw.map(normalizeArabicClient));
  const warnings: { line: string; reason: string }[] = [];
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const words = line.split(/\s+/).filter((w) => /[\u0600-\u06FF]/.test(w));
    if (words.length > 2) {
      warnings.push({ line, reason: `${words.length} words — bad examples should be a single MSA token, not a full sentence.` });
      continue;
    }
    for (const w of words) {
      const norm = normalizeArabicClient(w.replace(/^[\p{P}]+|[\p{P}]+$/gu, ''));
      if (allowed.has(norm)) {
        warnings.push({ line, reason: `"${w}" is a valid ${dialect} word and will be ignored by the detector.` });
        break;
      }
    }
  }
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded p-2">
        <span className="font-medium text-foreground">What to enter:</span>{' '}
        ONLY forms that are <em>always</em> wrong in this dialect (e.g.{' '}
        <span className="font-arabic">ليس</span>, <span className="font-arabic">لماذا</span>,{' '}
        <span className="font-arabic">أريد</span>, <span className="font-arabic">الآن</span>).
        Do NOT paste full MSA sentences — neutral words inside them (like{' '}
        <span className="font-arabic">البيت</span>, <span className="font-arabic">كيف</span>,{' '}
        <span className="font-arabic">أنا</span>) would get flagged as leaks.
        For contrastive “say X, not Y” pairs, use a <code>msa_substitutions</code> rule instead —
        those are not fed to the leak detector.
      </div>
      {warnings.length > 0 && (
        <div className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-2 space-y-1">
          <div className="font-medium flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> These lines may produce false positives:
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>
                <span className="font-arabic" dir="rtl">{w.line}</span> — {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatExample(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Prefer dialect-language fields first
    const primary = o.dialect ?? o.ar ?? o.arabic ?? o.text;
    const secondary = o.msa ?? o.en ?? o.english ?? o.translation ?? o.gloss;
    if (primary && secondary) return `${String(primary)} — ${String(secondary)}`;
    if (primary) return String(primary);
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

const AdminDialectRules = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [category, setCategory] = useState('');
  const [count, setCount] = useState(6);
  const [guidance, setGuidance] = useState('');
  const [generating, setGenerating] = useState(false);
  const [mining, setMining] = useState(false);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['dialect_rules', activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dialect_rules' as any)
        .select('*')
        .eq('dialect', activeDialect)
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

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-dialect-rules', {
        body: {
          dialect: activeDialect,
          category: category.trim() || undefined,
          guidance: guidance.trim() || undefined,
          count,
        },
      });
      if (error) throw error;
      toast({
        title: 'Drafting in background',
        description:
          data?.message ??
          'The council is working on it. You can navigate away — drafts will appear in the Draft tab in ~1–3 minutes.',
      });
      setGuidance('');
      // Poll for new drafts for the next 4 minutes, then stop.
      const dialectAtStart = activeDialect;
      const start = Date.now();
      const interval = window.setInterval(() => {
        qc.invalidateQueries({ queryKey: ['dialect_rules', dialectAtStart] });
        if (Date.now() - start > 4 * 60 * 1000) {
          window.clearInterval(interval);
        }
      }, 15000);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to draft rules',
        description: (err as Error)?.message ?? 'Unknown error',
      });
    } finally {
      setGenerating(false);
    }
  };

  const mineCorpus = async () => {
    setMining(true);
    try {
      const { data, error } = await supabase.functions.invoke('mine-dialect-corpus', {
        body: {
          dialect: activeDialect,
          category: category.trim() || undefined,
          count,
        },
      });
      if (error) throw error;
      toast({
        title: 'Corpus mined',
        description: `${data?.inserted ?? 0} draft(s) from ${data?.corpus_size ?? 0} snippets.`,
      });
      qc.invalidateQueries({ queryKey: ['dialect_rules', activeDialect] });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Corpus mining failed',
        description: (err as Error)?.message ?? 'Unknown error',
      });
    } finally {
      setMining(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="text-right">
            <h1 className="text-2xl font-semibold">Dialect Rulebook</h1>
            <p className="text-sm text-muted-foreground">
              Rules powering every AI generation for{' '}
              <span className="font-medium">{activeDialect}</span>
            </p>
          </div>
        </div>

        {/* AI drafter */}
        <Card className="border-purple-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Ask the AI council to propose new rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Category (optional)</label>
                <Input
                  placeholder="e.g. negation, pronouns"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Count</label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={generate}
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Draft rules
                </Button>
              </div>
            </div>
            <Textarea
              placeholder="Guidance for the council (optional). e.g. 'Focus on Saudi vs Emirati differences in question words.'"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={2}
            />
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Or mine real published content for this dialect and let the council generalize patterns:
              </p>
              <Button variant="outline" size="sm" onClick={mineCorpus} disabled={mining}>
                {mining ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Mine corpus
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Rules tabs */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="draft" className="w-full">
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
              <TabsTrigger value="violations">
                <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Violations
              </TabsTrigger>
              <TabsTrigger value="native_review">
                <UserCheck className="h-3.5 w-3.5 mr-1" /> Native Review
              </TabsTrigger>
            </TabsList>

            {(['draft', 'approved', 'retired'] as RuleStatus[]).map((s) => (
              <TabsContent key={s} value={s} className="space-y-3 mt-4">
                {grouped[s].length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No {s} rules.
                  </p>
                ) : (
                  grouped[s].map((r) => <RuleRow key={r.id} rule={r} dialect={activeDialect} />)
                )}
              </TabsContent>
            ))}

            <TabsContent value="violations" className="mt-4">
              <ViolationsPanel dialect={activeDialect} />
            </TabsContent>

            <TabsContent value="native_review" className="mt-4">
              <NativeReviewPanel dialect={activeDialect} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
};

interface RuleRowProps {
  rule: Rule;
  dialect: string;
}

const RuleRow = ({ rule, dialect }: RuleRowProps) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    rule: rule.rule,
    category: rule.category,
    priority: rule.priority,
    notes: rule.notes ?? '',
    good: (rule.examples?.good ?? []).map(formatExample).join('\n'),
    bad: (rule.examples?.bad ?? []).map(formatExample).join('\n'),
  });

  useEffect(() => {
    setDraft({
      rule: rule.rule,
      category: rule.category,
      priority: rule.priority,
      notes: rule.notes ?? '',
      good: (rule.examples?.good ?? []).map(formatExample).join('\n'),
      bad: (rule.examples?.bad ?? []).map(formatExample).join('\n'),
    });
  }, [rule]);

  const updateStatus = useMutation({
    mutationFn: async (status: RuleStatus) => {
      const patch: any = { status };
      if (status === 'approved') {
        const { data: u } = await supabase.auth.getUser();
        patch.approved_by = u.user?.id;
        patch.approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from('dialect_rules' as any).update(patch).eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      toast({ title: `Rule ${status}` });
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('dialect_rules' as any).delete().eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule deleted' });
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('dialect_rules' as any)
        .update({
          rule: draft.rule.trim(),
          category: draft.category.trim() || 'general',
          priority: Math.max(1, Math.min(5, Number(draft.priority) || 3)),
          notes: draft.notes.trim() || null,
          examples: {
            good: draft.good.split('\n').map((s) => s.trim()).filter(Boolean),
            bad: draft.bad.split('\n').map((s) => s.trim()).filter(Boolean),
          },
          version: undefined, // let it stay; could bump if desired
        })
        .eq('id', rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Rule saved' });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE[rule.status]}>{rule.status}</Badge>
          <Badge variant="outline" className={SOURCE_BADGE[rule.source]}>{rule.source}</Badge>
          <Badge variant="outline">P{rule.priority}</Badge>
          <Badge variant="outline">{rule.category}</Badge>
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
            <Textarea value={draft.rule} onChange={(e) => setDraft({ ...draft, rule: e.target.value })} rows={3} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="category"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
              <Select
                value={String(draft.priority)}
                onValueChange={(v) => setDraft({ ...draft, priority: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>Priority {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Good examples (one per line)</label>
                <Textarea
                  dir="rtl"
                  className="font-arabic"
                  value={draft.good}
                  onChange={(e) => setDraft({ ...draft, good: e.target.value })}
                  rows={4}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bad examples (one per line)</label>
                <Textarea
                  dir="rtl"
                  className="font-arabic"
                  value={draft.bad}
                  onChange={(e) => setDraft({ ...draft, bad: e.target.value })}
                  rows={4}
                />
                <BadExamplesHelp value={draft.bad} dialect={rule.dialect} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed">{rule.rule}</p>
            {(rule.examples?.good?.length || rule.examples?.bad?.length) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {rule.examples?.good?.length ? (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
                    <div className="text-xs text-emerald-700 font-medium mb-1">Good</div>
                    <ul dir="rtl" className="space-y-0.5">
                      {rule.examples.good.map((g, i) => <li key={i}>{formatExample(g)}</li>)}
                    </ul>
                  </div>
                ) : null}
                {rule.examples?.bad?.length ? (
                  <div className="bg-red-500/5 border border-red-500/20 rounded p-2">
                    <div className="text-xs text-red-700 font-medium mb-1">Bad / MSA</div>
                    <ul dir="rtl" className="space-y-0.5">
                      {rule.examples.bad.map((b, i) => <li key={i}>{formatExample(b)}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {rule.notes && (
              <p className="text-xs text-muted-foreground italic">{rule.notes}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

interface DigestResponse {
  windowDays: number;
  totals: { all: number; byDialect: Record<string, number> };
  topTokens: { token: string; count: number }[];
  topFunctions: { fn: string; count: number }[];
  samples: {
    id: string;
    dialect: string;
    token: string | null;
    function: string | null;
    created_at: string;
    snippet: string;
    resolved: boolean;
  }[];
}

const ViolationsPanel = ({ dialect }: { dialect: string }) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [includeResolved, setIncludeResolved] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dialect_violations_digest', dialect, days, includeResolved],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<DigestResponse>(
        'dialect-violations-digest',
        { body: { dialect, days, includeResolved } },
      );
      if (error) throw error;
      return data!;
    },
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('dialect_rule_violations' as any)
        .update({ resolved: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Marked resolved' });
      qc.invalidateQueries({ queryKey: ['dialect_violations_digest', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Window</label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24h</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={includeResolved ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIncludeResolved((v) => !v)}
          >
            {includeResolved ? 'Showing all' : 'Unresolved only'}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No digest data.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Total leaks</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{data.totals.all}</div>
                <p className="text-xs text-muted-foreground">in last {data.windowDays} day(s) for {dialect}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top MSA tokens</CardTitle></CardHeader>
              <CardContent>
                {data.topTokens.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None 🎉</p>
                ) : (
                  <ul dir="rtl" className="space-y-1 font-arabic text-sm">
                    {data.topTokens.slice(0, 8).map((t) => (
                      <li key={t.token} className="flex justify-between">
                        <span>{t.token}</span>
                        <Badge variant="outline">{t.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top source flows</CardTitle></CardHeader>
              <CardContent>
                {data.topFunctions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.topFunctions.slice(0, 8).map((f) => (
                      <li key={f.fn} className="flex justify-between">
                        <span className="truncate mr-2">{f.fn}</span>
                        <Badge variant="outline">{f.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent samples</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.samples.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No samples in this window.</p>
              ) : (
                data.samples.map((s) => (
                  <div key={s.id} className="border border-border rounded p-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {s.token && <Badge variant="outline" className="font-arabic">{s.token}</Badge>}
                      <Badge variant="outline">{s.function ?? 'unknown'}</Badge>
                      <span className="text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
                      {s.resolved && <Badge variant="outline" className="text-emerald-700">resolved</Badge>}
                      <div className="flex-1" />
                      {!s.resolved && (
                        <Button size="sm" variant="ghost" onClick={() => resolve.mutate(s.id)}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Resolve
                        </Button>
                      )}
                    </div>
                    <p dir="rtl" className="text-sm font-arabic whitespace-pre-wrap leading-relaxed">
                      {s.snippet}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

interface NativeReview {
  id: string;
  dialect: string;
  content_type: string;
  original_text: string;
  corrected_text: string | null;
  reviewer_notes: string | null;
  status: 'pending' | 'corrected' | 'dismissed';
  source: string;
  source_function: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const NativeReviewPanel = ({ dialect }: { dialect: string }) => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [drafts, setDrafts] = useState<Record<string, { corrected: string; notes: string }>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['dialect_native_reviews', dialect, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('dialect_native_reviews' as any)
        .select('*')
        .eq('dialect', dialect)
        .order('created_at', { ascending: false })
        .limit(100);
      if (statusFilter === 'pending') q = q.eq('status', 'pending');
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as NativeReview[];
    },
  });

  const submit = useMutation({
    mutationFn: async ({ id, status, corrected, notes, original }: { id: string; status: 'corrected' | 'dismissed'; corrected?: string; notes?: string; original?: string }) => {
      const { data: u } = await supabase.auth.getUser();
      const patch: any = { status, reviewer_id: u.user?.id ?? null };
      if (corrected != null) patch.corrected_text = corrected;
      if (notes != null) patch.reviewer_notes = notes;
      const { error } = await supabase.from('dialect_native_reviews' as any).update(patch).eq('id', id);
      if (error) throw error;

      // When a correction is provided, auto-draft a new dialect rule from the pair.
      if (status === 'corrected' && corrected?.trim() && original?.trim()) {
        await supabase.from('dialect_rules' as any).insert([{
          dialect,
          category: 'native_fix',
          rule: `Use authentic ${dialect} phrasing as in the corrected example. ${notes?.trim() || ''}`.trim(),
          examples: { good: [corrected.trim()], bad: [original.trim()] },
          priority: 3,
          status: 'draft',
          source: 'manual',
          notes: 'Auto-drafted from native review correction.',
          created_by: u.user?.id ?? null,
        }] as any);
      }
    },
    onSuccess: (_d, vars) => {
      toast({ title: vars.status === 'corrected' ? 'Correction saved' : 'Dismissed' });
      qc.invalidateQueries({ queryKey: ['dialect_native_reviews', dialect] });
      qc.invalidateQueries({ queryKey: ['dialect_rules', dialect] });
    },
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Failed', description: err.message }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <Button
            variant={statusFilter === 'pending' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('pending')}
          >
            Pending
          </Button>
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('all')}
          >
            All
          </Button>
          <p className="text-xs text-muted-foreground ml-auto">
            Approved corrections become draft rules for review.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No review items.</p>
      ) : (
        data.map((r) => {
          const d = drafts[r.id] ?? { corrected: r.corrected_text ?? '', notes: r.reviewer_notes ?? '' };
          const setD = (patch: Partial<typeof d>) => setDrafts((prev) => ({ ...prev, [r.id]: { ...d, ...patch } }));
          return (
            <Card key={r.id}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{r.status}</Badge>
                  <Badge variant="outline">{r.source}</Badge>
                  {r.source_function && <Badge variant="outline">{r.source_function}</Badge>}
                  <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Original</div>
                  <p dir="rtl" className="text-sm font-arabic bg-red-500/5 border border-red-500/20 rounded p-2 whitespace-pre-wrap leading-relaxed">
                    {r.original_text}
                  </p>
                </div>
                {r.status === 'pending' ? (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground">Correction (authentic dialect)</label>
                      <Textarea
                        dir="rtl"
                        className="font-arabic"
                        value={d.corrected}
                        onChange={(e) => setD({ corrected: e.target.value })}
                        rows={3}
                      />
                    </div>
                    <Input
                      placeholder="Reviewer notes (optional)"
                      value={d.notes}
                      onChange={(e) => setD({ notes: e.target.value })}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => submit.mutate({ id: r.id, status: 'dismissed', notes: d.notes })}
                      >
                        <X className="h-4 w-4 mr-1" /> Dismiss
                      </Button>
                      <Button
                        size="sm"
                        disabled={!d.corrected.trim() || submit.isPending}
                        onClick={() => submit.mutate({ id: r.id, status: 'corrected', corrected: d.corrected, notes: d.notes, original: r.original_text })}
                      >
                        <Check className="h-4 w-4 mr-1" /> Save correction
                      </Button>
                    </div>
                  </>
                ) : (
                  r.corrected_text && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Correction</div>
                      <p dir="rtl" className="text-sm font-arabic bg-emerald-500/5 border border-emerald-500/20 rounded p-2 whitespace-pre-wrap leading-relaxed">
                        {r.corrected_text}
                      </p>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
};

export default AdminDialectRules;


