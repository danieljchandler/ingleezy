import { describe, it, expect } from "vitest";
import { looksTruncated } from "../../supabase/functions/_shared/asrConfig";

describe("looksTruncated", () => {
  it("flags the Munsit failure: 7 chars for a 30-second clip", () => {
    // The reported run — five other engines produced 200-440 chars from the
    // same audio, Munsit answered 200 OK with two words.
    expect(looksTruncated("كلمتين", 30)).toBe(true);
  });

  it("accepts a normal transcript", () => {
    // ~14 chars/sec is ordinary continuous speech.
    expect(looksTruncated("x".repeat(420), 30)).toBe(false);
  });

  it("accepts sparse but plausible speech", () => {
    // Right at the 2 chars/sec floor.
    expect(looksTruncated("x".repeat(61), 30)).toBe(false);
  });

  it("flags an empty transcript on real audio", () => {
    expect(looksTruncated("", 30)).toBe(true);
    expect(looksTruncated("   ", 30)).toBe(true);
  });

  it("never fires when the duration is unknown", () => {
    // Guessing without a duration is how a quiet clip gets called broken.
    expect(looksTruncated("", 0)).toBe(false);
    expect(looksTruncated("short", NaN)).toBe(false);
    expect(looksTruncated("short", Infinity)).toBe(false);
  });

  it("never fires on clips too short to judge", () => {
    expect(looksTruncated("", 4)).toBe(false);
    expect(looksTruncated("hi", 3)).toBe(false);
  });

  it("scales with duration rather than using a fixed floor", () => {
    const text = "x".repeat(100);
    expect(looksTruncated(text, 30)).toBe(false);  // 100 chars in 30s is fine
    expect(looksTruncated(text, 300)).toBe(true);  // 100 chars in 5 min is not
  });

  it("ignores surrounding whitespace when measuring", () => {
    expect(looksTruncated(`   ${"x".repeat(10)}   `, 30)).toBe(true);
  });
});
