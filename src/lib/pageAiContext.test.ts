import { describe, expect, it } from "vitest";
import { buildPagePayload, hintKeyForPath } from "./pageAiContext";
import { PAGE_HINTS } from "./pageHints";

/**
 * The route→hint mapping is the assistant's fallback knowledge of "where the
 * learner is" on pages that don't publish their own context. Keys in
 * PAGE_HINTS are slugs, not paths, so the mapping is hand-written — these
 * tests pin the resolution rules and catch a renamed hint key.
 */

describe("hintKeyForPath", () => {
  it("maps routes to their PAGE_HINTS slugs", () => {
    expect(hintKeyForPath("/discover")).toBe("discover");
    expect(hintKeyForPath("/review/my-words")).toBe("mywords-review");
    expect(hintKeyForPath("/review")).toBe("review");
    expect(hintKeyForPath("/grammar")).toBe("grammar-drills");
    expect(hintKeyForPath("/analytics")).toBe("learning-analytics");
    expect(hintKeyForPath("/")).toBe("today");
  });

  it("matches param routes by prefix", () => {
    expect(hintKeyForPath("/discover/abc-123")).toBe("discover");
    expect(hintKeyForPath("/stories/story-9")).toBe("stories");
  });

  it("returns null for unmapped routes rather than guessing", () => {
    expect(hintKeyForPath("/admin/topics")).toBeNull();
    expect(hintKeyForPath("/no-such-page")).toBeNull();
  });

  it("only points at hint keys that exist", () => {
    // A rename in pageHints.ts must break this test, not silently degrade
    // the assistant's fallback context.
    const paths = ["/discover", "/review", "/review/my-words", "/grammar", "/", "/battles"];
    for (const p of paths) {
      const key = hintKeyForPath(p);
      expect(key && PAGE_HINTS[key], `hint for ${p}`).toBeTruthy();
    }
  });
});

describe("buildPagePayload", () => {
  it("prefers the registered page context and truncates it", () => {
    const payload = buildPagePayload("/discover/xyz", {
      kind: "video",
      title: "T".repeat(200),
      summary: "S".repeat(500),
      content: "C".repeat(2000),
    });

    expect(payload.route).toBe("/discover/xyz");
    expect(payload.title.length).toBeLessThanOrEqual(121); // 120 + ellipsis
    expect(payload.summary!.length).toBeLessThanOrEqual(401);
    expect(payload.content!.length).toBeLessThanOrEqual(1501);
  });

  it("falls back to the PAGE_HINTS blurb for the route", () => {
    const payload = buildPagePayload("/discover", null);
    expect(payload.title).toBe(PAGE_HINTS["discover"].title);
    expect(payload.summary).toBe(PAGE_HINTS["discover"].body);
  });

  it("degrades to a bare route when nothing is known", () => {
    const payload = buildPagePayload("/no-such-page", null);
    expect(payload.route).toBe("/no-such-page");
    expect(payload.title).toBe("Ingleezy");
    expect(payload.summary).toBeUndefined();
  });
});
