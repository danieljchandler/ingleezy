/**
 * Client-side rate limiter for AI-powered features.
 *
 * Prevents abuse and excessive API costs by limiting how many requests
 * a user can make to LLM-backed endpoints within a time window.
 */

interface RateLimiterConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
}

interface RateLimitState {
  timestamps: number[];
}

const stores = new Map<string, RateLimitState>();

/**
 * Creates a named rate limiter with the specified config.
 *
 * @example
 * const limiter = createRateLimiter('conversation', { maxRequests: 20, windowMs: 60_000 });
 * if (!limiter.canProceed()) {
 *   toast.error("Please slow down. Try again in a moment.");
 *   return;
 * }
 * limiter.record();
 */
export function createRateLimiter(name: string, config: RateLimiterConfig) {
  if (!stores.has(name)) {
    stores.set(name, { timestamps: [] });
  }

  const state = stores.get(name)!;

  function pruneExpired() {
    const cutoff = Date.now() - config.windowMs;
    state.timestamps = state.timestamps.filter((t) => t > cutoff);
  }

  return {
    /** Check if a new request is allowed without recording it. */
    canProceed(): boolean {
      pruneExpired();
      return state.timestamps.length < config.maxRequests;
    },

    /** Record a new request timestamp. Call after canProceed() returns true. */
    record(): void {
      state.timestamps.push(Date.now());
    },

    /** Get remaining requests in the current window. */
    remaining(): number {
      pruneExpired();
      return Math.max(0, config.maxRequests - state.timestamps.length);
    },

    /** Get milliseconds until the next request slot opens. */
    retryAfterMs(): number {
      pruneExpired();
      if (state.timestamps.length < config.maxRequests) return 0;
      const oldest = state.timestamps[0];
      return Math.max(0, oldest + config.windowMs - Date.now());
    },

    /** Reset the limiter (e.g., on sign-out). */
    reset(): void {
      state.timestamps = [];
    },
  };
}

// ── Pre-configured limiters for AI features ───────────────────────────────────

/** Conversation simulator: 20 messages per minute */
export const conversationLimiter = createRateLimiter("conversation", {
  maxRequests: 20,
  windowMs: 60_000,
});

/** "How Do I Say" translator: 15 requests per minute */
export const howDoISayLimiter = createRateLimiter("how-do-i-say", {
  maxRequests: 15,
  windowMs: 60_000,
});

/** Meme analyzer: 10 requests per minute */
export const memeAnalyzerLimiter = createRateLimiter("meme-analyzer", {
  maxRequests: 10,
  windowMs: 60_000,
});

/** Culture guide: 10 requests per minute */
export const cultureGuideLimiter = createRateLimiter("culture-guide", {
  maxRequests: 10,
  windowMs: 60_000,
});

/** Learn from X (general AI assist): 15 requests per minute */
export const learnFromXLimiter = createRateLimiter("learn-from-x", {
  maxRequests: 15,
  windowMs: 60_000,
});
