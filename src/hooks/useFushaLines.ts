/**
 * Fills in the Fusha (فصحى) row for transcript lines that don't carry one.
 *
 * Lines analysed since the Fusha pass landed in `analyze-gulf-arabic` already
 * have `fusha` stored on them and this hook never calls anything. Everything
 * analysed before it — the learner's saved transcriptions, the whole Discover
 * library — has nothing, and without this the toggle would open onto an empty
 * panel on most of the content in the app.
 *
 * Two rules keep that from turning into a stream of calls:
 *   - nothing is fetched until the learner actually turns the row on;
 *   - every line is asked for at most once per mount, whether it came back
 *     converted, blank, or as an error. A model that has no Fusha for a line
 *     will not find one on the second ask.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";
import type { TranscriptLine } from "@/types/transcript";

/** Matches MAX_LINES in supabase/functions/convert-to-fusha — the server rejects more. */
const BATCH_SIZE = 40;

export type FushaStatus = "idle" | "loading" | "ready" | "error";

export interface UseFushaLinesResult {
  /** Stored `fusha` when present, otherwise whatever the on-demand pass returned. */
  fushaFor: (line: TranscriptLine) => string | undefined;
  status: FushaStatus;
  /** Re-runs the lines that came back empty or failed. */
  retry: () => void;
}

export function useFushaLines(
  lines: TranscriptLine[],
  enabled: boolean,
  dialect: string,
): UseFushaLinesResult {
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<FushaStatus>("idle");
  /** Line ids already sent, so a re-render never re-asks. */
  const asked = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);
  /**
   * A conversion outlives the screen that asked for it — a learner who flips the
   * row on and navigates away leaves a request in flight, and its result must
   * not land on a component that no longer exists.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (inFlight.current) return;

    const missing = lines.filter(
      (line) => !line.fusha?.trim() && line.arabic?.trim() && !asked.current.has(line.id),
    );
    if (missing.length === 0) {
      setStatus((prev) => (prev === "loading" ? "ready" : prev));
      return;
    }

    inFlight.current = true;
    setStatus("loading");
    missing.forEach((line) => asked.current.add(line.id));

    let anyFailed = false;
    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.functions.invoke("convert-to-fusha", {
          body: { lines: batch.map((line) => line.arabic), dialect },
        });
        if (showCapToastIfLimited(error, data)) {
          anyFailed = true;
          break;
        }
        const converted: unknown = (data as { fusha?: unknown } | null)?.fusha;
        if (error || !Array.isArray(converted)) {
          anyFailed = true;
          continue;
        }
        if (!mounted.current) return;
        setFetched((prev) => {
          const next = { ...prev };
          batch.forEach((line, idx) => {
            const value = converted[idx];
            if (typeof value === "string" && value.trim()) next[line.id] = value.trim();
          });
          return next;
        });
      }
    } catch (e) {
      console.warn("Fusha conversion failed:", e);
      anyFailed = true;
    } finally {
      inFlight.current = false;
      if (mounted.current) setStatus(anyFailed ? "error" : "ready");
    }
  }, [lines, dialect]);

  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [enabled, run]);

  const retry = useCallback(() => {
    // Only the ids that produced nothing are forgotten — the ones that worked
    // are already rendered and must not be paid for twice.
    asked.current = new Set([...asked.current].filter((id) => fetched[id]));
    setStatus("idle");
    void run();
  }, [fetched, run]);

  const fushaFor = useCallback(
    (line: TranscriptLine) => line.fusha?.trim() || fetched[line.id],
    [fetched],
  );

  return { fushaFor, status, retry };
}
