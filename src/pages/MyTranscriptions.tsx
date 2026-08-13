import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileAudio, Trash2, Loader2, Eye, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type SavedRow = {
  id: string;
  title: string;
  created_at: string;
  raw_transcript_arabic: string;
  vocabulary: any;
  grammar_points: any;
  lines: any;
  dialect: string | null;
  engines_used: { asr?: string[]; translation?: string[]; analysis?: string } | null;
};

export default function MyTranscriptions() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const [rows, setRows] = useState<SavedRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth?redirect=/my-transcriptions");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("saved_transcriptions")
      .select("id,title,created_at,raw_transcript_arabic,vocabulary,grammar_points,lines,dialect,engines_used")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    console.log("[MyTranscriptions] loaded for user", user.id, { count: data?.length, error });
    if (error) {
      toast.error("Couldn't load transcriptions", { description: error.message });
      setRows([]);
    } else {
      setRows((data ?? []) as SavedRow[]);
    }
    setLoading(false);
  }

  const visibleRows = useMemo(() => {
    if (!rows) return rows;
    if (showAll) return rows;
    return rows.filter((r) => (r.dialect ?? null) === activeDialect || r.dialect == null);
  }, [rows, showAll, activeDialect]);

  async function handleDelete(id: string) {
    const { error } = await supabase.from("saved_transcriptions").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete", { description: error.message });
      return;
    }
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    toast.success("Transcription deleted");
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <HomeButton />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">My Transcriptions <InfoHint {...PAGE_HINTS["my-transcriptions"]} size="md" /></h1>
            <p className="text-sm text-muted-foreground">
              Everything you've saved from the Transcribe tool.
            </p>
          </div>
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowAll((v) => !v)}
          >
            <Shuffle className="h-3.5 w-3.5" />
            {showAll ? "All dialects" : activeDialect}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleRows && visibleRows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileAudio className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                {rows && rows.length > 0
                  ? `No saved transcriptions for ${activeDialect}. Toggle to see all.`
                  : "No saved transcriptions yet."}
              </p>
              {(!rows || rows.length === 0) && (
                <Button onClick={() => navigate("/transcribe")}>Go to Transcribe</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visibleRows?.map((r) => {
              const vocabCount = Array.isArray(r.vocabulary) ? r.vocabulary.length : 0;
              const grammarCount = Array.isArray(r.grammar_points) ? r.grammar_points.length : 0;
              const lineCount = Array.isArray(r.lines) ? r.lines.length : 0;
              return (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{r.title}</CardTitle>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p
                      className="text-sm text-muted-foreground line-clamp-2"
                      dir="rtl"
                      lang="ar"
                    >
                      {r.raw_transcript_arabic || "—"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {r.dialect && <Badge>{r.dialect}</Badge>}
                      <Badge variant="secondary">{lineCount} lines</Badge>
                      <Badge variant="secondary">{vocabCount} vocab</Badge>
                      <Badge variant="secondary">{grammarCount} grammar</Badge>
                    </div>
                    {r.engines_used?.asr && r.engines_used.asr.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">ASR:</span>
                        {r.engines_used.asr.map((e) => (
                          <Badge key={e} variant="outline" className="text-[10px] px-1.5 py-0">{e}</Badge>
                        ))}
                        {r.engines_used.translation && r.engines_used.translation.length > 0 && (
                          <>
                            <span className="ml-2 font-medium">Translation:</span>
                            {r.engines_used.translation.map((e) => (
                              <Badge key={e} variant="outline" className="text-[10px] px-1.5 py-0">{e}</Badge>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => navigate(`/transcribe?saved=${r.id}`)}
                      >
                        <Eye className="h-4 w-4 mr-1" /> Open
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this transcription?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes "{r.title}". This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(r.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
