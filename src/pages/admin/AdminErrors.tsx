import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ErrorRow {
  id: string;
  user_id: string | null;
  source: string;
  route: string | null;
  function_name: string | null;
  message: string;
  stack: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

const AdminErrors = () => {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "client" | "edge">("all");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("client_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q = q.eq("source", filter);
    const { data, error } = await q;
    if (error) {
      toast.error("Failed to load errors", { description: error.message });
    } else {
      setRows((data ?? []) as unknown as ErrorRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
     
  }, [filter]);

  const clearOlderThan = async (days: number) => {
    if (!confirm(`Delete all errors older than ${days} day(s)?`)) return;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { error } = await supabase.from("client_errors").delete().lt("created_at", cutoff);
    if (error) toast.error(error.message);
    else {
      toast.success("Cleared older errors");
      void load();
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Error Log</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void clearOlderThan(7)}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear &gt;7d
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(["all", "client", "edge"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No errors logged.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <details key={r.id} className="border rounded-lg p-3 bg-card">
              <summary className="cursor-pointer flex items-center gap-3 text-sm">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    r.source === "edge" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-900"
                  }`}
                >
                  {r.source}
                  {r.function_name ? `:${r.function_name}` : ""}
                </span>
                <span className="text-muted-foreground text-xs">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                <span className="flex-1 truncate font-medium">{r.message}</span>
              </summary>
              <div className="mt-3 space-y-2 text-xs">
                {r.route && <div><strong>Route:</strong> {r.route}</div>}
                {r.user_id && <div><strong>User:</strong> {r.user_id}</div>}
                {r.user_agent && <div className="text-muted-foreground">{r.user_agent}</div>}
                {r.stack && (
                  <pre className="bg-muted p-2 rounded whitespace-pre-wrap overflow-auto max-h-64">
                    {r.stack}
                  </pre>
                )}
                {r.meta && Object.keys(r.meta).length > 0 && (
                  <pre className="bg-muted p-2 rounded whitespace-pre-wrap overflow-auto max-h-32">
                    {JSON.stringify(r.meta, null, 2)}
                  </pre>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminErrors;
