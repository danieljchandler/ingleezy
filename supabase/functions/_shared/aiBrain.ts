// AI Brain — a small multi-model orchestrator for dialect-sensitive generation.
// Edge functions call askBrain() instead of fetching the gateway directly so every
// flow inherits: dialect identity prompt, structured-output, ensemble consensus,
// MSA-leak detection, and one repair pass.

import {
  getDialectIdentity,
  getDialectVocabRules,
  getDialectLabel,
  getDialectForbiddenTokens,
  primeDialectPrompt,
  type Dialect,
} from './dialectHelpers.ts';
import { detectMsaLeaks, type MsaLeakResult } from './msaLeakDetector.ts';
import { logMsaViolations, logValidatorResult } from './msaViolationLogger.ts';
import { validateDialectCrossChecked, type ValidatorResult } from './dialectValidator.ts';
import { decideCriticOutcome } from './criticDecision.ts';
import { emitMetric } from './featureMetrics.ts';
import { extractUsage } from './llmUsageCore.ts';
import { logLlmUsage } from './llmUsageLogger.ts';
import { logRepairPair } from './trainingExampleLogger.ts';
import {
  DEFAULT_FAST,
  DEFAULT_JUDGE,
  DEFAULT_DRAFTERS,
  MODEL_IDS,
  MODEL_LINEUPS,
  getModelWeight,
} from './modelRegistry.ts';

// Helper: scan with both hardcoded and rulebook-derived forbidden tokens.
function scanLeaks(text: string, dialect: Dialect): MsaLeakResult {
  return detectMsaLeaks(text, dialect, getDialectForbiddenTokens(dialect));
}

export type Strategy = 'solo' | 'ensemble' | 'draft_critic' | 'council';

// ----------------- Latency budget -----------------
// Nothing here used to be time-bounded. Deno's fetch has no default timeout, so
// a single upstream connection that stalls hung the edge function until the
// platform's wall clock killed it — the caller just saw a spinner. Worse, the
// retry/fallback ladder could stack six full-length generations back to back.
// Every model call now carries a per-call timeout, and the whole task carries a
// wall-clock deadline that retries, critic passes and repair passes check
// before they start.

/** Ceiling for one upstream model call. */
const DEFAULT_CALL_TIMEOUT_MS = 45_000;
/** Wall-clock budget for one askBrain task, across every pass. */
const DEFAULT_TASK_BUDGET_MS = 90_000;
/** Below this much remaining budget, an optional extra pass isn't worth starting. */
const MIN_PASS_BUDGET_MS = 12_000;
/** Ceiling for the dialect-authenticity check — a short classification, not a generation. */
const VALIDATOR_MAX_MS = 20_000;

interface Deadline {
  at: number;
  callTimeoutMs: number;
}

function remainingMs(d: Deadline): number {
  return Math.max(0, d.at - Date.now());
}

/** Timeout for the next call: the per-call ceiling, clipped to what's left. */
function callBudget(d: Deadline): number {
  return Math.max(1_000, Math.min(d.callTimeoutMs, remainingMs(d)));
}

type PassLog = Array<{ pass: string; model: string; ms: number }>;

/** Time one model pass into `log`, whether it succeeds or throws. */
async function timePass<R extends { model?: string }>(
  log: PassLog,
  pass: string,
  fallbackModel: string,
  fn: () => Promise<R>,
): Promise<R> {
  const t0 = Date.now();
  try {
    const r = await fn();
    log.push({ pass, model: r.model ?? fallbackModel, ms: Date.now() - t0 });
    return r;
  } catch (err) {
    log.push({ pass: `${pass}:failed`, model: fallbackModel, ms: Date.now() - t0 });
    throw err;
  }
}

export type MultimodalContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface BrainTask {
  purpose: string;
  dialect: Dialect;
  userPrompt: MultimodalContent;
  systemPromptExtra?: string;
  strategy?: Strategy;
  tool?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  models?: string[];
  maxTokens?: number;
  temperature?: number;
  arabicTextPath?: (parsed: unknown) => string;
  /** When true, skip the MSA repair pass (for low-stakes internal calls). */
  skipRepair?: boolean;
  /** When true, run a strict native-speaker validator after the repair pass. */
  validateDialect?: boolean;
  /** Wall-clock budget for the whole task. Optional passes are skipped once spent. */
  budgetMs?: number;
  /** Ceiling for a single upstream model call. */
  callTimeoutMs?: number;
  /**
   * Extra completeness/quality check on a draft, run locally and for free.
   * Return a short reason to force the expensive critic/rewrite pass, or null
   * when the draft is good enough to ship as-is. Used by draft_critic.
   */
  qualityGate?: (parsed: unknown, arabicText: string) => string | null;
  /**
   * Force draft_critic's critic pass even when the draft is clean. Restores the
   * old unconditional two-generation behaviour.
   */
  alwaysCritique?: boolean;
  /**
   * Judge the draft's dialect authenticity with the native-speaker validator,
   * and rewrite it when the validator asks for one.
   *
   * The MSA leak detector cannot do this job. It is a token blacklist: it
   * catches known-wrong *words*, and is blind to text that is MSA in grammar
   * and register while using dialect vocabulary — case endings, MSA verb
   * morphology, fusha lexis that nobody put on a list. Any caller whose output
   * a learner will read as a model of the dialect wants this on.
   *
   * Costs one short classification call (a few hundred tokens out), not a
   * generation; the expensive rewrite only follows a failed verdict.
   */
  enforceDialect?: boolean;
}

export interface BrainResult<T = unknown> {
  output: T;
  raw: string;
  strategy: Strategy;
  models: string[];
  agreementScore: number;
  msaLeaks: MsaLeakResult;
  msaRepairs: number;
  totalLatencyMs: number;
  /** Set when validateDialect was requested and the validator returned a result. */
  validator?: ValidatorResult;
  /**
   * True when a rewrite pass already ran against these exact leak tokens and
   * failed to shift them. Signals that another rewrite with the same
   * instruction is not going to converge either.
   */
  leakRewriteStalled?: boolean;
  /** Per-pass wall-clock timings, so a slow request can be diagnosed from logs. */
  passes: Array<{ pass: string; model: string; ms: number }>;
}

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Models that aren't on the Lovable AI Gateway catalog and must go through
// OpenRouter (uses OPENROUTER_API_KEY). Everything else goes through Lovable.
function routeForModel(model: string): 'openrouter' | 'lovable' {
  if (/^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai)\//.test(model)) return 'openrouter';
  return 'lovable';
}

class BrainHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ----------------- Public entry point -----------------

export async function askBrain<T = unknown>(task: BrainTask): Promise<BrainResult<T>> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new BrainHttpError(500, 'LOVABLE_API_KEY not configured');

  await primeDialectPrompt(task.dialect);

  const strategy: Strategy = task.strategy ?? pickStrategy(task.purpose);
  const start = Date.now();
  const deadline: Deadline = {
    at: start + (task.budgetMs ?? DEFAULT_TASK_BUDGET_MS),
    callTimeoutMs: task.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
  };

  let result: BrainResult<T>;
  switch (strategy) {
    case 'solo':
      result = await runSolo<T>(task, apiKey, deadline);
      break;
    case 'ensemble':
      result = await runEnsemble<T>(task, apiKey, deadline);
      break;
    case 'draft_critic':
      result = await runDraftCritic<T>(task, apiKey, deadline);
      break;
    case 'council':
      result = await runCouncil<T>(task, apiKey, deadline);
      break;
  }

  // MSA-guard + one repair pass when leaks are detected (all strategies).
  // Callers may opt out with skipRepair for truly low-stakes internal calls.
  // Skipped when the budget is spent: shipping output with a few leaks beats
  // burning another full generation and timing the caller out entirely.
  if (!task.skipRepair && result.msaLeaks.leaks.length > 0) {
    if (result.leakRewriteStalled) {
      // A rewrite already ran against these exact tokens and they came back
      // unchanged. Another one costs a full generation to produce the same text.
      console.warn(
        '[aiBrain] skipping repair pass, a rewrite already failed to shift these leaks:',
        result.msaLeaks.leaks.join(', '),
      );
    } else if (remainingMs(deadline) < MIN_PASS_BUDGET_MS) {
      console.warn('[aiBrain] skipping repair pass, latency budget spent');
    } else {
      try {
        const beforeText = extractScanText(task, result.output, result.raw);
        const repaired = await runRepair<T>(task, result, apiKey, deadline);
        const afterText = extractScanText(task, repaired.output, repaired.raw);
        // A repair that actually shifted the leaks is a correction pair worth
        // keeping (bronze — automated, not human): what the model said vs what
        // the repair made of it. Distillation data for the flywheel.
        if (
          beforeText && afterText && beforeText !== afterText &&
          repaired.msaLeaks.leaks.length < result.msaLeaks.leaks.length
        ) {
          logRepairPair({
            dialect: task.dialect,
            machineOutput: beforeText,
            repairedOutput: afterText,
            sourceFunction: task.purpose,
            leaks: result.msaLeaks.leaks,
          });
        }
        result = { ...repaired, msaRepairs: result.msaRepairs + 1 };
      } catch (err) {
        console.warn('[aiBrain] repair pass failed, returning original', err);
      }
    }
  }

  // Optional native-validator pass (strict native-speaker reviewer).
  // Skipped when enforceDialect already ran one inside the strategy — that
  // verdict is the same judgment on the same text, and re-asking costs a second
  // call to learn nothing.
  if (task.validateDialect && !result.validator) {
    try {
      const scanText = extractScanText(task, result.output, result.raw);
      const v = await validateDialectCrossChecked(scanText, task.dialect, { apiKey });
      result.validator = v;
      if (v.ok && (v.verdict === 'rewrite' || v.leaks.length > 0)) {
        logValidatorResult({
          dialect: task.dialect,
          result: v,
          offendingText: scanText,
          sourceFunction: task.purpose,
          metadata: { strategy: result.strategy, models: result.models },
        });
      }
    } catch (err) {
      console.warn('[aiBrain] validator pass failed', err);
    }
  }

  result.totalLatencyMs = Date.now() - start;

  // One line per request in the function logs saying exactly where the time
  // went. Without it, diagnosing "it's slow" means guessing at which pass ran.
  console.log(
    `[aiBrain] ${task.purpose} ${result.strategy} ${result.totalLatencyMs}ms ` +
      `[${(result.passes ?? []).map((p) => `${p.pass}=${p.ms}ms`).join(' ')}]` +
      ` leaks=${result.msaLeaks?.leaks?.length ?? 0} repairs=${result.msaRepairs}` +
      `${result.validator?.ok ? ` dialect=${result.validator.score}/5` : ''}`,
  );

  if (result.msaLeaks?.leaks?.length) {
    logMsaViolations({
      dialect: task.dialect,
      leaks: result.msaLeaks,
      offendingText: result.raw ?? '',
      sourceFunction: task.purpose,
      validator: result.validator
        ? { ok: result.validator.ok, verdict: result.validator.verdict, score: result.validator.score }
        : undefined,
      metadata: {
        strategy: result.strategy,
        models: result.models,
        repairs: result.msaRepairs,
        post_repair: true,
      },
    });
  }


  // Structured metric for the admin observability dashboard.
  try {
    const leakCount = result.msaLeaks?.leaks?.length ?? 0;
    emitMetric({
      feature: 'ai-brain',
      event: 'ask_brain',
      dialect: task.dialect,
      status: leakCount > 0 ? 'warn' : 'ok',
      durationMs: result.totalLatencyMs,
      count: leakCount,
      score: result.validator?.score ?? null,
      meta: {
        purpose: task.purpose,
        strategy: result.strategy,
        models: result.models,
        repairs: result.msaRepairs,
        leaks: result.msaLeaks?.leaks ?? [],
        validator_verdict: result.validator?.verdict ?? null,
        passes: result.passes ?? [],
      },
    });
  } catch { /* never throw from metrics */ }

  return result;
}

// ----------------- Strategy picker -----------------

function pickStrategy(purpose: string): Strategy {
  switch (purpose) {
    case 'vocab_definition':
    case 'sample_sentences':
    case 'translation':
    case 'phrase_of_the_day':
      return 'ensemble';
    case 'story':
    case 'meme_explain':
    case 'news_summary':
      return 'draft_critic';
    case 'lesson_generation':
    case 'how_do_i_say':
      return 'council';
    default:
      return 'solo';
  }
}

// ----------------- Prompt builder -----------------

function buildSystem(task: BrainTask): string {
  const identity = getDialectIdentity(task.dialect);
  const rules = getDialectVocabRules(task.dialect);
  const extra = task.systemPromptExtra ? `\n\n${task.systemPromptExtra}` : '';
  return `${identity}\n\n${rules}${extra}`;
}

/**
 * The same prompt split at its cache boundary. The dialect identity and the
 * Rulebook are stable across every call and every user of a dialect; the
 * learner profile (`systemPromptExtra`) changes per user per day. Keeping the
 * volatile half strictly AFTER the stable half is what makes the stable half
 * cacheable at all — anything volatile placed earlier would invalidate
 * everything behind it on every call.
 */
function buildSystemParts(task: BrainTask): { stable: string; volatile: string } {
  const identity = getDialectIdentity(task.dialect);
  const rules = getDialectVocabRules(task.dialect);
  return {
    stable: `${identity}\n\n${rules}`,
    volatile: task.systemPromptExtra ?? '',
  };
}

/** Providers that honour cache_control breakpoints through OpenRouter. */
function supportsPromptCache(model: string): boolean {
  return /^anthropic\//.test(model);
}

/**
 * The system message for a call: a plain string normally, or — for models with
 * prompt caching behind OpenRouter — content parts with a cache_control
 * breakpoint after the stable prefix, so the dialect identity and Rulebook are
 * billed at the cached rate on every call after the first.
 */
function systemMessage(
  opts: Pick<CallOptions, 'system' | 'systemParts' | 'model'>,
  route: 'openrouter' | 'lovable',
): { role: 'system'; content: unknown } {
  const parts = opts.systemParts;
  if (route === 'openrouter' && supportsPromptCache(opts.model) && parts?.stable) {
    const content: unknown[] = [
      { type: 'text', text: parts.stable, cache_control: { type: 'ephemeral' } },
    ];
    if (parts.volatile) content.push({ type: 'text', text: parts.volatile });
    return { role: 'system', content };
  }
  return { role: 'system', content: opts.system };
}

// ----------------- Single model call -----------------

interface CallOptions {
  model: string;
  system: string;
  user: MultimodalContent;
  tool?: BrainTask['tool'];
  maxTokens?: number;
  temperature?: number;
  apiKey: string;
  /** Hard ceiling for this one call. Defaults to DEFAULT_CALL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The task's purpose, so cost telemetry can name the feature it served. */
  purpose?: string;
  /**
   * The system prompt split at its cache boundary (stable dialect block vs
   * volatile learner profile). When set and the model supports prompt caching,
   * it is sent as content parts with a cache_control breakpoint; `system`
   * remains the joined fallback for every other model.
   */
  systemParts?: { stable: string; volatile: string };
}

/** True when the error came from our own AbortSignal.timeout rather than upstream. */
function isTimeout(err: unknown): boolean {
  if (err instanceof BrainHttpError) return err.status === 504;
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function callModel(opts: CallOptions): Promise<{ raw: string; parsed: unknown }> {
  const isGpt5 = /^openai\/gpt-5/.test(opts.model);
  const route = routeForModel(opts.model);
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      systemMessage(opts, route),
      { role: 'user', content: opts.user },
    ],
  };
  const tokens = opts.maxTokens ?? 1024;
  if (isGpt5) body.max_completion_tokens = tokens;
  else body.max_tokens = tokens;
  // GPT-5 models only support default temperature; skip the field for them.
  if (!isGpt5) body.temperature = opts.temperature ?? 0.5;

  if (opts.tool) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.parameters,
        },
      },
    ];
    body.tool_choice = { type: 'function', function: { name: opts.tool.name } };
  }

  let url: string;
  let authKey: string | undefined;
  if (route === 'openrouter') {
    url = OPENROUTER_URL;
    authKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!authKey) {
      throw new BrainHttpError(500, `OPENROUTER_API_KEY not configured (required for ${opts.model})`);
    }
    // Ask OpenRouter to report spend per call; it lands in `usage.cost` (USD)
    // alongside the token counts. Cost telemetry stores what the provider
    // says rather than computing from a price table that would drift.
    body.usage = { include: true };
  } else {
    url = GATEWAY_URL;
    authKey = opts.apiKey;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new BrainHttpError(504, `${route} ${opts.model} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BrainHttpError(res.status, `${route} ${opts.model} ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  logLlmUsage({
    functionName: opts.purpose ?? 'ai-brain',
    model: opts.model,
    provider: route,
    usage: extractUsage(data),
  });
  const msg = data.choices?.[0]?.message;
  if (opts.tool) {
    const tc = msg?.tool_calls?.[0];
    const args = tc?.function?.arguments;
    if (args) {
      try {
        return { raw: args, parsed: JSON.parse(args) };
      } catch {
        throw new BrainHttpError(500, `${opts.model} returned invalid JSON in tool call`);
      }
    }
    // Fallback: some models (notably gpt-5 on long judge prompts) skip the
    // tool_call and return JSON in message.content instead. Salvage it.
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.warn(`[aiBrain] ${opts.model} skipped tool_call; parsed JSON from content fallback`);
        return { raw: jsonMatch[0], parsed };
      } catch {
        /* fall through to error */
      }
    }
    throw new BrainHttpError(500, `${opts.model} returned no tool call and no parsable JSON content`);
  }
  const raw = msg?.content ?? '';
  // Try to extract JSON if it looks like JSON.
  const jsonMatch = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
  let parsed: unknown = raw;
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[0]); } catch { /* keep raw */ }
  }
  return { raw, parsed };
}

// ----------------- Strategies -----------------

// Rescue chain for models that won't emit a usable tool call. Ordered fastest
// first: this path only runs when the primary model has already burned part of
// the latency budget, so a stable model that answers beats a stronger one that
// runs the clock out.
const STABLE_FALLBACKS = ['google/gemini-2.5-flash', 'google/gemini-2.5-pro', 'google/gemini-3-flash-preview'];

/**
 * Calls the requested (best) model. If it returns an empty/unparseable response
 * — common with preview tool-calling — retries the SAME model ONCE with both
 * perturbations applied (lower temp + nudged prompt) before falling back to a
 * stable Gemini build.
 *
 * Every attempt is clipped to what remains of the task deadline, and the ladder
 * stops as soon as there isn't time for another full generation. A timeout is
 * treated differently from a malformed response: re-rolling the same model that
 * just ran out of clock buys nothing, so a timeout jumps straight to the
 * fallback chain.
 */
async function callModelWithFallback(
  opts: CallOptions,
  deadline: Deadline,
): Promise<{ raw: string; parsed: unknown; model: string }> {
  const recoverable = (msg: string) => /no tool call|invalid JSON|no parsable JSON|timed out|5\d\d/.test(msg);
  let lastErr: unknown;
  let timedOut = false;

  const attempt = async (o: CallOptions, model: string) => {
    const r = await callModel({ ...o, timeoutMs: callBudget(deadline) });
    return { ...r, model };
  };

  const classify = (err: unknown) => {
    lastErr = err;
    timedOut = isTimeout(err);
    if (!recoverable(err instanceof Error ? err.message : String(err))) throw err;
  };

  // Attempt 1: as requested.
  try {
    return await attempt(opts, opts.model);
  } catch (err) {
    classify(err);
  }

  // Attempt 2: ONE same-model retry that applies both perturbations at once —
  // lower temperature and an explicit reminder to call the tool. These used to
  // be two separate attempts, which meant a model that simply won't emit this
  // tool schema burned three full-length generations before the stable chain
  // was even tried, leaving the fallback with no deadline left (the Yemeni
  // reading-passage 504s). One re-roll catches the flaky case; a second never
  // did.
  if (!timedOut && remainingMs(deadline) > MIN_PASS_BUDGET_MS) {
    try {
      console.warn(`[aiBrain] ${opts.model} retry #1 (lower temp + tool nudge)`);
      const nudged = opts.tool
        ? `${opts.system}\n\nIMPORTANT: You MUST respond by calling the function "${opts.tool.name}". Do not write any prose. Return only the function call.`
        : opts.system;
      return await attempt({ ...opts, system: nudged, temperature: 0.2 }, opts.model);
    } catch (err) {
      classify(err);
    }
  }

  // Last resort: stable fallback chain.
  for (const fb of STABLE_FALLBACKS) {
    if (fb === opts.model) continue;
    if (remainingMs(deadline) < MIN_PASS_BUDGET_MS) {
      console.warn(`[aiBrain] out of latency budget, not trying fallback ${fb}`);
      break;
    }
    try {
      console.warn(`[aiBrain] ${opts.model} exhausted retries, falling back to ${fb}`);
      return await attempt({ ...opts, model: fb }, fb);
    } catch (err) { lastErr = err; /* try next */ }
  }
  throw lastErr;
}


async function runSolo<T>(task: BrainTask, apiKey: string, deadline: Deadline): Promise<BrainResult<T>> {
  const model = task.models?.[0] ?? DEFAULT_FAST;
  const passes: PassLog = [];
  const { raw, parsed, model: usedModel } = await timePass(passes, 'solo', model, () => callModelWithFallback({
    model,
    system: buildSystem(task),
    systemParts: buildSystemParts(task),
    user: task.userPrompt,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    apiKey,
    purpose: task.purpose,
  }, deadline));
  const text = extractScanText(task, parsed, raw);
  return {
    output: parsed as T,
    raw,
    strategy: 'solo',
    models: [usedModel],
    agreementScore: 1,
    msaLeaks: scanLeaks(text, task.dialect),
    msaRepairs: 0,
    totalLatencyMs: 0,
    passes,
  };
}


async function runEnsemble<T>(task: BrainTask, apiKey: string, deadline: Deadline): Promise<BrainResult<T>> {
  const models = (task.models ?? DEFAULT_DRAFTERS).slice(0, 3);
  const sys = buildSystem(task);
  const passes: PassLog = [];
  const ensembleStart = Date.now();
  const settled = await Promise.allSettled(
    models.map((m) =>
      callModel({
        model: m,
        system: sys,
        systemParts: buildSystemParts(task),
        user: task.userPrompt,
        tool: task.tool,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        apiKey,
        purpose: task.purpose,
        timeoutMs: callBudget(deadline),
      }),
    ),
  );
  const successes = settled
    .map((s, i) => ({ s, model: models[i] }))
    .filter((x) => x.s.status === 'fulfilled') as Array<{
      s: PromiseFulfilledResult<{ raw: string; parsed: unknown }>;
      model: string;
    }>;

  passes.push({ pass: 'ensemble', model: models.join('+'), ms: Date.now() - ensembleStart });

  if (successes.length === 0) {
    const firstErr = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstErr?.reason ?? new BrainHttpError(500, 'all ensemble models failed');
  }

  // Rank by weighted leak score (leaks / weight) — lower is better.
  // Qwen (weight 0.6) only wins when Gemini & Claude both have strictly more leaks.
  // Tiebreak by raw length (shorter = tighter).
  const ranked = successes
    .map(({ s, model }) => {
      const text = extractScanText(task, s.value.parsed, s.value.raw);
      const leaks = scanLeaks(text, task.dialect);
      const weight = getModelWeight(model);
      const score = leaks.leaks.length / weight;
      return { model, parsed: s.value.parsed, raw: s.value.raw, leaks, text, weight, score };
    })
    .sort((a, b) => a.score - b.score || a.raw.length - b.raw.length);

  const winner = ranked[0];
  // Agreement = share of candidates with the same leak-count bucket as winner.
  const agree = ranked.filter((r) => r.leaks.leaks.length === winner.leaks.leaks.length).length / ranked.length;

  return {
    output: winner.parsed as T,
    raw: winner.raw,
    strategy: 'ensemble',
    models: successes.map((x) => x.model),
    agreementScore: agree,
    msaLeaks: winner.leaks,
    msaRepairs: 0,
    totalLatencyMs: 0,
    passes,
  };
}

async function runDraftCritic<T>(task: BrainTask, apiKey: string, deadline: Deadline): Promise<BrainResult<T>> {
  // CONTENT lineup: Gemini drafts, Claude critiques. Source of truth =
  // MODEL_LINEUPS.CONTENT in modelRegistry.ts.
  const [drafter, critic] = task.models && task.models.length >= 2
    ? task.models
    : [MODEL_LINEUPS.CONTENT.drafters[0], MODEL_LINEUPS.CONTENT.judge];

  const passes: PassLog = [];
  const sys = buildSystem(task);
  const draft = await timePass(passes, 'draft', drafter, () => callModelWithFallback({
    model: drafter,
    system: sys,
    systemParts: buildSystemParts(task),
    user: task.userPrompt,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: task.temperature,
    apiKey,
    purpose: task.purpose,
  }, deadline));

  const draftText = extractScanText(task, draft.parsed, draft.raw);
  const draftLeaks = scanLeaks(draftText, task.dialect);
  // `validator` is assigned below, before any call site of shipDraft that can
  // observe it; declared here so the shipped draft always carries the verdict.
  let validator: ValidatorResult | undefined;
  const shipDraft = (stalled = false): BrainResult<T> => ({
    output: draft.parsed as T,
    raw: draft.raw,
    strategy: 'draft_critic',
    models: [draft.model],
    agreementScore: 1,
    msaLeaks: draftLeaks,
    msaRepairs: 0,
    totalLatencyMs: 0,
    leakRewriteStalled: stalled,
    validator,
    passes,
  });

  // The critic re-generates the entire payload from scratch — for structured
  // content (fully vocalized Arabic, transliteration, gloss, quiz) that is by
  // far the most expensive step in the pipeline, and it used to run on every
  // single request whether or not there was anything to fix.
  //
  // It now runs only for problems it is actually the right tool for: structural
  // and completeness failures, which need the whole payload re-emitted. MSA
  // leaks deliberately do NOT trigger it, because askBrain already has a repair
  // pass for exactly that and the repair pass is strictly better at it — it is
  // handed the offending tokens by name, where the critic gets only a vague
  // "rewrite it if it drifts". Running both meant two full generations spent on
  // one problem, on nearly every request: the detector's universal list includes
  // demonstratives like هذا/هذه that ordinary dialect prose uses freely, so
  // "leaks > 0" was true almost always and neither pass could ever clear them.
  const gateReason = task.qualityGate ? safeGate(task.qualityGate, draft.parsed, draftText) : null;

  // Dialect authenticity, judged by the native-speaker validator rather than by
  // the token detector. The detector only knows words on a list; it happily
  // passes text that is fusha in grammar and register — case endings, MSA verb
  // forms, classical lexis — as long as none of the blacklisted tokens appear.
  // That is precisely the failure mode a learner notices, so it needs a reader,
  // not a regex. One short classification call, and only a failed verdict costs
  // a rewrite.
  //
  // Requires room for the validator AND the rewrite it may order: at
  // MIN_PASS_BUDGET_MS the check would still run, spend up to 20s, and return a
  // "rewrite" verdict into a budget with nothing left to rewrite with — paying
  // for a judgment we then have to ignore. The validator's own timeout is
  // likewise clipped to leave the critic its floor.
  if (task.enforceDialect && remainingMs(deadline) > MIN_PASS_BUDGET_MS * 2) {
    const vStart = Date.now();
    try {
      validator = await validateDialectCrossChecked(draftText, task.dialect, {
        apiKey,
        // timeoutMs, not a shared signal: the cross-check runs two calls at once
        // and one AbortSignal between them let a slow leg abort the other.
        timeoutMs: Math.max(
          1_000,
          Math.min(VALIDATOR_MAX_MS, remainingMs(deadline) - MIN_PASS_BUDGET_MS),
        ),
      });
    } catch (err) {
      console.warn('[aiBrain] dialect validator failed; treating draft as acceptable', err);
    }
    passes.push({ pass: 'validate', model: 'dialect-validator', ms: Date.now() - vStart });
  }
  const drift = validator?.ok === true && validator.verdict === 'rewrite' ? validator : null;

  const needsCritic = task.alwaysCritique === true || gateReason !== null || drift !== null;

  if (!needsCritic) return shipDraft();
  if (remainingMs(deadline) < MIN_PASS_BUDGET_MS) {
    console.warn('[aiBrain] draft needs critic but latency budget is spent; shipping draft');
    return shipDraft();
  }
  console.warn(
    `[aiBrain] running critic on ${task.purpose} draft: gate=${gateReason ?? 'ok'}` +
      `${drift ? ` dialect=${drift.score}/5` : ''}`,
  );

  // Hand the critic the reviewer's specific findings. "Rewrite it if it drifts"
  // is a much weaker instruction than a list of words and their replacements.
  const driftNote = drift
    ? `\n\nA strict native ${getDialectLabel(task.dialect)} speaker reviewed this draft, scored it ${drift.score}/5 for authenticity and asked for a rewrite. It reads as MSA/fusha rather than natural dialect.` +
      (drift.leaks.length
        ? ` Replace these specifically: ${drift.leaks
            .map((l) => (l.suggestion ? `${l.token} → ${l.suggestion}` : l.token))
            .join('; ')}.`
        : '') +
      (drift.notes ? ` Reviewer notes: ${drift.notes}` : '') +
      ` Keep the story, the structure and every field; change only the Arabic register.`
    : '';

  const criticSys = `${sys}\n\nYou are reviewing a draft. If anything drifts to MSA or another dialect, REWRITE it in authentic ${getDialectLabel(task.dialect)}. Return ONLY the corrected output in the same format as the draft (no commentary).${driftNote}`;
  const criticUser = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nDraft to review:\n${draft.raw}`;
  let critiqued: { raw: string; parsed: unknown; model: string };
  try {
    critiqued = await timePass(passes, 'critic', critic, () => callModelWithFallback({
      model: critic,
      system: criticSys,
      user: criticUser,
      tool: task.tool,
      maxTokens: task.maxTokens,
      temperature: 0.3,
      apiKey,
      purpose: task.purpose,
    }, deadline));
  } catch (err) {
    // A failed critic used to fail the whole task, dropping callers onto their
    // hardcoded stub passage. The draft is a far better answer than that.
    console.warn('[aiBrain] critic pass failed, shipping draft', err);
    return shipDraft();
  }

  const text = extractScanText(task, critiqued.parsed, critiqued.raw);
  const criticLeaks = scanLeaks(text, task.dialect);

  // The critic rewrote the whole payload, so it had its shot at the leaks too.
  // If the same tokens survived it unchanged, a further repair pass carrying the
  // same instruction will not converge either — they are words the model insists
  // on, which in practice means the detector is flagging legitimate dialect.
  const stalled =
    criticLeaks.leaks.length > 0 &&
    criticLeaks.leaks.every((t) => draftLeaks.leaks.includes(t));

  // The critic rewrites rather than merges, so it can come back worse than what
  // it was given — but "worse" has to be judged against why it ran. See
  // _shared/criticDecision.ts; the short version is that a rewrite ordered by
  // the native-speaker validator must not be discarded over a token count, the
  // metric that is blind to fusha in the first place.
  const criticGateReason = task.qualityGate ? safeGate(task.qualityGate, critiqued.parsed, text) : null;
  const decision = decideCriticOutcome({
    draftGateReason: gateReason,
    criticGateReason,
    draftLeakCount: draftLeaks.leaks.length,
    criticLeakCount: criticLeaks.leaks.length,
    dialectDrift: drift !== null,
  });
  if (decision.keep === 'draft') {
    console.warn(`[aiBrain] keeping draft over critic rewrite: ${decision.reason}`, {
      draftLeaks: draftLeaks.leaks.length,
      criticLeaks: criticLeaks.leaks.length,
      criticGateReason,
      // Worth its own field: this is a draft a native-speaker reviewer already
      // failed, shipping anyway because the rewrite was unusable.
      shippingDriftedDraft: drift !== null,
    });
    return shipDraft();
  }
  console.log(`[aiBrain] taking critic rewrite: ${decision.reason}`);

  return {
    output: critiqued.parsed as T,
    raw: critiqued.raw,
    strategy: 'draft_critic',
    models: [draft.model, critiqued.model],
    agreementScore: 1,
    msaLeaks: criticLeaks,
    msaRepairs: 0,
    totalLatencyMs: 0,
    leakRewriteStalled: stalled,
    // The verdict describes the draft, which the rewrite has now superseded.
    // Keeping it would make askBrain's logging report a stale score.
    validator: undefined,
    passes,
  };
}

/** Run a caller-supplied quality gate; a throwing gate must not fail the task. */
function safeGate(
  gate: NonNullable<BrainTask['qualityGate']>,
  parsed: unknown,
  text: string,
): string | null {
  try {
    return gate(parsed, text);
  } catch (err) {
    console.warn('[aiBrain] qualityGate threw; treating draft as acceptable', err);
    return null;
  }
}

async function runCouncil<T>(task: BrainTask, apiKey: string, deadline: Deadline): Promise<BrainResult<T>> {
  const drafters = (task.models ?? DEFAULT_DRAFTERS).slice(0, 3);
  const judge = DEFAULT_JUDGE;
  const sys = buildSystem(task);
  const passes: PassLog = [];
  const draftStart = Date.now();

  const drafts = await Promise.allSettled(
    drafters.map((m) =>
      callModel({
        model: m,
        system: sys,
        systemParts: buildSystemParts(task),
        user: task.userPrompt,
        tool: task.tool,
        maxTokens: task.maxTokens,
        temperature: task.temperature ?? 0.7,
        apiKey,
        purpose: task.purpose,
        timeoutMs: callBudget(deadline),
      }),
    ),
  );
  passes.push({ pass: 'council-drafts', model: drafters.join('+'), ms: Date.now() - draftStart });

  const ok = drafts
    .map((d, i) => ({ d, model: drafters[i] }))
    .filter((x) => x.d.status === 'fulfilled') as Array<{
      d: PromiseFulfilledResult<{ raw: string; parsed: unknown }>;
      model: string;
    }>;
  if (ok.length === 0) {
    const firstErr = drafts.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw firstErr?.reason ?? new BrainHttpError(500, 'all council drafters failed');
  }

  const judgeSys = `${sys}\n\nYou are the judge. You are given ${ok.length} candidate responses, each labeled with a trust weight (1.0 = peer, <1.0 = verifier/tiebreaker). Prefer the higher-weight candidates; only side with a lower-weight candidate when the higher-weight ones clearly drift to MSA or another dialect. Merge the best phrasing if helpful. Never use MSA. Return ONLY the final answer in the same format as the candidates (no commentary).`;
  const judgeUser = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nCandidates:\n${ok
    .map((x, i) => `--- Candidate ${i + 1} (${x.model}, weight: ${getModelWeight(x.model).toFixed(1)}) ---\n${x.d.value.raw}`)
    .join('\n\n')}`;

  let final: { raw: string; parsed: unknown };
  let judgeUsed = true;
  const judgeStart = Date.now();
  try {
    if (remainingMs(deadline) < MIN_PASS_BUDGET_MS) throw new BrainHttpError(504, 'latency budget spent before judge');
    final = await callModel({
      model: judge,
      system: judgeSys,
      user: judgeUser,
      tool: task.tool,
      maxTokens: task.maxTokens,
      temperature: 0.3,
      apiKey,
      purpose: task.purpose,
      timeoutMs: callBudget(deadline),
    });
  } catch (e) {
    console.warn(`[council] judge ${judge} failed, falling back to first successful draft:`, (e as Error)?.message);
    judgeUsed = false;
    final = ok[0].d.value;
  }
  passes.push({ pass: judgeUsed ? 'judge' : 'judge:failed', model: judge, ms: Date.now() - judgeStart });

  const text = extractScanText(task, final.parsed, final.raw);
  return {
    output: final.parsed as T,
    raw: final.raw,
    strategy: 'council',
    models: judgeUsed ? [...ok.map((x) => x.model), judge] : ok.map((x) => x.model),
    agreementScore: ok.length / drafters.length,
    msaLeaks: scanLeaks(text, task.dialect),
    msaRepairs: 0,
    totalLatencyMs: 0,
    passes,
  };
}

async function runRepair<T>(task: BrainTask, prior: BrainResult<T>, apiKey: string, deadline: Deadline): Promise<BrainResult<T>> {
  const sys = `${buildSystem(task)}\n\nThe previous output leaked MSA. Rewrite it in authentic ${getDialectLabel(task.dialect)} ONLY. The following MSA words MUST be replaced with dialectal equivalents: ${prior.msaLeaks.leaks.join(', ')}. Return ONLY the corrected output in the same format (no commentary).`;
  const user = `Original request:\n${stringifyUserPrompt(task.userPrompt)}\n\nFlawed output to correct:\n${prior.raw}`;
  const repairStart = Date.now();
  const { raw, parsed } = await callModel({
    model: DEFAULT_JUDGE,
    system: sys,
    user,
    tool: task.tool,
    maxTokens: task.maxTokens,
    temperature: 0.2,
    apiKey,
    purpose: task.purpose,
    timeoutMs: callBudget(deadline),
  });
  const text = extractScanText(task, parsed, raw);
  return {
    ...prior,
    output: parsed as T,
    raw,
    models: [...prior.models, DEFAULT_JUDGE],
    msaLeaks: scanLeaks(text, task.dialect),
    passes: [...prior.passes, { pass: 'repair', model: DEFAULT_JUDGE, ms: Date.now() - repairStart }],
  };
}

function extractScanText(task: BrainTask, parsed: unknown, raw: string): string {
  if (task.arabicTextPath) {
    try { return task.arabicTextPath(parsed) ?? ''; } catch { /* fall through */ }
  }
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object') {
    // Concatenate any string values that contain Arabic characters.
    const acc: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') {
        if (/[\u0600-\u06FF]/.test(v)) acc.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(parsed);
    if (acc.length) return acc.join(' ');
  }
  return raw;
}

function stringifyUserPrompt(p: MultimodalContent): string {
  if (typeof p === 'string') return p;
  return p
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join('\n');
}

export { BrainHttpError };

// ----------------- Streaming entry point -----------------

export interface StreamBrainTask {
  purpose: string;
  dialect: Dialect;
  /** Prior conversation messages (excluding the system prompt — that is built here). */
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPromptExtra?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Called once after the upstream stream finishes, with the accumulated assistant text.
   *  Use it to fire-and-forget MSA leak logging. Never throws to the caller. */
  onComplete?: (fullText: string) => void | Promise<void>;
  /** Optional CORS / extra headers to merge into the streamed Response. */
  responseHeaders?: Record<string, string>;
  /** Forward client abort signal so the upstream call cancels too. */
  signal?: AbortSignal;
}

/** Stream a single-model dialect-aware chat response. Routed like callModel:
 *  anthropic/qwen/etc. via OpenRouter, everything else via the Lovable gateway
 *  (both speak OpenAI-shaped SSE, so the passthrough and tap are unchanged).
 *  Returns a Response with text/event-stream body, ready to return from a Deno handler. */
export async function streamBrain(task: StreamBrainTask): Promise<Response> {
  await primeDialectPrompt(task.dialect);

  const model = task.model ?? DEFAULT_DRAFTERS[1] ?? MODEL_IDS.GEMINI_FLASH;
  const isGpt5 = /^openai\/gpt-5/.test(model);

  const route = routeForModel(model);
  const apiKey = Deno.env.get(route === 'openrouter' ? 'OPENROUTER_API_KEY' : 'LOVABLE_API_KEY');
  if (!apiKey) {
    throw new BrainHttpError(
      500,
      route === 'openrouter'
        ? `OPENROUTER_API_KEY not configured (required for ${model})`
        : 'LOVABLE_API_KEY not configured',
    );
  }

  const streamTask = {
    purpose: task.purpose,
    dialect: task.dialect,
    userPrompt: '',
    systemPromptExtra: task.systemPromptExtra,
  } as BrainTask;
  const system = buildSystem(streamTask);

  // Drop any client-supplied system messages — we own the system prompt here.
  const userMessages = task.messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      // Ask AI chat streams through here on an Anthropic model many times per
      // conversation with an identical dialect block — the single best prompt
      // cache in the app.
      systemMessage({ model, system, systemParts: buildSystemParts(streamTask) }, route),
      ...userMessages,
    ],
  };
  const tokens = task.maxTokens ?? 1024;
  if (isGpt5) body.max_completion_tokens = tokens;
  else body.max_tokens = tokens;
  if (!isGpt5) body.temperature = task.temperature ?? 0.7;
  // OpenRouter reports tokens and spend in the final SSE chunk when asked;
  // the tap below picks it up for cost telemetry. Only sent on the OpenRouter
  // route — the Lovable gateway is not documented to accept the field.
  if (route === 'openrouter') body.usage = { include: true };

  const upstream = await fetch(route === 'openrouter' ? OPENROUTER_URL : GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: task.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    throw new BrainHttpError(upstream.status, `${route} stream ${model} ${upstream.status}: ${text.slice(0, 200)}`);
  }

  // Tap the stream so we can accumulate the assistant text for MSA leak logging,
  // while passing every byte through to the client unchanged.
  const accumulator: string[] = [];
  const decoder = new TextDecoder();
  let sseBuffer = '';
  // The usage block rides the stream's final chunk; hold the last one seen.
  let streamUsage: unknown = null;

  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try {
        sseBuffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = sseBuffer.indexOf('\n')) !== -1) {
          const line = sseBuffer.slice(0, nl).trim();
          sseBuffer = sseBuffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') accumulator.push(delta);
            if (json.usage) streamUsage = json;
          } catch { /* ignore partial chunks */ }
        }
      } catch { /* never break the passthrough */ }
    },
    flush() {
      if (streamUsage) {
        logLlmUsage({
          functionName: task.purpose,
          model,
          provider: route,
          usage: extractUsage(streamUsage),
        });
      }
      const full = accumulator.join('');
      if (full && task.dialect) {
        try {
          const leaks = scanLeaks(full, task.dialect);
          if (leaks.leaks.length > 0) {
            console.warn(`[aiBrain.stream] MSA leak in ${task.purpose} (${task.dialect}):`, leaks.leaks.join(', '));
            logMsaViolations({
              dialect: task.dialect,
              leaks,
              offendingText: full,
              sourceFunction: task.purpose,
              metadata: { streaming: true, model },
            });
            // Fire-and-forget a repair call so callers with onComplete can get
            // the corrected text (e.g., conversation-practice buffers the stream).
            if (task.onComplete) {
              const apiKey = Deno.env.get('LOVABLE_API_KEY');
              if (apiKey && leaks.severity !== 'none') {
                const repairSys = `${buildSystem({ purpose: task.purpose, dialect: task.dialect, userPrompt: '', systemPromptExtra: task.systemPromptExtra } as BrainTask)}\n\nThe previous output leaked MSA. Rewrite it in authentic ${getDialectLabel(task.dialect)} ONLY. The following MSA words MUST be replaced with dialectal equivalents: ${leaks.leaks.join(', ')}. Return ONLY the corrected text (no commentary).`;
                fetch(GATEWAY_URL, {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: DEFAULT_FAST,
                    max_tokens: 600,
                    temperature: 0.2,
                    messages: [
                      { role: 'system', content: repairSys },
                      { role: 'user', content: full },
                    ],
                  }),
                }).then(async (r) => {
                  if (!r.ok) return;
                  const d = await r.json();
                  const corrected = d?.choices?.[0]?.message?.content;
                  if (corrected && typeof corrected === 'string') {
                    try { Promise.resolve(task.onComplete!(corrected)).catch(() => {}); } catch { /* ignore */ }
                  }
                }).catch(() => {});
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (task.onComplete) {
        try { Promise.resolve(task.onComplete(full)).catch(() => {}); } catch { /* ignore */ }
      }
    },
  });

  const headers = new Headers(task.responseHeaders ?? {});
  headers.set('Content-Type', 'text/event-stream');

  return new Response(upstream.body.pipeThrough(tap), { headers });
}
