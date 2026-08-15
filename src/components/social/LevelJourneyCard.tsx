import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { GraduationCap, TrendingUp } from "lucide-react";

interface PlacementRow {
  dialect: string;
  cefr_level: string;
  confidence: number | null;
  taken_at: string;
}

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Assessments older than this deserve a re-check — levels move. */
export const RECHECK_AFTER_DAYS = 90;

/**
 * The learner's assessed-level trajectory for the active dialect: every
 * placement they've completed, oldest to newest, with a re-check nudge once
 * the latest is stale. Progress on a recognised scale is the one number a
 * learner can show someone else — XP can't do that.
 */
export function LevelJourneyCard() {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const [rows, setRows] = useState<PlacementRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke("placement-quiz", {
        body: { action: "history" },
      });
      if (!cancelled && !error && Array.isArray(data?.history)) {
        setRows(data.history as PlacementRow[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dialectRows = (rows ?? []).filter((row) => row.dialect === activeDialect);
  const latest = dialectRows.at(-1);
  const daysSince = latest
    ? Math.floor((Date.now() - new Date(latest.taken_at).getTime()) / 86_400_000)
    : null;
  const stale = daysSince !== null && daysSince >= RECHECK_AFTER_DAYS;
  const previous = dialectRows.at(-2);
  const moved =
    latest && previous
      ? CEFR_ORDER.indexOf(latest.cefr_level) - CEFR_ORDER.indexOf(previous.cefr_level)
      : 0;

  if (rows === null) return null; // no card until we know; nothing to skeleton

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Your {activeDialect} level</p>
        </div>
        {latest && (
          <span className="text-2xl font-bold text-primary">{latest.cefr_level}</span>
        )}
      </div>

      {dialectRows.length === 0 ? (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Take the placement quiz to get your CEFR level — and retake it as you improve, so
            the line below has somewhere to go.
          </p>
          <Button size="sm" onClick={() => navigate("/placement")}>
            حدّد مستواي
          </Button>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-end gap-1.5" aria-label="سجل المستويات">
            {dialectRows.slice(-8).map((row, index) => (
              <div key={`${row.taken_at}-${index}`} className="flex flex-col items-center gap-1">
                <div
                  className="w-7 rounded-t bg-primary/70"
                  style={{ height: `${(CEFR_ORDER.indexOf(row.cefr_level) + 1) * 10}px` }}
                  title={`${row.cefr_level} — ${new Date(row.taken_at).toLocaleDateString()}`}
                />
                <span className="text-[10px] text-muted-foreground">{row.cefr_level}</span>
              </div>
            ))}
          </div>
          {moved > 0 && (
            <p className="mb-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              Up from {previous!.cefr_level} — measured, not guessed.
            </p>
          )}
          {stale ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                آخر فحص قبل {daysSince} يوم. المستويات تتغيّر — شوف وينك الحين.
              </p>
              <Button size="sm" onClick={() => navigate("/placement")}>
                أعد تحديد مستواي
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Checked {daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`} · next
              re-check suggested after {RECHECK_AFTER_DAYS} days.
            </p>
          )}
        </>
      )}
    </div>
  );
}
