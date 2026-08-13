import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "@/lib/rateLimiter";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests up to the limit", () => {
    const limiter = createRateLimiter("test-1", { maxRequests: 3, windowMs: 1000 });

    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.remaining()).toBe(2);

    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
    expect(limiter.remaining()).toBe(0);
  });

  it("allows requests after the window expires", () => {
    const limiter = createRateLimiter("test-2", { maxRequests: 2, windowMs: 1000 });

    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(1001);
    expect(limiter.canProceed()).toBe(true);
  });

  it("reports retryAfterMs correctly", () => {
    const limiter = createRateLimiter("test-3", { maxRequests: 1, windowMs: 5000 });

    limiter.record();
    expect(limiter.retryAfterMs()).toBeGreaterThan(0);
    expect(limiter.retryAfterMs()).toBeLessThanOrEqual(5000);
  });

  it("resets correctly", () => {
    const limiter = createRateLimiter("test-4", { maxRequests: 1, windowMs: 60000 });

    limiter.record();
    expect(limiter.canProceed()).toBe(false);

    limiter.reset();
    expect(limiter.canProceed()).toBe(true);
    expect(limiter.remaining()).toBe(1);
  });
});
