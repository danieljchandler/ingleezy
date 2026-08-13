import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  anInteractiveStory,
  aStoryScene,
  interactiveStoryId,
  sceneId,
  TEST_USER_ID,
} from "@/test/support/factories";
import {
  useAllStories,
  usePublishedStories,
  useStoryProgress,
  useStoryScenes,
  useUpsertStoryProgress,
} from "./useInteractiveStories";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Branching stories — the app's one piece of interactive fiction.
 *
 * A learner reads a scene in Arabic and picks what to do next, which turns
 * comprehension into a decision with a consequence. That is the point: you can
 * skim a passage you half-understand, but you cannot choose between two options
 * you did not read.
 *
 * Progress is one row per learner per story, holding the scene they are on and
 * the path they took to get there. The path is what lets them see, at the end,
 * that a different choice was available — and it is why the row is upserted
 * rather than inserted: a story is read across several sittings.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const STORY = interactiveStoryId(0);

function render<T>(hook: () => T, seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("the story shelf", () => {
  it("shows a learner only the published stories", async () => {
    const { result } = render(() => usePublishedStories(), (backend) =>
      backend.db.seed("interactive_stories", [
        anInteractiveStory({ id: interactiveStoryId(0), title: "Live", status: "published" }),
        anInteractiveStory({ id: interactiveStoryId(1), title: "Draft", status: "draft" }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A draft story has scenes that lead nowhere; opening one is a dead end
    // mid-narrative rather than an obviously unfinished page.
    expect(result.current.data?.map((story) => story.title)).toEqual(["Live"]);
  });

  it("orders the shelf as the curriculum intends", async () => {
    const { result } = render(() => usePublishedStories(), (backend) =>
      backend.db.seed("interactive_stories", [
        anInteractiveStory({
          id: interactiveStoryId(1),
          title: "Second",
          status: "published",
          display_order: 2,
        }),
        anInteractiveStory({
          id: interactiveStoryId(0),
          title: "First",
          status: "published",
          display_order: 1,
        }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Curated rather than chronological: the first story is the one written for
    // a beginner.
    expect(result.current.data?.map((story) => story.title)).toEqual(["First", "Second"]);
  });

  it("shows an admin the drafts as well", async () => {
    const { result } = render(() => useAllStories(), (backend) =>
      backend.db.seed("interactive_stories", [
        anInteractiveStory({ id: interactiveStoryId(0), title: "Live", status: "published" }),
        anInteractiveStory({ id: interactiveStoryId(1), title: "Draft", status: "draft" }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The unpublished ones are exactly the queue an author works from.
    expect(result.current.data?.map((story) => story.title).sort()).toEqual(["Draft", "Live"]);
  });

  it("is browsable by a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => usePublishedStories(), {
      persona: "anonymous",
      seed: (backend) =>
        backend.db.seed("interactive_stories", [anInteractiveStory({ status: "published" })]),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.data).toHaveLength(1));
  });

  it("surfaces a failed read rather than an empty shelf", async () => {
    const { result } = render(() => usePublishedStories(), (backend) =>
      backend.db.failAlways("interactive_stories", 500, { message: "boom" }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("the scenes of one story", () => {
  it("returns them in narrative order", async () => {
    const { result } = render(() => useStoryScenes(STORY), (backend) =>
      backend.db.seed("story_scenes", [
        aStoryScene({ id: sceneId(2), story_id: STORY, scene_order: 2 }),
        aStoryScene({ id: sceneId(0), story_id: STORY, scene_order: 0 }),
        aStoryScene({ id: sceneId(1), story_id: STORY, scene_order: 1 }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Choices point at a `next_scene_order`, so the order is not decoration —
    // it is how the branching graph is addressed.
    expect(result.current.data?.map((scene) => scene.scene_order)).toEqual([0, 1, 2]);
  });

  it("leaves out another story's scenes", async () => {
    const { result } = render(() => useStoryScenes(STORY), (backend) =>
      backend.db.seed("story_scenes", [
        aStoryScene({ id: sceneId(0), story_id: STORY }),
        aStoryScene({ id: sceneId(1), story_id: interactiveStoryId(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("carries the choices and the vocabulary the scene teaches", async () => {
    const { result } = render(() => useStoryScenes(STORY), (backend) =>
      backend.db.seed("story_scenes", [aStoryScene({ story_id: STORY })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].choices[0]).toMatchObject({
      text_arabic: "اطلب قهوة",
      next_scene_order: 1,
    });
    expect(result.current.data?.[0].vocabulary[0]).toMatchObject({ word_arabic: "مقهى" });
  });

  it("gives a scene with no choices an empty list rather than nothing", async () => {
    const { result } = render(() => useStoryScenes(STORY), (backend) =>
      backend.db.seed("story_scenes", [
        aStoryScene({
          story_id: STORY,
          vocabulary: null,
          choices: null,
          is_ending: true,
          ending_message: "You found the camel.",
        }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // An ending has no choices by definition, and the reader maps over the
    // array — null there would throw on the last page of every story.
    expect(result.current.data?.[0].choices).toEqual([]);
    expect(result.current.data?.[0].vocabulary).toEqual([]);
    expect(result.current.data?.[0].is_ending).toBe(true);
  });

  it("does not query without a story", async () => {
    const { result, backend } = render(() => useStoryScenes(undefined));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(backend.db.reads.filter((read) => read.table === "story_scenes")).toEqual([]);
  });
});

describe("where the learner got to", () => {
  it("returns their place in the story", async () => {
    const { result } = render(() => useStoryProgress(STORY), (backend) =>
      backend.db.seed("story_progress", [
        {
          id: "prog-1",
          user_id: TEST_USER_ID,
          story_id: STORY,
          current_scene_id: sceneId(2),
          completed: false,
          path_taken: [0, 1],
          started_at: new Date().toISOString(),
          completed_at: null,
        },
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The path, not just the scene: an interactive story is only interesting if
    // the reader can see which way they came.
    expect(result.current.data).toMatchObject({
      current_scene_id: sceneId(2),
      path_taken: [0, 1],
    });
  });

  it("returns nothing for a story they have not opened", async () => {
    const { result } = render(() => useStoryProgress(STORY));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Null is "start from the beginning", which is a state the reader screen
    // needs to tell apart from a failed load.
    expect(result.current.data).toBeNull();
  });

  it("leaves out another learner's progress", async () => {
    const { result } = render(() => useStoryProgress(STORY), (backend) =>
      backend.db.seed("story_progress", [
        {
          id: "prog-1",
          user_id: "someone-else",
          story_id: STORY,
          current_scene_id: sceneId(2),
          completed: true,
          path_taken: [0, 1],
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useStoryProgress(STORY), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});

/**
 * Mount the mutation with a signed-in-only query beside it, and wait for that
 * query to run.
 *
 * `useAuth` has no user on the first pass, and the mutation throws
 * "Not authenticated" if it is called then. Awaiting a query that is `enabled`
 * only for a signed-in learner is the signal that the session has landed.
 */
async function renderSaver(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(
    () => ({ progress: useStoryProgress(STORY), save: useUpsertStoryProgress() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.progress.isSuccess).toBe(true));
  return harness;
}

describe("saving a choice", () => {
  it("records the scene and the path taken", async () => {
    const { result, backend } = await renderSaver();

    await result.current.save.mutateAsync({
      storyId: STORY,
      currentSceneId: sceneId(1),
      completed: false,
      pathTaken: [0],
    });

    expect(backend.db.lastWriteTo("story_progress")?.payload[0]).toMatchObject({
      user_id: TEST_USER_ID,
      story_id: STORY,
      current_scene_id: sceneId(1),
      completed: false,
      path_taken: [0],
      completed_at: null,
    });
  });

  it("stamps the finish time when the story ends", async () => {
    const { result, backend } = await renderSaver();

    await result.current.save.mutateAsync({
      storyId: STORY,
      currentSceneId: sceneId(4),
      completed: true,
      pathTaken: [0, 1, 4],
    });

    const row = backend.db.lastWriteTo("story_progress")?.payload[0] as Record<string, unknown>;
    // The timestamp is what a completion list and any "finished this week"
    // count read; a bare boolean says it happened but not when.
    expect(typeof row.completed_at).toBe("string");
  });

  it("keeps one row per learner and story across several sittings", async () => {
    const { result, backend } = await renderSaver();

    await result.current.save.mutateAsync({
      storyId: STORY,
      currentSceneId: sceneId(1),
      completed: false,
      pathTaken: [0],
    });
    await result.current.save.mutateAsync({
      storyId: STORY,
      currentSceneId: sceneId(2),
      completed: false,
      pathTaken: [0, 1],
    });

    // Without the conflict target every choice would be a new row, and
    // "where was I" would have several answers.
    expect(backend.db.rows("story_progress")).toHaveLength(1);
    expect(backend.db.rows("story_progress")[0]).toMatchObject({
      current_scene_id: sceneId(2),
      path_taken: [0, 1],
    });
  });

  it("puts the new position on screen without a reload", async () => {
    const harness = renderHookWithProviders(
      () => ({ progress: useStoryProgress(STORY), save: useUpsertStoryProgress() }),
      { persona: "free" },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.progress.isSuccess).toBe(true));

    await harness.result.current.save.mutateAsync({
      storyId: STORY,
      currentSceneId: sceneId(1),
      completed: false,
      pathTaken: [0],
    });

    await waitFor(() =>
      expect(harness.result.current.progress.data?.current_scene_id).toBe(sceneId(1)),
    );
  });

  it("refuses to save for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useUpsertStoryProgress(), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    // Reading a story without an account is fine; there is nowhere to record a
    // path for someone who has none.
    await act(async () => {
  await expect(
        harness.result.current.mutateAsync({
          storyId: STORY,
          currentSceneId: sceneId(1),
          completed: false,
          pathTaken: [0],
        }),
      ).rejects.toThrow("Not authenticated");
    });
  });

  it("reports a rejected save", async () => {
    const { result } = await renderSaver((backend) =>
      backend.db.failWrites("story_progress", 403, { message: "denied" }),
    );

    // A silently lost save sends the reader back to the start next time, with
    // no indication of why.
    await expect(
      result.current.save.mutateAsync({
        storyId: STORY,
        currentSceneId: sceneId(1),
        completed: false,
        pathTaken: [0],
      }),
    ).rejects.toBeTruthy();
  });
});
