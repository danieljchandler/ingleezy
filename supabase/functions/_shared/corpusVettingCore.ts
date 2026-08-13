// Pure half of vet-corpus-sentences: turning a model's verdict list back into
// one decision per sentence. Import-free so the Vitest suite can cover it.
//
// The whole file exists for one rule: **a sentence is rejected unless the model
// affirmatively passed it.** A dropped verdict, a malformed index, a truncated
// response, `ok: "true"` as a string — every one of those resolves to rejected.
// The pool is scraped wartime Twitter and the downstream consumer is a content
// generator, so silence must never be the thing that lets a sentence through.

export interface RawVerdict {
  i?: unknown;
  ok?: unknown;
  reason?: unknown;
}

export interface Decision {
  index: number;
  vetted: boolean;
  reason: string;
}

export const MAX_REASON_CHARS = 200;

/**
 * Map a model's verdicts onto a batch of `size` sentences.
 *
 * Only `ok === true` (a real boolean) passes. Indexes outside the batch are
 * ignored rather than trusted; the first verdict for an index wins, so a
 * repeated index cannot flip an earlier rejection into a pass.
 */
export function reconcileVerdicts(size: number, verdicts: unknown): Decision[] {
  const byIndex = new Map<number, RawVerdict>();
  if (Array.isArray(verdicts)) {
    for (const v of verdicts) {
      if (!v || typeof v !== "object") continue;
      const raw = v as RawVerdict;
      if (!Number.isInteger(raw.i)) continue;
      const idx = raw.i as number;
      if (idx < 0 || idx >= size) continue; // hallucinated index
      if (byIndex.has(idx)) continue; // first wins; a repeat cannot upgrade
      byIndex.set(idx, raw);
    }
  }

  const out: Decision[] = [];
  for (let i = 0; i < size; i++) {
    const v = byIndex.get(i);
    if (!v) {
      out.push({ index: i, vetted: false, reason: "no verdict returned" });
      continue;
    }
    const vetted = v.ok === true;
    const reason =
      typeof v.reason === "string" && v.reason.trim()
        ? v.reason.trim().slice(0, MAX_REASON_CHARS)
        : vetted
          ? "accepted"
          : "rejected";
    out.push({ index: i, vetted, reason });
  }
  return out;
}

/** Coverage of a batch, for reporting a run that is quietly degrading. */
export function verdictCoverage(size: number, decisions: Decision[]): number {
  if (size <= 0) return 1;
  const answered = decisions.filter((d) => d.reason !== "no verdict returned").length;
  return answered / size;
}
