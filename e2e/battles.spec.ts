import { expect, test } from "./support/fixtures";
import {
  aVocabBattle,
  battleId as makeBattleId,
  TEST_USER_ID,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Vocab battles: an asynchronous duel between two learners.
 *
 * Turn order is not in `status` — it is inferred from which score columns are
 * null. A pending battle with no challenger score is the challenger's turn; one
 * with a challenger score is the opponent's. Getting that inference wrong
 * either offers a battle that cannot be played or hides one that can, and both
 * look identical from the list.
 *
 * The opponent's submission is also what completes the battle and decides the
 * winner, so it is the one write that has to be right: higher score, then
 * faster time, then a draw.
 */

const BATTLE = makeBattleId(0);
const OPPONENT = "dddddddd-0000-4000-8000-000000000001";

const battleRows = (page: Page) => page.locator("div.max-w-lg button.rounded-xl");

/** Wait for a write to land, then return its payload. */
async function writtenTo(db: MemoryDb, table: string): Promise<Record<string, unknown>[]> {
  await expect.poll(() => db.writesTo(table).length).toBeGreaterThan(0);
  return db.lastWriteTo(table)!.payload as Record<string, unknown>[];
}

/** Answer both questions correctly and wait for the score to be submitted. */
async function playThrough(page: Page, correct = true) {
  await page.getByRole("button", { name: /ابدأ المعركة/ }).click();
  await page.getByRole("button", { name: correct ? "door" : "chair" }).click();
  await expect(page.getByRole("button", { name: "book" })).toBeVisible();
  await page.getByRole("button", { name: correct ? "book" : "chair" }).click();
}

test.beforeEach(async ({ signInAs, db }) => {
  await signInAs("free");
  db.seed("vocab_battles", []);
});

test.describe("the battle list", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/battles");

    // A duel needs two identified players. `ProtectedRoute` redirects before
    // the page renders, so its own signed-out branch — a "Sign In" button and
    // a line of copy — is unreachable in the app as routed. The redirect is
    // the behaviour that ships.
    await expect(page).toHaveURL(/\/auth/);
  });

  test("points an empty list at the friends page", async ({ page }) => {
    await page.goto("/battles");

    await expect(page.getByRole("heading", { name: /معارك المفردات/ })).toBeVisible();
    await expect(page.getByText("لا معارك بعد")).toBeVisible();
    await expect(page.getByRole("button", { name: /ابحث عن أصدقاء للمنافسة/ })).toBeVisible();
  });

  test("offers a way to start one", async ({ page, db }) => {
    db.seed("vocab_battles", [aVocabBattle({ id: BATTLE })]);

    await page.goto("/battles");

    await expect(page.getByRole("button", { name: /تحدَّ صديقاً/ })).toBeVisible();
  });

  test("shows a battle this learner started", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("تحديت")).toBeVisible();
    await expect(page.getByText("العب دورك")).toBeVisible();
  });

  test("shows a battle someone started against this learner", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: BATTLE,
        challenger_id: OPPONENT,
        opponent_id: TEST_USER_ID,
        challenger_score: 2,
        challenger_time_ms: 20_000,
      }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("تحداك")).toBeVisible();
    await expect(page.getByText("دورك للعب!")).toBeVisible();
  });

  test("calls out the challenges waiting on this learner", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: makeBattleId(0),
        challenger_id: OPPONENT,
        opponent_id: TEST_USER_ID,
        challenger_score: 2,
      }),
      aVocabBattle({
        id: makeBattleId(1),
        challenger_id: OPPONENT,
        opponent_id: TEST_USER_ID,
        challenger_score: 1,
      }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("🔥 2 battles waiting for you!")).toBeVisible();
  });

  test("says so once the challenger has played and is waiting", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: BATTLE,
        challenger_id: TEST_USER_ID,
        opponent_id: OPPONENT,
        challenger_score: 2,
        challenger_time_ms: 15_000,
      }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("بانتظار الخصم")).toBeVisible();
    // Nothing to do here — the row must not look tappable.
    await expect(battleRows(page).first()).toBeDisabled();
  });

  test("reports a win, a loss and a draw", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: makeBattleId(0),
        status: "completed",
        winner_id: TEST_USER_ID,
        challenger_score: 2,
        opponent_score: 1,
      }),
      aVocabBattle({
        id: makeBattleId(1),
        status: "completed",
        winner_id: OPPONENT,
        challenger_score: 0,
        opponent_score: 2,
      }),
      aVocabBattle({
        id: makeBattleId(2),
        status: "completed",
        winner_id: null,
        challenger_score: 1,
        opponent_score: 1,
      }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("فزت! 🎉")).toBeVisible();
    await expect(page.getByText("خسرت")).toBeVisible();
    await expect(page.getByText("تعادل")).toBeVisible();
  });

  test("shows both scores against the question count", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: BATTLE,
        status: "completed",
        winner_id: TEST_USER_ID,
        challenger_score: 2,
        opponent_score: 1,
        question_count: 2,
      }),
    ]);

    await page.goto("/battles");

    await expect(page.getByText("أنت: 2/2")).toBeVisible();
    await expect(page.getByText("الخصم: 1/2")).toBeVisible();
  });

  test("puts the challenges awaiting a reply first", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: makeBattleId(0),
        challenger_id: TEST_USER_ID,
        opponent_id: OPPONENT,
        status: "completed",
        winner_id: TEST_USER_ID,
      }),
      aVocabBattle({
        id: makeBattleId(1),
        challenger_id: OPPONENT,
        opponent_id: TEST_USER_ID,
        challenger_score: 2,
      }),
    ]);

    await page.goto("/battles");

    // The one thing on this page that needs doing goes at the top, regardless
    // of when it arrived.
    await expect(battleRows(page).first()).toContainText("دورك للعب!");
  });

  test("opens a playable battle and leaves a finished one alone", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: BATTLE,
        challenger_id: OPPONENT,
        opponent_id: TEST_USER_ID,
        challenger_score: 2,
      }),
    ]);

    await page.goto("/battles");
    await battleRows(page).first().click();

    await expect(page).toHaveURL(new RegExp(`/battles/${BATTLE}$`));
  });

  test("will not open a completed battle", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, status: "completed", winner_id: TEST_USER_ID }),
    ]);

    await page.goto("/battles");

    await expect(battleRows(page).first()).toBeDisabled();
  });
});

test.describe("playing a battle", () => {
  test("offers a start screen before the timer runs", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto(`/battles/${BATTLE}`);

    // The clock is the whole game; starting it on page load would cost a
    // learner their turn to a slow connection.
    await expect(page.getByRole("heading", { name: "معركة مفردات" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ابدأ المعركة/ })).toBeVisible();
  });

  test("says so when the battle does not exist", async ({ page }) => {
    await page.goto(`/battles/${makeBattleId(9)}`);

    await expect(page.getByRole("button", { name: /العودة إلى المعارك/ })).toBeVisible();
  });

  test("refuses a turn that has already been taken", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({
        id: BATTLE,
        challenger_id: TEST_USER_ID,
        opponent_id: OPPONENT,
        challenger_score: 2,
        challenger_played_at: new Date().toISOString(),
      }),
    ]);

    await page.goto(`/battles/${BATTLE}`);

    // Replaying would let a learner improve their score after seeing it.
    await expect(page.getByRole("heading", { name: "لعبت هذه المعركة" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ابدأ المعركة/ })).toHaveCount(0);
  });

  test("asks one word at a time with its choices", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto(`/battles/${BATTLE}`);
    await page.getByRole("button", { name: /ابدأ المعركة/ }).click();

    await expect(page.getByText("باب")).toBeVisible();
    await expect(page.getByRole("button", { name: "door" })).toBeVisible();
    await expect(page.getByText("1/2")).toBeVisible();
  });

  test("records the challenger's score and time", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    const written = (await writtenTo(db, "vocab_battles"))[0];
    expect(written.challenger_score).toBe(2);
    expect(written.challenger_played_at).toBeTruthy();
    // Time is the tiebreak, so it has to be stored even on a clean sweep.
    expect(typeof written.challenger_time_ms).toBe("number");
  });

  test("leaves the battle pending after the challenger's turn", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    // Half a duel is not a result — the status only moves when both have
    // played.
    const written = (await writtenTo(db, "vocab_battles"))[0];
    expect(written.status).toBeUndefined();
    expect(written.winner_id).toBeUndefined();
  });

  test("scores only the answers that were right", async ({ page, db }) => {
    db.seed("vocab_battles", [
      aVocabBattle({ id: BATTLE, challenger_id: TEST_USER_ID, opponent_id: OPPONENT }),
    ]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page, false);

    expect((await writtenTo(db, "vocab_battles"))[0].challenger_score).toBe(0);
  });
});

test.describe("finishing a battle", () => {
  const asOpponent = (over: Record<string, unknown> = {}) =>
    aVocabBattle({
      id: BATTLE,
      challenger_id: OPPONENT,
      opponent_id: TEST_USER_ID,
      challenger_score: 1,
      challenger_time_ms: 20_000,
      challenger_played_at: new Date().toISOString(),
      ...over,
    });

  test("completes the battle and names the winner", async ({ page, db }) => {
    db.seed("vocab_battles", [asOpponent()]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    const written = (await writtenTo(db, "vocab_battles"))[0];
    expect(written.opponent_score).toBe(2);
    expect(written.status).toBe("completed");
    expect(written.winner_id).toBe(TEST_USER_ID);
    expect(written.completed_at).toBeTruthy();
  });

  test("gives it to the challenger when they scored higher", async ({ page, db }) => {
    db.seed("vocab_battles", [asOpponent({ challenger_score: 2 })]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page, false);

    const written = (await writtenTo(db, "vocab_battles"))[0];
    expect(written.opponent_score).toBe(0);
    expect(written.winner_id).toBe(OPPONENT);
  });

  test("breaks a tied score on time", async ({ page, db }) => {
    // The challenger took twenty seconds; a live playthrough takes well under
    // that, so the tie goes to this learner.
    db.seed("vocab_battles", [asOpponent({ challenger_score: 2, challenger_time_ms: 20_000 })]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    const written = (await writtenTo(db, "vocab_battles"))[0];
    expect(written.opponent_score).toBe(2);
    expect(written.winner_id).toBe(TEST_USER_ID);
  });

  test("treats a missing challenger time as unbeatable rather than instant", async ({ page, db }) => {
    // A null time becomes Infinity, so any real time beats it. The other
    // reading — treating null as zero — would hand every tie to a challenger
    // whose time was never recorded.
    db.seed("vocab_battles", [asOpponent({ challenger_score: 2, challenger_time_ms: null })]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    expect((await writtenTo(db, "vocab_battles"))[0].winner_id).toBe(TEST_USER_ID);
  });

  test("shows the learner how it went", async ({ page, db }) => {
    db.seed("vocab_battles", [asOpponent()]);

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    // The settled outcome, not the moment before it. Two things on this screen
    // are transient: the toast, and the heading itself — which reads "Score
    // Submitted!" until the battle refetches as completed and then flips to the
    // result. Asserting either one races the refetch, and `getByText("Score
    // submitted!")` matched the toast and the heading at once besides, since
    // that matcher is case-insensitive.
    await expect(page.getByRole("heading", { name: /فزت!|تعادل!|محاولة طيبة!/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "كل المعارك" })).toBeVisible();
    await expect(page.getByRole("button", { name: "تحدٍّ جديد" })).toBeVisible();
  });

  test("says so when the score cannot be submitted", async ({ page, db }) => {
    db.seed("vocab_battles", [asOpponent()]);
    db.failWrites("vocab_battles", 403, { message: "new row violates row-level security policy" });

    await page.goto(`/battles/${BATTLE}`);
    await playThrough(page);

    // Pinned. The turn is unrecoverable: the questions have been seen and the
    // page offers no retry, so a failed submit costs the learner the battle
    // with nothing but a toast to say why.
    await expect(page.getByText(/row-level security/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Try Again|Retry/ })).toHaveCount(0);
  });
});
