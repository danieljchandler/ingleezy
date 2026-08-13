import { useState, useRef, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, FileText, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
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
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  parseApkg,
  parseAnkiText,
  uploadAnkiMediaBatch,
  classifyMedia,
  mapAnkiSchedule,
  normalizeArabic,
  ANKI_FILE_SIZE_LIMIT,
  ANKI_IMPORT_LIMIT,
  type ImportProgress,
  type ParsedAnkiDeck,
} from "@/lib/ankiImport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "preview" | "importing" | "done";

const INSERT_BATCH = 200;

export function ImportFromAnkiDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [deck, setDeck] = useState<ParsedAnkiDeck | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    mediaUploaded: number;
  } | null>(null);

  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [priorCount, setPriorCount] = useState<number | null>(null);

  const reset = () => {
    setStep("upload");
    setFilename("");
    setDeck(null);
    setProgress(null);
    setResult(null);
  };

  // Load count of existing Anki-imported cards for current user+dialect
  const refreshPriorCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from("user_vocabulary")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("dialect", activeDialect)
      .eq("source", "anki_import");
    setPriorCount(count ?? 0);
  };

  const handleDeletePrevious = async () => {
    if (!user) return;
    setWiping(true);
    try {
      const { error, count } = await supabase
        .from("user_vocabulary")
        .delete({ count: "exact" })
        .eq("user_id", user.id)
        .eq("dialect", activeDialect)
        .eq("source", "anki_import");
      if (error) throw error;
      toast.success(`Deleted ${count ?? 0} previously imported cards`);
      setPriorCount(0);
      qc.invalidateQueries({ queryKey: ["user-vocabulary"] });
      qc.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
    } catch (err: any) {
      console.error("[anki] delete previous error", err);
      toast.error(err?.message || "Could not delete previous import");
    } finally {
      setWiping(false);
      setConfirmWipe(false);
    }
  };

  useEffect(() => {
    if (open && user) {
      refreshPriorCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, activeDialect]);

  const handleClose = (next: boolean) => {
    if (!next && step !== "importing") {
      reset();
    }
    onOpenChange(next);
  };

  const handleFile = async (file: File) => {
    if (!/\.(apkg|colpkg|txt|csv|tsv)$/i.test(file.name)) {
      toast.error("Unsupported file type. Please choose a .apkg, .colpkg, .txt, .csv or .tsv file.");
      return;
    }
    if (file.size > ANKI_FILE_SIZE_LIMIT) {
      toast.error(`File too large (max ${ANKI_FILE_SIZE_LIMIT / 1024 / 1024} MB)`);
      return;
    }
    setFilename(file.name);
    setProgress({ phase: "parsing", message: "Reading your Anki deck…" });
    try {
      const isApkg = /\.(apkg|colpkg)$/i.test(file.name);
      const parsed = isApkg ? await parseApkg(file) : await parseAnkiText(file);
      if (parsed.cards.length === 0) {
        toast.error("No importable cards found in this file.");
        setProgress(null);
        return;
      }
      setDeck(parsed);
      setStep("preview");
      setProgress(null);
    } catch (err: any) {
      console.error("[anki] parse error", err);
      toast.error(err?.message || "Could not read this Anki file.");
      setProgress(null);
    }
  };

  const previewRows = useMemo(() => deck?.cards.slice(0, 8) ?? [], [deck]);
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!deck) return counts;
    for (const c of deck.cards) {
      const s = mapAnkiSchedule(c).stage;
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [deck]);
  const deckCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!deck) return counts;
    for (const c of deck.cards) {
      const name = c.deckName || "Default";
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }, [deck]);
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!deck) return counts;
    for (const c of deck.cards) {
      for (const t of c.tags) counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [deck]);

  const handleImport = async () => {
    if (!user || !deck) return;
    setStep("importing");

    try {
      // 1. Create batch row
      const { data: batchRow, error: batchErr } = await supabase
        .from("anki_import_batches")
        .insert({
          user_id: user.id,
          dialect: activeDialect,
          source_filename: filename,
          total_cards: deck.cards.length,
        })
        .select("id")
        .single();
      if (batchErr) throw batchErr;
      const batchId = batchRow.id as string;

      // 2. Collect referenced media and upload
      const neededMedia = new Set<string>();
      for (const c of deck.cards) {
        for (const r of c.imageRefs) if (deck.media.has(r) && classifyMedia(r)) neededMedia.add(r);
        for (const r of c.audioRefs) if (deck.media.has(r) && classifyMedia(r)) neededMedia.add(r);
      }
      const mediaFiles = Array.from(neededMedia).map((name) => ({
        filename: name,
        bytes: deck.media.get(name)!,
      }));

      setProgress({
        phase: "uploading-media",
        current: 0,
        total: mediaFiles.length,
        message: `Uploading ${mediaFiles.length} media files…`,
      });

      const mediaMap = await uploadAnkiMediaBatch(user.id, mediaFiles, {
        concurrency: 4,
        onProgress: (done, total) =>
          setProgress({ phase: "uploading-media", current: done, total }),
      });

      // 3. Dedupe vs existing user_vocabulary (paginated — Supabase caps at 1000/req)
      const seen = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: existing, error: existErr } = await supabase
          .from("user_vocabulary")
          .select("word_arabic")
          .eq("user_id", user.id)
          .eq("dialect", activeDialect)
          .range(from, from + PAGE - 1);
        if (existErr) throw existErr;
        if (!existing || existing.length === 0) break;
        for (const r of existing) seen.add(normalizeArabic(r.word_arabic));
        if (existing.length < PAGE) break;
      }

      // 4. Build insert rows
      const rows: any[] = [];
      let skipped = 0;
      for (const c of deck.cards) {
        const key = normalizeArabic(c.wordArabic);
        if (!key) {
          skipped++;
          continue;
        }
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);

        const sched = mapAnkiSchedule(c);

        // Pick first available media
        const imageRef = c.imageRefs.find((r) => mediaMap.has(r));
        const audioRef = c.audioRefs.find((r) => mediaMap.has(r));
        const imageUrl = imageRef ? mediaMap.get(imageRef)!.url : null;
        const audioUrl = audioRef ? mediaMap.get(audioRef)!.url : null;

        rows.push({
          user_id: user.id,
          dialect: activeDialect,
          word_arabic: c.wordArabic,
          word_english: c.wordEnglish || "",
          phonetic: c.phonetic || null,
          sentence_text: c.sentenceArabic || null,
          sentence_english: c.sentenceEnglish || null,
          image_url: imageUrl,
          word_audio_url: audioUrl,
          tags: c.tags.length ? c.tags : null,
          deck_name: c.deckName || null,
          source: "anki_import",
          anki_note_id: c.ankiNoteId ?? null,
          anki_card_id: c.ankiCardId ?? null,
          import_batch_id: batchId,
          stage: sched.stage,
          repetitions: sched.repetitions,
          interval_days: sched.interval_days,
          ease_factor: sched.ease_factor,
          lapses: sched.lapses,
          is_leech: sched.is_leech,
          next_review_at: sched.next_review_at,
        });
      }

      // 5. Insert in batches
      setProgress({
        phase: "inserting",
        current: 0,
        total: rows.length,
        message: `Importing ${rows.length} cards…`,
      });
      let inserted = 0;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const chunk = rows.slice(i, i + INSERT_BATCH);
        const { error } = await supabase.from("user_vocabulary").insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
        setProgress({
          phase: "inserting",
          current: inserted,
          total: rows.length,
        });
      }

      // 6. Update batch totals
      await supabase
        .from("anki_import_batches")
        .update({
          imported_cards: inserted,
          skipped_duplicates: skipped,
          media_uploaded: mediaMap.size,
        })
        .eq("id", batchId);

      setResult({ inserted, skipped, mediaUploaded: mediaMap.size });
      setStep("done");
      qc.invalidateQueries({ queryKey: ["user-vocabulary"] });
      qc.invalidateQueries({ queryKey: ["user-vocabulary-due"] });
      toast.success(`Imported ${inserted} cards from Anki`);
    } catch (err: any) {
      console.error("[anki] import error", err);
      toast.error(err?.message || "Import failed");
      setStep("preview");
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Anki</DialogTitle>
          <DialogDescription>
            Import .apkg / .colpkg or text exports. We keep tags, audio, images,
            and learning progress — saved into the {activeDialect} dialect.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-xl p-8 hover:border-primary hover:bg-muted/30 transition-colors flex flex-col items-center gap-2"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Drop your Anki file here or click to choose</p>
              <p className="text-xs text-muted-foreground">
                .apkg, .colpkg, .txt, .csv · up to 2 GB · {ANKI_IMPORT_LIMIT.toLocaleString()} cards max
                <br />
                <span className="text-amber-700">Large files (&gt; 200 MB) may run out of memory — use desktop Chrome and close other tabs.</span>
              </p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              // No `accept` filter: mobile browsers grey out .apkg/.colpkg
              // because their MIME types are unknown to the OS. We validate
              // by extension inside handleFile instead.
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            {progress?.phase === "parsing" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress.message}
              </div>
            )}
            <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-muted-foreground leading-relaxed space-y-1">
              <p className="font-medium text-foreground">In Anki: File → Export</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Format: <span className="font-medium">Anki Deck Package (.apkg)</span></li>
                <li>✅ Support older Anki versions</li>
                <li>✅ <span className="font-medium text-amber-700 dark:text-amber-500">Include scheduling information</span> — required to keep your review progress</li>
                <li>✅ Include media</li>
              </ul>
            </div>

            {priorCount !== null && priorCount > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs">
                  <p className="font-medium">
                    {priorCount.toLocaleString()} card{priorCount === 1 ? "" : "s"} from a previous Anki import
                  </p>
                  <p className="text-muted-foreground">
                    Delete them first so a re-import with scheduling info isn't skipped as duplicates.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => setConfirmWipe(true)}
                  disabled={wiping}
                >
                  {wiping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5">Delete previous</span>
                </Button>
              </div>
            )}
          </div>
        )}

        <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete previous Anki import?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove {priorCount?.toLocaleString() ?? "all"} card{priorCount === 1 ? "" : "s"} previously imported from Anki for the <span className="font-medium">{activeDialect}</span> dialect, along with any review progress you've made on them here. Cards added other ways are not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={wiping}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDeletePrevious();
                }}
                disabled={wiping}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {wiping ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {step === "preview" && deck && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-medium">{filename}</span>
              <span className="text-muted-foreground">
                · {deck.cards.length.toLocaleString()} cards · {deck.media.size} media files
              </span>
            </div>

            {deck.truncated && (
              <div className="flex gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                <span>
                  Your deck has more than {ANKI_IMPORT_LIMIT.toLocaleString()} notes.
                  Only the first {ANKI_IMPORT_LIMIT.toLocaleString()} will be imported.
                </span>
              </div>
            )}

            {Object.keys(stageCounts).length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {Object.entries(stageCounts).map(([stage, n]) => (
                  <span key={stage} className="px-2 py-1 rounded-full bg-muted text-muted-foreground">
                    {stage.replace(/_/g, " ").toLowerCase()}: <span className="font-medium text-foreground">{n}</span>
                  </span>
                ))}
              </div>
            )}

            {Object.keys(deckCounts).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Decks ({Object.keys(deckCounts).length})
                </p>
                <div className="flex flex-wrap gap-1.5 text-xs max-h-20 overflow-y-auto">
                  {Object.entries(deckCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, n]) => (
                      <span key={name} className="px-2 py-1 rounded-full bg-primary/10 text-primary">
                        📚 {name} <span className="text-muted-foreground">· {n}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {Object.keys(tagCounts).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Tags ({Object.keys(tagCounts).length})
                </p>
                <div className="flex flex-wrap gap-1.5 text-xs max-h-20 overflow-y-auto">
                  {Object.entries(tagCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 30)
                    .map(([tag, n]) => (
                      <span key={tag} className="px-2 py-1 rounded-full bg-accent/40 text-foreground/80">
                        #{tag} <span className="text-muted-foreground">· {n}</span>
                      </span>
                    ))}
                  {Object.keys(tagCounts).length > 30 && (
                    <span className="px-2 py-1 text-muted-foreground">
                      +{Object.keys(tagCounts).length - 30} more
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-right p-2">Arabic</th>
                    <th className="text-left p-2">English</th>
                    <th className="text-left p-2">Sentence</th>
                    <th className="text-left p-2">Media</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((c, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-right font-arabic" dir="rtl" style={{ fontFamily: "'Amiri', serif" }}>
                        {c.wordArabic}
                      </td>
                      <td className="p-2 text-muted-foreground">{c.wordEnglish}</td>
                      <td className="p-2 text-xs text-muted-foreground truncate max-w-[180px]" dir="rtl">
                        {c.sentenceArabic || "—"}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {c.imageRefs.length > 0 && `🖼 ${c.imageRefs.length}`}{" "}
                        {c.audioRefs.length > 0 && `🔊 ${c.audioRefs.length}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Choose different file
              </Button>
              <Button onClick={handleImport}>
                Import {deck.cards.length.toLocaleString()} cards
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "importing" && progress && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{progress.message || "Working…"}</span>
            </div>
            {typeof progress.current === "number" && typeof progress.total === "number" && progress.total > 0 && (
              <>
                <Progress value={(progress.current / progress.total) * 100} />
                <p className="text-xs text-muted-foreground text-center">
                  {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
                </p>
              </>
            )}
            <p className="text-xs text-muted-foreground text-center">
              Please keep this dialog open until the import finishes.
            </p>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-semibold text-lg">Import complete</p>
              <div className="text-sm text-muted-foreground text-center space-y-1">
                <p>{result.inserted.toLocaleString()} new cards added</p>
                {result.skipped > 0 && <p>{result.skipped.toLocaleString()} duplicates skipped</p>}
                {result.mediaUploaded > 0 && <p>{result.mediaUploaded.toLocaleString()} media files uploaded</p>}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
