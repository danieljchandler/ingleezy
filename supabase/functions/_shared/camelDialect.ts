// =============================================================================
// CAMeL-Lab dialect identification — shared map, response parsing, and client.
//
// Model: CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter, a
// city-level dialect classifier trained on the MADAR corpus. Used as an
// independent, non-LLM check on the dialect the analysis models claim.
//
// This module exists because there were two divergent copies: `camel-analyze`
// carried the full MADAR map, while the video pipeline in `analyze-gulf-arabic`
// had a private Gulf-only one. With the Gulf-only map, a *correct* Egyptian or
// Yemeni prediction fell through to `isGulf: false` and was scored as the model
// disagreeing with the pipeline — which then raised a false `flagged` bit on
// exactly the content it was right about.
// =============================================================================

/** The three dialect modules the app teaches. Mirrors asrConfig's DialectModule. */
export type CamelModule = "Gulf" | "Egyptian" | "Yemeni";

export const CAMEL_DIALECT_MODEL =
  "CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter";

export interface CamelCityMeta {
  country: string;
  dialect: string;
  isGulf: boolean;
  /**
   * Which teaching module this prediction supports, if any. `null` means the
   * prediction is a real dialect but not one we teach (Levantine, Iraqi,
   * Maghrebi...) or is MSA — informative, but not evidence of disagreement.
   */
  module: CamelModule | null;
}

/**
 * MADAR-26 city codes, plus the Gulf country-level codes the twitter-trained
 * variant also emits. Unknown labels are handled by the caller rather than
 * being coerced into a "not Gulf" verdict.
 */
export const CAMEL_CITY_MAP: Record<string, CamelCityMeta> = {
  // ── Gulf ───────────────────────────────────────────────────────────────
  RIY: { country: "Saudi Arabia", dialect: "Saudi",    isGulf: true, module: "Gulf" },
  JED: { country: "Saudi Arabia", dialect: "Hijazi",   isGulf: true, module: "Gulf" },
  DOH: { country: "Qatar",        dialect: "Qatari",   isGulf: true, module: "Gulf" },
  KUW: { country: "Kuwait",       dialect: "Kuwaiti",  isGulf: true, module: "Gulf" },
  MUS: { country: "Oman",         dialect: "Omani",    isGulf: true, module: "Gulf" },
  MSC: { country: "Oman",         dialect: "Omani",    isGulf: true, module: "Gulf" },
  ABU: { country: "UAE",          dialect: "Emirati",  isGulf: true, module: "Gulf" },
  DUB: { country: "UAE",          dialect: "Emirati",  isGulf: true, module: "Gulf" },
  BAH: { country: "Bahrain",      dialect: "Bahraini", isGulf: true, module: "Gulf" },

  // ── Yemeni ─────────────────────────────────────────────────────────────
  // Absent from the old Gulf-only map, so every correct Yemeni prediction
  // used to read as a disagreement.
  SAN: { country: "Yemen", dialect: "Yemeni", isGulf: false, module: "Yemeni" },

  // ── Egyptian ───────────────────────────────────────────────────────────
  CAI: { country: "Egypt", dialect: "Egyptian",              isGulf: false, module: "Egyptian" },
  ALX: { country: "Egypt", dialect: "Egyptian (Alexandria)", isGulf: false, module: "Egyptian" },
  ASW: { country: "Egypt", dialect: "Egyptian (Sa'idi)",     isGulf: false, module: "Egyptian" },

  // ── Other Arabic — real predictions, but outside the taught modules ────
  ALE: { country: "Syria",     dialect: "Levantine", isGulf: false, module: null },
  DAM: { country: "Syria",     dialect: "Levantine", isGulf: false, module: null },
  BEI: { country: "Lebanon",   dialect: "Lebanese",  isGulf: false, module: null },
  AMM: { country: "Jordan",    dialect: "Jordanian", isGulf: false, module: null },
  SAL: { country: "Jordan",    dialect: "Jordanian", isGulf: false, module: null },
  JER: { country: "Palestine", dialect: "Palestinian", isGulf: false, module: null },
  BAG: { country: "Iraq",      dialect: "Iraqi",     isGulf: false, module: null },
  BAS: { country: "Iraq",      dialect: "Iraqi",     isGulf: false, module: null },
  MOS: { country: "Iraq",      dialect: "Iraqi",     isGulf: false, module: null },
  KHA: { country: "Sudan",     dialect: "Sudanese",  isGulf: false, module: null },
  TRI: { country: "Libya",     dialect: "Libyan",    isGulf: false, module: null },
  BEN: { country: "Libya",     dialect: "Libyan",    isGulf: false, module: null },
  TUN: { country: "Tunisia",   dialect: "Tunisian",  isGulf: false, module: null },
  SFX: { country: "Tunisia",   dialect: "Tunisian",  isGulf: false, module: null },
  ALG: { country: "Algeria",   dialect: "Algerian",  isGulf: false, module: null },
  RAB: { country: "Morocco",   dialect: "Moroccan",  isGulf: false, module: null },
  FES: { country: "Morocco",   dialect: "Moroccan",  isGulf: false, module: null },
  MOR: { country: "Morocco",   dialect: "Moroccan",  isGulf: false, module: null },

  MSA: { country: "MSA", dialect: "Modern Standard Arabic", isGulf: false, module: null },
};

export interface CamelPrediction {
  code: string;
  dialect: string;
  country: string;
  confidence: number;
  isGulf: boolean;
  /** Null when the label is unknown to us, or is a dialect we don't teach. */
  module: CamelModule | null;
  topPredictions: { code: string; dialect: string; score: number }[];
}

export type CamelFailureReason =
  | "no_api_key"
  | "unrecognized_response"
  | "timeout"
  | "network_error"
  | `http_${number}`;

export type CamelOutcome =
  | { ok: true; result: CamelPrediction }
  | { ok: false; reason: CamelFailureReason };

/**
 * Normalise HuggingFace's text-classification response.
 *
 * The serverless API returns a flat `[{label, score}, ...]` for some
 * deployments and a nested `[[{label, score}, ...]]` for others. The old code
 * assumed flat, so the nested shape made `predictions[0].label` undefined and
 * `.toUpperCase()` throw — caught by an outer handler and reported as a plain
 * null, indistinguishable from a missing API key.
 */
export function parseCamelPredictions(raw: unknown): { label: string; score: number }[] | null {
  const flatten = (v: unknown): unknown[] =>
    Array.isArray(v) && Array.isArray(v[0]) ? (v[0] as unknown[]) : (v as unknown[]);

  if (!Array.isArray(raw)) return null;
  const items = flatten(raw);
  if (!Array.isArray(items) || items.length === 0) return null;

  const out: { label: string; score: number }[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const label = (item as { label?: unknown }).label;
    const score = (item as { score?: unknown }).score;
    if (typeof label !== "string" || !label) continue;
    out.push({ label, score: typeof score === "number" ? score : 0 });
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => b.score - a.score);
}

/** Turn ranked predictions into the shape the pipeline stores. */
export function toCamelPrediction(
  predictions: { label: string; score: number }[],
): CamelPrediction {
  const top = predictions[0];
  const code = top.label.toUpperCase();
  const meta = CAMEL_CITY_MAP[code] ??
    { country: "Unknown", dialect: code, isGulf: false, module: null };
  return {
    code,
    dialect: meta.dialect,
    country: meta.country,
    confidence: Math.round(top.score * 1000) / 1000,
    isGulf: meta.isGulf,
    module: meta.module,
    topPredictions: predictions.slice(0, 5).map((p) => ({
      code: p.label.toUpperCase(),
      dialect: CAMEL_CITY_MAP[p.label.toUpperCase()]?.dialect ?? p.label,
      score: Math.round(p.score * 1000) / 1000,
    })),
  };
}

/**
 * Does CAMeL's verdict agree with the module the pipeline is running?
 *
 * Returns `null` — not `false` — whenever CAMeL has no opinion that bears on
 * the question: no prediction, an unknown label, MSA, or a dialect outside the
 * three taught modules. Only a confident prediction for a *different* taught
 * module counts as disagreement. Scoring "no opinion" as disagreement is what
 * made the Gulf-only map raise false flags.
 */
export function camelAgreesWithModule(
  prediction: CamelPrediction | null,
  module: CamelModule,
): boolean | null {
  if (!prediction || prediction.module === null) return null;
  return prediction.module === module;
}

/**
 * Call the classifier. Tries HuggingFace's current router host first and falls
 * back to the legacy serverless host, so this works whichever the account is
 * provisioned for — the legacy `api-inference.huggingface.co` path 404s on
 * newer accounts, and that 404 used to be logged identically to a cold start.
 */
export async function callCamelDialect(
  text: string,
  hfApiKey: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<CamelOutcome> {
  if (!hfApiKey) return { ok: false, reason: "no_api_key" };

  // BERT caps at 512 tokens anyway, and dialect is detectable from a short
  // sample — truncating keeps latency down.
  const sample = text.trim().slice(0, opts.maxChars ?? 512);
  const hosts = [
    `https://router.huggingface.co/hf-inference/models/${CAMEL_DIALECT_MODEL}`,
    `https://api-inference.huggingface.co/models/${CAMEL_DIALECT_MODEL}`,
  ];

  let lastReason: CamelFailureReason = "network_error";
  for (const url of hosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${hfApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: sample }),
      });
      if (!resp.ok) {
        lastReason = `http_${resp.status}` as CamelFailureReason;
        // 404 means this host doesn't serve the model — try the next one.
        // 503 is a cold start on the free tier and is not worth a second host.
        console.warn(`CAMeL dialect: HTTP ${resp.status} from ${new URL(url).host}`);
        if (resp.status === 404) continue;
        return { ok: false, reason: lastReason };
      }
      const predictions = parseCamelPredictions(await resp.json());
      if (!predictions) return { ok: false, reason: "unrecognized_response" };
      return { ok: true, result: toCamelPrediction(predictions) };
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      lastReason = isAbort ? "timeout" : "network_error";
      console.warn(
        `CAMeL dialect call failed (${new URL(url).host}):`,
        isAbort ? "timeout" : e instanceof Error ? e.message : String(e),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, reason: lastReason };
}
