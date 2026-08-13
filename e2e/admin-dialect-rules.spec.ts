import { expect, test, type Page } from "./support/fixtures";
import { aDialectRule, aNativeReview, daysAgo, ruleId, TEST_USER_ID } from "../src/test/support/factories";

/**
 * `/admin/dialect-rules` — the rulebook every AI generation in the app is
 * steered by.
 *
 * Five tabs over three tables and three edge functions. Rules move draft →
 * approved → retired and back; the violations tab is a rollup from an edge
 * function rather than a table read; the native-review tab turns a human
 * correction into a *new* draft rule, which is the only place in the admin
 * where editing one table writes a row into another.
 *
 * The bad-examples helper is worth its own attention: it warns when a line
 * would poison the leak detector, and it does so by normalising Arabic in the
 * browser against a per-dialect allow-list. Getting that wrong does not break
 * the page — it quietly floods the violations tab with false positives.
 */

const REVIEW = "f5f5f5f5-0000-4000-8000-000000000000";

const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });

/** The rule's own textarea in the inline editor. */
const ruleBox = (page: Page) => page.locator('textarea[rows="3"]').first();

test.describe("the rulebook", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("says which dialect it is steering", async ({ page, db }) => {
    db.seed("dialect_rules", []);
    await page.goto("/admin/dialect-rules");

    await expect(page.getByRole("heading", { name: /dialect rulebook/i })).toBeVisible();
    await expect(page.getByText(/Rules powering every AI generation for/)).toBeVisible();
  });

  test("sorts each tab into its own count", async ({ page, db }) => {
    db.seed("dialect_rules", [
      aDialectRule({ id: ruleId(0), status: "draft" }),
      aDialectRule({ id: ruleId(1), status: "draft", rule: "Second draft." }),
      aDialectRule({ id: ruleId(2), status: "approved", rule: "Approved one." }),
      aDialectRule({ id: ruleId(3), status: "retired", rule: "Retired one." }),
    ]);

    await page.goto("/admin/dialect-rules");

    await expect(tab(page, /^Drafts/)).toContainText("2");
    await expect(tab(page, /^Approved/)).toContainText("1");
    await expect(tab(page, /^Retired/)).toContainText("1");
  });

  test("opens on the drafts, which are what need a decision", async ({ page, db }) => {
    db.seed("dialect_rules", [
      aDialectRule({ id: ruleId(0), status: "draft", rule: "A draft rule." }),
      aDialectRule({ id: ruleId(1), status: "approved", rule: "A live rule." }),
    ]);

    await page.goto("/admin/dialect-rules");

    await expect(page.getByText("A draft rule.")).toBeVisible();
    await expect(page.getByText("A live rule.")).toHaveCount(0);
  });

  test("shows a rule with its grading and its examples", async ({ page, db }) => {
    db.seed("dialect_rules", [
      aDialectRule({
        rule: "Use هالحين, never الآن.",
        category: "lexis",
        priority: 5,
        source: "manual",
        notes: "Reported by a native reviewer.",
        examples: { good: ["هالحين"], bad: ["الآن"] },
      }),
    ]);

    await page.goto("/admin/dialect-rules");

    await expect(page.getByText("Use هالحين, never الآن.")).toBeVisible();
    await expect(page.getByText("P5")).toBeVisible();
    await expect(page.getByText("lexis")).toBeVisible();
    await expect(page.getByText("manual")).toBeVisible();
    await expect(page.getByText("Good")).toBeVisible();
    await expect(page.getByText("Bad / MSA")).toBeVisible();
    await expect(page.getByText("Reported by a native reviewer.")).toBeVisible();
  });

  test("renders an example stored as an object, not just a string", async ({ page, db }) => {
    // Both shapes exist in production, so the formatter has to cope with a
    // dialect/MSA pair as well as a bare string.
    db.seed("dialect_rules", [
      aDialectRule({
        examples: { good: [{ dialect: "هالحين", msa: "الآن" }], bad: ["الآن"] },
      }),
    ]);

    await page.goto("/admin/dialect-rules");

    await expect(page.getByText("هالحين — الآن")).toBeVisible();
  });

  test("shows nothing where a rule has no examples", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ examples: { good: [], bad: [] } })]);
    await page.goto("/admin/dialect-rules");

    await expect(page.getByText("Good")).toHaveCount(0);
    await expect(page.getByText("Bad / MSA")).toHaveCount(0);
  });

  test("says so when a tab is empty", async ({ page, db }) => {
    db.seed("dialect_rules", []);
    await page.goto("/admin/dialect-rules");

    await expect(page.getByText("No draft rules.")).toBeVisible();
    await tab(page, /^Approved/).click();
    await expect(page.getByText("No approved rules.")).toBeVisible();
  });

  test("shows only the active dialect's rules", async ({ page, db }) => {
    db.seed("dialect_rules", [
      aDialectRule({ id: ruleId(0), dialect: "Gulf", rule: "A Gulf rule." }),
      aDialectRule({ id: ruleId(1), dialect: "Egyptian", rule: "A Cairo rule." }),
    ]);

    await page.goto("/admin/dialect-rules");
    await expect(page.getByText("A Gulf rule.")).toBeVisible();
    await expect(page.getByText("A Cairo rule.")).toHaveCount(0);

    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();

    await expect(page.getByText("A Cairo rule.")).toBeVisible();
    await expect(page.getByText("A Gulf rule.")).toHaveCount(0);
  });

  test("puts the highest priority first", async ({ page, db }) => {
    db.seed("dialect_rules", [
      aDialectRule({ id: ruleId(0), priority: 1, rule: "Least important." }),
      aDialectRule({ id: ruleId(1), priority: 5, rule: "Most important." }),
    ]);

    await page.goto("/admin/dialect-rules");

    const rules = page.locator("p.text-sm.leading-relaxed");
    await expect(rules.first()).toHaveText("Most important.");
    await expect(rules.last()).toHaveText("Least important.");
  });
});

test.describe("moving a rule through its life", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("approving stamps who approved it and when", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), status: "draft" })]);
    await page.goto("/admin/dialect-rules");

    await page.getByRole("button", { name: /approve/i }).click();

    await expect(page.getByText("Rule approved")).toBeVisible();
    const write = db.lastWriteTo("dialect_rules");
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toMatchObject({ status: "approved", approved_by: TEST_USER_ID });
    expect(typeof write?.payload[0].approved_at).toBe("string");
  });

  test("retiring does not stamp an approver", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), status: "draft" })]);
    await page.goto("/admin/dialect-rules");

    await page.getByRole("button", { name: /retire/i }).click();

    await expect(page.getByText("Rule retired")).toBeVisible();
    expect(db.lastWriteTo("dialect_rules")?.payload[0]).toEqual({ status: "retired" });
  });

  test("a retired rule can be reopened as a draft", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), status: "retired" })]);
    await page.goto("/admin/dialect-rules");
    await tab(page, /^Retired/).click();

    await page.getByRole("button", { name: /reopen/i }).click();

    await expect(page.getByText("Rule draft")).toBeVisible();
    expect(db.rows("dialect_rules")[0]).toMatchObject({ status: "draft" });
  });

  test("an approved rule offers no second approval", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), status: "approved" })]);
    await page.goto("/admin/dialect-rules");
    await tab(page, /^Approved/).click();

    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /retire/i })).toBeVisible();
  });

  test("says so when a status change is rejected", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), status: "draft" })]);
    await page.goto("/admin/dialect-rules");

    db.failWrites("dialect_rules", 403);
    await page.getByRole("button", { name: /approve/i }).click();

    await expect(page.getByText("Failed")).toBeVisible();
    expect(db.rows("dialect_rules")[0]).toMatchObject({ status: "draft" });
  });

  test("asks before deleting a rule for good", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0) })]);
    let asked = "";
    page.on("dialog", (dialog) => {
      asked = dialog.message();
      return dialog.dismiss();
    });
    await page.goto("/admin/dialect-rules");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect.poll(() => asked).toContain("permanently");
    expect(db.writesTo("dialect_rules")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0) })]);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/admin/dialect-rules");

    await page.locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByText("Rule deleted")).toBeVisible();
    expect(db.rows("dialect_rules")).toHaveLength(0);
  });
});

test.describe("editing a rule", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("dialect_rules", [
      aDialectRule({
        id: ruleId(0),
        rule: "Use هالحين, never الآن.",
        category: "lexis",
        priority: 3,
        notes: "A note.",
        examples: { good: ["هالحين"], bad: ["الآن"] },
      }),
    ]);
  });

  const openEditor = async (page: Page) => {
    await page.goto("/admin/dialect-rules");
    await page.locator("button:has(svg.lucide-pencil)").click();
  };

  test("prefills every field from the rule", async ({ page }) => {
    await openEditor(page);

    // rows=3 is the rule box; the drafter's guidance box above it is rows=2 and
    // the example boxes are rows=4, so this is the only unambiguous handle.
    await expect(ruleBox(page)).toHaveValue("Use هالحين, never الآن.");
    await expect(page.getByPlaceholder("category")).toHaveValue("lexis");
    await expect(page.getByPlaceholder("notes")).toHaveValue("A note.");
    await expect(page.getByRole("combobox")).toContainText("Priority 3");
  });

  test("hides the status controls while editing", async ({ page }) => {
    await openEditor(page);

    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /retire/i })).toHaveCount(0);
  });

  test("saves the edited rule, splitting the examples by line", async ({ page, db }) => {
    await openEditor(page);

    await ruleBox(page).fill("Use هالحين only.");
    await page.getByPlaceholder("category").fill("  time  ");
    await page.locator("textarea.font-arabic").first().fill("هالحين\nذحين\n\n");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("Rule saved")).toBeVisible();
    const write = db.lastWriteTo("dialect_rules");
    expect(write?.payload[0]).toMatchObject({
      rule: "Use هالحين only.",
      category: "time",
      notes: "A note.",
    });
    // Blank lines are dropped rather than stored as empty examples.
    expect(write?.payload[0].examples).toEqual({ good: ["هالحين", "ذحين"], bad: ["الآن"] });
  });

  test("falls back to a general category when the field is cleared", async ({ page, db }) => {
    await openEditor(page);

    await page.getByPlaceholder("category").fill("");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("Rule saved")).toBeVisible();
    expect(db.lastWriteTo("dialect_rules")?.payload[0]).toMatchObject({ category: "general" });
  });

  test("stores a cleared note as null rather than as an empty string", async ({ page, db }) => {
    await openEditor(page);

    await page.getByPlaceholder("notes").fill("   ");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("Rule saved")).toBeVisible();
    expect(db.lastWriteTo("dialect_rules")?.payload[0]).toMatchObject({ notes: null });
  });

  test("cancelling discards the edit", async ({ page, db }) => {
    await openEditor(page);

    await ruleBox(page).fill("Something else.");
    await page.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByText("Use هالحين, never الآن.")).toBeVisible();
    expect(db.writesTo("dialect_rules")).toHaveLength(0);
  });

  test("keeps the editor open when the save is rejected", async ({ page, db }) => {
    await openEditor(page);

    await ruleBox(page).fill("Use هالحين only.");
    db.failWrites("dialect_rules", 403);
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByText("Failed")).toBeVisible();
    await expect(ruleBox(page)).toHaveValue("Use هالحين only.");
  });
});

test.describe("the bad-examples guard", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0) })]);
    // The guard only renders inside the editor.
  });

  const openBadExamples = async (page: Page) => {
    await page.goto("/admin/dialect-rules");
    await page.locator("button:has(svg.lucide-pencil)").click();
    return page.locator("textarea.font-arabic").last();
  };

  test("explains what belongs in the box", async ({ page }) => {
    await openBadExamples(page);

    await expect(page.getByText(/ONLY forms that are/)).toBeVisible();
    await expect(page.getByText(/msa_substitutions/)).toBeVisible();
  });

  test("warns about a whole sentence pasted in as a bad example", async ({ page }) => {
    const box = await openBadExamples(page);
    await box.fill("أريد أن أذهب إلى البيت");

    await expect(page.getByText(/may produce false positives/i)).toBeVisible();
    await expect(page.getByText(/words — bad examples should be a single MSA token/)).toBeVisible();
  });

  test("warns about a word that is valid in the dialect", async ({ page }) => {
    // "البيت" is on the Gulf allow-list, so the detector would ignore it — and
    // an admin who does not know that would think the rule was working.
    const box = await openBadExamples(page);
    await box.fill("البيت");

    await expect(page.getByText(/is a valid Gulf word and will be ignored/)).toBeVisible();
  });

  test("matches the allow-list through Arabic normalisation", async ({ page }) => {
    // "الآن" is not allow-listed, but "أنا" is — and the guard folds hamza
    // forms, so "انا" has to match the allow-listed "أنا".
    const box = await openBadExamples(page);
    await box.fill("انا");

    await expect(page.getByText(/is a valid Gulf word and will be ignored/)).toBeVisible();
  });

  test("says nothing about a genuinely MSA-only token", async ({ page }) => {
    const box = await openBadExamples(page);
    await box.fill("ليس\nلماذا\nأريد");

    await expect(page.getByText(/may produce false positives/i)).toHaveCount(0);
  });

  test("lists at most five warnings", async ({ page }) => {
    const box = await openBadExamples(page);
    await box.fill(Array.from({ length: 8 }, () => "البيت").join("\n"));

    await expect(page.getByText(/is a valid Gulf word/)).toHaveCount(5);
  });
});

test.describe("asking the council for new rules", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("dialect_rules", []);
  });

  test("sends the dialect, category, count and guidance", async ({ page, backend }) => {
    await page.goto("/admin/dialect-rules");

    await page.getByPlaceholder("e.g. negation, pronouns").fill("  negation  ");
    await page.locator('input[type="number"]').fill("9");
    await page.getByPlaceholder(/Guidance for the council/).fill("Focus on question words.");
    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/drafting in background/i)).toBeVisible();
    expect(backend.lastCallTo("draft-dialect-rules")?.body).toEqual({
      dialect: "Gulf",
      category: "negation",
      guidance: "Focus on question words.",
      count: 9,
    });
  });

  test("omits an empty category and guidance rather than sending blanks", async ({
    page,
    backend,
  }) => {
    await page.goto("/admin/dialect-rules");
    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/drafting in background/i)).toBeVisible();
    const body = backend.lastCallTo("draft-dialect-rules")?.body as Record<string, unknown>;
    expect(body.category).toBeUndefined();
    expect(body.guidance).toBeUndefined();
    expect(body.count).toBe(6);
  });

  test("clamps the count to what the council will accept", async ({ page, backend }) => {
    await page.goto("/admin/dialect-rules");

    await page.locator('input[type="number"]').fill("40");
    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/drafting in background/i)).toBeVisible();
    expect((backend.lastCallTo("draft-dialect-rules")?.body as { count: number }).count).toBe(12);
  });

  test("clears the guidance once the request is away", async ({ page }) => {
    await page.goto("/admin/dialect-rules");

    await page.getByPlaceholder(/Guidance for the council/).fill("Focus on question words.");
    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/drafting in background/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Guidance for the council/)).toHaveValue("");
  });

  test("says the drafts will arrive later, not now", async ({ page, db }) => {
    // Drafting is queued: the response is an acknowledgement, and the list is
    // polled for the next four minutes. Nothing appears on this click.
    await page.goto("/admin/dialect-rules");
    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/Council is drafting rules in the background/)).toBeVisible();
    expect(db.rows("dialect_rules")).toHaveLength(0);
  });

  test("reports a failed request", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("draft-dialect-rules", 500);
    await page.goto("/admin/dialect-rules");

    await page.getByRole("button", { name: /draft rules/i }).click();

    await expect(page.getByText(/failed to draft rules/i)).toBeVisible();
  });

});

test.describe("the violations digest", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("dialect_rules", []);
  });

  const openViolations = async (page: Page) => {
    await page.goto("/admin/dialect-rules");
    await tab(page, /violations/i).click();
  };

  const digest = (over: Record<string, unknown> = {}) => ({
    windowDays: 7,
    totals: { all: 3, byDialect: { Gulf: 3 } },
    topTokens: [{ token: "الآن", count: 2 }],
    topFunctions: [{ fn: "free-chat", count: 3 }],
    samples: [
      {
        id: "v-1",
        dialect: "Gulf",
        token: "الآن",
        function: "free-chat",
        created_at: daysAgo(1),
        snippet: "أريد أن أذهب الآن",
        resolved: false,
      },
    ],
    ...over,
  });

  test("summarises the window", async ({ page, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest());
    await openViolations(page);

    await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("in last 7 day(s) for Gulf")).toBeVisible();
    await expect(page.getByText("الآن").first()).toBeVisible();
    await expect(page.getByText("free-chat").first()).toBeVisible();
    await expect(page.getByText("أريد أن أذهب الآن")).toBeVisible();
  });

  test("celebrates an empty rulebook rather than showing an empty table", async ({
    page,
    backend,
  }) => {
    backend.stubFunction("dialect-violations-digest", {
      windowDays: 7,
      totals: { all: 0, byDialect: {} },
      topTokens: [],
      topFunctions: [],
      samples: [],
    });
    await openViolations(page);

    await expect(page.getByText("None 🎉")).toBeVisible();
    await expect(page.getByText(/no samples in this window/i)).toBeVisible();
  });

  test("narrows the window", async ({ page, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest());
    await openViolations(page);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Last 30 days" }).click();

    await expect
      .poll(() => backend.lastCallTo("dialect-violations-digest")?.body)
      .toMatchObject({ dialect: "Gulf", days: 30, includeResolved: false });
  });

  test("can include the ones already dealt with", async ({ page, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest());
    await openViolations(page);

    await page.getByRole("button", { name: /unresolved only/i }).click();

    await expect(page.getByRole("button", { name: /showing all/i })).toBeVisible();
    await expect
      .poll(() => backend.lastCallTo("dialect-violations-digest")?.body)
      .toMatchObject({ includeResolved: true });
  });

  test("marks a sample resolved", async ({ page, db, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest());
    await openViolations(page);

    // "Unresolved only" also matches /resolve/i, so the sample's own control
    // has to be named exactly.
    await page.getByRole("button", { name: "Resolve", exact: true }).click();

    await expect(page.getByText("Marked resolved")).toBeVisible();
    const write = db.lastWriteTo("dialect_rule_violations");
    expect(write?.method).toBe("PATCH");
    expect(write?.payload[0]).toEqual({ resolved: true });
  });

  test("offers no resolve on one already resolved", async ({ page, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest({
      samples: [
        {
          id: "v-1",
          dialect: "Gulf",
          token: "الآن",
          function: "free-chat",
          created_at: daysAgo(1),
          snippet: "أريد أن أذهب الآن",
          resolved: true,
        },
      ],
    }));
    await openViolations(page);

    await expect(page.getByText("resolved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resolve", exact: true })).toHaveCount(0);
  });

  test("labels a sample with no source flow", async ({ page, backend }) => {
    backend.stubFunction("dialect-violations-digest", digest({
      samples: [
        {
          id: "v-1",
          dialect: "Gulf",
          token: null,
          function: null,
          created_at: daysAgo(1),
          snippet: "أريد",
          resolved: false,
        },
      ],
    }));
    await openViolations(page);

    await expect(page.getByText("unknown")).toBeVisible();
  });
});

test.describe("native review", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("dialect_rules", []);
  });

  const openReview = async (page: Page) => {
    await page.goto("/admin/dialect-rules");
    await tab(page, /native review/i).click();
  };

  test("says when there is nothing waiting", async ({ page, db }) => {
    db.seed("dialect_native_reviews", []);
    await openReview(page);

    await expect(page.getByText(/no review items/i)).toBeVisible();
  });

  test("shows a pending item with the line that was flagged", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [
      aNativeReview({ id: REVIEW, original_text: "أريد أن أذهب الآن", source_function: "free-chat" }),
    ]);
    await openReview(page);

    await expect(page.getByText("أريد أن أذهب الآن")).toBeVisible();
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
    await expect(page.getByText("free-chat")).toBeVisible();
    await expect(page.getByPlaceholder(/reviewer notes/i)).toBeVisible();
  });

  test("opens on pending, and can widen to everything", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [
      aNativeReview({ id: REVIEW, original_text: "أريد", status: "pending" }),
      aNativeReview({
        id: "f5f5f5f5-0000-4000-8000-000000000001",
        original_text: "لماذا",
        status: "dismissed",
        created_at: daysAgo(2),
      }),
    ]);
    await openReview(page);

    await expect(page.getByText("أريد")).toBeVisible();
    await expect(page.getByText("لماذا")).toHaveCount(0);

    await page.getByRole("button", { name: /^all$/i }).click();

    await expect(page.getByText("لماذا")).toBeVisible();
  });

  test("will not save an empty correction", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [aNativeReview({ id: REVIEW })]);
    await openReview(page);

    await expect(page.getByRole("button", { name: /save correction/i })).toBeDisabled();
  });

  test("a correction becomes a draft rule as well", async ({ page, db }) => {
    // This is the only place in the admin where editing one table writes into
    // another: the corrected/original pair is turned into a new draft rule so
    // the same mistake steers future generations.
    db.seed("dialect_native_reviews", [
      aNativeReview({ id: REVIEW, original_text: "أريد أن أذهب الآن" }),
    ]);
    await openReview(page);

    await page.locator("textarea.font-arabic").fill("أبي أروح هالحين");
    await page.getByPlaceholder(/reviewer notes/i).fill("Gulf speakers use أبي.");
    await page.getByRole("button", { name: /save correction/i }).click();

    await expect(page.getByText("Correction saved")).toBeVisible();

    const review = db.lastWriteTo("dialect_native_reviews");
    expect(review?.payload[0]).toMatchObject({
      status: "corrected",
      corrected_text: "أبي أروح هالحين",
      reviewer_notes: "Gulf speakers use أبي.",
      reviewer_id: TEST_USER_ID,
    });

    const drafted = db.lastWriteTo("dialect_rules");
    expect(drafted?.method).toBe("POST");
    expect(drafted?.payload[0]).toMatchObject({
      dialect: "Gulf",
      category: "native_fix",
      status: "draft",
      source: "manual",
      priority: 3,
      notes: "Auto-drafted from native review correction.",
      examples: { good: ["أبي أروح هالحين"], bad: ["أريد أن أذهب الآن"] },
    });
    expect(String(drafted?.payload[0].rule)).toContain("Gulf speakers use أبي.");
  });

  test("dismissing writes no rule at all", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [aNativeReview({ id: REVIEW })]);
    await openReview(page);

    await page.getByRole("button", { name: /dismiss/i }).click();

    await expect(page.getByText("Dismissed")).toBeVisible();
    expect(db.lastWriteTo("dialect_native_reviews")?.payload[0]).toMatchObject({
      status: "dismissed",
    });
    expect(db.writesTo("dialect_rules")).toHaveLength(0);
  });

  test("shows a finished item's correction read-only", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [
      aNativeReview({
        id: REVIEW,
        status: "corrected",
        original_text: "أريد أن أذهب الآن",
        corrected_text: "أبي أروح هالحين",
      }),
    ]);
    await openReview(page);
    await page.getByRole("button", { name: /^all$/i }).click();

    await expect(page.getByText("أبي أروح هالحين")).toBeVisible();
    await expect(page.getByRole("button", { name: /save correction/i })).toHaveCount(0);
  });

  test("reports a rejected correction", async ({ page, db }) => {
    db.seed("dialect_native_reviews", [aNativeReview({ id: REVIEW })]);
    await openReview(page);

    await page.locator("textarea.font-arabic").fill("أبي أروح هالحين");
    db.failWrites("dialect_native_reviews", 403);
    await page.getByRole("button", { name: /save correction/i }).click();

    await expect(page.getByText("Failed")).toBeVisible();
    expect(db.writesTo("dialect_rules")).toHaveLength(0);
  });
});

test.describe("who can open it", () => {
  test.beforeEach(async ({ db }) => {
    db.seed("dialect_rules", []);
  });

  test("a content reviewer may work the rulebook", async ({ page, signInAs, db }) => {
    // One of the three paths rbac.ts allow-lists for the role.
    await signInAs("content_reviewer");
    db.seed("dialect_rules", [aDialectRule({ id: ruleId(0), rule: "A draft rule." })]);

    await page.goto("/admin/dialect-rules");

    await expect(page.getByRole("heading", { name: /dialect rulebook/i })).toBeVisible();
    await expect(page.getByText("A draft rule.")).toBeVisible();
  });

  test("a recorder may too", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/dialect-rules");

    await expect(page.getByRole("heading", { name: /dialect rulebook/i })).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");
    await page.goto("/admin/dialect-rules");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
