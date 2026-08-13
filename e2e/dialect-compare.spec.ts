import { expect, test } from "./support/fixtures";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * Dialect Compare and the MSA Bridge.
 *
 * Two pages about the same thing from opposite ends. Compare takes one word and
 * shows it across five varieties; Bridge takes the *rules* that turn MSA into
 * the learner's dialect and lists them by category.
 *
 * They differ in where their content comes from, and that is what makes them
 * worth testing together: Compare asks a model per request, Bridge reads
 * `msa_transformation_rules` filtered on the active dialect and on
 * `status = published`, so an unpublished rule is invisible no matter what the
 * admin sees.
 */

const aComparison = (over: Record<string, unknown> = {}) => ({
  word_arabic: "كيف حالك",
  word_english: "How are you?",
  common_root: "ح و ل",
  cultural_notes: "Gulf speakers often answer with a blessing rather than a state.",
  dialects: [
    {
      dialect: "Gulf Arabic",
      country: "UAE",
      word: "شلونك",
      transliteration: "shlonak",
      pronunciation_notes: "The ش is soft here.",
      usage_context: "Everyday greeting between friends.",
      formality: "casual",
    },
    {
      dialect: "Egyptian Arabic",
      country: "Egypt",
      word: "ازيك",
      transliteration: "izzayyak",
      formality: "casual",
    },
    {
      dialect: "Modern Standard Arabic (MSA)",
      country: "—",
      word: "كيف حالك",
      transliteration: "kayfa haluka",
      formality: "formal",
    },
  ],
  ...over,
});

function seedCompare(db: MemoryDb) {
  db.seed("msa_transformation_rules", []);
}

async function compare(page: Page, word = "كيف حالك") {
  await page.getByPlaceholder(/Enter a word or phrase/).fill(word);
  await page.getByPlaceholder(/Enter a word or phrase/).press("Enter");
}

test.describe("comparing a word", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedCompare(db);
  });

  test("shows the word in every dialect it came back with", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);

    await expect(page.getByText("شلونك")).toBeVisible();
    await expect(page.getByText("ازيك")).toBeVisible();
    // MSA is one of the five, not a separate mode — the point of the page is
    // seeing the textbook form beside what people actually say.
    await expect(page.getByText("Modern Standard Arabic (MSA)")).toBeVisible();
  });

  test("shows the transliteration for each variant", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);

    // A learner comparing dialects is comparing *sounds*; the script alone
    // hides the difference this page exists to show.
    await expect(page.getByText("shlonak")).toBeVisible();
    await expect(page.getByText("izzayyak")).toBeVisible();
  });

  test("marks how formal each variant is", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);

    await expect(page.getByText("formal", { exact: true })).toBeVisible();
    await expect(page.getByText("casual").first()).toBeVisible();
  });

  test("shows the shared root and the cultural note", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);

    await expect(page.getByText("ح و ل")).toBeVisible();
    await expect(page.getByText(/answer with a blessing/)).toBeVisible();
  });

  test("leaves out the note and the root when there are none", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", {
      comparison: aComparison({ common_root: undefined, cultural_notes: undefined }),
    });

    await page.goto("/dialect-compare");
    await compare(page);

    await expect(page.getByText("شلونك")).toBeVisible();
    // Both are optional; an empty "Root:" line reads as a missing answer rather
    // than a word with no shared root.
    await expect(page.getByText("Cultural Notes")).toHaveCount(0);
    await expect(page.getByText(/^Root:/)).toHaveCount(0);
  });

  test("carries the per-variant pronunciation and usage notes", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);

    await expect(page.getByText(/The ش is soft here/)).toBeVisible();
    await expect(page.getByText(/Everyday greeting between friends/)).toBeVisible();
  });

  test("sends the word that was typed", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page, "  شكراً  ");

    await expect(page.getByText("شلونك")).toBeVisible();
    // Trimmed, because a trailing space from a paste changes nothing about the
    // word but does change the cache key on the model's side.
    expect(backend.lastCallTo("dialect-compare")?.body).toMatchObject({ word: "شكراً" });
  });

  test("always compares from Gulf, whatever the learner is studying", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Egyptian" } });
    seedCompare(db);
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);
    await expect(page.getByText("شلونك")).toBeVisible();

    // Pinned as-is. `source_dialect` is hardcoded to "Gulf" and the page never
    // reads `useDialect`, so an Egyptian learner asks "how does this Gulf word
    // differ elsewhere?" — the reverse of what they want. Every other page in
    // the app is dialect-aware.
    expect(backend.lastCallTo("dialect-compare")?.body).toMatchObject({
      source_dialect: "Gulf",
    });
  });
});

test.describe("getting started", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedCompare(db);
  });

  test("offers examples on a cold page", async ({ page }) => {
    await page.goto("/dialect-compare");

    // The page needs a word to do anything, and a learner who does not yet know
    // the dialects cannot supply an interesting one.
    await expect(page.getByText("Try these examples:")).toBeVisible();
    await expect(page.getByRole("button", { name: /كيف حالك/ })).toBeVisible();
  });

  test("runs a comparison straight from an example", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await page.getByRole("button", { name: /شكراً/ }).click();

    await expect(page.getByText("شلونك")).toBeVisible();
    expect(backend.lastCallTo("dialect-compare")?.body).toMatchObject({ word: "شكراً" });
  });

  test("hides the examples once there is a result", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);
    await expect(page.getByText("شلونك")).toBeVisible();

    await expect(page.getByText("Try these examples:")).toHaveCount(0);
  });

  test("brings the examples back on Compare Another Word", async ({ page, backend }) => {
    backend.stubFunction("dialect-compare", { comparison: aComparison() });

    await page.goto("/dialect-compare");
    await compare(page);
    await expect(page.getByText("شلونك")).toBeVisible();

    await page.getByRole("button", { name: "Compare Another Word" }).click();

    await expect(page.getByText("Try these examples:")).toBeVisible();
    await expect(page.getByPlaceholder(/Enter a word or phrase/)).toHaveValue("");
  });

  test("will not submit an empty box", async ({ page, backend }) => {
    await page.goto("/dialect-compare");

    // The submit control is icon-only and unnamed, like several others in the
    // app — located by its icon and counted against that baseline.
    await expect(page.locator("button:has(svg.lucide-search)")).toBeDisabled();
    await page.getByPlaceholder(/Enter a word or phrase/).press("Enter");
    expect(backend.callsTo("dialect-compare")).toHaveLength(0);
  });

  test("will not submit whitespace", async ({ page, backend }) => {
    await page.goto("/dialect-compare");
    await page.getByPlaceholder(/Enter a word or phrase/).fill("   ");

    await expect(page.locator("button:has(svg.lucide-search)")).toBeDisabled();
    expect(backend.callsTo("dialect-compare")).toHaveLength(0);
  });

  test("says so when the comparison fails", async ({
    page,
    backend,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("dialect-compare", 500, { error: "model unavailable" });

    await page.goto("/dialect-compare");
    await compare(page);

    // Pinned: the message is generic, so a daily cap and an outage read
    // identically here — unlike the other AI helpers, which surface the
    // function's own message.
    await expect(page.getByText("Failed to compare dialects. Please try again.")).toBeVisible();
  });
});

test.describe("the MSA bridge", () => {
  const aRule = (over: Record<string, unknown> = {}) => ({
    id: "rule-1",
    dialect: "Gulf",
    category: "sound_shift",
    rule_name: "ق becomes گ",
    msa_pattern: "قَلْب",
    dialect_pattern: "galb",
    example_msa: "قَلْبي",
    example_dialect: "galbi",
    notes: "Common across the Gulf, not universal.",
    status: "published",
    display_order: 1,
    example_audio_url: null,
    ...over,
  });

  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists the rules for the learner's dialect", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");

    await expect(page.getByText("ق becomes گ")).toBeVisible();
    await expect(page.getByText("قَلْبي")).toBeVisible();
    await expect(page.getByText("galbi")).toBeVisible();
  });

  test("groups the rules by what kind of change they are", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [
      aRule({ id: "r1", category: "sound_shift", rule_name: "A sound rule" }),
      aRule({ id: "r2", category: "pronoun", rule_name: "A pronoun rule" }),
      aRule({ id: "r3", category: "verb_prefix", rule_name: "A prefix rule" }),
      aRule({ id: "r4", category: "vocab_swap", rule_name: "A vocab rule" }),
    ]);

    await page.goto("/bridge");

    // Four fixed categories, in a fixed order — sound shifts first because they
    // are the change a reader of MSA notices before any of the others.
    for (const heading of ["Sound shifts", "Pronouns", "Verb prefixes", "Vocabulary swaps"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("shows no heading for a category with no rules", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule({ category: "pronoun" })]);

    await page.goto("/bridge");

    await expect(page.getByRole("heading", { name: "Pronouns" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sound shifts" })).toHaveCount(0);
  });

  test("counts the rules in each category", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [
      aRule({ id: "r1", category: "pronoun", rule_name: "One" }),
      aRule({ id: "r2", category: "pronoun", rule_name: "Two" }),
    ]);

    await page.goto("/bridge");

    await expect(page.getByText("2 rules")).toBeVisible();
  });

  test("says rule rather than rules for a single one", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule({ category: "pronoun" })]);

    await page.goto("/bridge");

    await expect(page.getByText("1 rule")).toBeVisible();
  });

  test("asks the database for published rules in the active dialect only", async ({
    page,
    db,
  }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");
    await expect(page.getByText("ق becomes گ")).toBeVisible();

    // Both filters matter. Without `status`, a half-written rule an admin is
    // still drafting appears to every learner; without `dialect`, an Egyptian
    // learner is taught Gulf sound shifts.
    const read = db.readsOf("msa_transformation_rules").at(-1);
    expect(read?.search).toContain("status=eq.published");
    expect(read?.search).toContain("dialect=eq.Gulf");
    expect(read?.search).toContain("display_order.asc");
  });

  test("says so when a dialect has no rules yet", async ({ page, db }) => {
    db.seed("msa_transformation_rules", []);

    await page.goto("/bridge");

    // Named as "coming soon" rather than shown as an error — the content is
    // authored per dialect and lags behind.
    await expect(page.getByText(/No bridge rules for/)).toBeVisible();
  });

  test("turns Bridge view on across the app", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");
    await page.getByRole("switch", { name: "Toggle Bridge view" }).click();

    // The switch is the page's actual product — the rule list is documentation,
    // and this is what changes flashcards, lessons, transcripts and reading.
    await expect
      .poll(() => db.rows("profiles")[0]?.bridge_view_enabled)
      .toBe(true);
  });

  test("remembers Bridge view after a reload", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");
    await page.getByRole("switch", { name: "Toggle Bridge view" }).click();
    await expect.poll(() => db.rows("profiles")[0]?.bridge_view_enabled).toBe(true);

    await page.reload();

    // localStorage is the source of truth and the profile is the sync target,
    // so the setting survives a reload without waiting on a round trip.
    await expect(page.getByRole("switch", { name: "Toggle Bridge view" })).toBeChecked();
  });

  test("records how much MSA the learner already has", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");
    await page.getByRole("button", { name: "Advanced / fluent" }).click();

    await expect.poll(() => db.rows("profiles")[0]?.msa_background).toBe("advanced");
  });

  test("turns Bridge on and leaves from the footer", async ({ page, db }) => {
    db.seed("msa_transformation_rules", [aRule()]);

    await page.goto("/bridge");
    await page.getByRole("button", { name: "Turn on Bridge & go home" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => db.rows("profiles")[0]?.bridge_view_enabled).toBe(true);
  });
});
