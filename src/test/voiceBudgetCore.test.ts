import { describe, expect, it } from "vitest";
import {
  clampReportedSeconds,
  MAX_REPORT_SECONDS,
  monthWindow,
  remainingSeconds,
  VOICE_MONTHLY_SECONDS,
} from "../../supabase/functions/_shared/voiceBudgetCore";

/**
 * The arithmetic behind the voice-minute meter. The client reports its own
 * call duration, so the clamp is a trust boundary, not a convenience — and the
 * month window is a billing boundary that has to mean the same thing on every
 * device, which is why it is UTC.
 */

describe("clampReportedSeconds", () => {
  it("floors a fractional duration to whole seconds", () => {
    expect(clampReportedSeconds(64.9)).toBe(64);
  });

  it("accepts a numeric string, since it crossed a JSON boundary", () => {
    expect(clampReportedSeconds("120")).toBe(120);
  });

  it.each([
    ["negative", -5],
    ["zero", 0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["not a number", "yesterday"],
    ["undefined", undefined],
    ["null", null],
  ])("turns %s into 0 rather than trusting it", (_label, value) => {
    expect(clampReportedSeconds(value)).toBe(0);
  });

  it("caps a single report at two hours", () => {
    // A forged report can cost its sender at most one long call, not a month.
    expect(clampReportedSeconds(999_999)).toBe(MAX_REPORT_SECONDS);
  });
});

describe("monthWindow", () => {
  it("spans the UTC calendar month containing the given moment", () => {
    const { start, end } = monthWindow(new Date("2026-08-12T15:30:00Z"));
    expect(start).toBe("2026-08-01T00:00:00.000Z");
    expect(end).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    const { start, end } = monthWindow(new Date("2026-12-31T23:59:59Z"));
    expect(start).toBe("2026-12-01T00:00:00.000Z");
    expect(end).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is anchored to UTC, not the machine's timezone", () => {
    // 2026-09-01T00:30Z is still August in UTC-04:00; the budget must not be.
    const { start } = monthWindow(new Date("2026-09-01T00:30:00Z"));
    expect(start).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("remainingSeconds", () => {
  it("subtracts what was used", () => {
    expect(remainingSeconds(1800, 600)).toBe(1200);
  });

  it("bottoms out at zero once the budget is spent", () => {
    expect(remainingSeconds(1800, 5000)).toBe(0);
  });

  it("does not let corrupt negative usage inflate the balance", () => {
    expect(remainingSeconds(1800, -600)).toBe(1800);
  });
});

describe("the allowance table", () => {
  it("orders the tiers the way the pricing page does", () => {
    // The mechanism is tier-agnostic; this pins the policy's shape, not its
    // exact numbers — paying more must never buy fewer minutes.
    expect(VOICE_MONTHLY_SECONDS.free).toBeLessThan(VOICE_MONTHLY_SECONDS.standard);
    expect(VOICE_MONTHLY_SECONDS.standard).toBeLessThan(VOICE_MONTHLY_SECONDS.allin);
  });
});
