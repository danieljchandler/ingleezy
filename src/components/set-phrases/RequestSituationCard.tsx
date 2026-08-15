import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Plus, Check, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import { toast } from "sonner";

interface GeneratedPhrase {
  phrase_arabic: string;
  phrase_english: string;
  literal?: string;
  transliteration: string;
  notes?: string;
}

const SUGGESTIONS = [
  "تطلب قهوة في كافيه",
  "مقابلة وظيفية بالإنجليزي",
  "تسجّل وصولك في المطار",
  "تكلّم خدمة العملاء",
  "تتعرّف على زملاء جدد",
];

export const RequestSituationCard = () => {
  const { activeDialect } = useDialect();
  const addPhrase = useAddUserPhrase();
  const [situation, setSituation] = useState("");
  const [loading, setLoading] = useState(false);
  const [phrases, setPhrases] = useState<GeneratedPhrase[]>([]);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const generate = async () => {
    const s = situation.trim();
    if (s.length < 3) {
      toast.error("اوصف الموقف بجملة أو جملتين.");
      return;
    }
    setLoading(true);
    setPhrases([]);
    setSaved(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("request-situation-phrases", {
        body: { situation: s, dialect: activeDialect, count: 6 },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
      setPhrases(((data as any)?.phrases ?? []) as GeneratedPhrase[]);
      if (!((data as any)?.phrases ?? []).length) toast.error("ما رجعت عبارات، جرّب صياغة ثانية.");
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر توليد العبارات");
    } finally {
      setLoading(false);
    }
  };

  const save = async (idx: number) => {
    const p = phrases[idx];
    try {
      await addPhrase.mutateAsync({
        phrase_arabic: p.phrase_arabic,
        phrase_english: p.phrase_english,
        transliteration: p.transliteration,
        notes: p.notes || undefined,
        source: `situation:${situation.trim().slice(0, 80)}`,
        dialect: activeDialect,
      });
      setSaved((prev) => new Set(prev).add(idx));
      toast.success("حفظناها في عباراتي");
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر الحفظ");
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < phrases.length; i++) {
      if (saved.has(i)) continue;
      try {
        await addPhrase.mutateAsync({
          phrase_arabic: phrases[i].phrase_arabic,
          phrase_english: phrases[i].phrase_english,
          transliteration: phrases[i].transliteration,
          notes: phrases[i].notes || undefined,
          source: `situation:${situation.trim().slice(0, 80)}`,
          dialect: activeDialect,
        });
        setSaved((prev) => new Set(prev).add(i));
      } catch {
        // ignore individual failures (likely duplicates)
      }
    }
    toast.success("حفظنا كل العبارات");
  };

  return (
    <Card className="p-4 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
          <Wand2 className="h-5 w-5 text-amber-700 dark:text-amber-300" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">تبي عبارات لموقف معيّن؟</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Describe the situation — in Arabic or English — and AI will generate
            natural English phrases, glossed in {activeDialect} Arabic, you can save.
          </p>
        </div>
      </div>

      <Textarea
        value={situation}
        onChange={(e) => setSituation(e.target.value)}
        placeholder="مثلاً: تطلب من مديرك إجازة يوم"
        className="mt-3 min-h-[64px]"
        disabled={loading}
      />

      <div className="flex flex-wrap gap-1.5 mt-2">
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

      <Button onClick={generate} disabled={loading} className="w-full mt-3">
        {loading ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Sparkles className="h-4 w-4 me-1" />}
        {loading ? "نولّد…" : "ولّد عبارات"}
      </Button>

      {phrases.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {phrases.length} phrases
            </p>
            <Button size="sm" variant="outline" onClick={saveAll} disabled={addPhrase.isPending}>
              احفظ الكل
            </Button>
          </div>
          {phrases.map((p, i) => (
            <div
              key={i}
              className="p-3 rounded-lg bg-card border border-border"
            >
              <p className="text-lg font-semibold font-english">
                {p.phrase_english}
              </p>
              {p.transliteration && (
                <p className="text-xs text-muted-foreground mt-0.5 font-arabic" dir="rtl">{p.transliteration}</p>
              )}
              <p className="text-sm mt-1 font-arabic" dir="rtl" style={{ fontFamily: "'Noto Sans Arabic', sans-serif" }}>
                {p.phrase_arabic}
              </p>
              {p.literal && (
                <p className="text-xs text-muted-foreground/80 mt-0.5 font-arabic" dir="rtl">
                  <span className="uppercase tracking-wide text-[9px] ms-1 text-muted-foreground/60">
                    حرفي
                  </span>
                  {p.literal}
                </p>
              )}
              {p.notes && <p className="text-[11px] text-muted-foreground mt-1 font-arabic" dir="rtl">{p.notes}</p>}
              <div className="flex justify-end mt-2">
                {saved.has(i) ? (
                  <Button size="sm" variant="ghost" disabled className="text-emerald-600">
                    <Check className="h-3.5 w-3.5 me-1" /> محفوظة
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => save(i)} disabled={addPhrase.isPending}>
                    <Plus className="h-3.5 w-3.5 me-1" /> Save
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
