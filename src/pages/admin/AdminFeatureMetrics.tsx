import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Activity, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface MetricRow {
  id: string;
  created_at: string;
  feature: string;
  event: string;
  dialect: string | null;
  status: "ok" | "warn" | "error" | string;
  duration_ms: number | null;
  count: number | null;
  score: number | null;
  user_id: string | null;
  meta: Record<string, unknown> | null;
}

const STATUS_COLOR: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-900",
  warn: "bg-amber-100 text-amber-900",
  error: "bg-rose-100 text-rose-900",
};

const DIALECTS = ["all", "Gulf", "Egyptian", "Yemeni"] as const;
const WINDOWS = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 24 * 7 },
];

const AdminFeatureMetrics = () => {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialect, setDialect] = useState<(typeof DIALECTS)[number]>("all");
  const [status, setStatus] = useState<"all" | "ok" | "warn" | "error">("all");
  const [feature, setFeature] = useState<string>("all");
  const [hours, setHours] = useState<number>(24);

  const load = async () => {
    setLoading(true);
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    let q = supabase
      .from("feature_metrics")
      .select("*")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(500);
    if (dialect !== "all") q = q.eq("dialect", dialect);
    if (status !== "all") q = q.eq("status", status);
    if (feature !== "all") q = q.eq("feature", feature);
    const { data, error } = await q;
    if (error) toast.error("Failed to load metrics", { description: error.message });
    else setRows((data ?? []) as unknown as MetricRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect, status, feature, hours]);

  const [teaching, setTeaching] = useState<string | null>(null);

  const teachAI = async (input: {
    key: string;
    metric_id?: string;
    feature: string;
    event: string;
    dialect: string | null;
    meta?: Record<string, unknown> | null;
    leaks?: string[];
    message?: string;
  }) => {
    if (!input.dialect || !["Gulf", "Egyptian", "Yemeni"].includes(input.dialect)) {
      toast.error("Cannot teach AI", { description: "Event has no recognized dialect." });
      return;
    }
    setTeaching(input.key);
    try {
      const { data, error } = await supabase.functions.invoke("learn-from-metric", {
        body: {
          metric_id: input.metric_id,
          feature: input.feature,
          event: input.event,
          dialect: input.dialect,
          meta: input.meta ?? {},
          leaks: input.leaks ?? [],
          message: input.message ?? "",
        },
      });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      if (inserted > 0) {
        toast.success(`Drafted ${inserted} rule${inserted === 1 ? "" : "s"}`, {
          description: "Review in Dialect Rules → Draft tab.",
          action: { label: "Open", onClick: () => window.location.assign("/admin/dialect-rules") },
        });
      } else {
        toast.message("AI returned no proposals", { description: "Try a different event." });
      }
    } catch (e) {
      toast.error("Teach AI failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setTeaching(null);
    }
  };

  // Summary by feature × dialect
  const summary = useMemo(() => {
    const map = new Map<
      string,
      { feature: string; dialect: string; total: number; ok: number; warn: number; err: number; avgDuration: number; totalLeaks: number; leakSamples: number }
    >();
    for (const r of rows) {
      const key = `${r.feature}::${r.dialect ?? "-"}`;
      const cur =
        map.get(key) ?? {
          feature: r.feature,
          dialect: r.dialect ?? "-",
          total: 0,
          ok: 0,
          warn: 0,
          err: 0,
          avgDuration: 0,
          totalLeaks: 0,
          leakSamples: 0,
        };
      cur.total++;
      if (r.status === "ok") cur.ok++;
      else if (r.status === "warn") cur.warn++;
      else cur.err++;
      if (r.duration_ms != null) cur.avgDuration += r.duration_ms;
      if (r.event === "ask_brain" || r.event === "dialect_leak") {
        cur.totalLeaks += r.count ?? 0;
        cur.leakSamples++;
      }
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((s) => ({
        ...s,
        avgDuration: s.total ? Math.round(s.avgDuration / s.total) : 0,
        errorRate: s.total ? s.err / s.total : 0,
        avgLeaks: s.leakSamples ? s.totalLeaks / s.leakSamples : 0,
      }))
      .sort((a, b) => b.err - a.err || b.total - a.total);
  }, [rows]);

  const features = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.feature));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-5 w-5" /> Feature Metrics
        </h1>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Structured events from edge functions — Firecrawl result counts, JSON parse errors, dialect
        leak counts, and AI gateway failures, sliced by dialect.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.hours}
              size="sm"
              variant={hours === w.hours ? "default" : "outline"}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {DIALECTS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={dialect === d ? "default" : "outline"}
              onClick={() => setDialect(d)}
            >
              {d}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "ok", "warn", "error"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="all">all features</option>
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* Summary */}
      <div className="border rounded-lg mb-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Feature</th>
              <th className="text-left p-2">Dialect</th>
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">OK</th>
              <th className="text-right p-2">Warn</th>
              <th className="text-right p-2">Errors</th>
              <th className="text-right p-2">Err %</th>
              <th className="text-right p-2">Avg ms</th>
              <th className="text-right p-2">Avg leaks</th>
              <th className="text-right p-2">Teach</th>
            </tr>
          </thead>
          <tbody>
            {summary.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-4 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No events in this window."}
                </td>
              </tr>
            ) : (
              summary.map((s) => {
                const canTeach =
                  (s.err > 0 || s.avgLeaks > 0) &&
                  ["Gulf", "Egyptian", "Yemeni"].includes(s.dialect);
                const sampleLeaks = rows
                  .filter(
                    (r) =>
                      r.feature === s.feature &&
                      (r.dialect ?? "-") === s.dialect &&
                      Array.isArray((r.meta as { leaks?: unknown })?.leaks),
                  )
                  .flatMap((r) => ((r.meta as { leaks?: string[] }).leaks ?? []))
                  .slice(0, 30);
                const key = `sum:${s.feature}:${s.dialect}`;
                return (
                  <tr key={`${s.feature}-${s.dialect}`} className="border-t">
                    <td className="p-2 font-medium">{s.feature}</td>
                    <td className="p-2">{s.dialect}</td>
                    <td className="p-2 text-right">{s.total}</td>
                    <td className="p-2 text-right text-emerald-700">{s.ok}</td>
                    <td className="p-2 text-right text-amber-700">{s.warn}</td>
                    <td className="p-2 text-right text-rose-700">{s.err}</td>
                    <td className="p-2 text-right">{(s.errorRate * 100).toFixed(0)}%</td>
                    <td className="p-2 text-right">{s.avgDuration || "—"}</td>
                    <td className="p-2 text-right">{s.avgLeaks ? s.avgLeaks.toFixed(2) : "—"}</td>
                    <td className="p-2 text-right">
                      {canTeach ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={teaching === key}
                          onClick={() =>
                            teachAI({
                              key,
                              feature: s.feature,
                              event: "summary_rollup",
                              dialect: s.dialect,
                              leaks: sampleLeaks,
                              message: `Rollup: ${s.err} errors, avg ${s.avgLeaks.toFixed(2)} leaks/event over ${s.total} events.`,
                              meta: { errors: s.err, warns: s.warn, total: s.total, avgLeaks: s.avgLeaks },
                            })
                          }
                        >
                          {teaching === key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Event log */}
      <h2 className="font-semibold mb-2">Recent events ({rows.length})</h2>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => {
            const leaks = Array.isArray((r.meta as { leaks?: unknown })?.leaks)
              ? ((r.meta as { leaks?: string[] }).leaks as string[])
              : [];
            const canTeach =
              !!r.dialect &&
              ["Gulf", "Egyptian", "Yemeni"].includes(r.dialect) &&
              (r.status === "warn" ||
                r.status === "error" ||
                leaks.length > 0 ||
                r.event === "dialect_leak");
            return (
              <details key={r.id} className="border rounded p-2 bg-card text-xs">
                <summary className="cursor-pointer flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded ${STATUS_COLOR[r.status] ?? "bg-muted"}`}
                  >
                    {r.status}
                  </span>
                  <span className="font-mono">{r.feature}</span>
                  <span className="text-muted-foreground">/{r.event}</span>
                  {r.dialect && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-900">
                      {r.dialect}
                    </span>
                  )}
                  {r.duration_ms != null && (
                    <span className="text-muted-foreground">{r.duration_ms}ms</span>
                  )}
                  {r.count != null && (
                    <span className="text-muted-foreground">n={r.count}</span>
                  )}
                  {r.score != null && (
                    <span className="text-muted-foreground">
                      score={Number(r.score).toFixed(2)}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  {canTeach && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2"
                      disabled={teaching === r.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void teachAI({
                          key: r.id,
                          metric_id: r.id,
                          feature: r.feature,
                          event: r.event,
                          dialect: r.dialect,
                          meta: r.meta,
                          leaks,
                          message:
                            (r.meta as { error?: string } | null)?.error ??
                            (r.meta as { message?: string } | null)?.message ??
                            "",
                        });
                      }}
                    >
                      {teaching === r.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 mr-1" /> Teach AI
                        </>
                      )}
                    </Button>
                  )}
                </summary>
                {r.meta && Object.keys(r.meta).length > 0 && (
                  <pre className="mt-2 bg-muted p-2 rounded whitespace-pre-wrap overflow-auto max-h-64">
                    {JSON.stringify(r.meta, null, 2)}
                  </pre>
                )}
              </details>
            );
          })}
        </div>
      )}
      <div className="mt-4 text-xs text-muted-foreground">
        Drafted rules appear in{" "}
        <Link to="/admin/dialect-rules" className="underline">
          Dialect Rules → Draft
        </Link>
        .
      </div>
    </div>
  );
};

export default AdminFeatureMetrics;
