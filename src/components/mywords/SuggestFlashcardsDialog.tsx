import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserVocabulary, useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { toast } from "sonner";

interface Suggestion {
  word_arabic: string;
  word_english: string;
  transliteration?: string;
  root?: string;
  example_arabic?: string;
  example_english?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SuggestFlashcardsDialog = ({ open, onOpenChange }: Props) => {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const { activeDialect } = useDialect();
  const { data: existingWords } = useUserVocabulary(true);
  const addWord = useAddUserVocabulary();

  const reset = () => {
    setTopic("");
    setSuggestions([]);
    setSelected(new Set());
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("اكتب موضوعاً");
      return;
    }
    setLoading(true);
    setSuggestions([]);
    setSelected(new Set());
    try {
      const existingArabic = (existingWords || []).map((w) => w.word_arabic);
      const { data, error } = await supabase.functions.invoke("suggest-flashcards", {
        body: { topic: topic.trim(), dialect: activeDialect, existingWords: existingArabic, count: 10 },
      });
      if (error) throw error;
      const cards = (data?.flashcards || []) as Suggestion[];
      if (cards.length === 0) {
        toast.error("ما رجعت اقتراحات جديدة. جرّب موضوعاً ثانياً.");
      } else {
        setSuggestions(cards);
        setSelected(new Set(cards.map((_, i) => i)));
      }
    } catch (e: any) {
      toast.error(e?.message || "تعذّر توليد الاقتراحات");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => {
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      toast.error("اختر كلمة على الأقل");
      return;
    }
    setSaving(true);
    let added = 0;
    let skipped = 0;
    for (const i of selected) {
      const c = suggestions[i];
      try {
        await addWord.mutateAsync({
          word_arabic: c.word_arabic,
          word_english: c.word_english,
          // Carried through so a suggested card arrives with its root already
          // known, rather than waiting for the backfill to ask again.
          root: c.root || undefined,
          source: "ai-suggest",
          sentence_text: c.example_arabic || undefined,
          sentence_english: c.example_english || undefined,
          dialect: activeDialect,
        });
        added++;
      } catch (e: any) {
        skipped++;
      }
    }
    setSaving(false);
    toast.success(`Added ${added} word${added === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped)` : ""}`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            AI Flashcard Suggestions
          </DialogTitle>
          <DialogDescription>
            Enter a topic and the AI will suggest 10 {activeDialect} Arabic words you don't already have.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            placeholder="e.g. ordering food at a restaurant, family members, weather, business meeting phrases…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            disabled={loading}
          />
          <Button onClick={handleGenerate} disabled={loading || !topic.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "نولّد…" : "ولّد اقتراحات"}
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="flex-1 overflow-y-auto border-t border-border pt-3 mt-2 space-y-2">
            {suggestions.map((c, i) => (
              <label
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="text-lg font-bold text-foreground"
                      style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                      dir="rtl"
                    >
                      {c.word_arabic}
                    </span>
                    <span className="text-sm text-muted-foreground">{c.word_english}</span>
                  </div>
                  {c.transliteration && (
                    <div className="text-xs text-muted-foreground italic">{c.transliteration}</div>
                  )}
                  {c.example_arabic && (
                    <div className="text-xs text-muted-foreground mt-1" dir="rtl">{c.example_arabic}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="border-t border-border pt-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button onClick={handleSave} disabled={saving || selected.size === 0} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              احفظ في كلماتي
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
