import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aStage, stageId } from "@/test/support/factories";
import { useStages } from "./useStages";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The curriculum's stages, in the order a learner walks them.
 *
 * A stage is the coarsest unit of the syllabus — Foundations, then Everyday
 * Speech, and so on — and the order is the whole point: it is a CEFR ladder,
 * and presenting stage 3 before stage 1 would put a learner in front of
 * material assuming vocabulary they have not met.
 *
 * The ordering column is `stage_number`, not `display_order`, and the table has
 * both. That is the one thing here worth pinning down.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[]) {
  const seed = (backend: SupabaseBackend) => backend.db.seed("curriculum_stages", rows);
  const harness = renderHookWithProviders(() => useStages(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("listing the stages", () => {
  it("returns them in curriculum order", async () => {
    const { result } = render([
      aStage({ id: stageId(2), name: "Third", stage_number: 3, display_order: 1 }),
      aStage({ id: stageId(0), name: "First", stage_number: 1, display_order: 3 }),
      aStage({ id: stageId(1), name: "Second", stage_number: 2, display_order: 2 }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Ordered by `stage_number`, and the fixtures set `display_order` to the
    // reverse on purpose: the table carries both columns, and sorting by the
    // wrong one would still produce a plausible, wrongly-ordered syllabus.
    expect(result.current.data?.map((stage) => stage.name)).toEqual(["First", "Second", "Third"]);
  });

  it("carries what the curriculum screen renders", async () => {
    const { result } = render([
      aStage({ name: "Foundations", name_arabic: "الأساسيات", cefr_level: "A1" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({
      name: "Foundations",
      name_arabic: "الأساسيات",
      cefr_level: "A1",
      stage_number: 1,
    });
  });

  it("returns an empty list when the curriculum is empty", async () => {
    const { result } = render([]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Empty rather than undefined: the curriculum page maps over this, and a
    // missing array is a different branch from an empty one.
    expect(result.current.data).toEqual([]);
  });

  it("is available to a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useStages(), {
      persona: "anonymous",
      seed: (backend) => backend.db.seed("curriculum_stages", [aStage()]),
    });
    cleanup = harness.cleanup;

    // The syllabus is the app's shop window — someone deciding whether to sign
    // up should be able to see what is taught.
    await waitFor(() => expect(harness.result.current.data).toHaveLength(1));
  });

  it("is shared across every screen that asks for it", async () => {
    const { result, backend } = render([aStage()]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // One cache key with no parameters, so the curriculum page, the admin
    // stage picker and the lesson breadcrumb all read the same fetch.
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
    expect(backend.db.reads.filter((read) => read.table === "curriculum_stages").length).toBe(1);
  });
});

describe("when the read fails", () => {
  it("surfaces the error rather than an empty curriculum", async () => {
    const harness = renderHookWithProviders(() => useStages(), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("curriculum_stages", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // The distinction the caller needs: "there are no stages" is a content
    // problem and "the query failed" is an outage, and a page that renders the
    // empty state for both hides the outage.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
    expect(harness.result.current.data).toBeUndefined();
  });
});
