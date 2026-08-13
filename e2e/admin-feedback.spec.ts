import { expect, test } from "./support/fixtures";
import { aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * /admin/feedback — the beta triage queue.
 *
 * A one-screen workflow: filter by status, read a report, change its status,
 * leave a note, delete it. What makes it worth testing is that the filter is
 * part of the query key and the counts are derived from whatever that query
 * returned — so the pills describe the *fetched* set rather than the table, and
 * the two only agree while the filter is "all".
 *
 * Delete is the one irreversible action, and it is the only place in this page
 * that asks first. That `confirm()` is the whole safety mechanism, so the spec
 * covers both answers to it.
 */

const feedbackId = (n: number) => `dddddddd-1111-4000-8000-00000000000${n}`;

const aFeedbackRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: feedbackId(n),
  user_id: TEST_USER_ID,
  type: "bug",
  status: "new",
  message: `Report number ${n}`,
  route: "/review",
  screenshot_url: null,
  admin_notes: null,
  context: {},
  created_at: new Date(Date.now() - n * 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

function seedFeedback(db: MemoryDb, rows: Array<Record<string, unknown>>) {
  db.seed("user_roles", [aRole("admin")]);
  db.seed("beta_feedback", rows);
}

test.describe("who may open it", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    seedFeedback(db, []);

    await page.goto("/admin/feedback");

    await expect(page.getByRole("heading", { name: "Beta Feedback" })).toBeVisible();
  });

  test("turns a content reviewer away", async ({ page, signInAs, db }) => {
    await signInAs("content_reviewer");
    seedFeedback(db, []);

    await page.goto("/admin/feedback");

    // Reports carry a route, a screenshot and free text a learner wrote
    // believing only the team would read it.
    await expect(page.getByRole("heading", { name: "Beta Feedback" })).toHaveCount(0);
  });
});

test.describe("the queue", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("shows a report with its type and the route it came from", async ({ page, db }) => {
    seedFeedback(db, [aFeedbackRow(1, { message: "Review button does nothing", route: "/review" })]);

    await page.goto("/admin/feedback");

    await expect(page.getByText("Review button does nothing")).toBeVisible();
    await expect(page.getByText("/review")).toBeVisible();
  });

  test("puts the newest report first", async ({ page, db }) => {
    seedFeedback(db, [
      aFeedbackRow(1, { message: "Newer", created_at: new Date().toISOString() }),
      aFeedbackRow(2, {
        message: "Older",
        created_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/admin/feedback");
    await expect(page.getByText("Newer")).toBeVisible();

    // A triage queue that buried new reports under old ones would be worked
    // from the wrong end.
    const messages = await page.locator("p.whitespace-pre-wrap").allTextContents();
    expect(messages).toEqual(["Newer", "Older"]);
  });

  test("counts what it is showing", async ({ page, db }) => {
    seedFeedback(db, [aFeedbackRow(1), aFeedbackRow(2), aFeedbackRow(3)]);

    await page.goto("/admin/feedback");

    await expect(page.getByText("3 total items")).toBeVisible();
  });

  test("says so when the queue is empty", async ({ page, db }) => {
    seedFeedback(db, []);

    await page.goto("/admin/feedback");

    await expect(page.getByText("No feedback yet.")).toBeVisible();
  });

  test("narrows to one status", async ({ page, db }) => {
    seedFeedback(db, [
      aFeedbackRow(1, { message: "Still new", status: "new" }),
      aFeedbackRow(2, { message: "Already done", status: "resolved" }),
    ]);

    await page.goto("/admin/feedback");
    await expect(page.getByText("Still new")).toBeVisible();

    await page.getByRole("button", { name: /^resolved/ }).click();

    await expect(page.getByText("Already done")).toBeVisible();
    await expect(page.getByText("Still new")).toHaveCount(0);
  });

  test("loses the other statuses' counts as soon as one is picked", async ({ page, db }) => {
    seedFeedback(db, [
      aFeedbackRow(1, { status: "new" }),
      aFeedbackRow(2, { status: "new" }),
      aFeedbackRow(3, { status: "resolved" }),
    ]);

    await page.goto("/admin/feedback");
    await expect(page.getByRole("button", { name: "new (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "resolved (1)" })).toBeVisible();

    await page.getByRole("button", { name: "resolved (1)" }).click();

    // Recording a quirk. `counts` is reduced over the *fetched* rows, and the
    // filter is part of the query — so once a status is selected the fetch
    // contains only that status and every other pill loses its number. The
    // pills read as "there is nothing else to triage", which is exactly what an
    // admin working the queue should not be told.
    await expect(page.getByRole("button", { name: "resolved (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "new", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "new (2)" })).toHaveCount(0);
  });

  test("reports a failed load", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    seedFeedback(db, [aFeedbackRow(1)]);
    db.failAlways("beta_feedback", 500);

    await page.goto("/admin/feedback");

    // No error branch of its own — the query throws and the page falls to its
    // empty state, so a broken read looks exactly like an empty inbox. Pinned
    // as current behaviour on a page whose purpose is not missing reports.
    await expect(page.getByText("No feedback yet.")).toBeVisible();
  });
});

test.describe("triaging a report", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    seedFeedback(db, [aFeedbackRow(1, { message: "Review button does nothing" })]);
  });

  test("changes its status", async ({ page, db }) => {
    await page.goto("/admin/feedback");
    await expect(page.getByText("Review button does nothing")).toBeVisible();

    await page.locator("select").selectOption("triaged");

    await expect
      .poll(() => db.rows("beta_feedback")[0]?.status)
      .toBe("triaged");
  });

  test("saves an admin note against it", async ({ page, db }) => {
    await page.goto("/admin/feedback");
    await page.getByRole("button", { name: "Show details" }).click();

    await page.getByPlaceholder("Internal notes…").fill("Reproduced on iOS Safari");
    await page.getByRole("button", { name: "Save notes" }).click();

    await expect
      .poll(() => db.rows("beta_feedback")[0]?.admin_notes)
      .toBe("Reproduced on iOS Safari");
  });

  test("keeps the note that was already there", async ({ page, db }) => {
    db.seed("beta_feedback", [aFeedbackRow(1, { admin_notes: "Earlier note" })]);

    await page.goto("/admin/feedback");
    await page.getByRole("button", { name: "Show details" }).click();

    // The draft falls back to the stored value, so opening a report and saving
    // without typing does not blank a colleague's note.
    await expect(page.getByPlaceholder("Internal notes…")).toHaveValue("Earlier note");
  });

  test("hides the details again", async ({ page }) => {
    await page.goto("/admin/feedback");
    await page.getByRole("button", { name: "Show details" }).click();
    await expect(page.getByPlaceholder("Internal notes…")).toBeVisible();

    await page.getByRole("button", { name: "Hide details" }).click();

    await expect(page.getByPlaceholder("Internal notes…")).toHaveCount(0);
  });

  test("reports a status change that failed", async ({ page, db }) => {
    db.failWrites("beta_feedback", 500);

    await page.goto("/admin/feedback");
    await expect(page.getByText("Review button does nothing")).toBeVisible();

    await page.locator("select").selectOption("resolved");

    // The select is uncontrolled against the row, so a failed write leaves the
    // dropdown showing a status the database does not have — the toast is the
    // only thing telling an admin the change did not land.
    await expect(page.getByText(/Injected failure/i)).toBeVisible();
    expect(db.rows("beta_feedback")[0]?.status).toBe("new");
  });
});

test.describe("deleting a report", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    seedFeedback(db, [aFeedbackRow(1, { message: "Review button does nothing" })]);
  });

  test("asks first, and does nothing when refused", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.dismiss());

    await page.goto("/admin/feedback");
    await expect(page.getByText("Review button does nothing")).toBeVisible();

    await page.locator("button:has(svg.text-destructive)").click();

    // A learner's report cannot be recovered from anywhere in the app, so the
    // confirm is the only thing between a misclick and losing it.
    await expect(page.getByText("Review button does nothing")).toBeVisible();
    expect(db.rows("beta_feedback")).toHaveLength(1);
  });

  test("deletes when confirmed", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/admin/feedback");
    await expect(page.getByText("Review button does nothing")).toBeVisible();

    await page.locator("button:has(svg.text-destructive)").click();

    await expect(page.getByText("Deleted")).toBeVisible();
    await expect.poll(() => db.rows("beta_feedback")).toHaveLength(0);
  });

  test("reports a delete that failed", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());
    db.failWrites("beta_feedback", 500);

    await page.goto("/admin/feedback");
    await expect(page.getByText("Review button does nothing")).toBeVisible();

    await page.locator("button:has(svg.text-destructive)").click();

    await expect(page.getByText(/Injected failure/i)).toBeVisible();
    await expect(page.getByText("Review button does nothing")).toBeVisible();
  });
});
