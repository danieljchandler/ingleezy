import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aVocabBattle,
  aVocabularyWord,
  battleId,
  daysAgo,
  TEST_USER_ID,
  wordId,
} from "@/test/support/factories";
import {
  useBattle,
  useCreateBattle,
  useDeclineBattle,
  useMyBattles,
  usePendingBattles,
  useSubmitChallengerScore,
  useSubmitOpponentScore,
} from "./useVocabBattles";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Asynchronous vocabulary duels between two learners.
 *
 * Both play the same ten questions, whenever they happen to open the app, and
 * the higher score wins with a tie broken by time. That asymmetry — the
 * challenger plays immediately, the opponent hours later — is the whole design:
 * a synchronous game between two people learning Arabic in different time zones
 * would never start.
 *
 * It also means the result is computed on the second player's device, from the
 * first player's stored score. Everything about who won lives in this file.
 */

const OPPONENT = "00000000-0000-4000-8000-0000000000ff";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render<T>(hook: () => T, seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(hook, { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Mount a mutation with a signed-in-only query beside it, and wait for that
 * query.
 *
 * `useAuth` has no user on the first render and these mutations throw
 * "Not authenticated" if called then, so the query settling is the signal that
 * the session has landed.
 */
async function renderWithSession<T>(
  hook: () => T,
  seed: (backend: SupabaseBackend) => void = () => {},
) {
  const harness = renderHookWithProviders(
    () => ({ battles: useMyBattles(), subject: hook() }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  await waitFor(() => expect(harness.result.current.battles.isSuccess).toBe(true));
  return harness;
}

const seedBattles = (rows: Record<string, unknown>[]) => (backend: SupabaseBackend) =>
  backend.db.seed("vocab_battles", rows);

describe("the learner's battles", () => {
  it("includes the ones they started and the ones they were challenged to", async () => {
    const { result } = render(
      () => useMyBattles(),
      seedBattles([
        aVocabBattle({ id: battleId(0), challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
        aVocabBattle({ id: battleId(1), challenger_id: OPPONENT, opponent_id: TEST_USER_ID }),
        aVocabBattle({ id: battleId(2), challenger_id: OPPONENT, opponent_id: "someone-else" }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // One list for both sides: a learner thinks of these as "my games", not as
    // two separate inboxes.
    expect(result.current.data?.map((battle) => battle.id).sort()).toEqual([
      battleId(0),
      battleId(1),
    ]);
  });

  it("puts the most recent first", async () => {
    const { result } = render(
      () => useMyBattles(),
      seedBattles([
        aVocabBattle({ id: battleId(0), created_at: daysAgo(10) }),
        aVocabBattle({ id: battleId(1), created_at: daysAgo(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((battle) => battle.id)).toEqual([battleId(1), battleId(0)]);
  });

  it("gives a battle with no questions an empty list rather than nothing", async () => {
    const { result } = render(
      () => useMyBattles(),
      seedBattles([aVocabBattle({ questions: null })]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The play screen maps over the questions; null would throw on a row whose
    // generation half-failed.
    expect(result.current.data?.[0].questions).toEqual([]);
  });

  it("does not query for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useMyBattles(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.fetchStatus).toBe("idle"));
  });
});

describe("the challenges waiting for them", () => {
  it("lists only the ones they have been challenged to and not yet played", async () => {
    const { result } = render(
      () => usePendingBattles(),
      seedBattles([
        aVocabBattle({
          id: battleId(0),
          challenger_id: OPPONENT,
          opponent_id: TEST_USER_ID,
          status: "pending",
        }),
        aVocabBattle({
          id: battleId(1),
          challenger_id: OPPONENT,
          opponent_id: TEST_USER_ID,
          status: "completed",
        }),
        aVocabBattle({
          id: battleId(2),
          challenger_id: TEST_USER_ID,
          opponent_id: OPPONENT,
          status: "pending",
        }),
      ]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // This is the badge on the nav. A challenge the learner issued is not
    // something they can act on, and a finished one is not waiting.
    expect(result.current.data?.map((battle) => battle.id)).toEqual([battleId(0)]);
  });
});

describe("one battle", () => {
  it("returns it by id", async () => {
    const { result } = render(
      () => useBattle(battleId(0)),
      seedBattles([aVocabBattle({ id: battleId(0) })]),
    );

    await waitFor(() => expect(result.current.data?.id).toBe(battleId(0)));
    expect(result.current.data?.questions).toHaveLength(2);
  });

  it("reports an id that names nothing", async () => {
    const { result } = render(() => useBattle(battleId(9)), seedBattles([]));

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not query without an id", async () => {
    const { result } = render(() => useBattle(undefined));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
  });
});

describe("issuing a challenge", () => {
  const seedVocabulary = (count: number) => (backend: SupabaseBackend) =>
    backend.db.seed(
      "vocabulary_words",
      Array.from({ length: count }, (_, index) =>
        aVocabularyWord({
          id: wordId(index),
          word_arabic: `كلمة${index}`,
          word_english: `word ${index}`,
        }),
      ),
    );

  it("builds a quiz both players will answer", async () => {
    const { result, backend } = await renderWithSession(() => useCreateBattle(), seedVocabulary(20));

    await result.current.subject.mutateAsync({ opponentId: OPPONENT, questionCount: 5 });

    const row = backend.db.lastWriteTo("vocab_battles")!.payload[0] as Record<string, unknown>;
    const questions = row.questions as Array<{ choices: string[]; correct_index: number }>;
    expect(questions).toHaveLength(5);
    // Four choices with exactly one right answer, and the index has to point at
    // it — the play screen scores against the index, so an off-by-one would
    // mark every correct answer wrong.
    for (const question of questions) {
      expect(question.choices).toHaveLength(4);
      expect(question.choices[question.correct_index]).toBe(
        (question as unknown as { word_english: string }).word_english,
      );
    }
  });

  it("never offers the right answer twice", async () => {
    const { result, backend } = await renderWithSession(() => useCreateBattle(), seedVocabulary(20));

    await result.current.subject.mutateAsync({ opponentId: OPPONENT, questionCount: 5 });

    const row = backend.db.lastWriteTo("vocab_battles")!.payload[0] as Record<string, unknown>;
    for (const question of row.questions as Array<{ choices: string[] }>) {
      // Two identical options make the question unanswerable and the score a
      // coin flip.
      expect(new Set(question.choices).size).toBe(4);
    }
  });

  it("defaults to ten questions in a minute", async () => {
    const { result, backend } = await renderWithSession(() => useCreateBattle(), seedVocabulary(20));

    await result.current.subject.mutateAsync({ opponentId: OPPONENT });

    expect(backend.db.lastWriteTo("vocab_battles")?.payload[0]).toMatchObject({
      question_count: 10,
      time_limit_seconds: 60,
      status: "pending",
      challenger_id: TEST_USER_ID,
      opponent_id: OPPONENT,
    });
  });

  it("refuses when there is not enough vocabulary to build a quiz", async () => {
    const { result } = await renderWithSession(() => useCreateBattle(), seedVocabulary(3));

    // Better to say so than to issue a challenge with three questions that both
    // players will find trivially easy.
    await expect(
      result.current.subject.mutateAsync({ opponentId: OPPONENT, questionCount: 10 }),
    ).rejects.toThrow("Not enough vocabulary words available");
  });

  it("draws from every dialect at once", async () => {
    const { result, backend } = await renderWithSession(
      () => useCreateBattle(),
      (b) =>
        b.db.seed(
          "vocabulary_words",
          Array.from({ length: 20 }, (_, index) =>
            aVocabularyWord({
              id: wordId(index),
              word_arabic: `كلمة${index}`,
              word_english: `word ${index}`,
              dialect_module: index % 2 === 0 ? "Gulf" : "Egyptian",
            }),
          ),
        ),
    );

    await result.current.subject.mutateAsync({ opponentId: OPPONENT, questionCount: 10 });

    // Pinned. The question pool is the first hundred rows of
    // `vocabulary_words` with no dialect filter, so a Gulf learner is quizzed
    // on Egyptian words and vice versa — and the wrong answers are drawn from
    // the same undifferentiated pool. Neither player has met half the deck,
    // which turns a vocabulary duel into a guessing game.
    const reads = backend.db.reads.filter((read) => read.table === "vocabulary_words");
    expect(decodeURIComponent(reads[0].search)).not.toContain("dialect_module");
  });

  it("refuses for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useCreateBattle(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await act(async () => {
      await expect(
        harness.result.current.mutateAsync({ opponentId: OPPONENT }),
      ).rejects.toThrow("Not authenticated");
    });
  });
});

describe("the challenger's turn", () => {
  it("records their score and time", async () => {
    const { result, backend } = await renderWithSession(
      () => useSubmitChallengerScore(),
      seedBattles([
        aVocabBattle({ id: battleId(0), challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
      ]),
    );

    await result.current.subject.mutateAsync({ battleId: battleId(0), score: 8, timeMs: 21_000 });

    const row = backend.db.rows("vocab_battles")[0];
    expect(row).toMatchObject({ challenger_score: 8, challenger_time_ms: 21_000 });
    // The timestamp is what the opponent's screen reads to say "played 2 hours
    // ago" — the asymmetry is the product, so it has to be visible.
    expect(typeof row.challenger_played_at).toBe("string");
  });

  it("can only write to a battle they started", async () => {
    const { result } = await renderWithSession(
      () => useSubmitChallengerScore(),
      seedBattles([
        aVocabBattle({ id: battleId(0), challenger_id: OPPONENT, opponent_id: TEST_USER_ID }),
      ]),
    );

    // The update is filtered on challenger_id as well as the battle id, so
    // posting a challenger score to somebody else's game matches no row.
    await expect(
      result.current.subject.mutateAsync({ battleId: battleId(0), score: 10, timeMs: 1000 }),
    ).rejects.toBeTruthy();
  });
});

describe("deciding the winner", () => {
  const playedBattle = (over: Record<string, unknown> = {}) =>
    aVocabBattle({
      id: battleId(0),
      challenger_id: OPPONENT,
      opponent_id: TEST_USER_ID,
      challenger_score: 7,
      challenger_time_ms: 30_000,
      challenger_played_at: daysAgo(1),
      status: "pending",
      ...over,
    });

  const play = async (score: number, timeMs: number, battle = playedBattle()) => {
    const { result, backend } = await renderWithSession(
      () => useSubmitOpponentScore(),
      seedBattles([battle]),
    );
    await result.current.subject.mutateAsync({ battleId: battleId(0), score, timeMs });
    return backend.db.rows("vocab_battles")[0];
  };

  it("gives it to the higher score", async () => {
    expect(await play(9, 59_000)).toMatchObject({ winner_id: TEST_USER_ID });
  });

  it("gives it to the challenger when they scored higher", async () => {
    // Even though the opponent was far quicker — accuracy outranks speed, or
    // the game rewards guessing fast over knowing the words.
    expect(await play(5, 1_000)).toMatchObject({ winner_id: OPPONENT });
  });

  it("breaks a tie on time", async () => {
    expect(await play(7, 20_000)).toMatchObject({ winner_id: TEST_USER_ID });
    expect(await play(7, 40_000)).toMatchObject({ winner_id: OPPONENT });
  });

  it("calls an exact tie a draw", async () => {
    const row = await play(7, 30_000);

    // Pinned. A draw is stored as `winner_id: null`, which is also the value a
    // battle carries before anyone has won. Only `status` tells them apart, so
    // anything reading `winner_id` alone shows a completed draw as still in
    // progress.
    expect(row).toMatchObject({ winner_id: null, status: "completed" });
  });

  it("counts an unplayed challenger as a zero", async () => {
    const row = await play(
      3,
      10_000,
      playedBattle({ challenger_score: null, challenger_time_ms: null }),
    );

    // A challenger who issued a battle and never played it forfeits, which is
    // the right outcome — the alternative is a game that never resolves.
    expect(row).toMatchObject({ winner_id: TEST_USER_ID });
  });

  it("marks the battle finished and stamps the time", async () => {
    const row = await play(9, 20_000);

    expect(row.status).toBe("completed");
    expect(typeof row.completed_at).toBe("string");
    expect(typeof row.opponent_played_at).toBe("string");
  });

  it("records the opponent's own score and time", async () => {
    expect(await play(9, 20_000)).toMatchObject({
      opponent_score: 9,
      opponent_time_ms: 20_000,
    });
  });

  it("refuses a battle that does not exist", async () => {
    const { result } = await renderWithSession(() => useSubmitOpponentScore(), seedBattles([]));

    await expect(
      result.current.subject.mutateAsync({ battleId: battleId(9), score: 5, timeMs: 1000 }),
    ).rejects.toThrow("Battle not found");
  });

  it("can only write to a battle they were challenged to", async () => {
    const { result } = await renderWithSession(
      () => useSubmitOpponentScore(),
      seedBattles([
        aVocabBattle({ id: battleId(0), challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
      ]),
    );

    await expect(
      result.current.subject.mutateAsync({ battleId: battleId(0), score: 5, timeMs: 1000 }),
    ).rejects.toBeTruthy();
  });
});

describe("turning a challenge down", () => {
  it("removes the battle", async () => {
    const harness = renderHookWithProviders(
      () => ({ battles: useMyBattles(), decline: useDeclineBattle() }),
      {
        persona: "free",
        seed: seedBattles([
          aVocabBattle({ id: battleId(0), challenger_id: OPPONENT, opponent_id: TEST_USER_ID }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.battles.data).toHaveLength(1));

    await harness.result.current.decline.mutateAsync(battleId(0));

    // Deleted rather than marked declined: an unplayed challenge carries no
    // history worth keeping, and leaving it would clutter both learners' lists.
    await waitFor(() => expect(harness.result.current.battles.data).toEqual([]));
  });

  it("reports a rejected decline", async () => {
    const { result } = render(() => useDeclineBattle(), (backend) => {
      backend.db.seed("vocab_battles", [aVocabBattle({ id: battleId(0) })]);
      backend.db.failWrites("vocab_battles", 403, { message: "denied" });
    });

    await expect(result.current.mutateAsync(battleId(0))).rejects.toBeTruthy();
  });
});
