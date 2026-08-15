import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aLearnerError, daysAgo, TEST_USER_ID } from "@/test/support/factories";
import { useMistakes, useResolveMistake } from "./useLearnerErrors";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The learner's own record of what they keep getting wrong.
 *
 * Every scoring function in the app produces detailed error data — per-phoneme
 * types from Azure, a word-level alignment diff from the shadow scorer, targeted
 * tips from the sentence coach — and until `learner_errors` existed all of it
 * was rendered once and dropped. Nothing accumulated, so nothing could be
 * remediated: a learner could mispronounce the same word forty times and the app
 * would react identically each time.
 *
 * The write side belongs to the edge functions under the service role. The
 * client can read its own rows and set `resolved_at`, and nothing else — the
 * 20260726140000 migration revoked blanket UPDATE and re-granted it on that one
 * column, because `target_text` and `detail` feed content generation and a
 * client that could rewrite them could steer what it is taught.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[], dialect = "Gulf") {
  const seed = (backend: SupabaseBackend) => backend.db.seed("learner_errors", rows);
  const harness = renderHookWithProviders(
    () => ({ mistakes: useMistakes(dialect), resolve: useResolveMistake() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("reading the corpus", () => {
  it("groups repeated failures on one word", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "شغل", created_at: daysAgo(1) }),
      aLearnerError({ id: "e2", target_text: "شغل", created_at: daysAgo(2) }),
      aLearnerError({ id: "e3", target_text: "كتاب", created_at: daysAgo(3) }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    const groups = result.current.mistakes.data!;
    // A list of forty rows is a wall of noise; "شغل, six times" is something a
    // learner can act on.
    expect(groups.map((group) => group.target)).toEqual(["شغل", "كتاب"]);
    expect(groups[0].count).toBe(2);
    expect(groups[0].ids).toEqual(["e1", "e2"]);
  });

  it("keeps the same word in two dialects apart", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "شغل", dialect: "Gulf" }),
      aLearnerError({ id: "e2", target_text: "شغل", dialect: "Egyptian" }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    // The query is per dialect, so the Egyptian row is not even fetched — the
    // Gulf learner's practice list is about Gulf.
    expect(result.current.mistakes.data).toHaveLength(1);
    expect(result.current.mistakes.data?.[0].dialect).toBe("Gulf");
  });

  it("leaves out anything already put right", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "شغل" }),
      aLearnerError({ id: "e2", target_text: "كتاب", resolved_at: daysAgo(1) }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    // Without this the list only ever grows, and content generation would keep
    // drilling words the learner has since fixed.
    expect(result.current.mistakes.data?.map((group) => group.target)).toEqual(["شغل"]);
  });

  it("leaves out another learner's errors", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "شغل" }),
      aLearnerError({ id: "e2", target_text: "كتاب", user_id: "someone-else" }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    expect(result.current.mistakes.data?.map((group) => group.target)).toEqual(["شغل"]);
  });

  it("puts the most recent trouble first", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "قديم", created_at: daysAgo(30) }),
      aLearnerError({ id: "e2", target_text: "جديد", created_at: daysAgo(1) }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    // What went wrong yesterday is what the learner still remembers attempting.
    expect(result.current.mistakes.data?.map((group) => group.target)).toEqual(["جديد", "قديم"]);
  });

  it("carries what the learner actually said", async () => {
    const { result } = render([
      aLearnerError({ id: "e1", target_text: "شغل", produced_text: "شغال", source: "shadow" }),
    ]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    // "You said شغال" is the feedback; the target alone only says they failed.
    expect(result.current.mistakes.data?.[0]).toMatchObject({
      attempts: ["شغال"],
      sources: ["shadow"],
      kinds: ["mispronunciation"],
    });
  });

  it("returns an empty list for a learner with a clean record", async () => {
    const { result } = render([]);

    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    expect(result.current.mistakes.data).toEqual([]);
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useMistakes("Gulf"), { persona: "anonymous" });
    cleanup = harness.cleanup;

    // The corpus is per learner and there is nobody to attribute it to.
    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
    expect(harness.result.current.data).toBeUndefined();
  });

  it("surfaces a failed read rather than an empty record", async () => {
    const harness = renderHookWithProviders(() => useMistakes("Gulf"), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("learner_errors", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // "You have made no mistakes" is a very different message from "we could
    // not load your mistakes", and only one of them is ever true here.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});

describe("dismissing a mistake", () => {
  it("stamps every row in the group as resolved", async () => {
    const { result, backend } = render([
      aLearnerError({ id: "e1", target_text: "شغل", created_at: daysAgo(1) }),
      aLearnerError({ id: "e2", target_text: "شغل", created_at: daysAgo(2) }),
    ]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));

    await result.current.resolve.mutateAsync(result.current.mistakes.data![0].ids);

    const write = backend.db.lastWriteTo("learner_errors")!;
    expect(write.method).toBe("PATCH");
    // All of them at once: dismissing "شغل" from a list that says it happened
    // twice must not leave one row behind for it to reappear from.
    expect(typeof (write.payload[0] as Record<string, unknown>).resolved_at).toBe("string");
  });

  it("clears exactly the rows the learner was looking at", async () => {
    const { result, backend } = render([
      aLearnerError({ id: "e1", target_text: "شغل" }),
      aLearnerError({ id: "e2", target_text: "كتاب" }),
    ]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));

    await result.current.resolve.mutateAsync(["e1"]);

    // Filtered by id rather than by target, so a scoring call still in flight
    // cannot have its brand-new row dismissed by a tap that predates it.
    const affected = backend.db.lastWriteTo("learner_errors")!.affected;
    expect(affected.map((row) => row.id)).toEqual(["e1"]);
  });

  it("refreshes the list afterwards", async () => {
    const { result, backend } = render([aLearnerError({ id: "e1", target_text: "شغل" })]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    const readsBefore = backend.db.reads.filter((read) => read.table === "learner_errors").length;

    await result.current.resolve.mutateAsync(["e1"]);

    // The dismissed group has to leave the screen; nothing else removes it.
    await waitFor(() =>
      expect(
        backend.db.reads.filter((read) => read.table === "learner_errors").length,
      ).toBeGreaterThan(readsBefore),
    );
  });

  it("does nothing at all when given no ids", async () => {
    const { result, backend } = render([aLearnerError({ id: "e1" })]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));

    const cleared = await result.current.resolve.mutateAsync([]);

    // An unfiltered PATCH would resolve the learner's entire history, which is
    // the worst thing this mutation could do.
    expect(cleared).toBe(0);
    expect(backend.db.writesTo("learner_errors")).toEqual([]);
  });

  it("reports a failed dismissal rather than swallowing it", async () => {
    const { result, backend } = render([aLearnerError({ id: "e1", target_text: "شغل" })]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));
    backend.db.failWrites("learner_errors", 403, { message: "denied" });

    await expect(result.current.resolve.mutateAsync(["e1"])).rejects.toBeTruthy();

    // A dismissal that silently failed would take the row off the screen and
    // put it back on the next load, with no explanation.
    await waitFor(() => expect(result.current.resolve.isError).toBe(true));
  });
});

describe("who the corpus belongs to", () => {
  it("scopes the query to the signed-in learner", async () => {
    const { result, backend } = render([aLearnerError({ id: "e1" })]);
    await waitFor(() => expect(result.current.mistakes.isSuccess).toBe(true));

    const read = backend.db.reads.find((entry) => entry.table === "learner_errors")!;
    expect(decodeURIComponent(read.search)).toContain(`user_id=eq.${TEST_USER_ID}`);
  });
});
