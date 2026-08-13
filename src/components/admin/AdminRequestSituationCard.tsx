import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Wand2, Check, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { toast } from "sonner";

const sb = supabase as any;

interface GeneratedPhrase {
  phrase_arabic: string;
  phrase_english: string;
  transliteration: string;
  notes?: string;
}

interface Props {
  occasions: Array<{ id: string; name: string }>;
  onSaved?: () => void;
}

const SUGGESTIONS = [
  "Ordering coffee at a café",
  "Bargaining at the souq",
  "Visiting someone at the hospital",
  "Comforting a grieving friend",
  "Meeting future in-laws",
];

export const AdminRequestSituationCard = ({ occasions, onSaved }: Props) => {
  const { activeDialect } = useDialect();
  const [situation, setSituation] = useState("");
  const [occasionId, setOccasionId] = useState<string>("");
  const [count, setCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phrases, setPhrases] = useState<GeneratedPhrase[]>([]);
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());

  const generate = async () => {
    const s = situation.trim();
    if (s.length < 3) {
      toast.error("Describe the situation in a sentence or two.");
      return;
    }
    setLoading(true);
    setPhrases([]);
    setSavedIdx(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("request-situation-phrases", {
        body: { situation: s, dialect: activeDialect, count },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      setPhrases(((data as any)?.phrases ?? []) as GeneratedPhrase[]);
      if (!((data as any)?.phrases ?? []).length) toast.error("No phrases returned");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate phrases");
    } finally {
      setLoading(false);
    }
  };

  const insertOne = async (p: GeneratedPhrase) => {
    const { error } = await sb.from("set_phrases").insert({
      dialect: activeDialect,
      occasion_id: occasionId || null,
      phrase_arabic: p.phrase_arabic,
      phrase_transliteration: p.transliteration || null,
      phrase_english: p.phrase_english || null,
      cultural_note: p.notes || null,
      scenario_english: situation.trim(),
      formality: "neutral",
      difficulty: "A2",
      status: "draft",
      tags: ["situation-request"],
    });
    if (error) throw error;
  };

  const saveOne = async (i: number) => {
    try {
      await insertOne(phrases[i]);
      setSavedIdx((prev) => new Set(prev).add(i));
      toast.success("Added to drafts");
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    }
  };

  const saveAll = async () => {
    setSaving(true);
    let ok = 0;
    for (let i = 0; i < phrases.length; i++) {
      if (savedIdx.has(i)) continue;
      try {
        await insertOne(phrases[i]);
        setSavedIdx((prev) => new Set(prev).add(i));
        ok++;
      } catch {
        // skip
      }
    }
    setSaving(false);
    toast.success(`Added ${ok} draft phrases for review`);
    onSaved?.();
  };

  return (
    <Card className="p-4 mb-4 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
          <Wand2 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Request situational phrases ({activeDialect})</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Generate phrases for a specific situation. They land in the draft queue below for your review and approval.
          </p>
        </div>
      </div>

      <Textarea
        value={situation}
        onChange={(e) => setSituation(e.target.value)}
        placeholder="e.g. Comforting someone whose father just passed away"
        className="min-h-[64px]"
        disabled={loading}
      />

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSituation(s)}
            disabled={loading}
            className="text-[11px] px-2 py-1 rounded-full bg-background border border-border hover:border-amber-500/40 text-muted-foreground"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Occasion (optional)
          <select
            value={occasionId}
            onChange={(e) => setOccasionId(e.target.value)}
            className="border rounded px-2 py-1.5 bg-background text-sm"
            disabled={loading}
          >
            <option value="">— none —</option>
            {occasions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Count
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="border rounded px-2 py-1.5 bg-background text-sm"
            disabled={loading}
          >
            {[4, 6, 8, 10].map((n) => (
              <option key={n} value={n}>{n} phrases</option>
            ))}
          </select>
        </label>
      </div>

      <Button onClick={generate} disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
        {loading ? "Generating…" : "Generate phrases"}
      </Button>

      {phrases.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {phrases.length} phrases
            </p>
            <Button size="sm" variant="outline" onClick={saveAll} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add all to drafts
            </Button>
          </div>
          {phrases.map((p, i) => (
            <div key={i} className="p-3 rounded-lg bg-card border border-border">
              <p className="text-lg font-semibold" dir="rtl" style={{ fontFamily: "'Noto Sans Arabic', sans-serif" }}>
                {p.phrase_arabic}
              </p>
              {p.transliteration && (
                <p className="text-xs italic text-muted-foreground mt-0.5">{p.transliteration}</p>
              )}
              <p className="text-sm mt-1">{p.phrase_english}</p>
              {p.notes && <p className="text-[11px] text-muted-foreground mt-1">{p.notes}</p>}
              <div className="flex justify-end mt-2">
                {savedIdx.has(i) ? (
                  <Button size="sm" variant="ghost" disabled className="text-emerald-600">
                    <Check className="h-3.5 w-3.5 mr-1" /> Added
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => saveOne(i)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add to drafts
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
