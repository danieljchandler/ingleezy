// Native-speaker authenticity validator.
//
// After the brain produces dialect Arabic, this runs a single strong-model
// "native speaker reviewer" pass that scores authenticity 1-5 against the
// approved rulebook context already baked into the system prompt.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  type Dialect,
} from './dialectHelpers.ts';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const VALIDATOR_MODEL = 'google/gemini-2.5-pro';
// Arabic-native second opinion. Mistral Saba is a 24B Arabic-focused model on
// the OpenRouter key the app already uses — roughly an order of magnitude
// cheaper than Gemini 2.5 Pro on this single-snippet task.
const ARABIC_VALIDATOR_MODEL = 'mistralai/mistral-saba';

export interface ValidatorLeak {
  token: string;
  suggestion?: string;
  rule_id?: string;
  reason?: string;
}

export interface ValidatorResult {
  score: number;           // 1-5; 5 = fully authentic native, 1 = clearly MSA / wrong dialect
  verdict: 'pass' | 'rewrite' | 'unknown';
  leaks: ValidatorLeak[];
  notes?: string;
  latencyMs: number;
  ok: boolean;             // false if the validator itself errored — caller should ignore result
  /** Which model produced this judgment. */
  model?: string;
  /** Present on cross-checked results: how the two validators related. */
  agreement?: 'agree' | 'disagree' | 'single';
}

export interface ValidateOptions {
  apiKey?: string;
  passThreshold?: number; // default 4
  maxChars?: number;      // truncate text for cost control; default 4000
  signal?: AbortSignal;
  /**
   * Per-call ceiling. Preferred over `signal` for the cross-checked path: one
   * shared AbortSignal across two concurrent calls means a slow leg eats the
   * other leg's clock, so each call mints its own timer from this instead.
   * Ignored when `signal` is supplied.
   */
  timeoutMs?: number;
  /** Override the judging model. Defaults to Gemini 2.5 Pro via the Lovable gateway. */
  model?: string;
}

export async function validateDialect(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions = {},
): Promise<ValidatorResult> {
  const start = Date.now();
  const model = opts.model ?? VALIDATOR_MODEL;
  // OpenRouter-only models (Saba) need their own key + endpoint; everything
  // else goes through the Lovable gateway. Mirrors routeForModel in aiBrain.
  const viaOpenRouter = /^(mistralai|anthropic|qwen|meta-llama|deepseek|x-ai)\//.test(model);
  const apiKey = viaOpenRouter
    ? Deno.env.get('OPENROUTER_API_KEY')
    : (opts.apiKey ?? Deno.env.get('LOVABLE_API_KEY'));
  if (!apiKey || !text || !text.trim()) {
    return { score: 0, verdict: 'unknown', leaks: [], latencyMs: 0, ok: false, model };
  }

  const passThreshold = opts.passThreshold ?? 4;
  const snippet = text.slice(0, opts.maxChars ?? 4000);

  const system = `${getDialectIdentity(dialect)}

${getDialectVocabRules(dialect)}

You are acting as a STRICT NATIVE-SPEAKER REVIEWER for ${getDialectLabel(dialect)}.
Your only job: judge whether the candidate text sounds like an authentic native ${dialect} speaker.
- Score 5: indistinguishable from a native — vocabulary, syntax, particles all authentic.
- Score 4: mostly authentic; minor stylistic awkwardness.
- Score 3: noticeable MSA influence OR borrowing from another dialect; would feel "off" to a native.
- Score 2: clearly MSA / wrong dialect in multiple places.
- Score 1: pure MSA or completely wrong dialect.
Be harsh. When in doubt between 4 and 3, choose 3.`;

  const tool = {
    name: 'emit_authenticity_score',
    description: 'Return a strict native-speaker authenticity judgment.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 1, maximum: 5 },
        verdict: { type: 'string', enum: ['pass', 'rewrite'] },
        leaks: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              token: { type: 'string', description: 'The offending word or short phrase as it appears in the text.' },
              suggestion: { type: 'string', description: 'Authentic dialectal replacement.' },
              reason: { type: 'string', description: 'Short reason this is wrong for this dialect.' },
            },
            required: ['token'],
          },
        },
        notes: { type: 'string' },
      },
      required: ['score', 'verdict', 'leaks'],
    },
  };

  try {
    const res = await fetch(viaOpenRouter ? OPENROUTER_URL : GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Candidate text in ${dialect} Arabic to judge:\n\n${snippet}` },
        ],
        tools: [{ type: 'function', function: tool }],
        tool_choice: { type: 'function', function: { name: tool.name } },
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      console.warn('[dialectValidator] gateway error', model, res.status, msg.slice(0, 200));
      return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    }
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    let parsed: { score?: number; verdict?: string; leaks?: ValidatorLeak[]; notes?: string };
    try { parsed = JSON.parse(args); } catch {
      return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
    }
    const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score) || 5)));
    const verdict: 'pass' | 'rewrite' =
      parsed.verdict === 'rewrite' || score < passThreshold ? 'rewrite' : 'pass';
    const leaks = Array.isArray(parsed.leaks) ? parsed.leaks.filter((l) => l && typeof l.token === 'string') : [];
    return {
      score,
      verdict,
      leaks,
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      latencyMs: Date.now() - start,
      ok: true,
      model,
    };
  } catch (err) {
    console.warn('[dialectValidator] failed', model, err);
    return { score: 0, verdict: 'unknown', leaks: [], latencyMs: Date.now() - start, ok: false, model };
  }
}

/**
 * Two-model dialect judgment: both models read the text, the harsher verdict wins.
 *
 * The two run CONCURRENTLY and both always run. An earlier version asked the
 * cheap Arabic-native validator (Mistral Saba) first and returned its answer
 * without paying for the strong generalist (Gemini 2.5 Pro) whenever Saba said
 * `pass` at 5/5. That is the one shortcut this gate cannot afford: Saba is a
 * general Arabic model, so on Yemeni it reads fusha-inflected prose as fine and
 * scores it 5, and the strict reviewer that would have caught it never ran.
 * "Fusha grammar with dialect words sprinkled in" is exactly the failure this
 * validator exists to catch, and it was being waved through.
 *
 * Running them in parallel also costs less wall clock than the old sequential
 * escalation (max, not sum), which matters because the caller skips the rewrite
 * pass entirely once its latency budget is spent — the previous shape could
 * spend the budget *and* return the lenient verdict. For the same reason each
 * call now gets its own timeout: they shared one AbortSignal, so a slow Saba
 * left the strong validator with a few seconds and it aborted into `unknown`,
 * silently degrading the cross-check to Saba alone.
 *
 * Set DIALECT_VALIDATOR_CROSSCHECK=off to fall back to Gemini Pro alone.
 */
export async function validateDialectCrossChecked(
  text: string,
  dialect: Dialect,
  opts: ValidateOptions = {},
): Promise<ValidatorResult> {
  if (Deno.env.get('DIALECT_VALIDATOR_CROSSCHECK')?.trim() === 'off') {
    return validateDialect(text, dialect, opts);
  }

  const [arabic, strong] = await Promise.all([
    validateDialect(text, dialect, { ...opts, model: ARABIC_VALIDATOR_MODEL }),
    validateDialect(text, dialect, { ...opts, model: VALIDATOR_MODEL }),
  ]);

  // If either side failed, trust whichever one worked.
  if (!strong.ok) return arabic.ok ? { ...arabic, agreement: 'single' } : strong;
  if (!arabic.ok) return { ...strong, agreement: 'single' };

  const agreement = arabic.verdict === strong.verdict ? 'agree' : 'disagree';
  // Harsher verdict wins: a rewrite call from either model stands, and the
  // reported score is the lower of the two.
  const verdict: 'pass' | 'rewrite' =
    arabic.verdict === 'rewrite' || strong.verdict === 'rewrite' ? 'rewrite' : 'pass';
  // Merge leak lists, deduplicated by token.
  const seen = new Set<string>();
  const leaks = [...strong.leaks, ...arabic.leaks].filter((l) => {
    if (seen.has(l.token)) return false;
    seen.add(l.token);
    return true;
  }).slice(0, 10);

  console.log(
    `[dialectValidator] cross-check ${agreement}: ` +
      `${ARABIC_VALIDATOR_MODEL}=${arabic.score}/${arabic.verdict} ` +
      `${VALIDATOR_MODEL}=${strong.score}/${strong.verdict} → ${verdict}`,
  );

  return {
    score: Math.min(arabic.score, strong.score),
    verdict,
    leaks,
    notes: strong.notes ?? arabic.notes,
    // Parallel, so the cost to the caller's budget is the slower leg, not the sum.
    latencyMs: Math.max(arabic.latencyMs, strong.latencyMs),
    ok: true,
    model: `${ARABIC_VALIDATOR_MODEL}+${VALIDATOR_MODEL}`,
    agreement,
  };
}
