import { expect, test, type Page } from "./support/fixtures";
import { aFeatureMetric, iso, many } from "../src/test/support/factories";

/**
 * `/admin/metrics` — the edge-function event log.
 *
 * Edge functions write structured events to `feature_metrics`; this page slices
 * them by window, dialect, status and feature, rolls them into a feature ×
 * dialect summary, and offers to feed a bad event back to `learn-from-metric`
 * as a dialect-rule draft.
 *
 * The rollup arithmetic is the part worth pinning: it is the only place in the
 * admin that turns raw events into a number someone would act on, and three of
 * its four columns are computed rather than read.
 */

const summaryRow = (page: Page, feature: string) =>
  page.locator("tbody tr").filter({ hasText: feature });

const metricId = (index: number) => `f3f3f3f3-0000-4000-8000-${String(index).padStart(12, "0")}`;

test.describe("the event log", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("says when the window is empty", async ({ page, db }) => {
    db.seed("feature_metrics", []);
    await page.goto("/admin/metrics");

    await expect(page.getByRole("heading", { name: /feature metrics/i })).toBeVisible();
    await expect(page.getByText(/no events in this window/i)).toBeVisible();
    await expect(page.getByText("Recent events (0)")).toBeVisible();
  });

  test("shows an event with everything it recorded", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({
        feature: "souq-news",
        event: "firecrawl",
        dialect: "Egyptian",
        status: "warn",
        duration_ms: 843,
        count: 12,
        score: 0.6666,
      }),
    ]);

    await page.goto("/admin/metrics");

    const entry = page.locator("details").first();
    await expect(entry).toContainText("warn");
    await expect(entry).toContainText("souq-news");
    await expect(entry).toContainText("/firecrawl");
    await expect(entry).toContainText("Egyptian");
    await expect(entry).toContainText("843ms");
    await expect(entry).toContainText("n=12");
    await expect(entry).toContainText("score=0.67");
  });

  test("hides the metadata until the event is opened", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ meta: { error: "gateway timeout", leaks: ["إزيك"] } }),
    ]);

    await page.goto("/admin/metrics");

    await expect(page.getByText(/gateway timeout/)).toBeHidden();
    await page.locator("summary").first().click();
    await expect(page.getByText(/gateway timeout/)).toBeVisible();
  });

  test("shows the newest event first", async ({ page, db }) => {
    db.seed(
      "feature_metrics",
      many(aFeatureMetric, 3, (index) => ({
        id: metricId(index),
        event: `event-${index}`,
        created_at: iso(-index * 60_000),
      })),
    );

    await page.goto("/admin/metrics");

    const entries = page.locator("details");
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText("/event-0");
    await expect(entries.last()).toContainText("/event-2");
  });

  test("reports a failed load rather than an empty window", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric()]);
    db.failAlways("feature_metrics", 500);

    await page.goto("/admin/metrics");

    await expect(page.getByText(/failed to load metrics/i)).toBeVisible();
  });

  test("refreshes on demand", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ event: "first" })]);
    await page.goto("/admin/metrics");
    await expect(page.getByText("Recent events (1)")).toBeVisible();

    db.add("feature_metrics", aFeatureMetric({ id: metricId(1), event: "second" }));
    await page.getByRole("button", { name: /refresh/i }).click();

    await expect(page.getByText("Recent events (2)")).toBeVisible();
  });
});

test.describe("the filters", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "souq-news", dialect: "Gulf", status: "ok" }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", dialect: "Egyptian", status: "error" }),
      aFeatureMetric({ id: metricId(2), feature: "ai-brain", dialect: "Gulf", status: "warn" }),
    ]);
  });

  test("defaults to the last 24 hours across every dialect", async ({ page, db }) => {
    await page.goto("/admin/metrics");

    await expect(page.getByText("Recent events (3)")).toBeVisible();
    const read = db.readsOf("feature_metrics").at(-1);
    expect(read?.search).toContain("created_at=gte.");
    expect(read?.search).not.toContain("dialect=eq.");
  });

  test("narrows to one dialect", async ({ page }) => {
    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: "Egyptian", exact: true }).click();

    await expect(page.getByText("Recent events (1)")).toBeVisible();
    await expect(page.locator("details").first()).toContainText("ai-brain");
  });

  test("narrows to one status", async ({ page }) => {
    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: "error", exact: true }).click();

    await expect(page.getByText("Recent events (1)")).toBeVisible();
  });

  test("narrows the window, which is applied as a cutoff not a page size", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), event: "recent", created_at: iso(-30 * 60_000) }),
      aFeatureMetric({ id: metricId(1), event: "older", created_at: iso(-3 * 3600_000) }),
    ]);

    await page.goto("/admin/metrics");
    await expect(page.getByText("Recent events (2)")).toBeVisible();

    await page.getByRole("button", { name: "Last 1h" }).click();

    await expect(page.getByText("Recent events (1)")).toBeVisible();
    await expect(page.locator("details").first()).toContainText("/recent");
  });

  test("narrows to one feature", async ({ page }) => {
    await page.goto("/admin/metrics");
    await page.locator("select").selectOption("ai-brain");

    await expect(page.getByText("Recent events (2)")).toBeVisible();
  });

  test("cannot move straight from one feature to another", async ({ page }) => {
    // Pinned, not fixed. The dropdown's options are derived from `rows`, and
    // `rows` is already filtered by the chosen feature — so picking one
    // collapses the list to that feature alone. Switching to another means
    // going back through "all features" first.
    await page.goto("/admin/metrics");
    await expect(page.locator("select option")).toHaveCount(3);

    await page.locator("select").selectOption("ai-brain");

    await expect(page.locator("select option")).toHaveText(["all features", "ai-brain"]);
  });
});

test.describe("the rollup", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("groups by feature and dialect", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", dialect: "Gulf", status: "ok" }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", dialect: "Gulf", status: "warn" }),
      aFeatureMetric({ id: metricId(2), feature: "ai-brain", dialect: "Egyptian", status: "error" }),
    ]);

    await page.goto("/admin/metrics");

    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(summaryRow(page, "Gulf")).toContainText("2");
    await expect(summaryRow(page, "Egyptian")).toContainText("1");
  });

  test("puts the worst feature at the top", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "healthy", status: "ok" }),
      aFeatureMetric({ id: metricId(1), feature: "broken", status: "error" }),
      aFeatureMetric({ id: metricId(2), feature: "broken", status: "error" }),
    ]);

    await page.goto("/admin/metrics");

    await expect(page.locator("tbody tr").first()).toContainText("broken");
    await expect(page.locator("tbody tr").last()).toContainText("healthy");
  });

  test("reports the error rate as a whole percentage", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", status: "ok" }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", status: "ok" }),
      aFeatureMetric({ id: metricId(2), feature: "ai-brain", status: "error" }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain")).toContainText("33%");
  });

  test("counts an unrecognised status as an error", async ({ page, db }) => {
    // Pinned, not fixed. The rollup is if ok / else if warn / else error, and
    // `status` is free text — so a new status an edge function starts writing
    // (say "skipped") lands in the error column and drives the error rate up
    // without anything having failed.
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", status: "skipped" }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain")).toContainText("100%");
  });

  test("averages duration over every event, not the timed ones", async ({ page, db }) => {
    // Pinned, not fixed. The sum skips rows with no duration but the divisor is
    // the total row count, so one untimed event halves the reported average.
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", duration_ms: 100 }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", duration_ms: null }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain")).toContainText("50");
  });

  test("averages leaks only over the events that report them", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", event: "dialect_leak", count: 3 }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", event: "dialect_leak", count: 1 }),
      aFeatureMetric({ id: metricId(2), feature: "ai-brain", event: "fetch", count: null }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain")).toContainText("2.00");
  });

  test("shows an em dash where there is nothing to average", async ({ page, db }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ feature: "ai-brain", duration_ms: null, count: null }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain").locator("td").nth(7)).toHaveText("—");
    await expect(summaryRow(page, "ai-brain").locator("td").nth(8)).toHaveText("—");
  });

  test("groups dialectless events under a dash", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ feature: "ai-brain", dialect: null })]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain").locator("td").nth(1)).toHaveText("-");
  });
});

test.describe("teaching the AI from an event", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("offers nothing for a healthy event", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ status: "ok", meta: {} })]);
    await page.goto("/admin/metrics");

    await expect(page.getByRole("button", { name: /teach ai/i })).toHaveCount(0);
  });

  test("offers it for a failure with a known dialect", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ status: "error", dialect: "Gulf" })]);
    await page.goto("/admin/metrics");

    await expect(page.getByRole("button", { name: /teach ai/i })).toBeVisible();
  });

  test("offers nothing when the event has no dialect to teach about", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ status: "error", dialect: null })]);
    await page.goto("/admin/metrics");

    await expect(page.getByRole("button", { name: /teach ai/i })).toHaveCount(0);
  });

  test("sends the event, its dialect and its leaks", async ({ page, db, backend }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({
        id: metricId(0),
        feature: "ai-brain",
        event: "dialect_leak",
        dialect: "Egyptian",
        status: "warn",
        meta: { leaks: ["شلونك"], error: "MSA leaked into the reply" },
      }),
    ]);

    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: /teach ai/i }).click();

    await expect(page.getByText(/drafted 1 rule$/i)).toBeVisible();
    expect(backend.lastCallTo("learn-from-metric")?.body).toMatchObject({
      metric_id: metricId(0),
      feature: "ai-brain",
      event: "dialect_leak",
      dialect: "Egyptian",
      leaks: ["شلونك"],
      message: "MSA leaked into the reply",
    });
  });

  test("pluralises the count of drafted rules", async ({ page, db, backend }) => {
    db.seed("feature_metrics", [aFeatureMetric({ status: "error", dialect: "Gulf" })]);
    backend.stubFunction("learn-from-metric", { inserted: 3 });

    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: /teach ai/i }).click();

    await expect(page.getByText(/drafted 3 rules/i)).toBeVisible();
  });

  test("says so when the model proposed nothing", async ({ page, db, backend }) => {
    db.seed("feature_metrics", [aFeatureMetric({ status: "error", dialect: "Gulf" })]);
    backend.stubFunction("learn-from-metric", { inserted: 0, message: "AI returned no proposals" });

    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: /teach ai/i }).click();

    await expect(page.getByText(/ai returned no proposals/i)).toBeVisible();
  });

  test("reports a failed call", async ({ page, db, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.seed("feature_metrics", [aFeatureMetric({ status: "error", dialect: "Gulf" })]);
    backend.stubFunctionFailure("learn-from-metric", 500);

    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: /teach ai/i }).click();

    await expect(page.getByText(/teach ai failed/i)).toBeVisible();
  });

  test("does not open the event while teaching from it", async ({ page, db }) => {
    // The button lives inside a <summary>, so without stopping the event the
    // click would toggle the disclosure open under the request.
    db.seed("feature_metrics", [
      aFeatureMetric({ status: "error", dialect: "Gulf", meta: { error: "gateway timeout" } }),
    ]);

    await page.goto("/admin/metrics");
    await page.getByRole("button", { name: /teach ai/i }).click();

    await expect(page.getByText(/drafted 1 rule/i)).toBeVisible();
    await expect(page.getByText("gateway timeout").first()).toBeHidden();
  });

  test("teaches from a whole rollup row", async ({ page, db, backend }) => {
    db.seed("feature_metrics", [
      aFeatureMetric({ id: metricId(0), feature: "ai-brain", dialect: "Gulf", status: "error" }),
      aFeatureMetric({ id: metricId(1), feature: "ai-brain", dialect: "Gulf", status: "error" }),
    ]);

    await page.goto("/admin/metrics");
    await summaryRow(page, "ai-brain").getByRole("button").click();

    await expect(page.getByText(/drafted 1 rule/i)).toBeVisible();
    expect(backend.lastCallTo("learn-from-metric")?.body).toMatchObject({
      feature: "ai-brain",
      event: "summary_rollup",
      dialect: "Gulf",
      message: "Rollup: 2 errors, avg 0.00 leaks/event over 2 events.",
    });
  });

  test("offers no rollup teach for a clean feature", async ({ page, db }) => {
    db.seed("feature_metrics", [aFeatureMetric({ feature: "ai-brain", status: "ok" })]);
    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain").getByRole("button")).toHaveCount(0);
    await expect(summaryRow(page, "ai-brain").locator("td").last()).toHaveText("—");
  });

  test("offers no rollup teach for a dialectless group", async ({ page, db }) => {
    // Every draft rule belongs to a dialect, so a group with none has nothing
    // to teach even when every event in it failed.
    db.seed("feature_metrics", [
      aFeatureMetric({ feature: "ai-brain", dialect: null, status: "error" }),
    ]);

    await page.goto("/admin/metrics");

    await expect(summaryRow(page, "ai-brain").getByRole("button")).toHaveCount(0);
  });

  test("points at where the drafts land", async ({ page, db }) => {
    db.seed("feature_metrics", []);
    await page.goto("/admin/metrics");

    await page.getByRole("link", { name: /dialect rules/i }).click();

    await expect(page).toHaveURL(/\/admin\/dialect-rules$/);
  });
});

test.describe("who can open it", () => {
  test.beforeEach(async ({ db }) => {
    db.seed("feature_metrics", []);
  });

  test("a recorder may read the metrics", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/metrics");

    await expect(page.getByRole("heading", { name: /feature metrics/i })).toBeVisible();
  });

  test("a content reviewer is turned away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");
    await page.goto("/admin/metrics");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/metrics");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
