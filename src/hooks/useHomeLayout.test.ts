import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeLayout } from "./useHomeLayout";
import { HOME_SECTIONS, isSectionVisible, loadHomeLayout, saveHomeLayout } from "@/lib/homeLayout";

/**
 * The home page's section order and visibility.
 *
 * Settings and the home page are separate trees reading the same localStorage
 * key, so the change has to propagate through an event — `storage` never fires
 * in the tab that wrote it, and without the custom event a learner would toggle
 * a section in Settings, navigate home, and see no difference until a reload.
 *
 * The stored value also outlives the section list. Sections have been removed
 * before — a much longer list was cut back when it turned out the home page
 * only gated three of them — so a saved order full of ids that no longer exist
 * is the normal state of an existing user's storage, not an edge case.
 */

const STORAGE_KEY = "hakiya:home-layout:v1";
const ALL_IDS = HOME_SECTIONS.map((s) => s.id);
/** The one section the home page lets a learner hide. */
const HIDEABLE = HOME_SECTIONS.find((s) => !s.alwaysOn)!.id;
const ALWAYS_ON = HOME_SECTIONS.find((s) => s.alwaysOn)!.id;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loading", () => {
  it("starts from the default order with nothing hidden", () => {
    const { result } = renderHook(() => useHomeLayout());

    expect(result.current.state.order).toEqual(ALL_IDS);
    expect(result.current.state.hidden).toEqual([]);
  });

  it("restores a saved layout", () => {
    saveHomeLayout({ order: [...ALL_IDS].reverse(), hidden: [HIDEABLE] });

    const { result } = renderHook(() => useHomeLayout());

    expect(result.current.state.order).toEqual([...ALL_IDS].reverse());
    expect(result.current.state.hidden).toEqual([HIDEABLE]);
  });

  it("drops ids that no longer exist", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: ["discover", "new-words", ...ALL_IDS], hidden: ["grammar"] }),
    );

    const { result } = renderHook(() => useHomeLayout());

    // A long-standing user's storage is full of sections that were removed;
    // rendering them would ask the home page for components that are gone.
    expect(result.current.state.order).toEqual(ALL_IDS);
    expect(result.current.state.hidden).toEqual([]);
  });

  it("appends a section the saved order never knew about", () => {
    const [first, ...rest] = ALL_IDS;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: [first], hidden: [] }));

    const { result } = renderHook(() => useHomeLayout());

    // A new section has to appear for existing users rather than being
    // silently absent because their saved order predates it.
    expect(result.current.state.order).toEqual([first, ...rest]);
  });

  it("falls back to the default on unreadable storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useHomeLayout());

    expect(result.current.state.order).toEqual(ALL_IDS);
  });
});

describe("hiding a section", () => {
  it("hides and unhides", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.toggleSection(HIDEABLE);
    });
    expect(result.current.state.hidden).toContain(HIDEABLE);

    act(() => {
      result.current.toggleSection(HIDEABLE);
    });
    expect(result.current.state.hidden).not.toContain(HIDEABLE);
  });

  it("persists the change", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.toggleSection(HIDEABLE);
    });

    expect(loadHomeLayout().hidden).toContain(HIDEABLE);
  });

  it("refuses to hide a section marked always-on", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.toggleSection(ALWAYS_ON);
    });

    // The daily queue is the home page; hiding it leaves a learner with
    // nothing to do and no obvious way back.
    expect(result.current.state.hidden).toEqual([]);
  });

  it("keeps an always-on section visible even if storage says otherwise", () => {
    saveHomeLayout({ order: ALL_IDS, hidden: [ALWAYS_ON] });

    const { result } = renderHook(() => useHomeLayout());

    // Hand-edited storage, or a section that became always-on after a user hid
    // it. The visibility check is the backstop.
    expect(isSectionVisible(ALWAYS_ON, result.current.state)).toBe(true);
  });
});

describe("reordering", () => {
  it("moves a section down and back up", () => {
    const { result } = renderHook(() => useHomeLayout());
    const [first, second] = ALL_IDS;

    act(() => {
      result.current.moveSection(first, 1);
    });
    expect(result.current.state.order.slice(0, 2)).toEqual([second, first]);

    act(() => {
      result.current.moveSection(first, -1);
    });
    expect(result.current.state.order.slice(0, 2)).toEqual([first, second]);
  });

  it("persists the new order", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.moveSection(ALL_IDS[0], 1);
    });

    expect(loadHomeLayout().order[0]).toBe(ALL_IDS[1]);
  });

  it("will not move the first section up", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.moveSection(ALL_IDS[0], -1);
    });

    // Swapping with index -1 would move it to the end, which reads as a bug
    // rather than as a no-op.
    expect(result.current.state.order).toEqual(ALL_IDS);
  });

  it("will not move the last section down", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.moveSection(ALL_IDS.at(-1)!, 1);
    });

    expect(result.current.state.order).toEqual(ALL_IDS);
  });

  it("ignores a section that is not in the order", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.moveSection("no-such-section" as never, 1);
    });

    expect(result.current.state.order).toEqual(ALL_IDS);
  });

  it("keeps every section when one moves", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.moveSection(ALL_IDS[0], 1);
    });

    // A swap that dropped a section would remove it from the home page with no
    // way to bring it back except a reset.
    expect([...result.current.state.order].sort()).toEqual([...ALL_IDS].sort());
  });
});

describe("resetting", () => {
  it("restores the default order and unhides everything", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      result.current.toggleSection(HIDEABLE);
    });
    act(() => {
      result.current.moveSection(ALL_IDS[0], 1);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.order).toEqual(ALL_IDS);
    expect(result.current.state.hidden).toEqual([]);
    expect(loadHomeLayout().hidden).toEqual([]);
  });
});

describe("staying in sync", () => {
  it("follows a change made elsewhere in the same tab", () => {
    const { result } = renderHook(() => useHomeLayout());

    act(() => {
      saveHomeLayout({ order: ALL_IDS, hidden: [HIDEABLE] });
    });

    // Settings and the home page are separate trees; `storage` never fires for
    // the tab that wrote, so the custom event is the only channel.
    expect(result.current.state.hidden).toEqual([HIDEABLE]);
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useHomeLayout());
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: ALL_IDS, hidden: [HIDEABLE] }));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.state.hidden).toEqual([HIDEABLE]);
  });

  it("keeps two mounted copies agreeing", () => {
    const settings = renderHook(() => useHomeLayout());
    const home = renderHook(() => useHomeLayout());

    act(() => {
      settings.result.current.toggleSection(HIDEABLE);
    });

    expect(home.result.current.state.hidden).toEqual([HIDEABLE]);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useHomeLayout());

    unmount();

    // A leaked listener sets state on an unmounted tree on every settings
    // change for the life of the tab.
    expect(() =>
      act(() => {
        saveHomeLayout({ order: ALL_IDS, hidden: [HIDEABLE] });
      }),
    ).not.toThrow();
  });
});
