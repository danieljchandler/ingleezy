import { describe, it, expect } from "vitest";
import { localDateKey, parseLocalDate } from "@/lib/localDate";

describe("localDate", () => {
  it("formats a local date as zero-padded YYYY-MM-DD", () => {
    // Month is 0-indexed in the Date constructor.
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses local calendar fields, not the UTC ones", () => {
    // Late-evening local time in a negative-UTC offset would roll to the next
    // day under toISOString(); localDateKey must keep the local date.
    const d = new Date(2026, 6, 25, 23, 30); // 25 Jul, 23:30 local
    expect(localDateKey(d)).toBe("2026-07-25");
  });

  it("parses YYYY-MM-DD as local midnight (not UTC midnight)", () => {
    const d = parseLocalDate("2026-07-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });

  it("round-trips through key → parse without shifting the day", () => {
    const original = new Date(2026, 2, 1, 14, 0); // 1 Mar
    const parsed = parseLocalDate(localDateKey(original));
    expect(parsed.getFullYear()).toBe(original.getFullYear());
    expect(parsed.getMonth()).toBe(original.getMonth());
    expect(parsed.getDate()).toBe(original.getDate());
  });
});
