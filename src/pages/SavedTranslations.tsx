import { useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { useSavedTranslations, type SavedTranslation } from "@/hooks/useSavedTranslations";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, ChevronRight, Info, Loader2, Trash2 } from "lucide-react";

const SavedTranslations = () => {
  const { items, loading, remove } = useSavedTranslations();
  const [active, setActive] = useState<SavedTranslation | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (!id) return;
    setDeletingId(id);
    try {
      await remove(id);
      if (active?.id === id) setActive(null);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          {active ? (
            <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          ) : (
            <HomeButton />
          )}
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Saved Translations
          </h1>
          <div className="w-9" />
        </div>

        {!active && (
          <>
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">
                    You haven't saved any translations yet.
                  </p>
                  <Button asChild size="sm">
                    <Link to="/translate">Translate something</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {items.map((it) => (
                  <Card key={it.id} className="hover:border-primary/40 transition-colors">
                    <CardContent className="p-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActive(it)}
                        className="flex-1 min-w-0 text-left flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" dir="rtl">
                            {it.title || it.source_text.slice(0, 60)}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(it.created_at).toLocaleDateString()} ·{" "}
                            {it.sentences.length} sentence
                            {it.sentences.length === 1 ? "" : "s"}
                            {it.detected_dialect ? ` · ${it.detected_dialect}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDeleteId(it.id)}
                        disabled={deletingId === it.id}
                        aria-label="Delete saved translation"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {active && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {active.detected_dialect && (
                <Badge variant="secondary" className="text-xs">
                  {active.detected_dialect}
                </Badge>
              )}
              <p className="text-xs text-muted-foreground">
                Saved {new Date(active.created_at).toLocaleString()}
              </p>
            </div>
            {active.sentences.map((s, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <TappableArabicText
                    text={s.arabic}
                    vocabulary={[]}
                    source="translate-text"
                    sentenceContext={{ arabic: s.arabic, english: s.natural }}
                  />
                  <TranslationPair
                    variant="grid"
                    literal={s.literal}
                    natural={s.natural}
                    className="pt-1 border-t border-border/40"
                  />
                  {s.note && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 flex gap-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-200">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <p>{s.note}</p>
                    </div>
                  )}
                  <div className="flex justify-start pt-1 border-t border-border/40">
                    <AskAISentence arabic={s.arabic} english={s.natural} variant="chip" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this saved translation?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default SavedTranslations;
