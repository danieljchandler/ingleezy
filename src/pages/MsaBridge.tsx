/**
 * MSA → Dialect Bridge home.
 *
 * Lets learners who already know Modern Standard Arabic toggle on a global
 * "Bridge view" and study the transformation rules (sound shifts, pronouns,
 * verb prefixes, vocab swaps) that take MSA forms to the active dialect.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { HomeButton } from "@/components/HomeButton";
import { useDialect } from "@/contexts/DialectContext";
import { useBridgeMode } from "@/hooks/useBridgeMode";
import { useMsaRules, type MsaRule, type MsaRuleCategory } from "@/hooks/useMsaRules";
import { ArrowRight, Volume2, Sparkles, BookOpen, Languages } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_META: Record<MsaRuleCategory, { label: string; arabic: string; tint: string }> = {
  sound_shift: { label: "Sound shifts",  arabic: "تَحَوُّلات صَوْتية", tint: "from-teal-500/15 to-teal-500/5 border-teal-500/30" },
  pronoun:     { label: "Pronouns",       arabic: "الضَّمائر",         tint: "from-amber-500/15 to-amber-500/5 border-amber-500/30" },
  verb_prefix: { label: "Verb prefixes",  arabic: "بَوادئ الأَفْعال",   tint: "from-rose-500/15 to-rose-500/5 border-rose-500/30" },
  vocab_swap:  { label: "Vocabulary swaps", arabic: "تَبْديل المُفْرَدات", tint: "from-indigo-500/15 to-indigo-500/5 border-indigo-500/30" },
};

const CATEGORY_ORDER: MsaRuleCategory[] = ["sound_shift", "pronoun", "verb_prefix", "vocab_swap"];

const BACKGROUND_OPTIONS = [
  { id: "none", label: "I don't know MSA" },
  { id: "beginner", label: "A little" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced / fluent" },
];

function RuleCard({ rule }: { rule: MsaRule }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-foreground text-sm sm:text-base">{rule.rule_name}</h3>
        {rule.example_audio_url && (
          <button
            type="button"
            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
            onClick={() => new Audio(rule.example_audio_url!).play().catch(() => {})}
            aria-label="Play example audio"
          >
            <Volume2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Pattern row: MSA → Dialect */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3">
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">MSA</p>
          <p className="font-arabic text-xl text-foreground/80" dir="rtl">{rule.msa_pattern}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-primary mx-1 -scale-x-100" />
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wide text-primary mb-0.5">Dialect</p>
          <p className="font-arabic text-xl text-primary font-semibold" dir="ltr">{rule.dialect_pattern}</p>
        </div>
      </div>

      {/* Example */}
      {(rule.example_msa || rule.example_dialect) && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-3 border-t border-border/60">
          <p className="font-arabic text-base text-muted-foreground text-right" dir="rtl">
            {rule.example_msa || "—"}
          </p>
          <ArrowRight className="h-3 w-3 text-muted-foreground -scale-x-100" />
          <p className="font-arabic text-base text-foreground text-left" dir="rtl">
            {rule.example_dialect || "—"}
          </p>
        </div>
      )}

      {rule.notes && (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{rule.notes}</p>
      )}
    </div>
  );
}

export default function MsaBridge() {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { enabled, setBridge, msaBackground, setBackground } = useBridgeMode();
  const { data: rules, isLoading } = useMsaRules(activeDialect);

  const grouped = useMemo(() => {
    const map = new Map<MsaRuleCategory, MsaRule[]>();
    (rules ?? []).forEach((r) => {
      const cat = r.category as MsaRuleCategory;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    });
    return map;
  }, [rules]);

  return (
    <AppShell>
      <HomeButton />

      {/* Hero */}
      <header className="mt-2 mb-6 rounded-3xl border-2 border-[#5C3A46]/30 bg-gradient-to-br from-[#F9F7F2] via-[#F3EDE2] to-[#E8DCC4]/60 p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Languages className="h-5 w-5 text-[#5C3A46]" />
            <Badge variant="outline" className="border-[#5C3A46]/40 text-[#5C3A46] bg-[#F9F7F2]/70">
              From MSA → {activeDialect}
            </Badge>
          </div>
          <h1
            className="text-2xl sm:text-3xl font-bold text-[#5C3A46] mb-2 leading-tight"
            style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            Bridge your Modern Standard Arabic into dialect
          </h1>
          <p className="text-sm sm:text-base text-[#5C3A46]/80 leading-relaxed max-w-prose">
            You already know <span className="font-arabic" dir="rtl">الفصحى</span>. Here's how it
            transforms into <span className="font-semibold">{activeDialect}</span> — sound by sound,
            word by word.
          </p>
        </div>
      </header>

      {/* Bridge view toggle */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5 flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">Show MSA next to dialect everywhere</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Flashcards, lessons, transcripts, reading — every screen will surface the MSA form
            when it's available.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setBridge} aria-label="Toggle Bridge view" />
      </section>

      {/* MSA background self-report */}
      <section className="mb-8">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Your MSA background
        </p>
        <div className="flex flex-wrap gap-2">
          {BACKGROUND_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setBackground(opt.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                msaBackground === opt.id
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Rules grouped by category */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : !rules || rules.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No bridge rules for <span className="font-semibold">{activeDialect}</span> yet —
            coming soon.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <section key={cat}>
                <div
                  className={cn(
                    "rounded-2xl border-2 bg-gradient-to-br p-3 mb-3 flex items-center justify-between",
                    meta.tint
                  )}
                >
                  <div>
                    <h2
                      className="font-bold text-foreground text-sm sm:text-base"
                      style={{ fontFamily: "'Montserrat', sans-serif" }}
                    >
                      {meta.label}
                    </h2>
                    <p className="font-arabic text-xs text-muted-foreground" dir="rtl">
                      {meta.arabic}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {items.length} {items.length === 1 ? "rule" : "rules"}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {items.map((rule) => <RuleCard key={rule.id} rule={rule} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Footer CTA */}
      <div className="mt-10 mb-6 flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => navigate("/my-words")}
        >
          See it in My Words
        </Button>
        <Button
          className="flex-1"
          onClick={() => { setBridge(true); navigate("/"); }}
        >
          Turn on Bridge & go home
        </Button>
      </div>
    </AppShell>
  );
}
