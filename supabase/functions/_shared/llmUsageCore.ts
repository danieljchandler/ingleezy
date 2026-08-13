// Pure half of LLM usage logging: pull the token/cost block out of an
// OpenAI-compatible chat-completions response. Free of Deno globals so the
// Vitest suite covers it (src/test/llmUsageCore.test.ts); the insert lives in
// llmUsageLogger.ts.
//
// Shapes handled: OpenAI/Lovable `usage.{prompt_tokens,completion_tokens}`,
// OpenRouter's `usage.cost` (USD, present when the request asked with
// `usage: {include: true}`), and cached-token counts under either
// `prompt_tokens_details.cached_tokens` (OpenAI style) or
// `cached_tokens` directly.

export interface NormalizedUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
}

export const EMPTY_USAGE: NormalizedUsage = {
  promptTokens: null,
  completionTokens: null,
  cachedTokens: null,
  costUsd: null,
};

function asCount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function asCost(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Extract usage from a parsed chat-completions response body (or SSE chunk). */
export function extractUsage(data: unknown): NormalizedUsage {
  const usage = (data as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== "object") return EMPTY_USAGE;
  const u = usage as Record<string, unknown>;
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  return {
    promptTokens: asCount(u.prompt_tokens),
    completionTokens: asCount(u.completion_tokens),
    cachedTokens: asCount(details?.cached_tokens ?? u.cached_tokens),
    costUsd: asCost(u.cost),
  };
}

/** True when there is anything worth writing a row for. */
export function hasUsage(u: NormalizedUsage): boolean {
  return u.promptTokens !== null || u.completionTokens !== null || u.costUsd !== null;
}
