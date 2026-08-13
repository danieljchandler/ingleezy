import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aConceptMastery,
  aCurriculumConcept,
  conceptId,
  TEST_USER_ID,
} from "@/test/support/factories";
import { useGrammarMastery, useRecordGrammarOutcome } from "./useGrammarMastery";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * How well the learner handles each grammar point, and how a finished drill
 * gets recorded.
 *
 * Vocabulary has been tracked in fine detail since the beginning — FSRS
 * stability per card, leeches, production errors. Structure was tracked not at
 * all: a learner could miss every negation question in Grammar Drills, see a
 * score, and leave no trace anywhere. The next drill was generated as if they
 * had never answered a question.
 *
 * The read/write asymmetry here is deliberate and is the thing worth pinning.
 * Reads go straight to the table under RLS. Writes go through an edge function
 * under the service role, so a client cannot post itself a mastery score —
 * which matters because mastery decides what content the learner is given next.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const NEGATION = conceptId(0);
const PLURALS = conceptId(1);

function render(
  seed: (backend: SupabaseBackend) => void = () => {},
  dialect = "Gulf",
) {
  const harness = renderHookWithProviders(
    () => ({ mastery: useGrammarMastery(dialect), record: useRecordGrammarOutcome() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

const seedConcept = (backend: SupabaseBackend, rows: Record<string, unknown>[]) =>
  backend.db.seed("curriculum_concepts", rows);

describe("reading mastery", () => {
  it("keys each concept by the id the drill grid uses", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({
          id: NEGATION,
          key: "negation",
          display_english: "Negation",
          kind: "grammar",
          dialect: "Gulf",
        }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: NEGATION, strength: "familiar" }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // A Map keyed on the concept key, because the grid renders the six drill
    // categories and needs to look each one up by the id it already has.
    expect(result.current.mastery.data?.get("negation")).toMatchObject({
      conceptKey: "negation",
      label: "Negation",
      strength: "familiar",
    });
  });

  it("falls back to the key when a concept has no gloss", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({
          id: NEGATION,
          key: "negation",
          display_english: null,
          kind: "grammar",
          dialect: "Gulf",
        }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: NEGATION }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // The label is rendered; an unglossed concept should read as its key rather
    // than as a blank chip.
    expect(result.current.mastery.data?.get("negation")?.label).toBe("negation");
  });

  it("leaves out vocabulary concepts", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({ id: NEGATION, key: "negation", kind: "grammar", dialect: "Gulf" }),
        aCurriculumConcept({ id: PLURALS, key: "souq", kind: "vocab", dialect: "Gulf" }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: NEGATION }),
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: PLURALS }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // The same table tracks both; only grammar belongs on the drill grid, and a
    // vocabulary row there would render as a category nobody can practise.
    expect([...result.current.mastery.data!.keys()]).toEqual(["negation"]);
  });

  it("leaves out another dialect's concepts", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({ id: NEGATION, key: "negation", kind: "grammar", dialect: "Gulf" }),
        aCurriculumConcept({
          id: PLURALS,
          key: "negation-eg",
          kind: "grammar",
          dialect: "Egyptian",
        }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: NEGATION }),
        aConceptMastery({ user_id: TEST_USER_ID, concept_id: PLURALS }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // Negation works differently in each dialect, so being strong in one says
    // nothing about the other.
    expect([...result.current.mastery.data!.keys()]).toEqual(["negation"]);
  });

  it("leaves out another learner's mastery", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({ id: NEGATION, key: "negation", kind: "grammar", dialect: "Gulf" }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({ user_id: "someone-else", concept_id: NEGATION }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    expect(result.current.mastery.data?.size).toBe(0);
  });

  it("returns an empty map for a learner who has not drilled yet", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // Empty rather than undefined: the grid calls `.get` for each of the six
    // categories and renders "new" for the misses.
    expect(result.current.mastery.data?.size).toBe(0);
  });

  it("fills in the defaults the ladder assumes", async () => {
    const { result } = render((backend) => {
      seedConcept(backend, [
        aCurriculumConcept({ id: NEGATION, key: "negation", kind: "grammar", dialect: "Gulf" }),
      ]);
      backend.db.seed("user_concept_mastery", [
        aConceptMastery({
          user_id: TEST_USER_ID,
          concept_id: NEGATION,
          exposures: null,
          correct: null,
          incorrect: null,
          ease: null,
          strength: null,
        }),
      ]);
    });

    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    // A row written before a column existed must not reach the ladder as null —
    // the arithmetic there would produce NaN intervals.
    expect(result.current.mastery.data?.get("negation")).toMatchObject({
      exposures: 0,
      correct: 0,
      incorrect: 0,
      ease: 2.5,
      strength: "new",
    });
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useGrammarMastery("Gulf"), {
      persona: "anonymous",
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });

  it("surfaces a failed read", async () => {
    const harness = renderHookWithProviders(() => useGrammarMastery("Gulf"), {
      persona: "free",
      seed: (backend) => backend.db.failAlways("user_concept_mastery", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});

describe("recording a finished drill", () => {
  it("posts the answers through the edge function, not the table", async () => {
    const { result, backend } = render((b) =>
      b.stubFunction("record-grammar-outcome", { recorded: 3 }),
    );
    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));

    await result.current.record.mutateAsync({
      category: "negation",
      categoryLabel: "Negation",
      dialect: "Gulf",
      outcomes: [true, false, true],
    });

    // The asymmetry that makes the score mean anything: a client that could
    // write here could hand itself "mastered" and change what it is taught.
    expect(backend.lastCallTo("record-grammar-outcome")?.body).toMatchObject({
      category: "negation",
      dialect: "Gulf",
      outcomes: [true, false, true],
    });
    expect(backend.db.writesTo("user_concept_mastery")).toEqual([]);
  });

  it("sends the answers in the order they were given", async () => {
    const { result, backend } = render((b) =>
      b.stubFunction("record-grammar-outcome", { recorded: 3 }),
    );
    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));

    await result.current.record.mutateAsync({
      category: "negation",
      dialect: "Gulf",
      outcomes: [false, true, true],
    });

    // Order carries information the totals do not: a wrong answer can never
    // promote, so three-wrong-then-right and right-then-three-wrong land on
    // different rungs of the ladder.
    expect(backend.lastCallTo("record-grammar-outcome")?.body).toMatchObject({
      outcomes: [false, true, true],
    });
  });

  it("does not call out for a drill with no answers", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));

    const recorded = await result.current.record.mutateAsync({
      category: "negation",
      dialect: "Gulf",
      outcomes: [],
    });

    // An abandoned drill is not a result, and posting it would count exposures
    // the learner never had.
    expect(recorded).toBeNull();
    expect(backend.callsTo("record-grammar-outcome")).toEqual([]);
  });

  it("refreshes the grid behind the results screen", async () => {
    const { result, backend } = render((b) =>
      b.stubFunction("record-grammar-outcome", { recorded: 1 }),
    );
    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));
    const readsBefore = backend.db.reads.filter(
      (read) => read.table === "user_concept_mastery",
    ).length;

    await result.current.record.mutateAsync({
      category: "negation",
      dialect: "Gulf",
      outcomes: [true],
    });

    // Nothing else moves the category from "learning" to "familiar" on screen
    // while the learner is still looking at it.
    await waitFor(() =>
      expect(
        backend.db.reads.filter((read) => read.table === "user_concept_mastery").length,
      ).toBeGreaterThan(readsBefore),
    );
  });

  it("does not put a failed write in front of the learner", async () => {
    const { result } = render((b) => b.stubFunctionFailure("record-grammar-outcome", 500));
    await waitFor(() => expect(result.current.mastery.isSuccess).toBe(true));

    await expect(
      result.current.record.mutateAsync({
        category: "negation",
        dialect: "Gulf",
        outcomes: [true],
      }),
    ).rejects.toBeTruthy();

    // The rejection is for the caller; the hook's own onError only logs. The
    // learner has already seen their score, and a lost statistic is not worth
    // an error dialog over a drill they completed.
    await waitFor(() => expect(result.current.record.isError).toBe(true));
  });
});
