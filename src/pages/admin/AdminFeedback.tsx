import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Trash2, ExternalLink, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

function ScreenshotPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("feedback-screenshots")
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url) return <div className="text-xs text-muted-foreground">Loading screenshot…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt="Feedback screenshot" className="max-h-96 w-auto rounded-md border" />
    </a>
  );
}


type Status = "new" | "triaged" | "in_progress" | "resolved" | "wont_fix";
type FbType = "bug" | "idea" | "confusing" | "praise" | "other";

interface FeedbackRow {
  id: string;
  user_id: string;
  type: FbType;
  message: string;
  route: string | null;
  status: Status;
  admin_notes: string | null;
  context: Record<string, unknown> | null;
  screenshot_url: string | null;
  created_at: string;
}


const STATUSES: Status[] = ["new", "triaged", "in_progress", "resolved", "wont_fix"];
const TYPE_COLORS: Record<FbType, string> = {
  bug: "bg-red-500/10 text-red-600",
  idea: "bg-amber-500/10 text-amber-600",
  confusing: "bg-blue-500/10 text-blue-600",
  praise: "bg-pink-500/10 text-pink-600",
  other: "bg-muted text-muted-foreground",
};

const AdminFeedback = () => {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-feedback", filter],
    queryFn: async () => {
      let q = supabase
        .from("beta_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as FeedbackRow[];
    },
  });

  const updateRow = async (id: string, patch: { status?: Status; admin_notes?: string }) => {
    const { error } = await supabase.from("beta_feedback").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-feedback"] });
  };

  const deleteRow = async (id: string) => {
    if (!confirm("Delete this feedback?")) return;
    const { error } = await supabase.from("beta_feedback").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["admin-feedback"] });
  };

  const counts = (data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Beta Feedback</h1>
          <p className="text-sm text-muted-foreground">
            {data?.length ?? 0} {filter === "all" ? "total" : filter} items
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
            }`}
          >
            {s.replace("_", " ")}
            {s !== "all" && counts[s] ? ` (${counts[s]})` : ""}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No feedback yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.map((row) => {
            const isOpen = expanded === row.id;
            return (
              <Card key={row.id}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[row.type]}`}>
                        {row.type}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{row.status.replace("_", " ")}</span>
                      {row.route && (
                        <a
                          href={row.route}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {row.route} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteRow(row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{row.message}</p>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.status}
                      onChange={(e) => updateRow(row.id, { status: e.target.value as Status })}
                      className="text-xs border rounded-md px-2 py-1 bg-background"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    {row.screenshot_url && (
                      <span className="text-xs inline-flex items-center gap-1 text-muted-foreground">
                        <ImageIcon className="h-3 w-3" /> screenshot
                      </span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : row.id)}>
                      {isOpen ? "Hide details" : "Show details"}
                    </Button>
                  </div>



                  {isOpen && (
                    <div className="space-y-3 pt-2 border-t">
                      <div>
                        <div className="text-xs font-medium mb-1">Admin notes</div>
                        <Textarea
                          rows={2}
                          value={notesDraft[row.id] ?? row.admin_notes ?? ""}
                          onChange={(e) => setNotesDraft({ ...notesDraft, [row.id]: e.target.value })}
                          placeholder="Internal notes…"
                        />
                        <div className="mt-2 flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => updateRow(row.id, { admin_notes: notesDraft[row.id] ?? "" })}
                          >
                            Save notes
                          </Button>
                        </div>
                      </div>
                      {row.screenshot_url && (
                        <div>
                          <div className="text-xs font-medium mb-1">Screenshot</div>
                          <ScreenshotPreview path={row.screenshot_url} />
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium mb-1">Context</div>
                        <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto max-h-64">
{JSON.stringify({ user_id: row.user_id, ...(row.context ?? {}) }, null, 2)}
                        </pre>
                      </div>

                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminFeedback;
