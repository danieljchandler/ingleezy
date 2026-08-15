import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The English Sounds journey — 28 stops, six steps each, unlocked in order.
 * Replaces the old Alphabet Journey (which taught the Arabic alphabet — the
 * wrong direction once the app itself flipped); see src/data/englishSounds.ts.
 *
 * The gate is entirely client-side and entirely derived: `currentIndex()`
 * walks the 28 sounds and stops at the first one with no `mastered_at`, and
 * everything past it is locked. There is no "unlocked" column, so the lock is
 * only ever as good as the progress rows that arrive — a learner with no rows
 * is at stop 1, and a learner whose progress fails to load is too.
 *
 * The other thing worth pinning is that each step marks itself done locally
 * before the write is awaited, and the write's failure is swallowed. That makes
 * the tick and the +5 XP a claim about the request having been *made*, not
 * about anything having been saved — which matters most for the signed-out
 * learner, for whom the write cannot succeed at all.
 */

const aSoundProgress = (
  soundCode: string,
  over: Record<string, unknown> = {},
) => ({
  id: `aaaaaaaa-0000-4000-8000-${soundCode.padEnd(12, "0").slice(0, 12)}`,
  user_id: TEST_USER_ID,
  sound_code: soundCode,
  steps_completed: ["meet", "mouth", "spell", "examples", "spot", "contrast"],
  best_spot_score: 100,
  best_sound_score: 100,
  mastered_at: new Date().toISOString(),
  last_practiced_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

/** The first four sounds, in order. */
const SOUNDS = ["m", "b", "t", "d"];

function seedProgress(db: MemoryDb, rows: Array<Record<string, unknown>> = []) {
  db.seed("user_sound_progress", rows);
  db.seed("user_checkpoint_progress", []);
}

test.describe("the trail", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows all 28 stops", async ({ page, db }) => {
    seedProgress(db);

    await page.goto("/sounds");

    await expect(page.getByRole("heading", { name: /رحلة أصوات الإنجليزية/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^الصوت / })).toHaveCount(28);
  });

  test("unlocks only the first stop for a new learner", async ({ page, db }) => {
    seedProgress(db);

    await page.goto("/sounds");

    await expect(page.getByRole("button", { name: "الصوت m", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "الصوت b (مقفل)" })).toBeDisabled();
  });

  test("unlocks the next stop once the previous is mastered", async ({ page, db }) => {
    seedProgress(db, [aSoundProgress("m")]);

    await page.goto("/sounds");

    await expect(page.getByRole("button", { name: "الصوت b", exact: true })).toBeEnabled();
    // Sequential, not cumulative: mastering one stop moves the frontier by one.
    await expect(page.getByRole("button", { name: "الصوت t (مقفل)" })).toBeDisabled();
  });

  test("counts what has been mastered", async ({ page, db }) => {
    seedProgress(db, [aSoundProgress("m"), aSoundProgress("b")]);

    await page.goto("/sounds");

    await expect(page.getByText("2 / 28")).toBeVisible();
  });

  test("shows how far through a part-finished stop the learner is", async ({ page, db }) => {
    seedProgress(db, [
      aSoundProgress("m", {
        steps_completed: ["meet", "mouth"],
        mastered_at: null,
      }),
    ]);

    await page.goto("/sounds");

    await expect(page.getByText("2/6")).toBeVisible();
  });

  test("does not count a part-finished stop as mastered", async ({ page, db }) => {
    seedProgress(db, [
      aSoundProgress("m", { steps_completed: ["meet"], mastered_at: null }),
    ]);

    await page.goto("/sounds");

    // `mastered_at` is the gate, not the step count — a learner who did five of
    // six steps has not finished the stop.
    await expect(page.getByText("0 / 28")).toBeVisible();
    await expect(page.getByRole("button", { name: "الصوت b (مقفل)" })).toBeDisabled();
  });

  test("opens a stop that is unlocked", async ({ page, db }) => {
    seedProgress(db);

    await page.goto("/sounds");
    await page.getByRole("button", { name: "الصوت m" }).click();

    await expect(page).toHaveURL(/\/sounds\/m$/);
  });

  test("locks everything but the first stop for a signed-out visitor", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");

    await page.goto("/sounds");

    // The page is unguarded and the progress query is disabled without a user,
    // so a visitor sees the shape of the whole track with one stop open — which
    // is the intended shop window.
    await expect(page.getByRole("button", { name: "الصوت m", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "الصوت b (مقفل)" })).toBeDisabled();
    await expect(page.getByText("0 / 28")).toBeVisible();
  });

  test("relocks the whole trail when progress cannot be read", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedProgress(db, SOUNDS.map((code) => aSoundProgress(code)));
    db.failAlways("user_sound_progress", 500);

    await page.goto("/sounds");

    // The lock is derived rather than stored, so a failed read is
    // indistinguishable from having made no progress: a learner four stops in
    // is put back at stop 1 with nothing to say why. Recorded as the cost of
    // deriving the gate client-side, not as an argument against it.
    await expect(page.getByText("0 / 28")).toBeVisible();
    await expect(page.getByRole("button", { name: "الصوت b (مقفل)" })).toBeDisabled();
  });
});

test.describe("a stop's mini-lesson", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedProgress(db);
  });

  test("opens on the first step of six", async ({ page }) => {
    await page.goto("/sounds/m");

    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();
    await expect(page.getByRole("button", { name: "الخطوة 1: تعرّف على الصوت" })).toBeVisible();
  });

  test("advances a step at a time", async ({ page }) => {
    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();

    await page.getByRole("button", { name: "تخطّي" }).click();

    await expect(page.getByText("الخطوة 2 من 6")).toBeVisible();
  });

  test("will not step back past the first", async ({ page }) => {
    await page.goto("/sounds/m");

    await expect(page.getByRole("button", { name: "رجوع" })).toBeDisabled();
  });

  test("will not step forward past the last", async ({ page }) => {
    await page.goto("/sounds/m");
    await page.getByRole("button", { name: "الخطوة 6: ميّز بينهما" }).click();

    await expect(page.getByText("الخطوة 6 من 6")).toBeVisible();
    await expect(page.getByRole("button", { name: "تخطّي" })).toBeDisabled();
  });

  test("jumps straight to a step from the dots", async ({ page }) => {
    await page.goto("/sounds/m");

    await page.getByRole("button", { name: "الخطوة 4: كلمات عليه" }).click();

    await expect(page.getByText("الخطوة 4 من 6")).toBeVisible();
  });

  test("records a completed step against the sound", async ({ page, db }) => {
    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();

    await page.getByRole("button", { name: "سمعته" }).click();

    await expect.poll(() => db.rows("user_sound_progress").length).toBe(1);
    expect(db.rows("user_sound_progress")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      sound_code: "m",
      steps_completed: ["meet"],
      mastered_at: null,
    });
  });

  test("keeps steps in their canonical order however they were done", async ({ page, db }) => {
    seedProgress(db, [
      aSoundProgress("m", { steps_completed: ["spot", "contrast"], mastered_at: null }),
    ]);

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();
    await page.getByRole("button", { name: "سمعته" }).click();

    // The merge rebuilds the list by filtering SOUND_STEPS, so the stored
    // order is the lesson's order rather than the order the learner happened
    // to finish things in. That is what makes "2/6" mean the same thing on
    // every row.
    await expect
      .poll(() => db.rows("user_sound_progress")[0].steps_completed)
      .toEqual(["meet", "spot", "contrast"]);
  });

  test("masters the sound on the sixth step", async ({ page, db }) => {
    seedProgress(db, [
      aSoundProgress("m", {
        steps_completed: ["mouth", "spell", "examples", "spot", "contrast"],
        mastered_at: null,
      }),
    ]);

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();

    await page.getByRole("button", { name: "سمعته" }).click();

    await expect
      .poll(() => db.rows("user_sound_progress")[0].mastered_at)
      .not.toBeNull();
  });

  test("keeps the original mastery date on a repeat visit", async ({ page, db }) => {
    const firstTime = "2026-01-01T00:00:00.000Z";
    seedProgress(db, [
      aSoundProgress("m", { steps_completed: [], mastered_at: firstTime }),
    ]);

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();
    await page.getByRole("button", { name: "سمعته" }).click();

    // Practising a mastered sound again must not re-date the achievement —
    // `mastered_at` is what the trail counts and what orders the milestones.
    await expect
      .poll(() => db.rows("user_sound_progress")[0].mastered_at)
      .toBe(firstTime);
  });

  test("shows saved progress as already done", async ({ page, db }) => {
    seedProgress(db, [
      aSoundProgress("m", { steps_completed: ["mouth"], mastered_at: null }),
    ]);

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();

    // The dot for step 2 is green while step 1 is the current one, rehydrated
    // from the row rather than from this session — a learner returning to a
    // half-finished stop should see where they got to. (The current step's dot
    // is always primary, so a completed *current* step shows nothing here.)
    await expect(page.locator("button.bg-green-500")).toHaveCount(1);
  });

  test("sends an unknown sound code back to the map", async ({ page }) => {
    await page.goto("/sounds/notasound");

    await expect(page.getByText("الصوت غير موجود.")).toBeVisible();
    await page.getByRole("button", { name: "العودة إلى الخريطة" }).click();
    await expect(page).toHaveURL(/\/sounds$/);
  });
});

test.describe("when the step cannot be saved", () => {
  test("tells a signed-out learner nothing at all", async ({
    page,
    signInAs,
    expectConsoleErrors,
  }) => {
    // The only trace of the failure anywhere: `handleStepDone` catches it into
    // console.error and nothing reaches the screen.
    expectConsoleErrors([/Not signed in/]);
    await signInAs("anonymous");

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();
    await page.getByRole("button", { name: "سمعته" }).click();

    // `completeStep` throws "Not signed in" and `handleStepDone` swallows it
    // into console.error — but the tick and the +5 XP were already applied
    // optimistically. A signed-out learner can walk all six steps of all 28
    // sounds, collect the XP animation every time, and have nothing saved,
    // with no prompt to sign in anywhere on the page.
    await expect(page.getByText("الخطوة 2 من 6")).toBeVisible();
    await expect(page.locator("button.bg-green-500")).toHaveCount(1);
  });

  test("shows the step as done even when the write fails", async ({
    page,
    signInAs,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("free");
    seedProgress(db);
    db.failWrites("user_sound_progress", 500);

    await page.goto("/sounds/m");
    await expect(page.getByText("الخطوة 1 من 6")).toBeVisible();
    await page.getByRole("button", { name: "سمعته" }).click();

    // Same shape with a signed-in learner and a failing write: the tick is a
    // claim about the request having been made, not about anything having been
    // stored. Reloading loses the step silently.
    await expect(page.locator("button.bg-green-500")).toHaveCount(1);
    expect(db.rows("user_sound_progress")).toHaveLength(0);
  });
});
