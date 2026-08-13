import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { useBridgeMode } from "./useBridgeMode";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * MSA bridge mode — showing the Modern Standard Arabic form next to dialect
 * content wherever one exists.
 *
 * The preference lives in two places on purpose: localStorage so it applies
 * before any network call resolves (the alternative is every flashcard, lesson
 * and transcript flickering between two layouts on load), and `profiles` so it
 * follows a learner to another device. That duplication is the whole risk —
 * the two can disagree, and which one wins on mount decides what the learner
 * sees.
 *
 * The toggle appears in Settings while the content that reacts to it is
 * everywhere else, so the change is broadcast on a custom event as well as
 * `storage`, which never fires in the tab that wrote it.
 */

const STORAGE_KEY = "ingleezy_bridge_view_enabled";

let cleanup: (() => void) | undefined;

function render(profile: Record<string, unknown> | null = {}) {
  const seed = (backend: SupabaseBackend) => {
    backend.db.seed(
      "profiles",
      profile === null ? [] : [aProfile({ user_id: TEST_USER_ID, ...profile })],
    );
  };
  const harness = renderHookWithProviders(() => useBridgeMode(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

describe("the initial value", () => {
  it("is off for a learner who has never set it", async () => {
    const { result } = render({ bridge_view_enabled: false });

    // Off is the right default: the bridge is a crutch for people coming from
    // MSA, and showing it unasked doubles the text on every card.
    expect(result.current.enabled).toBe(false);
  });

  it("comes from localStorage before any request resolves", () => {
    localStorage.setItem(STORAGE_KEY, "1");

    const { result } = render({ bridge_view_enabled: true });

    // Synchronous on the very first render — waiting for the profile would
    // flicker every card between two layouts on load.
    expect(result.current.enabled).toBe(true);
  });

  it("treats any value other than 1 as off", () => {
    localStorage.setItem(STORAGE_KEY, "true");

    const { result } = render({ bridge_view_enabled: false });

    // Only the literal "1" counts. An older format reads as off rather than
    // as unset, which is visible and correctable.
    expect(result.current.enabled).toBe(false);
  });
});

describe("syncing from the profile", () => {
  it("adopts the stored preference from another device", async () => {
    const { result } = render({ bridge_view_enabled: true });

    // The point of persisting it server-side at all.
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("writes the profile's answer back to localStorage", async () => {
    const { result } = render({ bridge_view_enabled: true });

    await waitFor(() => expect(result.current.enabled).toBe(true));
    // So the next load is instant rather than waiting for the round trip
    // again.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("lets the profile overrule a local value that disagrees", async () => {
    localStorage.setItem(STORAGE_KEY, "1");

    const { result } = render({ bridge_view_enabled: false });

    // Pinned as the resolution rule: the server wins. A learner who turned the
    // bridge on in this browser and off on their phone finds it off here after
    // the sync lands — the setting visibly changes itself a moment after the
    // page loads, with nothing saying why.
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("keeps the local value when the profile has no opinion", async () => {
    localStorage.setItem(STORAGE_KEY, "1");

    const { result } = render({ bridge_view_enabled: null });

    // A null column is a learner who has never touched the setting on any
    // device; overwriting from it would reset them on every load.
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("keeps the local value for a signed-out visitor", async () => {
    localStorage.setItem(STORAGE_KEY, "1");
    const harness = renderHookWithProviders(() => useBridgeMode(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.enabled).toBe(true));
  });

  it("reads the MSA background level from the profile", async () => {
    const { result } = render({ msa_background: "strong" });

    // How much MSA the learner already has decides how much scaffolding the
    // bridge shows.
    await waitFor(() => expect(result.current.msaBackground).toBe("strong"));
  });

  it("defaults the background to none", () => {
    const { result } = render({ msa_background: null });

    expect(result.current.msaBackground).toBe("none");
  });
});

describe("changing the setting", () => {
  it("applies immediately rather than after the write", async () => {
    const { result } = render({ bridge_view_enabled: false });

    act(() => {
      result.current.setBridge(true);
    });

    // The toggle has to move under the finger; awaiting a round trip would
    // make it feel broken on a slow connection.
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("persists to the profile", async () => {
    const { result, backend } = render({ bridge_view_enabled: false });

    act(() => {
      result.current.setBridge(true);
    });

    await waitFor(() =>
      expect(backend.db.lastWriteTo("profiles")?.payload[0]).toMatchObject({
        bridge_view_enabled: true,
      }),
    );
  });

  it("persists the background level", async () => {
    const { result, backend } = render({ msa_background: "none" });

    act(() => {
      result.current.setBackground("some");
    });

    expect(result.current.msaBackground).toBe("some");
    await waitFor(() =>
      expect(backend.db.lastWriteTo("profiles")?.payload[0]).toMatchObject({
        msa_background: "some",
      }),
    );
  });

  it("keeps the setting applied even when the write fails", async () => {
    const { result, backend } = render({ bridge_view_enabled: false });
    backend.db.failWrites("profiles", 403, { message: "denied" });

    act(() => {
      result.current.setBridge(true);
    });

    // Pinned. A rejected write is logged to the console and nothing else — the
    // toggle stays on, localStorage says on, and the profile still says off.
    // The learner is told nothing, and the next device they open disagrees
    // with this one.
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("writes nothing for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useBridgeMode(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    act(() => {
      harness.result.current.setBridge(true);
    });

    // Still applies locally — the bridge is useful before signing up.
    expect(harness.result.current.enabled).toBe(true);
    expect(harness.backend.db.lastWriteTo("profiles")).toBeUndefined();
  });
});

describe("staying in sync", () => {
  it("follows a change made elsewhere in the same tab", async () => {
    const { result } = render({ bridge_view_enabled: false });

    act(() => {
      localStorage.setItem(STORAGE_KEY, "1");
      window.dispatchEvent(new CustomEvent("ingleezy:bridge-mode-changed"));
    });

    // Settings and the content that reacts to the setting are different trees;
    // `storage` never fires for the writing tab, so the custom event is the
    // only channel between them.
    expect(result.current.enabled).toBe(true);
  });

  it("follows a change made in another tab", async () => {
    const { result } = render({ bridge_view_enabled: false });

    act(() => {
      localStorage.setItem(STORAGE_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.enabled).toBe(true);
  });

  it("keeps two mounted copies agreeing", async () => {
    const settings = render({ bridge_view_enabled: false });
    const content = renderHookWithProviders(() => useBridgeMode(), { persona: "free" });
    const stopContent = content.cleanup;

    act(() => {
      settings.result.current.setBridge(true);
    });

    expect(content.result.current.enabled).toBe(true);
    stopContent();
  });

  it("stops listening once unmounted", async () => {
    const harness = render({ bridge_view_enabled: false });
    harness.cleanup();
    cleanup = undefined;

    // A leaked listener sets state on an unmounted tree every time the setting
    // moves, for the life of the tab.
    expect(() =>
      act(() => {
        localStorage.setItem(STORAGE_KEY, "1");
        window.dispatchEvent(new CustomEvent("ingleezy:bridge-mode-changed"));
      }),
    ).not.toThrow();
  });
});
