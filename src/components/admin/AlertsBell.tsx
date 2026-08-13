import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Alert {
  id: string;
  created_at: string;
  feature: string;
  event: string;
  dialect: string | null;
  alert_type: string;
  severity: "warn" | "error" | "critical" | string;
  message: string;
  acknowledged_at: string | null;
}

const SEVERITY_RING: Record<string, string> = {
  warn: "bg-amber-500",
  error: "bg-rose-600",
  critical: "bg-rose-700 animate-pulse",
};

/** Floating bell that subscribes to feature_alerts in realtime and notifies admins. */
const AlertsBell = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const bootedRef = useRef(false);

  const load = async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await supabase
      .from("feature_alerts")
      .select("*")
      .is("acknowledged_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as unknown as Alert[];
    rows.forEach((r) => seenRef.current.add(r.id));
    setAlerts(rows);
    bootedRef.current = true;
  };

  useEffect(() => {
    void load();
    // Best-effort browser notification permission
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const channel = supabase
      .channel("feature_alerts_stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feature_alerts" },
        (payload) => {
          const a = payload.new as Alert;
          if (seenRef.current.has(a.id)) return;
          seenRef.current.add(a.id);
          setAlerts((prev) => [a, ...prev].slice(0, 50));

          if (bootedRef.current) {
            toast.error(a.message, {
              description: `${a.feature} • ${a.dialect ?? "all"} • ${a.severity}`,
              duration: a.severity === "critical" ? 15000 : 8000,
            });
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(`Hakiya alert: ${a.feature}`, {
                  body: a.message,
                  tag: a.id,
                });
              }
            } catch {
              /* ignore in iframe */
            }
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "feature_alerts" },
        (payload) => {
          const a = payload.new as Alert;
          if (a.acknowledged_at) {
            setAlerts((prev) => prev.filter((x) => x.id !== a.id));
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const ack = async (id: string) => {
    const { data: userResp } = await supabase.auth.getUser();
    await supabase
      .from("feature_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userResp.user?.id ?? null })
      .eq("id", id);
    setAlerts((prev) => prev.filter((x) => x.id !== id));
  };

  const ackAll = async () => {
    const ids = alerts.map((a) => a.id);
    if (!ids.length) return;
    const { data: userResp } = await supabase.auth.getUser();
    await supabase
      .from("feature_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userResp.user?.id ?? null })
      .in("id", ids);
    setAlerts([]);
  };

  const count = alerts.length;
  const topSeverity = alerts.find((a) => a.severity === "critical")
    ? "critical"
    : alerts.find((a) => a.severity === "error")
    ? "error"
    : alerts[0]?.severity ?? "warn";

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-80 max-h-96 overflow-auto bg-card border rounded-lg shadow-lg text-xs">
          <div className="flex items-center justify-between p-2 border-b bg-muted">
            <span className="font-semibold">Alerts ({count})</span>
            <div className="flex gap-2">
              <Link to="/admin/metrics" onClick={() => setOpen(false)} className="text-blue-600 hover:underline">
                View metrics
              </Link>
              {count > 0 && (
                <button onClick={() => void ackAll()} className="text-muted-foreground hover:text-foreground">
                  Ack all
                </button>
              )}
            </div>
          </div>
          {count === 0 ? (
            <p className="p-4 text-center text-muted-foreground">No active alerts 🎉</p>
          ) : (
            <ul>
              {alerts.map((a) => (
                <li key={a.id} className="p-2 border-b last:border-b-0 flex gap-2 items-start">
                  <span className={`mt-1 inline-block h-2 w-2 rounded-full ${SEVERITY_RING[a.severity] ?? "bg-muted"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.message}</p>
                    <p className="text-muted-foreground">
                      {a.feature} · {a.dialect ?? "all"} · {new Date(a.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    onClick={() => void ack(a.id)}
                    className="text-muted-foreground hover:text-foreground text-[10px]"
                    title="Acknowledge"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-full shadow-lg p-3 text-white ${
          count > 0 ? SEVERITY_RING[topSeverity] ?? "bg-rose-600" : "bg-slate-700"
        }`}
        title="Feature alerts"
      >
        {count > 0 ? <AlertTriangle className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-white text-rose-700 text-[10px] font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center border border-rose-700">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
    </div>
  );
};

export default AlertsBell;
