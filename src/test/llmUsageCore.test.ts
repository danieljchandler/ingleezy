import { describe, expect, it } from "vitest";
import {
  EMPTY_USAGE,
  extractUsage,
  hasUsage,
} from "../../supabase/functions/_shared/llmUsageCore";

/**
 * The pure half of cost telemetry: pulling token counts and provider-reported
 * cost out of a chat-completions response. The IO half (llmUsageLogger.ts) is
 * a fire-and-forget sink in the msaViolationLogger mould, exercised through
 * the edge suites' `/rest/v1/llm_usage_logs` routes; what is worth pinning
 * here is the parsing, because providers disagree about where these numbers
 * live and a shape miss silently logs nothing.
 */

describe("extractUsage", () => {
  it("reads the standard OpenAI-compatible block", () => {
    const usage = extractUsage({
      usage: { prompt_tokens: 812, completion_tokens: 245 },
    });
    expect(usage).toEqual({
      promptTokens: 812,
      completionTokens: 245,
      cachedTokens: null,
      costUsd: null,
    });
  });

  it("reads OpenRouter's cost and OpenAI-style cached token details", () => {
    const usage = extractUsage({
      usage: {
        prompt_tokens: 4000,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 3600 },
        cost: 0.00185,
      },
    });
    expect(usage.cachedTokens).toBe(3600);
    expect(usage.costUsd).toBe(0.00185);
  });

  it("accepts a flat cached_tokens field too", () => {
    // Not every gateway nests the details object.
    expect(extractUsage({ usage: { prompt_tokens: 10, cached_tokens: 8 } }).cachedTokens).toBe(8);
  });

  it("returns the empty shape when there is no usage block", () => {
    expect(extractUsage({ choices: [] })).toEqual(EMPTY_USAGE);
    expect(extractUsage(null)).toEqual(EMPTY_USAGE);
    expect(extractUsage(undefined)).toEqual(EMPTY_USAGE);
    expect(extractUsage({ usage: "yes" })).toEqual(EMPTY_USAGE);
  });

  it("rejects negative and non-numeric counts rather than logging garbage", () => {
    const usage = extractUsage({
      usage: { prompt_tokens: -5, completion_tokens: "many", cost: -1 },
    });
    expect(usage).toEqual(EMPTY_USAGE);
  });

  it("floors fractional token counts but keeps cost precise", () => {
    const usage = extractUsage({ usage: { prompt_tokens: 11.7, cost: 0.000123 } });
    expect(usage.promptTokens).toBe(11);
    expect(usage.costUsd).toBe(0.000123);
  });
});

describe("hasUsage", () => {
  it("is false for the empty shape, so no row is written", () => {
    expect(hasUsage(EMPTY_USAGE)).toBe(false);
  });

  it("is true when any quantitative field is present", () => {
    expect(hasUsage({ ...EMPTY_USAGE, promptTokens: 1 })).toBe(true);
    expect(hasUsage({ ...EMPTY_USAGE, completionTokens: 1 })).toBe(true);
    expect(hasUsage({ ...EMPTY_USAGE, costUsd: 0.01 })).toBe(true);
  });

  it("ignores cached tokens alone — they never occur without a prompt count", () => {
    expect(hasUsage({ ...EMPTY_USAGE, cachedTokens: 5 })).toBe(false);
  });
});
