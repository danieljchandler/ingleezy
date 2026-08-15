import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The learner's own mistakes.
 *
 * `learner_errors` collects every pronunciation miss, shadowing gap and
 * set-phrase mismatch, and has always fed the content generators. This page is
 * the first time the person who made them gets to see them.
 *
 * The rows are per-attempt and the page is per-*target*: five failed goes at
 * the same word are one entry saying you missed it five times, not five
 * entries. That grouping is the whole design — an ungrouped list would be
 * dominated by whatever was practised most recently — so the tests are mostly
 * about it, and about the dismissal that has to clear every row behind an
 * entry rather than just the one that named it.
 */

const errorId = (n: number) => `eeeeeeee-3333-4000-8000-00000000000${n}`;

const anError = (n: number, over: Record<string, unknown> = {}) => ({
  id: errorId(n),
  user_id: TEST_USER_ID,
  dialect: "Gulf",
  source: "pronunciation",
  error_kind: "mispronunciation",
  target_text: "مرحبا",
  produced_text: "مرهبا",
  detail: {},
  word_id: null,
  user_vocabulary_id: null,
  resolved_at: null,
  created_at: new Date(Date.now() - n * 3_600_000).toISOString(),
  ...over,
});

function seedMistakes(db: MemoryDb, rows: Array<Record<string, unknown>>) {
  db.seed("learner_errors", rows);
}

test.describe("reaching the page", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/mistakes");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("lets a learner in", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedMistakes(db, []);

    await page.goto("/mistakes");

    await expect(page.getByRole("heading", { name: "أخطاؤك" })).toBeVisible();
  });
});

test.describe("the list", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows what the learner was aiming for", async ({ page, db }) => {
    seedMistakes(db, [anError(1)]);

    await page.goto("/mistakes");

    // The target, not the attempt. The point of the page is knowing what to go
    // and practise, and the wrong version is not the thing to memorise.
    await expect(page.getByText("مرحبا")).toBeVisible();
  });

  test("collapses repeated attempts at the same target into one entry", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "مرحبا" }),
      anError(3, { target_text: "مرحبا" }),
    ]);

    await page.goto("/mistakes");

    // Ungrouped, whatever was practised most recently would fill the page and
    // bury everything else.
    await expect(page.getByText("مرحبا")).toHaveCount(1);
  });

  test("says how often a target was missed", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "مرحبا" }),
      anError(3, { target_text: "مرحبا" }),
    ]);

    await page.goto("/mistakes");

    await expect(page.getByText(/3/).first()).toBeVisible();
  });

  test("keeps different targets apart", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "شكرا" }),
    ]);

    await page.goto("/mistakes");

    await expect(page.getByText("مرحبا")).toBeVisible();
    await expect(page.getByText("شكرا")).toBeVisible();
  });

  test("shows only the active dialect's mistakes", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا", dialect: "Gulf" }),
      anError(2, { target_text: "إزيك", dialect: "Egyptian" }),
    ]);

    await page.goto("/mistakes");

    // A pronunciation miss is dialect-specific by construction — the same word
    // is not said the same way, so an Egyptian miss is not a Gulf one.
    await expect(page.getByText("مرحبا")).toBeVisible();
    await expect(page.getByText("إزيك")).toHaveCount(0);
  });

  test("leaves out anything already dismissed", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "شكرا", resolved_at: new Date().toISOString() }),
    ]);

    await page.goto("/mistakes");

    await expect(page.getByText("مرحبا")).toBeVisible();
    await expect(page.getByText("شكرا")).toHaveCount(0);
  });

  test("congratulates a learner with nothing outstanding", async ({ page, db }) => {
    seedMistakes(db, []);

    await page.goto("/mistakes");

    // An empty list here is good news, and the copy says where entries come
    // from so it does not read as a broken page.
    await expect(page.getByText("لا شيء عالق.")).toBeVisible();
    await expect(page.getByText(/النطق والمحاكاة/)).toBeVisible();
  });

  test("shows nothing belonging to another learner", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, {
        target_text: "شكرا",
        user_id: "00000000-0000-4000-8000-0000000000ff",
      }),
    ]);

    await page.goto("/mistakes");

    await expect(page.getByText("مرحبا")).toBeVisible();
    await expect(page.getByText("شكرا")).toHaveCount(0);
  });
});

test.describe("hearing it said correctly", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedMistakes(db, [anError(1)]);
  });

  test("synthesises nothing until asked", async ({ page, backend }) => {
    await page.goto("/mistakes");
    await expect(page.getByText("مرحبا")).toBeVisible();

    // One TTS request per entry on open would mean a page of twenty mistakes
    // costing twenty syntheses to look at.
    expect(backend.callsTo("munsit-tts")).toHaveLength(0);
    expect(backend.callsTo("azure-tts")).toHaveLength(0);
  });

  test("routes a Gulf target to the Gulf voice", async ({ page, backend }) => {
    backend.stubFunction("munsit-tts", { audioContent: "" });

    await page.goto("/mistakes");
    await page.getByRole("button", { name: "اسمعها منطوقة صحيحاً" }).click();

    // `useAzureTTS` is named for its fallback, not its default: Gulf goes to
    // munsit-tts and everything else to azure-tts. Sending a Gulf mistake to
    // the Azure voice would play the learner a correction in the wrong accent,
    // on a page whose entire purpose is hearing it said right.
    await expect.poll(() => backend.callsTo("munsit-tts").length).toBeGreaterThan(0);
    expect(backend.lastCallTo("munsit-tts")?.body).toMatchObject({ text: "مرحبا" });
    expect(backend.callsTo("azure-tts")).toHaveLength(0);
  });
});

test.describe("dismissing a mistake", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("resolves every attempt behind the entry", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "مرحبا" }),
      anError(3, { target_text: "مرحبا" }),
    ]);

    await page.goto("/mistakes");
    await page.getByRole("button", { name: "أتقنتها الآن" }).click();

    // The entry is a group, so dismissing it has to clear all three rows —
    // resolving only the one that named the group would leave the entry on the
    // page with a smaller count, which reads as the button not working.
    await expect
      .poll(() => db.rows("learner_errors").filter((r) => r.resolved_at === null).length)
      .toBe(0);
  });

  test("leaves other targets alone", async ({ page, db }) => {
    seedMistakes(db, [
      anError(1, { target_text: "مرحبا" }),
      anError(2, { target_text: "شكرا" }),
    ]);

    await page.goto("/mistakes");
    await page
      .locator("div.rounded-xl")
      .filter({ hasText: "مرحبا" })
      .getByRole("button", { name: "أتقنتها الآن" })
      .click();

    await expect(page.getByText("مرحبا")).toHaveCount(0);
    await expect(page.getByText("شكرا")).toBeVisible();
  });

  test("empties the page when the last one is dismissed", async ({ page, db }) => {
    seedMistakes(db, [anError(1)]);

    await page.goto("/mistakes");
    await page.getByRole("button", { name: "أتقنتها الآن" }).click();

    // The list refetches rather than filtering in place, so the empty state is
    // the same one a learner with a clean slate sees.
    await expect(page.getByText("لا شيء عالق.")).toBeVisible();
  });

  test("keeps the entry when the update fails", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    seedMistakes(db, [anError(1)]);
    db.failWrites("learner_errors", 500);

    await page.goto("/mistakes");
    await page.getByRole("button", { name: "أتقنتها الآن" }).click();

    // Nothing was resolved, so the entry has to stay — a learner told their
    // mistake was cleared when it was not will simply never see it again.
    await expect(page.getByText("مرحبا")).toBeVisible();
    expect(db.rows("learner_errors").filter((r) => r.resolved_at === null)).toHaveLength(1);
  });
});
