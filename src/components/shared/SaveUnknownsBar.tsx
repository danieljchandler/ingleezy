import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, BookmarkPlus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useBulkAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useMarkUnknowns } from "@/contexts/MarkUnknownsContext";

interface Props {
  source: string;
}

/**
 * Floating bottom bar shown when the user has marked any unknown words
 * via mark-mode. Saves them all to My Words in a single bulk insert,
 * preserving sentence context. Translations are fetched in parallel
 * via the word-enrichment edge function (best-effort).
 */
export const SaveUnknownsBar = ({ source }: Props) => {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { unknowns, clear, setEnabled } = useMarkUnknowns();
  const bulkAdd = useBulkAddUserVocabulary();
  const [saving, setSaving] = useState(false);

  const count = unknowns.size;
  if (count === 0) return null;

  const handleSave = async () => {
    if (!user) {
      toast.error("Sign in to save words");
      return;
    }
    setSaving(true);
    const entries = Array.from(unknowns.values());
    try {
      // Fetch translations in parallel (best-effort)
      const enriched = await Promise.all(
        entries.map(async (entry) => {
          try {
            const { data } = await supabase.functions.invoke("word-enrichment", {
              body: {
                word: entry.arabic,
                dialect: activeDialect,
                sentenceArabic: entry.sentence_text,
                sentenceEnglish: entry.sentence_english,
              },
            });
            return {
              word_arabic: entry.arabic,
              word_english: data?.definition || "",
              root: data?.root || null,
              transliteration: data?.transliteration || null,
              source,
              sentence_text: entry.sentence_text,
              sentence_english: entry.sentence_english,
            };
          } catch {
            return {
              word_arabic: entry.arabic,
              word_english: "",
              source,
              sentence_text: entry.sentence_text,
              sentence_english: entry.sentence_english,
            };
          }
        })
      );

      // We need a per-word insert path because bulk hook doesn't currently
      // pass sentence_text. Use sequential inserts via the table directly.
      const rows = enriched.map((e) => ({
        user_id: user.id,
        word_arabic: e.word_arabic,
        word_english: e.word_english,
        root: e.root ?? null,
        transliteration: (e as { transliteration?: string | null }).transliteration ?? null,
        source: e.source,
        dialect: activeDialect,
        sentence_text: e.sentence_text ?? null,
        sentence_english: e.sentence_english ?? null,
      }));

      const { data: inserted, error } = await supabase
        .from("user_vocabulary")
        .upsert(rows as any, {
          onConflict: "user_id,word_arabic,dialect",
          ignoreDuplicates: true,
        })
        .select("id");

      if (error) throw error;
      const added = inserted?.length ?? 0;
      const skipped = entries.length - added;
      toast.success(
        skipped > 0
          ? `Saved ${added} — ${skipped} already in My Words`
          : `Saved ${added} word${added === 1 ? "" : "s"} to My Words`
      );
      clear();
      setEnabled(false);
    } catch (e: any) {
      console.error("Bulk save failed", e);
      toast.error(e?.message || "Failed to save words");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,420px)]">
      <div className="flex items-center gap-2 rounded-2xl border border-primary/40 bg-card/95 backdrop-blur px-3 py-2 shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => {
            clear();
            setEnabled(false);
          }}
          disabled={saving}
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="flex-1 text-sm text-foreground">
          <span className="font-semibold">{count}</span>{" "}
          word{count === 1 ? "" : "s"} marked
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving} className="shrink-0">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5 mr-1.5" />
          )}
          Save {count}
        </Button>
      </div>
    </div>
  );
};
