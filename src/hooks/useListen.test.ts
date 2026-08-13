import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { aListenEpisode, daysAgo, episodeId } from "@/test/support/factories";
import {
  useDeleteListenEpisode,
  useGenerateListenEpisode,
  useIncrementPlayCount,
  useListenEpisode,
  useListenEpisodes,
  useRetryListenAudio,
} from "./useListen";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The Listen catalogue and its audio pipeline.
 *
 * Generating an episode is two stages: a script, then per-line speech synthesis
 * that can take minutes and runs outside the request. The row therefore carries
 * an `audio_status`, the page polls while it is pending, and there is a watchdog
 * — a pending episode whose heartbeat has not moved in five minutes is assumed
 * to have lost its worker and the job is re-kicked.
 *
 * That watchdog is the part worth testing. It is invisible, it fires on a read
 * rather than a click, and both failure directions are bad: too eager and every
 * poll starts a duplicate synthesis job, too slow and an episode sits at
 * "preparing audio" forever with nothing to press.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

/** Minutes before now, as an ISO timestamp. */
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function render<T>(hook: () => T, seed?: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("the catalogue", () => {
  it("lists episodes in the active dialect", async () => {
    const { result } = render(() => useListenEpisodes(), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "Gulf one", dialect: "Gulf" }),
        aListenEpisode({ id: episodeId(1), title: "Cairo one", dialect: "Egyptian" }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].title).toBe("Gulf one");
  });

  it("puts the newest first", async () => {
    const { result } = render(() => useListenEpisodes(), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "Older", created_at: daysAgo(9) }),
        aListenEpisode({ id: episodeId(1), title: "Newer", created_at: daysAgo(1) }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.map((episode) => episode.title)).toEqual(["Newer", "Older"]);
  });

  it("narrows to one format", async () => {
    const { result } = render(() => useListenEpisodes({ format: "ted" }), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "A chat", format: "podcast" }),
        aListenEpisode({ id: episodeId(1), title: "A talk", format: "ted" }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].title).toBe("A talk");
  });

  it("treats 'all' as no filter at all", async () => {
    const { result } = render(() => useListenEpisodes({ format: "all" }), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), format: "podcast" }),
        aListenEpisode({ id: episodeId(1), format: "ted" }),
      ]);
    });

    // A literal `.eq("format", "all")` would match nothing and read as an empty
    // catalogue.
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it("narrows to the learner's own episodes", async () => {
    const { result } = render(() => useListenEpisodes({ mineOnly: true }), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "Mine", creator_id: TEST_USER_ID }),
        aListenEpisode({
          id: episodeId(1),
          title: "Theirs",
          creator_id: "00000000-0000-4000-8000-000000000009",
        }),
      ]);
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].title).toBe("Mine");
  });

  it("shows everything when 'mine only' is off", async () => {
    const { result } = render(() => useListenEpisodes(), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), creator_id: TEST_USER_ID }),
        aListenEpisode({
          id: episodeId(1),
          creator_id: "00000000-0000-4000-8000-000000000009",
        }),
      ]);
    });

    // The catalogue is shared; episodes other learners generated are the bulk
    // of it.
    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });
});

describe("one episode", () => {
  it("returns it by id", async () => {
    const { result } = render(() => useListenEpisode(episodeId(0)), (backend) => {
      backend.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "Episode one" }),
        aListenEpisode({ id: episodeId(1), title: "Episode two" }),
      ]);
    });

    await waitFor(() => expect(result.current.data?.title).toBe("Episode one"));
  });

  it("returns null for an id that matches nothing", async () => {
    const { result } = render(() => useListenEpisode(episodeId(9)), (backend) => {
      backend.db.seed("listen_episodes", [aListenEpisode({ id: episodeId(0) })]);
    });

    // maybeSingle, so a stale link is a null rather than an error the page has
    // to translate.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("asks nothing without an id", async () => {
    const { result, backend } = render(() => useListenEpisode(undefined), (b) =>
      b.db.seed("listen_episodes", [aListenEpisode({ id: episodeId(0) })]),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(backend.db.readsOf("listen_episodes")).toHaveLength(0);
  });
});

describe("the stale-synthesis watchdog", () => {
  const pending = (over: Record<string, unknown> = {}) =>
    aListenEpisode({
      id: episodeId(0),
      audio_mode: "full",
      audio_status: "pending",
      full_audio_url: null,
      ...over,
    });

  it("re-kicks a job whose heartbeat stopped moving", async () => {
    const { result, backend } = render(() => useListenEpisode(episodeId(0)), (b) => {
      b.db.seed("listen_episodes", [pending({ updated_at: minutesAgo(30) })]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    // Synthesis runs outside the request and is resumable — it skips lines
    // already uploaded — so re-kicking a dead worker is how an episode stuck at
    // "preparing audio" ever finishes.
    await waitFor(() =>
      expect(backend.callsTo("generate-listen-audio").length).toBeGreaterThan(0),
    );
    expect(backend.lastCallTo("generate-listen-audio")?.body).toMatchObject({
      episodeId: episodeId(0),
    });
  });

  it("leaves a job alone while its heartbeat is fresh", async () => {
    const { result, backend } = render(() => useListenEpisode(episodeId(0)), (b) => {
      b.db.seed("listen_episodes", [pending({ updated_at: minutesAgo(1) })]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    // The page polls every four seconds while pending. Re-kicking on each poll
    // would start a synthesis job per tick and bill for all of them.
    expect(backend.callsTo("generate-listen-audio")).toHaveLength(0);
  });

  it("leaves a finished episode alone", async () => {
    const { result, backend } = render(() => useListenEpisode(episodeId(0)), (b) => {
      b.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), audio_mode: "full", audio_status: "ready" }),
      ]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(backend.callsTo("generate-listen-audio")).toHaveLength(0);
  });

  it("leaves a failed episode alone", async () => {
    const { result, backend } = render(() => useListenEpisode(episodeId(0)), (b) => {
      b.db.seed("listen_episodes", [
        aListenEpisode({
          id: episodeId(0),
          audio_mode: "full",
          audio_status: "failed",
          updated_at: minutesAgo(30),
        }),
      ]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    // A failure is a decision, not a stall: retrying it automatically would
    // loop forever on an episode that cannot be synthesised. The page offers a
    // manual retry instead.
    expect(backend.callsTo("generate-listen-audio")).toHaveLength(0);
  });

  it("leaves an on-demand episode alone", async () => {
    const { result, backend } = render(() => useListenEpisode(episodeId(0)), (b) => {
      b.db.seed("listen_episodes", [
        pending({ audio_mode: "on_demand", updated_at: minutesAgo(30) }),
      ]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    // On-demand episodes synthesise line by line as the learner plays them;
    // there is no background job to have died.
    expect(backend.callsTo("generate-listen-audio")).toHaveLength(0);
  });
});

describe("generating an episode", () => {
  it("sends what the learner asked for, in their dialect", async () => {
    const { result, backend } = render(() => useGenerateListenEpisode(), (b) => {
      b.db.seed("listen_episodes", []);
      b.stubFunction("generate-listen-script", {
        episode: aListenEpisode({ id: episodeId(0) }),
      });
    });

    await act(async () => {
      await result.current.mutateAsync({
        format: "podcast",
        topic: "ordering coffee",
        length: "short",
        audioMode: "full",
      });
    });

    expect(backend.lastCallTo("generate-listen-script")?.body).toMatchObject({
      format: "podcast",
      topic: "ordering coffee",
      length: "short",
      audioMode: "full",
      dialect: "Gulf",
    });
  });

  it("raises when the function answers without an episode", async () => {
    const { result } = render(() => useGenerateListenEpisode(), (b) => {
      b.stubFunction("generate-listen-script", { error: "budget_spent", message: "No budget" });
    });

    // A resolved promise with no episode would leave the page navigating to
    // `undefined`.
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          format: "podcast",
          topic: "x",
          length: "short",
          audioMode: "full",
        }),
      ).rejects.toThrow(/no budget/i);
    });
  });

  it("surfaces a failed generation", async () => {
    const { result } = render(() => useGenerateListenEpisode(), (b) => {
      b.stubFunctionFailure("generate-listen-script");
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          format: "ted",
          topic: "x",
          length: "short",
          audioMode: "on_demand",
        }),
      ).rejects.toThrow();
    });
  });
});

describe("retrying and cleaning up", () => {
  it("re-kicks synthesis for one episode on request", async () => {
    const { result, backend } = render(() => useRetryListenAudio(), (b) => {
      b.db.seed("listen_episodes", [aListenEpisode({ id: episodeId(0) })]);
      b.stubFunction("generate-listen-audio", { ok: true });
    });

    await act(async () => {
      await result.current.mutateAsync(episodeId(0));
    });

    expect(backend.lastCallTo("generate-listen-audio")?.body).toMatchObject({
      episodeId: episodeId(0),
    });
  });

  it("surfaces a failed retry", async () => {
    const { result } = render(() => useRetryListenAudio(), (b) => {
      b.stubFunctionFailure("generate-listen-audio");
    });

    // The retry button is the learner's only recourse on a failed episode; a
    // silent failure makes it look dead.
    await act(async () => {
      await expect(result.current.mutateAsync(episodeId(0))).rejects.toThrow();
    });
  });

  it("counts a play", async () => {
    const { result, backend } = render(() => useIncrementPlayCount(), (b) => {
      b.db.seed("listen_episodes", [aListenEpisode({ id: episodeId(0), play_count: 4 })]);
    });

    await act(async () => {
      await result.current.mutateAsync(episodeId(0));
    });

    expect(Number(backend.db.rows("listen_episodes")[0].play_count)).toBe(5);
  });

  it("deletes exactly the episode named", async () => {
    const { result, backend } = render(() => useDeleteListenEpisode(), (b) => {
      b.db.seed("listen_episodes", [
        aListenEpisode({ id: episodeId(0), title: "Delete me" }),
        aListenEpisode({ id: episodeId(1), title: "Keep me" }),
      ]);
    });

    await act(async () => {
      await result.current.mutateAsync(episodeId(0));
    });

    // A delete without its filter would clear the shared catalogue.
    const remaining = backend.db.rows("listen_episodes");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("Keep me");
  });

  it("surfaces a refused delete", async () => {
    const { result } = render(() => useDeleteListenEpisode(), (b) => {
      b.db.seed("listen_episodes", [aListenEpisode({ id: episodeId(0) })]);
      b.db.failWrites("listen_episodes", 403);
    });

    // RLS lets a learner delete only their own; a silent failure would leave
    // the episode on screen looking deleted until the next reload.
    await act(async () => {
      await expect(result.current.mutateAsync(episodeId(0))).rejects.toThrow();
    });
  });
});
