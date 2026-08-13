import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * The saved-transcriptions library.
 *
 * A read-only shelf in front of the Transcribe tool, with one twist worth
 * testing: the dialect filter runs client-side over rows already fetched, and
 * it treats a *null* dialect as belonging to whatever dialect is active. That
 * is deliberate — transcriptions saved before the column existed have no
 * dialect and would otherwise be invisible from every dialect at once — but it
 * means "showing Gulf" and "showing everything unlabelled" are the same view,
 * and only the toggle tells them apart.
 *
 * Deleting is the only write, and it is the one place in the app where a
 * destructive action names what it will remove before doing it.
 */

const savedId = (n: number) => `dddddddd-3333-4000-8000-00000000000${n}`;

const aTranscription = (n: number, over: Record<string, unknown> = {}) => ({
  id: savedId(n),
  user_id: TEST_USER_ID,
  title: `Recording ${n}`,
  raw_transcript_arabic: `نص رقم ${n}`,
  lines: [{ id: "line-0", arabic: `نص رقم ${n}`, translation: "text", tokens: [] }],
  vocabulary: [{ arabic: "نص", english: "text" }],
  grammar_points: [],
  cultural_context: null,
  audio_url: null,
  dialect: "Gulf",
  engines_used: { asr: ["Deepgram", "Munsit"], translation: ["claude-sonnet-4.5"] },
  created_at: new Date(Date.now() - n * 86_400_000).toISOString(),
  ...over,
});

function seedSaved(db: MemoryDb, rows: Array<Record<string, unknown>>) {
  db.seed("saved_transcriptions", rows);
}

test.describe("reaching the library", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/my-transcriptions");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("loses the return path it tried to carry", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/my-transcriptions");

    // The page has its own `navigate("/auth?redirect=/my-transcriptions")`,
    // which would land the visitor back here after signing in. ProtectedRoute
    // redirects first and plainly, so the parameter never reaches the URL and
    // a visitor who signs in arrives at the home screen instead. Pinned as
    // current behaviour: two redirects for one guard, and the more helpful one
    // never runs.
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("lets a learner in", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedSaved(db, [aTranscription(1)]);

    await page.goto("/my-transcriptions");

    await expect(page.getByRole("heading", { name: "My Transcriptions" })).toBeVisible();
  });
});

test.describe("the shelf", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows a saved transcription with what was extracted from it", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1)]);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("Recording 1")).toBeVisible();
    await expect(page.getByText("نص رقم 1")).toBeVisible();
    // The counts are what make one saved recording distinguishable from
    // another at a glance.
    await expect(page.getByText("1 lines")).toBeVisible();
    await expect(page.getByText("1 vocab")).toBeVisible();
    await expect(page.getByText("0 grammar")).toBeVisible();
  });

  test("names the engines that produced it", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1)]);

    await page.goto("/my-transcriptions");

    // Recorded at save time precisely so an old transcript can be judged
    // against the engines available when it was made.
    await expect(page.getByText("Deepgram")).toBeVisible();
    await expect(page.getByText("Munsit")).toBeVisible();
    await expect(page.getByText("claude-sonnet-4.5")).toBeVisible();
  });

  test("puts the newest first", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1), aTranscription(2), aTranscription(3)]);

    await page.goto("/my-transcriptions");
    await expect(page.getByText("Recording 1")).toBeVisible();

    const titles = await page.locator("h3.text-base").allTextContents();
    expect(titles).toEqual(["Recording 1", "Recording 2", "Recording 3"]);
  });

  test("shows an em dash for a transcription with no text", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1, { raw_transcript_arabic: "" })]);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("—")).toBeVisible();
  });

  test("points an empty shelf at the Transcribe tool", async ({ page, db }) => {
    seedSaved(db, []);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("No saved transcriptions yet.")).toBeVisible();
    await page.getByRole("button", { name: "Go to Transcribe" }).click();
    await expect(page).toHaveURL(/\/transcribe$/);
  });

  test("reports a failed load", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    seedSaved(db, [aTranscription(1)]);
    db.failAlways("saved_transcriptions", 500);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("Couldn't load transcriptions").first()).toBeVisible();
  });

  test("loads the shelf twice on every visit", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1)]);

    await page.goto("/my-transcriptions");
    await expect(page.getByText("Recording 1")).toBeVisible();

    // A finding, pinned. The load effect depends on `[user, authLoading]` and
    // both settle separately, so it fires twice for one page open — two round
    // trips for the same rows, and two identical toasts when the read fails.
    // Not React StrictMode: the app does not use it. Harmless at one request,
    // but it is the sort of thing that doubles a bill quietly.
    await expect.poll(() => db.readsOf("saved_transcriptions").length).toBeGreaterThan(1);
  });

  test("shows nothing belonging to another learner", async ({ page, db }) => {
    seedSaved(db, [
      aTranscription(1, { title: "Mine" }),
      aTranscription(2, {
        title: "Theirs",
        user_id: "00000000-0000-4000-8000-0000000000ff",
      }),
    ]);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("Mine")).toBeVisible();
    await expect(page.getByText("Theirs")).toHaveCount(0);
  });
});

test.describe("the dialect filter", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("hides another dialect's transcriptions by default", async ({ page, db }) => {
    seedSaved(db, [
      aTranscription(1, { title: "A Gulf clip", dialect: "Gulf" }),
      aTranscription(2, { title: "An Egyptian clip", dialect: "Egyptian" }),
    ]);

    await page.goto("/my-transcriptions");

    await expect(page.getByText("A Gulf clip")).toBeVisible();
    await expect(page.getByText("An Egyptian clip")).toHaveCount(0);
  });

  test("shows every dialect when asked", async ({ page, db }) => {
    seedSaved(db, [
      aTranscription(1, { title: "A Gulf clip", dialect: "Gulf" }),
      aTranscription(2, { title: "An Egyptian clip", dialect: "Egyptian" }),
    ]);

    await page.goto("/my-transcriptions");
    await page.getByRole("button", { name: "Gulf" }).click();

    await expect(page.getByRole("button", { name: "All dialects" })).toBeVisible();
    await expect(page.getByText("An Egyptian clip")).toBeVisible();
  });

  test("keeps an unlabelled transcription visible whatever the dialect", async ({ page, db }) => {
    seedSaved(db, [aTranscription(1, { title: "Before dialects existed", dialect: null })]);

    await page.goto("/my-transcriptions");

    // A null dialect passes the filter deliberately: rows saved before the
    // column existed would otherwise be invisible from every dialect at once,
    // which reads as data loss.
    await expect(page.getByText("Before dialects existed")).toBeVisible();
  });

  test("explains an empty view caused by the filter rather than by an empty shelf", async ({
    page,
    db,
  }) => {
    seedSaved(db, [aTranscription(1, { title: "An Egyptian clip", dialect: "Egyptian" })]);

    await page.goto("/my-transcriptions");

    // The two empty states say different things and offer different actions —
    // "you have saved nothing" gets a link to Transcribe, "nothing in this
    // dialect" gets told about the toggle.
    await expect(page.getByText("No saved transcriptions for Gulf. Toggle to see all.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to Transcribe" })).toHaveCount(0);
  });

  test("filters without going back to the server", async ({ page, db }) => {
    seedSaved(db, [
      aTranscription(1, { dialect: "Gulf" }),
      aTranscription(2, { dialect: "Egyptian" }),
    ]);

    await page.goto("/my-transcriptions");
    await expect(page.getByText("Recording 1")).toBeVisible();
    const before = db.readsOf("saved_transcriptions").length;

    await page.getByRole("button", { name: "Gulf" }).click();
    await expect(page.getByText("Recording 2")).toBeVisible();

    // The whole library is fetched once and filtered in memory, so toggling is
    // instant — worth pinning because it also means the shelf does not scale
    // past what one request can carry.
    expect(db.readsOf("saved_transcriptions").length).toBe(before);
  });
});

test.describe("acting on a transcription", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedSaved(db, [aTranscription(1)]);
  });

  test("opens one back up in Transcribe", async ({ page }) => {
    await page.goto("/my-transcriptions");
    await page.getByRole("button", { name: "Open" }).click();

    await expect(page).toHaveURL(new RegExp(`/transcribe\\?saved=${savedId(1)}`));
  });

  test("names what it is about to delete", async ({ page }) => {
    await page.goto("/my-transcriptions");
    await page.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").click();

    // The only destructive action in the app that quotes the thing by name.
    // A shelf of near-identical cards is exactly where that matters.
    await expect(page.getByText(/permanently removes "Recording 1"/)).toBeVisible();
  });

  test("keeps the transcription when the learner backs out", async ({ page, db }) => {
    await page.goto("/my-transcriptions");
    await page.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "Recording 1" })).toBeVisible();
    expect(db.rows("saved_transcriptions")).toHaveLength(1);
  });

  test("deletes when confirmed", async ({ page, db }) => {
    await page.goto("/my-transcriptions");
    await page.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByText("Transcription deleted")).toBeVisible();
    await expect.poll(() => db.rows("saved_transcriptions")).toHaveLength(0);
    await expect(page.getByText("Recording 1")).toHaveCount(0);
  });

  test("keeps the row on screen when the delete fails", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("saved_transcriptions", 500);

    await page.goto("/my-transcriptions");
    await page.locator("button:has(svg.lucide-trash-2), button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // The list is filtered optimistically on success only — dropping the card
    // on failure would tell a learner their transcript is gone when it is not.
    await expect(page.getByText("Failed to delete")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recording 1" })).toBeVisible();
  });
});
