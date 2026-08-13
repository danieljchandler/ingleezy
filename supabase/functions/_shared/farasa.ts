// =============================================================================
// QCRI Farasa WebAPI client — endpoint cascade, failure classification.
//
// Farasa has moved between hosts and paths over the years and accepts both JSON
// and form-encoded bodies, so every task is tried against a list of candidates
// until one answers usefully. Two problems with the copies this replaces:
//
//   1. A 200 response whose payload used a field name the caller didn't know
//      about returned `null` *and stopped the cascade* — one odd response from
//      the first endpoint meant the remaining ones were never tried.
//   2. Every failure — dead host, timeout, rejected key — collapsed into the
//      same `null`. A pipeline run with no tashkeel anywhere looked identical
//      whether the service was down or the key was simply never issued, and the
//      distinction is the whole difference between "wait" and "go register".
//
// There were also two divergent copies (this module's ancestor in `farasa/` read
// `data.result`, the one in `analyze-gulf-arabic` did not), so a response shape
// one of them handled the other dropped.
// =============================================================================

export type FarasaTask = 'diac' | 'seg' | 'pos' | 'NER' | 'parsing';

export type FarasaFailureReason =
  /** Every endpoint that answered rejected the credentials. Needs FARASA_API_KEY. */
  | 'invalid_api_key'
  /** Endpoints answered but nothing usable came back. */
  | 'all_endpoints_failed'
  /** Nothing answered in time. */
  | 'timeout'
  /** Nothing to send. */
  | 'empty_input';

export interface FarasaAttempt {
  url: string;
  encoding: 'json' | 'form';
  status?: number;
  /** Short reason this attempt was discarded; absent when it succeeded. */
  outcome: 'ok' | 'auth' | 'http_error' | 'unusable_body' | 'timeout' | 'network_error';
}

export type FarasaOutcome =
  | { ok: true; text: string; url: string; attempts: FarasaAttempt[] }
  | { ok: false; reason: FarasaFailureReason; attempts: FarasaAttempt[] };

const DEFAULT_TIMEOUT_MS = 20_000;

type Endpoint = [url: string, encoding: 'json' | 'form'];

/**
 * Candidate endpoints for a task, in the order they're tried.
 * `diac` has extra paths because diacritizeV2 is the current one and the older
 * seq2seq path is still reachable on some deployments.
 */
export function farasaEndpoints(task: FarasaTask): Endpoint[] {
  if (task === 'diac') {
    return [
      ['https://farasa-api.qcri.org/msa/webapi/diacritizeV2/', 'json'],
      ['https://farasa.qcri.org/webapi/diacritize/', 'json'],
      ['https://farasa.qcri.org/webapi/diacritize/', 'form'],
      ['https://farasa-api.qcri.org/webapi/diacritize/', 'json'],
      ['https://farasa.qcri.org/webapi/seq2seq_diacritize/', 'json'],
    ];
  }
  const bases = ['https://farasa.qcri.org/webapi', 'https://farasa-api.qcri.org/webapi'];
  return bases.flatMap((base): Endpoint[] => [
    [`${base}/${task}/`, 'json'],
    [`${base}/${task}/`, 'form'],
  ]);
}

/**
 * Farasa reports a rejected key as prose — "invalid api key. please register at
 * farasa.qcri.org." — and does so at a range of status codes, including 200.
 * Matching the message is therefore more reliable than matching the status.
 */
const AUTH_PATTERN = /invalid\s*api[_\s-]?key|please\s+register|unauthoriz|not\s+authoriz|forbidden|missing\s+api[_\s-]?key/i;

export function looksLikeAuthFailure(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  return AUTH_PATTERN.test(body);
}

/**
 * Pull the analysed text out of a Farasa response.
 * The field name varies by task and deployment; an object with none of them —
 * or with an empty one — is not a usable answer.
 */
export function extractFarasaText(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() || null;
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  for (const key of ['text', 'output', 'result']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * Run one Farasa task against the endpoint cascade.
 *
 * Keeps going after any single-endpoint failure — including an auth rejection,
 * because the endpoints do not all enforce the key the same way — and reports
 * `invalid_api_key` only when credentials were the reason *every* answering
 * endpoint refused.
 */
export async function callFarasa(
  task: FarasaTask,
  text: string,
  opts: { apiKey?: string; timeoutMs?: number } = {},
): Promise<FarasaOutcome> {
  const clean = (text ?? '').trim();
  if (!clean) return { ok: false, reason: 'empty_input', attempts: [] };

  // Optional-chained so the module stays importable (and testable) outside Deno.
  const apiKey = opts.apiKey ??
    (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get('FARASA_API_KEY') ?? '';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts: FarasaAttempt[] = [];

  for (const [url, encoding] of farasaEndpoints(task)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const params: Record<string, string> = { text: clean };
      if (apiKey) params.api_key = apiKey;
      const headers = encoding === 'json'
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/x-www-form-urlencoded' };
      const body = encoding === 'json'
        ? JSON.stringify(params)
        : new URLSearchParams(params).toString();

      const res = await fetch(url, { method: 'POST', signal: controller.signal, headers, body });
      const raw = await res.text();

      if (looksLikeAuthFailure(res.status, raw)) {
        attempts.push({ url, encoding, status: res.status, outcome: 'auth' });
        console.warn(`Farasa ${task}: credentials rejected at ${url} [${encoding}] — ${raw.slice(0, 100)}`);
        continue;
      }
      if (!res.ok) {
        attempts.push({ url, encoding, status: res.status, outcome: 'http_error' });
        console.warn(`Farasa ${task}: HTTP ${res.status} at ${url} [${encoding}] — ${raw.slice(0, 100)}`);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      const out = extractFarasaText(parsed);
      if (!out) {
        // Previously this returned null and abandoned the remaining endpoints.
        attempts.push({ url, encoding, status: res.status, outcome: 'unusable_body' });
        console.warn(`Farasa ${task}: no usable text at ${url} [${encoding}] — ${raw.slice(0, 100)}`);
        continue;
      }

      attempts.push({ url, encoding, status: res.status, outcome: 'ok' });
      console.log(`Farasa ${task}: success via ${url} [${encoding}]`);
      return { ok: true, text: out, url, attempts };
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      attempts.push({ url, encoding, outcome: isAbort ? 'timeout' : 'network_error' });
      console.warn(
        `Farasa ${task} failed at ${url} [${encoding}]:`,
        isAbort ? `timeout after ${timeoutMs}ms` : e instanceof Error ? e.message : String(e),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const answered = attempts.filter((a) => a.outcome !== 'timeout' && a.outcome !== 'network_error');
  const reason: FarasaFailureReason =
    answered.length > 0 && answered.every((a) => a.outcome === 'auth')
      ? 'invalid_api_key'
      : answered.length === 0
        ? 'timeout'
        : 'all_endpoints_failed';

  console.warn(
    `Farasa ${task}: all ${attempts.length} endpoints exhausted — ${reason}` +
      (reason === 'invalid_api_key' ? ' (set FARASA_API_KEY; register at farasa.qcri.org)' : ''),
  );
  return { ok: false, reason, attempts };
}

// ── Per-line diacritization ───────────────────────────────────────────────────

export interface FarasaLinesOutcome {
  /** One entry per input line, positionally aligned. Null where a line failed. */
  lines: (string | null)[];
  /** True when at least one line came back. */
  ok: boolean;
  succeeded: number;
  failed: number;
  /** Set when nothing succeeded. */
  reason?: FarasaFailureReason;
  /**
   * First slice of the diacritizer's answer for the first line that produced
   * one. Carried into provenance so a run where the output still fails to line
   * up shows *what came back* rather than only that it didn't fit.
   */
  sample?: string;
  /** The line that produced `sample`, so the two can be compared directly. */
  sampleInput?: string;
}

/** How many lines to diacritize at once. Farasa throttles aggressive callers. */
const LINE_CONCURRENCY = 3;

/** Past this many lines, per-line calls stop being worth the request count. */
const MAX_LINES = 60;

/**
 * Diacritize each line with its own request.
 *
 * The whole-transcript call this replaces sent every line joined by newlines and
 * then had to work out which output word belonged to which input line. Farasa
 * does not preserve those newlines, and on long input returns a fraction of what
 * it was sent (245 characters for a 748-character transcript in the reported
 * run), so the stream never aligned and no tashkeel reached any line.
 *
 * One line per request removes the problem rather than compensating for it:
 * output `i` belongs to input `i` by construction, and each input is short
 * enough to come back whole.
 */
export async function callFarasaDiacritizeLines(
  lines: string[],
  opts: { apiKey?: string; timeoutMs?: number; concurrency?: number } = {},
): Promise<FarasaLinesOutcome> {
  const out: (string | null)[] = new Array(lines.length).fill(null);
  if (lines.length === 0) {
    return { lines: out, ok: false, succeeded: 0, failed: 0, reason: 'empty_input' };
  }
  if (lines.length > MAX_LINES) {
    console.warn(
      `Farasa diac: ${lines.length} lines exceeds the ${MAX_LINES}-line per-line budget — ` +
      `sending the transcript whole instead`,
    );
    const whole = await callFarasa('diac', lines.join('\n'), opts);
    return whole.ok
      ? { lines: [whole.text], ok: true, succeeded: 1, failed: 0, sample: whole.text.slice(0, 200) }
      : { lines: out, ok: false, succeeded: 0, failed: lines.length, reason: whole.reason };
  }

  // Probe with the first non-empty line before fanning out. A rejected key
  // fails identically on every line, and firing all of them would mean dozens
  // of pointless requests against a service that throttles.
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx < 0) {
    return { lines: out, ok: false, succeeded: 0, failed: lines.length, reason: 'empty_input' };
  }
  const probe = await callFarasa('diac', lines[firstIdx], opts);
  if (!probe.ok) {
    if (probe.reason === 'invalid_api_key') {
      console.warn('Farasa diac: key rejected on the first line — not attempting the rest');
      return { lines: out, ok: false, succeeded: 0, failed: lines.length, reason: probe.reason };
    }
  } else {
    out[firstIdx] = probe.text;
  }

  const remaining = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line, i }) => i !== firstIdx && line.trim());

  for (let start = 0; start < remaining.length; start += LINE_CONCURRENCY) {
    const slice = remaining.slice(start, start + (opts.concurrency ?? LINE_CONCURRENCY));
    const settled = await Promise.all(
      slice.map(({ line }) => callFarasa('diac', line, opts).catch(() => null)),
    );
    settled.forEach((res, k) => {
      if (res?.ok) out[slice[k].i] = res.text;
    });
  }

  const succeeded = out.filter((l) => l !== null).length;
  // Paired sample: the first line that came back, next to the exact text that
  // was sent for it. Four audits reported "Farasa succeeded but nothing landed"
  // and none could show *what* came back, so each round diagnosed the mismatch
  // by inference. Side by side, one glance settles it.
  const sampleIdx = out.findIndex((l) => l);
  const sample = sampleIdx >= 0 ? out[sampleIdx]!.slice(0, 200) : undefined;
  const sampleInput = sampleIdx >= 0 ? lines[sampleIdx].slice(0, 200) : undefined;
  console.log(`Farasa diac: ${succeeded}/${lines.length} lines diacritized`);
  return {
    lines: out,
    ok: succeeded > 0,
    succeeded,
    failed: lines.length - succeeded,
    ...(succeeded === 0 ? { reason: probe.ok ? 'all_endpoints_failed' : probe.reason } : {}),
    ...(sample ? { sample } : {}),
    ...(sampleInput ? { sampleInput } : {}),
  };
}
