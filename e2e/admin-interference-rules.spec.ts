import { expect, test } from "./support/fixtures";
import { anInterferenceRule, ruleId } from "../src/test/support/factories";

/**
 * `/admin/interference-rules` — the L1-Interference Rulebook: how Arabic
 * shapes learners' English, steering every English-target generation.
 *
 * Deliberately simpler than the dialect rulebook (no violations rollup, no
 * native review, no AI drafter yet), so what is worth pinning is the CRUD
 * lifecycle itself, the universal-vs-dialect scoping, and the "detector"
 * badge — the admin's only signal that a category's ❌ lines are matched
 * literally in learner English rather than just steering prompts.
 */

test.describe("the interference rulebook", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("groups rules by status and defaults to the approved tab", async ({ page, db }) => {
    db.seed("interference_rules", [
      anInterferenceRule({ id: ruleId(0), status: "approved" }),
      anInterferenceRule({ id: ruleId(1), status: "draft", rule: "Drop of a/an by learners." }),
    ]);
    await page.goto("/admin/interference-rules");

    await expect(page.getByRole("tab", { name: /approved/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByText("Arabic idioms translated word-for-word produce unnatural English."),
    ).toBeVisible();

    await page.getByRole("tab", { name: /draft/i }).click();
    await expect(page.getByText("Drop of a/an by learners.")).toBeVisible();
  });

  test("shows scope, examples, Arabic explanation, and the detector badge", async ({
    page,
    db,
  }) => {
    db.seed("interference_rules", [anInterferenceRule({ status: "approved" })]);
    await page.goto("/admin/interference-rules");

    // dialect: null renders as the universal scope.
    await expect(page.getByText("All dialects")).toBeVisible();
    await expect(page.getByText("❌ open the light")).toBeVisible();
    await expect(page.getByText("✅ turn on the light")).toBeVisible();
    await expect(page.getByText("التعابير لا تُترجم حرفياً.")).toBeVisible();
    // calque is a detector-matched category; the admin must be able to see that.
    await expect(page.getByText("detector", { exact: true })).toBeVisible();
  });

  test("prompt-only categories carry no detector badge", async ({ page, db }) => {
    db.seed("interference_rules", [
      anInterferenceRule({
        status: "approved",
        category: "copula",
        rule: "Arabic nominal sentences have no present-tense to be.",
        examples: { good: ["The report is ready"], bad: ["The report ready"] },
      }),
    ]);
    await page.goto("/admin/interference-rules");

    await expect(page.getByText("The report ready", { exact: false })).toBeVisible();
    await expect(page.getByText("detector", { exact: true })).toHaveCount(0);
  });

  test("approves a draft and stamps the approver", async ({ page, db }) => {
    db.seed("interference_rules", [anInterferenceRule({ status: "draft" })]);
    await page.goto("/admin/interference-rules");
    await page.getByRole("tab", { name: /draft/i }).click();

    await page.getByRole("button", { name: /approve/i }).click();

    await expect(page.getByText(/rule approved/i)).toBeVisible();
    const row = db.rows("interference_rules")[0];
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBeTruthy();
    expect(row.approved_at).toBeTruthy();
  });

  test("retires an approved rule", async ({ page, db }) => {
    db.seed("interference_rules", [anInterferenceRule({ status: "approved" })]);
    await page.goto("/admin/interference-rules");

    await page.getByRole("button", { name: /retire/i }).click();

    await expect(page.getByText(/rule retired/i)).toBeVisible();
    expect(db.rows("interference_rules")[0].status).toBe("retired");
  });

  test("creates a new draft rule scoped to one dialect", async ({ page, db }) => {
    db.seed("interference_rules", []);
    await page.goto("/admin/interference-rules");

    await page.getByRole("button", { name: /add rule/i }).click();
    await page
      .getByPlaceholder(/Arabic has no indefinite article/i)
      .fill("Egyptian speakers merge /θ/ into /s/.");
    await page.getByPlaceholder(/لا توجد أداة تنكير/).fill("ينطق البعض الثاء سيناً.");
    await page.getByPlaceholder("I am student\nopen the light").fill("sank you");
    await page.getByPlaceholder("I am a student\nturn on the light").fill("thank you");
    await page.getByRole("button", { name: /save draft/i }).click();

    await expect(page.getByText(/rule drafted/i)).toBeVisible();
    const row = db.rows("interference_rules")[0];
    expect(row.status).toBe("draft");
    expect(row.rule).toBe("Egyptian speakers merge /θ/ into /s/.");
    expect(row.examples).toEqual({ good: ["thank you"], bad: ["sank you"] });
  });

  test("edits a rule in place", async ({ page, db }) => {
    db.seed("interference_rules", [anInterferenceRule({ status: "approved" })]);
    await page.goto("/admin/interference-rules");

    await page.getByRole("button").filter({ has: page.locator("svg.lucide-pencil") }).click();
    await page
      .getByPlaceholder(/Arabic has no indefinite article/i)
      .fill("Calques: idioms must be translated by meaning, not word-for-word.");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText(/rule saved/i)).toBeVisible();
    expect(db.rows("interference_rules")[0].rule).toBe(
      "Calques: idioms must be translated by meaning, not word-for-word.",
    );
  });

  test("deletes a rule after confirmation", async ({ page, db }) => {
    db.seed("interference_rules", [anInterferenceRule({ status: "retired" })]);
    await page.goto("/admin/interference-rules");
    await page.getByRole("tab", { name: /retired/i }).click();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button").filter({ has: page.locator("svg.lucide-trash2") }).click();

    await expect(page.getByText(/rule deleted/i)).toBeVisible();
    expect(db.rows("interference_rules")).toHaveLength(0);
  });
});
