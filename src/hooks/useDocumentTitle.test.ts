import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle";

/**
 * The document title, per route.
 *
 * In a single-page app the title is the only thing distinguishing one open tab
 * from another, and it is what a browser writes into history and bookmarks. It
 * does not change on navigation by itself, so every route that does not set one
 * inherits whatever the last one left behind — which is why the hook restores
 * the previous title on unmount rather than assuming a base.
 */

const BASE = "Ingleezy — English for Arabic speakers";

beforeEach(() => {
  document.title = BASE;
});

describe("setting a title", () => {
  it("suffixes the brand", () => {
    renderHook(() => useDocumentTitle("My Words"));

    // Bookmarks and history entries are read out of context, so the app's name
    // has to travel with the page's.
    expect(document.title).toBe("My Words — Ingleezy");
  });

  it("falls back to the full base title for a page with no name", () => {
    renderHook(() => useDocumentTitle());

    expect(document.title).toBe(BASE);
  });

  it("treats an empty or blank title as no title", () => {
    renderHook(() => useDocumentTitle(""));
    expect(document.title).toBe(BASE);

    renderHook(() => useDocumentTitle("   "));
    // " — Ingleezy" would be a tab with a leading dash and no name.
    expect(document.title).toBe(BASE);
  });

  it("keeps a title that is only meaningful in Arabic", () => {
    renderHook(() => useDocumentTitle("مفرداتي"));

    expect(document.title).toBe("مفرداتي — Ingleezy");
  });

  it("follows the title as it changes", () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "My Words" },
    });

    rerender({ title: "Review" });

    // A page that renames itself — a story opening, a lesson loading — has to
    // take the tab with it.
    expect(document.title).toBe("Review — Ingleezy");
  });
});

describe("giving the title back", () => {
  it("restores what was there on unmount", () => {
    document.title = "Something else";

    const { unmount } = renderHook(() => useDocumentTitle("My Words"));
    expect(document.title).toBe("My Words — Ingleezy");

    unmount();

    // Restoring rather than resetting to the base: a modal or a nested route
    // that sets a title must hand the tab back to whatever owned it, not to a
    // default.
    expect(document.title).toBe("Something else");
  });

  it("unwinds nested owners in order", () => {
    const outer = renderHook(() => useDocumentTitle("Curriculum"));
    const inner = renderHook(() => useDocumentTitle("Lesson 4"));

    expect(document.title).toBe("Lesson 4 — Ingleezy");

    inner.unmount();
    expect(document.title).toBe("Curriculum — Ingleezy");

    outer.unmount();
    expect(document.title).toBe(BASE);
  });

  it("restores the mount-time title even after renaming itself", () => {
    document.title = "Something else";
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "First" },
    });

    rerender({ title: "Second" });
    expect(document.title).toBe("Second — Ingleezy");

    unmount();

    // The subtle part, and the reason this works: React runs the previous
    // cleanup *before* the next effect, so each rename restores the original
    // title and then captures it again. A hook that renamed itself five times
    // still hands back what the page had when it mounted, rather than its own
    // fourth name.
    expect(document.title).toBe("Something else");
  });
});
