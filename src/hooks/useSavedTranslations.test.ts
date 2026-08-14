import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { daysAgo, TEST_USER_ID } from "@/test/support/factories";
import { useSavedTranslations } from "./useSavedTranslations";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Translations the learner chose to keep.
 *
 * The translate screen does real work on a passage — sentence segmentation, a
 * literal gloss alongside the natural one, per-word tokens. Losing that on
 * navigation means paying for it again, so anything worth returning to gets
 * saved whole rather than re-derived: the `sentences` column holds the finished
 * analysis, not just the source text.
 *
 * The list is local state rather than a query cache, which makes the optimistic
 * updates on save and delete the whole behaviour — nothing else refreshes it.
 */

const TABLE = "saved_text_translations";

/**
 * One analysed sentence, in the shape the translate screen produces.
 *
 * Both translations, always: the natural one is what the sentence means and the
 * literal one is how it is built, and the app's rule is that neither substitutes
 * for the other.
 */
const aSentence = () => ({
  english: "How is it going?",
  arabic: "شخبارك؟",
  literal: "كيف هو ماشي؟",
});

const aSavedTranslation = (over: Record<string, unknown> = {}) => ({
  id: "saved-1",
  user_id: TEST_USER_ID,
  title: "A note from a friend",
  source_text: "How is it going?",
  source_dialect: "Gulf",
  detected_dialect: "Gulf",
  sentences: [aSentence()],
  created_at: daysAgo(1),
  updated_at: daysAgo(1),
  ...over,
});

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/**
 * Wait until the hook has actually run its query as the signed-in learner.
 *
 * `loading` is false before that: the effect's first pass happens while
 * `useAuth` still has no user, takes the signed-out branch and settles
 * immediately. Asserting on `loading` alone would run the test against a hook
 * that had not queried anything and would still refuse to save.
 */
async function ready(backend: SupabaseBackend) {
  await waitFor(() =>
    expect(backend.db.reads.filter((read) => read.table === TABLE).length).toBeGreaterThan(0),
  );
}

function render(rows: Record<string, unknown>[] = []) {
  const seed = (backend: SupabaseBackend) => backend.db.seed(TABLE, rows);
  const harness = renderHookWithProviders(() => useSavedTranslations(), {
    persona: "free",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("the list", () => {
  it("loads the learner's saved translations", async () => {
    const { result } = render([aSavedTranslation()]);

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].title).toBe("A note from a friend");
  });

  it("puts the most recently saved first", async () => {
    const { result } = render([
      aSavedTranslation({ id: "old", title: "Older", created_at: daysAgo(10) }),
      aSavedTranslation({ id: "new", title: "Newer", created_at: daysAgo(1) }),
    ]);

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    // A saved-items list is a stack: what you kept last is what you came back
    // for.
    expect(result.current.items.map((item) => item.title)).toEqual(["Newer", "Older"]);
  });

  it("leaves out another learner's translations", async () => {
    const { result, backend } = render([
      aSavedTranslation({ id: "mine" }),
      aSavedTranslation({ id: "theirs", user_id: "someone-else" }),
    ]);

    await ready(backend);
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(["mine"]));
  });

  it("keeps the whole analysis, not just the text", async () => {
    const { result } = render([aSavedTranslation()]);

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    // The point of saving: reopening must not mean paying for the translation
    // again.
    expect(result.current.items[0].sentences).toEqual([aSentence()]);
  });

  it("is empty for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useSavedTranslations(), {
      persona: "anonymous",
      seed: (backend) => backend.db.seed(TABLE, [aSavedTranslation()]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.items).toEqual([]));
  });

  it("reports a failed load rather than an empty shelf", async () => {
    const harness = renderHookWithProviders(() => useSavedTranslations(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways(TABLE, 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // "You have saved nothing" would invite the learner to save it again.
    await waitFor(() => expect(harness.result.current.error).toBe("boom"));
    expect(harness.result.current.loading).toBe(false);
  });
});

describe("saving one", () => {
  it("writes the analysis and shows it immediately", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({ source_text: "How is it going?", sentences: [aSentence()] });
    });

    // Prepended locally rather than refetched: the learner is looking at the
    // list when they save, and a round trip would make it appear late.
    expect(result.current.items).toHaveLength(1);
    expect(backend.db.lastWriteTo(TABLE)?.payload[0]).toMatchObject({
      user_id: TEST_USER_ID,
      source_text: "How is it going?",
    });
  });

  it("titles it from the passage when the learner does not", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({ source_text: "  شخبارك يا صديقي  ", sentences: [] });
    });

    // An untitled row in a saved list is unfindable; the opening words are the
    // best label available without asking.
    expect(backend.db.lastWriteTo(TABLE)?.payload[0]).toMatchObject({
      title: "شخبارك يا صديقي",
    });
  });

  it("truncates a long passage into a readable title", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({ source_text: "ا".repeat(200), sentences: [] });
    });

    const title = (backend.db.lastWriteTo(TABLE)?.payload[0] as Record<string, string>).title;
    // Sixty characters plus an ellipsis, so the list stays scannable and the
    // truncation is visible rather than looking like the whole title.
    expect(title).toHaveLength(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("keeps a title the learner gave", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({
        source_text: "How is it going?",
        sentences: [],
        title: "Message from Ahmed",
      });
    });

    expect(backend.db.lastWriteTo(TABLE)?.payload[0]).toMatchObject({
      title: "Message from Ahmed",
    });
  });

  it("records both the chosen and the detected dialect", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({
        source_text: "How is it going?",
        sentences: [],
        source_dialect: "Gulf",
        detected_dialect: "Egyptian",
      });
    });

    // They disagree often enough to be worth keeping apart: what the learner
    // said they were reading, and what the model thought it actually was.
    expect(backend.db.lastWriteTo(TABLE)?.payload[0]).toMatchObject({
      source_dialect: "Gulf",
      detected_dialect: "Egyptian",
    });
  });

  it("stores an unspecified dialect as nothing", async () => {
    const { result, backend } = render();
    await ready(backend);

    await act(async () => {
      await result.current.save({ source_text: "How is it going?", sentences: [] });
    });

    expect(backend.db.lastWriteTo(TABLE)?.payload[0]).toMatchObject({
      source_dialect: null,
      detected_dialect: null,
    });
  });

  it("refuses to save for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useSavedTranslations(), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.loading).toBe(false));

    // Translating without an account is allowed; keeping something needs
    // somewhere to keep it.
    await expect(
      harness.result.current.save({ source_text: "How is it going?", sentences: [] }),
    ).rejects.toThrow("Not signed in");
  });

  it("reports a rejected write and leaves the list alone", async () => {
    const { result, backend } = render();
    await ready(backend);
    backend.db.failWrites(TABLE, 403, { message: "denied" });

    await expect(
      result.current.save({ source_text: "How is it going?", sentences: [] }),
    ).rejects.toBeTruthy();

    // The optimistic prepend happens after the insert resolves, so a failed
    // save cannot leave a row on screen that is not in the database.
    expect(result.current.items).toEqual([]);
  });
});

describe("deleting one", () => {
  it("removes it from the database and the list", async () => {
    const { result, backend } = render([
      aSavedTranslation({ id: "keep", title: "Keep" }),
      aSavedTranslation({ id: "drop", title: "Drop" }),
    ]);
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      await result.current.remove("drop");
    });

    expect(result.current.items.map((item) => item.id)).toEqual(["keep"]);
    expect(backend.db.lastWriteTo(TABLE)?.method).toBe("DELETE");
  });

  it("reports a rejected delete and keeps the row on screen", async () => {
    const { result, backend } = render([aSavedTranslation({ id: "drop" })]);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    backend.db.failWrites(TABLE, 403, { message: "denied" });

    await expect(result.current.remove("drop")).rejects.toBeTruthy();

    // Removing it locally on a failed delete would make it reappear on the next
    // load, which reads as the app resurrecting something the learner deleted.
    expect(result.current.items).toHaveLength(1);
  });
});

describe("reopening one", () => {
  it("fetches a single saved translation by id", async () => {
    const { result } = render([aSavedTranslation({ id: "saved-1" })]);
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const fetched = await result.current.get("saved-1");

    // The detail route loads directly by id rather than searching the list, so
    // a shared or bookmarked URL works without visiting the index first.
    expect(fetched?.source_text).toBe("How is it going?");
  });

  it("returns nothing for an id that is not there", async () => {
    const { result, backend } = render();
    await ready(backend);

    // Null rather than an error: a stale bookmark is an ordinary occurrence and
    // the page renders a not-found state for it.
    expect(await result.current.get("gone")).toBeNull();
  });
});

describe("refreshing", () => {
  it("picks up rows saved elsewhere", async () => {
    const { result, backend } = render();
    await ready(backend);
    backend.db.seed(TABLE, [aSavedTranslation()]);

    await act(async () => {
      await result.current.refresh();
    });

    // The list is local state, not a query cache, so nothing invalidates it —
    // this is the only way it ever picks up a change from another tab.
    expect(result.current.items).toHaveLength(1);
  });

  it("clears a previous error on a successful reload", async () => {
    const harness = renderHookWithProviders(() => useSavedTranslations(), {
      persona: "free",
      seed: (backend) => backend.db.failNext(TABLE, 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.error).toBe("boom"));

    await act(async () => {
      await harness.result.current.refresh();
    });

    // A stale error banner over a list that has since loaded is worse than no
    // banner at all.
    expect(harness.result.current.error).toBeNull();
  });
});
