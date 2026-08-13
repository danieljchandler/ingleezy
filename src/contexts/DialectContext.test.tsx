import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { useDialect } from "./DialectContext";
import { useUserVocabulary } from "@/hooks/useUserVocabulary";

/**
 * The dialect module, which scopes almost everything.
 *
 * Curriculum, saved vocabulary, review queues, topics, lessons and
 * notifications are all filtered by it, so a switch that fails to invalidate
 * the right caches leaves the learner looking at another dialect's content
 * while the header says otherwise. Three places have to agree: React state,
 * localStorage, and the `profiles.preferred_dialect` column that other devices
 * read.
 */

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const STORAGE_KEY = "ingleezy_dialect_module";

describe("the starting dialect", () => {
  it("defaults to Gulf", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    expect(rendered.result.current.activeDialect).toBe("Gulf");
  });

  it("restores what was last chosen on this device", async () => {
    // Read synchronously during the first render, so there is no flash of the
    // wrong dialect before the profile sync lands.
    localStorage.setItem(STORAGE_KEY, "Egyptian");

    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    expect(rendered.result.current.activeDialect).toBe("Egyptian");
  });

  it("ignores a stored value that is not a dialect", async () => {
    localStorage.setItem(STORAGE_KEY, "Klingon");

    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    expect(rendered.result.current.activeDialect).toBe("Gulf");
  });

  it("adopts the profile's preference for a signed-in learner", async () => {
    // The profile is the cross-device source of truth; localStorage is only a
    // cache to avoid the flash.
    const rendered = renderHookWithProviders(() => useDialect(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("profiles", [aProfile({ preferred_dialect: "Yemeni" })]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.result.current.activeDialect).toBe("Yemeni"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("Yemeni");
  });

  it("keeps the local choice when the profile has no preference", async () => {
    localStorage.setItem(STORAGE_KEY, "Egyptian");

    const rendered = renderHookWithProviders(() => useDialect(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("profiles", [aProfile({ preferred_dialect: null })]),
    });
    cleanup = rendered.cleanup;

    await waitFor(() => expect(rendered.backend.db.readsOf("profiles").length).toBeGreaterThan(0));
    expect(rendered.result.current.activeDialect).toBe("Egyptian");
  });
});

describe("switching", () => {
  it("changes the active dialect", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "free" });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Egyptian"));

    expect(rendered.result.current.activeDialect).toBe("Egyptian");
  });

  it("remembers the choice on this device", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "free" });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Yemeni"));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("Yemeni");
  });

  it("persists to the profile, so other devices follow", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), {
      persona: "free",
      seed: (backend) => backend.db.seed("profiles", [aProfile()]),
    });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Egyptian"));

    await waitFor(() => {
      const write = rendered.backend.db.lastWriteTo("profiles");
      expect(write?.payload[0]).toMatchObject({ preferred_dialect: "Egyptian" });
    });
  });

  it("writes only to the signed-in learner's own profile", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), {
      persona: "free",
      seed: (backend) =>
        backend.db.seed("profiles", [
          aProfile({ user_id: TEST_USER_ID, preferred_dialect: "Gulf" }),
          aProfile({ user_id: "00000000-0000-4000-8000-000000000009", preferred_dialect: "Gulf" }),
        ]),
    });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Egyptian"));

    await waitFor(() => expect(rendered.backend.db.writesTo("profiles").length).toBeGreaterThan(0));

    const rows = rendered.backend.db.rows("profiles");
    expect(rows.find((row) => row.user_id === TEST_USER_ID)?.preferred_dialect).toBe("Egyptian");
    // An update missing its filter would change everyone's dialect.
    expect(
      rows.find((row) => row.user_id === "00000000-0000-4000-8000-000000000009")?.preferred_dialect,
    ).toBe("Gulf");
  });

  it("does not try to persist for a signed-out visitor", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Yemeni"));

    await waitFor(() => expect(rendered.result.current.activeDialect).toBe("Yemeni"));
    expect(rendered.backend.db.writesTo("profiles")).toHaveLength(0);
  });

  it("still switches locally when the profile write fails", async () => {
    // Losing the cross-device preference is a nuisance; refusing to switch the
    // dialect the learner just asked for is worse.
    const rendered = renderHookWithProviders(() => useDialect(), {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [aProfile()]);
        backend.db.failWrites("profiles", 500);
      },
    });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Egyptian"));

    expect(rendered.result.current.activeDialect).toBe("Egyptian");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("Egyptian");
  });
});

describe("the theme tokens", () => {
  it("sets the accent variables for the active dialect", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--dialect-accent")).not.toBe(""),
    );
    expect(document.documentElement.dataset.dialect).toBe("gulf");
  });

  it("changes them on a switch", async () => {
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    const before = document.documentElement.style.getPropertyValue("--dialect-accent");
    act(() => rendered.result.current.setDialect("Yemeni"));

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--dialect-accent")).not.toBe(before),
    );
    expect(document.documentElement.dataset.dialect).toBe("yemeni");
  });

  it("leaves the global palette alone", async () => {
    // Overriding --primary globally washes the whole app in one dialect's hue,
    // which earlier builds did; the cleanup is deliberate and worth pinning.
    const rendered = renderHookWithProviders(() => useDialect(), { persona: "anonymous" });
    cleanup = rendered.cleanup;

    act(() => rendered.result.current.setDialect("Egyptian"));

    for (const token of ["--primary", "--accent", "--ring", "--primary-glow"]) {
      expect(document.documentElement.style.getPropertyValue(token)).toBe("");
    }
  });
});

describe("cache invalidation", () => {
  it("swaps the learner's words over to the new dialect", async () => {
    // The real point of the switch. `user-vocabulary` is one of the seven
    // query-key prefixes the context invalidates; without that the learner
    // keeps seeing the previous module's words under the new module's header.
    //
    // A consumer is mounted alongside so this observes an actual refetch
    // rather than just the context's own state.
    const rendered = renderHookWithProviders(
      () => ({ dialect: useDialect(), vocabulary: useUserVocabulary() }),
      {
        persona: "free",
        seed: (backend) =>
          backend.db.seed("user_vocabulary", [
            aUserVocabulary({ id: "v1", dialect: "Gulf", word_arabic: "خليجي" }),
            aUserVocabulary({ id: "v2", dialect: "Egyptian", word_arabic: "مصري" }),
          ]),
      },
    );
    cleanup = rendered.cleanup;

    await waitFor(() =>
      expect(rendered.result.current.vocabulary.data?.map((word) => word.word_arabic)).toEqual([
        "خليجي",
      ]),
    );

    act(() => rendered.result.current.dialect.setDialect("Egyptian"));

    await waitFor(() =>
      expect(rendered.result.current.vocabulary.data?.map((word) => word.word_arabic)).toEqual([
        "مصري",
      ]),
    );
  });
});
