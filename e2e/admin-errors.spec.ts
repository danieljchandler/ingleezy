import { expect, test } from "./support/fixtures";
import { aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * /admin/errors — what the app reports about itself.
 *
 * Two producers write into one table: the browser's global error handlers POST
 * client crashes, and edge functions log their own failures with a
 * `function_name`. The `source` column is the only thing separating them, and
 * the filter is the only way to read one without the other — so a filter that
 * silently matched nothing would look exactly like a quiet week.
 *
 * The retention control deletes by `created_at` cutoff rather than by id, which
 * makes it the one action here that can remove rows an admin never saw. It is
 * behind a `confirm()`, and this spec covers both answers.
 */

const errorId = (n: number) => `ffffffff-1111-4000-8000-00000000000${n}`;

const anError = (n: number, over: Record<string, unknown> = {}) => ({
  id: errorId(n),
  source: "client",
  function_name: null,
  message: `Something broke ${n}`,
  stack: `Error: Something broke ${n}\n  at Review.tsx:42`,
  route: "/review",
  user_id: TEST_USER_ID,
  user_agent: "Mozilla/5.0 (test)",
  meta: {},
  created_at: new Date(Date.now() - n * 60_000).toISOString(),
  ...over,
});

function seedErrors(db: MemoryDb, rows: Array<Record<string, unknown>>) {
  db.seed("user_roles", [aRole("admin")]);
  db.seed("client_errors", rows);
}

test.describe("who may open it", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    seedErrors(db, []);

    await page.goto("/admin/errors");

    await expect(page.getByRole("heading", { name: "Error Log" })).toBeVisible();
  });

  test("turns a recorder away", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    seedErrors(db, []);

    await page.goto("/admin/errors");

    // Stacks carry file paths and the rows carry user ids — not a recorder's
    // business, and not something the page redacts.
    await expect(page.getByRole("heading", { name: "Error Log" })).toHaveCount(0);
  });
});

test.describe("reading the log", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists an error with its source and message", async ({ page, db }) => {
    seedErrors(db, [anError(1, { message: "Cannot read properties of null" })]);

    await page.goto("/admin/errors");

    await expect(page.getByText("Cannot read properties of null")).toBeVisible();
    await expect(page.getByText("client", { exact: true }).first()).toBeVisible();
  });

  test("names the edge function an error came from", async ({ page, db }) => {
    seedErrors(db, [
      anError(1, { source: "edge", function_name: "grammar-drill", message: "upstream 502" }),
    ]);

    await page.goto("/admin/errors");

    // `edge` alone would leave an admin grepping 84 functions; the name is what
    // makes the row actionable.
    await expect(page.getByText("edge:grammar-drill")).toBeVisible();
  });

  test("keeps the detail folded away until asked for", async ({ page, db }) => {
    seedErrors(db, [anError(1)]);

    await page.goto("/admin/errors");
    await expect(page.getByText("Something broke 1").first()).toBeVisible();

    // A hundred expanded stacks is not a list. The summary is the scannable
    // part; the stack is one click away.
    await expect(page.getByText("at Review.tsx:42")).toBeHidden();

    await page.getByText("Something broke 1").first().click();
    await expect(page.getByText("at Review.tsx:42")).toBeVisible();
  });

  test("shows the route and user behind an error", async ({ page, db }) => {
    seedErrors(db, [anError(1)]);

    await page.goto("/admin/errors");
    await page.getByText("Something broke 1").first().click();

    await expect(page.getByText("/review")).toBeVisible();
    await expect(page.getByText(TEST_USER_ID)).toBeVisible();
  });

  test("puts the newest error first", async ({ page, db }) => {
    seedErrors(db, [
      anError(1, { message: "Older", created_at: new Date(Date.now() - 86_400_000).toISOString() }),
      anError(2, { message: "Newer", created_at: new Date().toISOString() }),
    ]);

    await page.goto("/admin/errors");
    await expect(page.getByText("Newer")).toBeVisible();

    const messages = await page.locator("summary span.flex-1").allTextContents();
    expect(messages).toEqual(["Newer", "Older"]);
  });

  test("says so when nothing has gone wrong", async ({ page, db }) => {
    seedErrors(db, []);

    await page.goto("/admin/errors");

    await expect(page.getByText("No errors logged.")).toBeVisible();
  });

  test("reports a failed load rather than a clean bill of health", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    seedErrors(db, [anError(1)]);
    db.failAlways("client_errors", 500);

    await page.goto("/admin/errors");

    // "No errors" is the good news this page exists to deliver, so it must not
    // be what a broken query looks like.
    await expect(page.getByText("Failed to load errors")).toBeVisible();
  });
});

test.describe("filtering by source", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    seedErrors(db, [
      anError(1, { source: "client", message: "A browser crash" }),
      anError(2, { source: "edge", function_name: "translate-text", message: "A function failure" }),
    ]);
  });

  test("shows both sources by default", async ({ page }) => {
    await page.goto("/admin/errors");

    await expect(page.getByText("A browser crash")).toBeVisible();
    await expect(page.getByText("A function failure")).toBeVisible();
  });

  test("narrows to client errors", async ({ page }) => {
    await page.goto("/admin/errors");
    await expect(page.getByText("A function failure")).toBeVisible();

    await page.getByRole("button", { name: "client", exact: true }).click();

    await expect(page.getByText("A browser crash")).toBeVisible();
    await expect(page.getByText("A function failure")).toHaveCount(0);
  });

  test("narrows to edge errors", async ({ page }) => {
    await page.goto("/admin/errors");
    await expect(page.getByText("A browser crash")).toBeVisible();

    await page.getByRole("button", { name: "edge", exact: true }).click();

    await expect(page.getByText("A function failure")).toBeVisible();
    await expect(page.getByText("A browser crash")).toHaveCount(0);
  });

  test("goes back to showing everything", async ({ page }) => {
    await page.goto("/admin/errors");
    await page.getByRole("button", { name: "edge", exact: true }).click();
    await expect(page.getByText("A browser crash")).toHaveCount(0);

    await page.getByRole("button", { name: "all", exact: true }).click();

    await expect(page.getByText("A browser crash")).toBeVisible();
    await expect(page.getByText("A function failure")).toBeVisible();
  });

  test("refetches rather than filtering what it already has", async ({ page, db }) => {
    await page.goto("/admin/errors");
    await expect(page.getByText("A browser crash")).toBeVisible();
    const before = db.readsOf("client_errors").length;

    await page.getByRole("button", { name: "edge", exact: true }).click();
    await expect(page.getByText("A function failure")).toBeVisible();

    // The filter is a `.eq("source", …)` on the query, not a client-side
    // predicate — which is what keeps the 200-row limit meaningful when one
    // source drowns out the other.
    await expect.poll(() => db.readsOf("client_errors").length).toBeGreaterThan(before);
    expect(db.readsOf("client_errors").at(-1)?.search).toContain("source=eq.edge");
  });
});

test.describe("clearing old errors", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    seedErrors(db, [
      anError(1, { message: "Yesterday", created_at: new Date(Date.now() - 86_400_000).toISOString() }),
      anError(2, {
        message: "Last month",
        created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),
    ]);
  });

  test("asks first, and keeps everything when refused", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.dismiss());

    await page.goto("/admin/errors");
    await expect(page.getByText("Yesterday")).toBeVisible();

    await page.getByRole("button", { name: /Clear >7d/ }).click();

    // This is a bulk delete with no undo and no preview of what it will remove.
    await expect.poll(() => db.rows("client_errors")).toHaveLength(2);
  });

  test("deletes only what is older than the cutoff", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/admin/errors");
    await expect(page.getByText("Yesterday")).toBeVisible();

    await page.getByRole("button", { name: /Clear >7d/ }).click();

    // A cutoff rather than a truncate: yesterday's crash is still the one being
    // investigated.
    await expect(page.getByText("Cleared older errors")).toBeVisible();
    await expect.poll(() => db.rows("client_errors").map((r) => r.message)).toEqual(["Yesterday"]);
  });

  test("reloads the list after clearing", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/admin/errors");
    await expect(page.getByText("Last month")).toBeVisible();

    await page.getByRole("button", { name: /Clear >7d/ }).click();

    // The rows are held in component state, not a query cache, so nothing
    // invalidates on its own — the reload is explicit or the list lies.
    await expect(page.getByText("Last month")).toHaveCount(0);
    await expect(page.getByText("Yesterday")).toBeVisible();
  });

  test("reports a clear that failed", async ({ page, db }) => {
    page.on("dialog", (dialog) => dialog.accept());
    db.failWrites("client_errors", 500);

    await page.goto("/admin/errors");
    await expect(page.getByText("Yesterday")).toBeVisible();

    await page.getByRole("button", { name: /Clear >7d/ }).click();

    await expect(page.getByText(/Injected failure/i)).toBeVisible();
    await expect.poll(() => db.rows("client_errors")).toHaveLength(2);
  });

  test("refetches on demand", async ({ page, db }) => {
    await page.goto("/admin/errors");
    await expect(page.getByText("Yesterday")).toBeVisible();
    const before = db.readsOf("client_errors").length;

    await page.getByRole("button", { name: /Refresh/ }).click();

    // Errors arrive while the page is open and nothing pushes them, so the
    // button is the only way to see one without navigating away and back.
    await expect.poll(() => db.readsOf("client_errors").length).toBeGreaterThan(before);
  });
});
