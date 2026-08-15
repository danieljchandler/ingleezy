import { expect, test, type Page } from "./support/fixtures";
import {
  aSetPhrase,
  aSetPhraseOccasion,
  daysAgo,
  iso,
  many,
  occasionId,
  setPhraseId,
} from "../src/test/support/factories";

/**
 * `/admin/set-phrases` — the editorial queue for the set-phrase deck.
 *
 * It is three surfaces stacked in one page, each writing to a different place:
 * an occasions card that seeds `set_phrase_occasions` directly, an AI card that
 * generates drafts through `request-situation-phrases` and inserts them one at
 * a time, and a phrase list with inline edit, approve/unapprove and delete.
 *
 * All three write with `sb.from(...)` — the untyped escape hatch — so the
 * compiler checks nothing here. That is exactly the surface where the in-memory
 * backend's column guard earns its keep, and why every write below is asserted
 * against the journal rather than against a toast.
 */

/**
 * The phrase rows in the list, scoped so the generated-draft cards in the AI
 * section above cannot be mistaken for them. Both use `p-3 rounded-lg border`;
 * only the list rows add `space-y-2`.
 */
const phraseRows = (page: Page) => page.locator("div.p-3.border.rounded-lg.space-y-2");

/**
 * The eight inline-edit fields, in DOM order:
 * phrase arabic / transliteration / english, reply arabic / transliteration /
 * english, scenario, cultural note.
 *
 * Positional rather than by label on purpose — see the pinned spec below about
 * the labels not being associated with their controls.
 */
const editField = (page: Page, index: number) => phraseRows(page).first().getByRole("textbox").nth(index);

/**
 * An occasion chip in the occasions card.
 *
 * Scoped to the badge element because every occasion name is also rendered as
 * an `<option>` in the AI card's picker, so a bare text match is ambiguous.
 */
const occasionChip = (page: Page, name: string) =>
  page.locator("div.rounded-full").filter({ hasText: new RegExp(`^${name}$`) });

test.describe("occasions", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists the occasions for the active dialect", async ({ page, db }) => {
    db.seed("set_phrase_occasions", [
      aSetPhraseOccasion({ id: occasionId(0), name: "Greetings" }),
      aSetPhraseOccasion({ id: occasionId(1), name: "Eid", slug: "eid", display_order: 1 }),
    ]);

    await page.goto("/admin/set-phrases");

    await expect(page.getByText("Occasions (2)")).toBeVisible();
    await expect(occasionChip(page, "Greetings")).toBeVisible();
    await expect(occasionChip(page, "Eid")).toBeVisible();
  });

  test("hides occasions belonging to another dialect", async ({ page, db }) => {
    db.seed("set_phrase_occasions", [
      aSetPhraseOccasion({ id: occasionId(0), name: "Greetings", dialect: "Gulf" }),
      aSetPhraseOccasion({
        id: occasionId(1),
        name: "Egyptian only",
        slug: "eg",
        dialect: "Egyptian",
      }),
    ]);

    await page.goto("/admin/set-phrases");

    await expect(page.getByText("Occasions (1)")).toBeVisible();
    await expect(page.getByText("Egyptian only")).toHaveCount(0);
  });

  test("follows the dialect switcher in the admin bar", async ({ page, db }) => {
    db.seed("set_phrase_occasions", [
      aSetPhraseOccasion({ id: occasionId(0), name: "Greetings", dialect: "Gulf" }),
      aSetPhraseOccasion({
        id: occasionId(1),
        name: "Egyptian only",
        slug: "eg",
        dialect: "Egyptian",
      }),
    ]);

    await page.goto("/admin/set-phrases");
    await expect(occasionChip(page, "Greetings")).toBeVisible();

    await page.getByRole("button", { name: /Egyptian Arabic/ }).click();

    await expect(occasionChip(page, "Egyptian only")).toBeVisible();
    await expect(occasionChip(page, "Greetings")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Set Phrases \(Egyptian\)/ })).toBeVisible();
  });

  test("offers the starter set when the dialect has no occasions", async ({ page, db }) => {
    db.seed("set_phrase_occasions", []);
    await page.goto("/admin/set-phrases");

    await expect(page.getByText(/no occasions yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /add 12 starter occasions/i })).toBeVisible();
  });

  test("writes twelve occasions for the active dialect", async ({ page, db }) => {
    db.seed("set_phrase_occasions", []);
    await page.goto("/admin/set-phrases");

    await page.getByRole("button", { name: /add 12 starter occasions/i }).click();

    await expect(page.getByText(/starter occasions added/i)).toBeVisible();
    const rows = db.rows("set_phrase_occasions");
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.dialect === "Gulf")).toBe(true);
    expect(rows.map((row) => row.slug)).toContain("funeral");
    // Every starter lands published, so the learner deck picks them up with no
    // second approval step — unlike the phrases themselves, which land draft.
    expect(rows.every((row) => row.status === "published")).toBe(true);
  });

  test(
    "reports the starter set as added even when every insert was rejected",
    async ({ page, db }) => {
      // Pinned, not fixed. The loop is `await sb...insert(...).then(() => {})`,
      // and a PostgREST error resolves rather than throws — so twelve failed
      // writes produce the same green toast as twelve successful ones, and the
      // admin is left believing the set exists.
      db.seed("set_phrase_occasions", []);
      await page.goto("/admin/set-phrases");

      db.failWrites("set_phrase_occasions", 403);
      await page.getByRole("button", { name: /add 12 starter occasions/i }).click();

      await expect(page.getByText(/starter occasions added/i)).toBeVisible();
      expect(db.rows("set_phrase_occasions")).toHaveLength(0);
      await expect(page.getByText(/no occasions yet/i)).toBeVisible();
    },
  );

  test("cannot seed phrases until an occasion exists", async ({ page, db }) => {
    db.seed("set_phrase_occasions", []);
    await page.goto("/admin/set-phrases");

    await expect(page.getByRole("button", { name: /seed 10 phrases per occasion/i })).toBeDisabled();
  });

  test("seeds phrases for the active dialect and reports the tally", async ({
    page,
    db,
    backend,
  }) => {
    db.seed("set_phrase_occasions", [aSetPhraseOccasion({ id: occasionId(0) })]);
    backend.stubFunction("seed-set-phrases", {
      summary: [
        { occasion: "Greetings", inserted: 10 },
        { occasion: "Eid", inserted: 7 },
      ],
    });

    await page.goto("/admin/set-phrases");
    await page.getByRole("button", { name: /seed 10 phrases per occasion/i }).click();

    await expect(page.getByText("Seeded: Greetings (10), Eid (7)")).toBeVisible();
    expect(backend.lastCallTo("seed-set-phrases")?.body).toMatchObject({ dialect: "Gulf" });
  });

  test("says so when seeding fails", async ({ page, db, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);

    db.seed("set_phrase_occasions", [aSetPhraseOccasion({ id: occasionId(0) })]);
    backend.stubFunctionFailure("seed-set-phrases", 500);

    await page.goto("/admin/set-phrases");
    await page.getByRole("button", { name: /seed 10 phrases per occasion/i }).click();

    await expect(page.getByText(/non-2xx status code/i)).toBeVisible();
    await expect(page.getByText(/^Seeded:/)).toHaveCount(0);
  });
});

test.describe("the phrase queue", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("set_phrase_occasions", [aSetPhraseOccasion({ id: occasionId(0), name: "Greetings" })]);
  });

  test("says when there is nothing to review", async ({ page, db }) => {
    db.seed("set_phrases", []);
    await page.goto("/admin/set-phrases");

    await expect(page.getByText(/no phrases yet/i)).toBeVisible();
    await expect(page.getByText("Phrases (0)")).toBeVisible();
  });

  test("shows a phrase with its reply, occasion and grading", async ({ page, db }) => {
    db.seed("set_phrases", [
      aSetPhrase({
        phrase_arabic: "صباح الخير",
        phrase_english: "good morning",
        reply_arabic: "صباح النور",
        occasion_id: occasionId(0),
        difficulty: "A1",
        formality: "informal",
      }),
    ]);

    await page.goto("/admin/set-phrases");

    await expect(page.getByText("صباح الخير")).toBeVisible();
    await expect(page.getByText("good morning")).toBeVisible();
    await expect(page.getByText("صباح النور")).toBeVisible();
    await expect(occasionChip(page, "Greetings")).toHaveCount(2);
    await expect(page.getByText("A1", { exact: true })).toBeVisible();
    await expect(page.getByText("informal", { exact: true })).toBeVisible();
  });

  test("lists the newest phrase first", async ({ page, db }) => {
    db.seed(
      "set_phrases",
      many(aSetPhrase, 3, (index) => ({
        id: setPhraseId(index),
        phrase_english: `phrase ${index}`,
        created_at: new Date(Date.now() - index * 60_000).toISOString(),
      })),
    );

    await page.goto("/admin/set-phrases");

    await expect(phraseRows(page)).toHaveCount(3);
    await expect(phraseRows(page).first()).toContainText("phrase 0");
    await expect(phraseRows(page).last()).toContainText("phrase 2");
  });

  test("hides phrases from another dialect", async ({ page, db }) => {
    db.seed("set_phrases", [
      aSetPhrase({ id: setPhraseId(0), phrase_english: "gulf one", dialect: "Gulf" }),
      aSetPhrase({ id: setPhraseId(1), phrase_english: "cairo one", dialect: "Egyptian" }),
    ]);

    await page.goto("/admin/set-phrases");

    await expect(page.getByText("Phrases (1)")).toBeVisible();
    await expect(page.getByText("cairo one")).toHaveCount(0);
  });

  test("publishes a draft", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase({ status: "draft" })]);
    await page.goto("/admin/set-phrases");

    await page.getByRole("button", { name: /^Approve$/ }).click();

    await expect(page.getByText(/approved & published/i)).toBeVisible();
    expect(db.lastWriteTo("set_phrases")).toMatchObject({ method: "PATCH" });
    expect(db.lastWriteTo("set_phrases")?.payload[0]).toMatchObject({ status: "published" });
    await expect(page.getByRole("button", { name: /^Approved$/ })).toBeVisible();
  });

  test("sends a published phrase back to draft", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase({ status: "published" })]);
    await page.goto("/admin/set-phrases");

    await page.getByRole("button", { name: /^Approved$/ }).click();

    await expect(page.getByText(/moved back to draft/i)).toBeVisible();
    expect(db.lastWriteTo("set_phrases")?.payload[0]).toMatchObject({ status: "draft" });
  });

  test("claims a publish succeeded even when the update was rejected", async ({ page, db }) => {
    // Pinned, not fixed. `togglePublish` never looks at the error — it toasts
    // and refetches regardless, so a phrase that stayed draft reads as approved
    // until the refetch lands and silently flips the button back.
    db.seed("set_phrases", [aSetPhrase({ status: "draft" })]);
    await page.goto("/admin/set-phrases");

    db.failWrites("set_phrases", 403);
    await page.getByRole("button", { name: /^Approve$/ }).click();

    await expect(page.getByText(/approved & published/i)).toBeVisible();
    expect(db.rows("set_phrases")[0].status).toBe("draft");
  });

  test("edits a phrase in place", async ({ page, db }) => {
    db.seed("set_phrases", [
      aSetPhrase({ phrase_arabic: "صباح الخير", phrase_english: "good morning" }),
    ]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-pencil)").click();

    await expect(editField(page, 0)).toHaveValue("صباح الخير");
    await expect(editField(page, 2)).toHaveValue("good morning");

    await editField(page, 2).fill("morning greeting");
    await editField(page, 3).fill("صباح النور");
    await editField(page, 7).fill("Said before noon.");
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(db.lastWriteTo("set_phrases")).toMatchObject({ method: "PATCH" });
    expect(db.lastWriteTo("set_phrases")?.payload[0]).toMatchObject({
      phrase_arabic: "صباح الخير",
      phrase_english: "morning greeting",
      reply_arabic: "صباح النور",
      cultural_note: "Said before noon.",
    });
    await expect(page.getByText("morning greeting")).toBeVisible();
  });

  test("does not associate the edit labels with their fields", async ({ page, db }) => {
    // Pinned, not fixed. Every field is a bare `<label>` with no `htmlFor` and
    // no wrapping, so nothing connects "Phrase (Arabic)" to the input beneath
    // it — a screen reader reads eight unlabelled boxes, and a test can only
    // reach them by position.
    db.seed("set_phrases", [aSetPhrase()]);
    await page.goto("/admin/set-phrases");
    await phraseRows(page).first().locator("button:has(svg.lucide-pencil)").click();

    await expect(page.getByText("Phrase (Arabic)")).toBeVisible();
    await expect(page.getByLabel("Phrase (Arabic)")).toHaveCount(0);
    await expect(editField(page, 0)).toHaveAttribute("dir", "rtl");
  });

  test("cancelling an edit writes nothing", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase({ phrase_english: "good morning" })]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-pencil)").click();
    await editField(page, 2).fill("something else");
    await page.getByRole("button", { name: /^Cancel$/ }).click();

    await expect(page.getByText("good morning")).toBeVisible();
    expect(db.writesTo("set_phrases")).toHaveLength(0);
  });

  test("keeps the editor open when the save is rejected", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase({ phrase_english: "good morning" })]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-pencil)").click();
    await editField(page, 2).fill("morning greeting");

    db.failWrites("set_phrases", 403);
    await page.getByRole("button", { name: /^Save$/ }).click();

    await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
    await expect(editField(page, 2)).toHaveValue("morning greeting");
  });

  test("edits only one phrase at a time", async ({ page, db }) => {
    db.seed("set_phrases", [
      aSetPhrase({ id: setPhraseId(0), phrase_english: "first", created_at: iso() }),
      aSetPhrase({ id: setPhraseId(1), phrase_english: "second", created_at: daysAgo(1) }),
    ]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-pencil)").click();

    await expect(page.getByRole("button", { name: /^Save$/ })).toHaveCount(1);
    await expect(phraseRows(page).last()).toContainText("second");
  });

  test("asks before deleting, and names what goes with it", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase({ phrase_arabic: "صباح الخير" })]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-trash2)").click();

    await expect(page.getByRole("heading", { name: /delete this phrase/i })).toBeVisible();
    await expect(page.getByText(/user review history/i)).toBeVisible();
    expect(db.writesTo("set_phrases")).toHaveLength(0);
  });

  test("deletes once confirmed", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase()]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /^Delete$/ }).click();

    await expect(page.getByText(/phrase deleted/i)).toBeVisible();
    expect(db.rows("set_phrases")).toHaveLength(0);
    await expect(page.getByText(/no phrases yet/i)).toBeVisible();
  });

  test("cancelling the dialog keeps the phrase", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase()]);
    await page.goto("/admin/set-phrases");

    await phraseRows(page).first().locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /^Cancel$/ }).click();

    expect(db.rows("set_phrases")).toHaveLength(1);
    await expect(phraseRows(page)).toHaveCount(1);
  });

  test("reports a rejected delete instead of pretending it worked", async ({ page, db }) => {
    db.seed("set_phrases", [aSetPhrase()]);
    await page.goto("/admin/set-phrases");

    db.failWrites("set_phrases", 403);
    await phraseRows(page).first().locator("button:has(svg.lucide-trash2)").click();
    await page.getByRole("button", { name: /^Delete$/ }).click();

    await expect(page.getByText(/phrase deleted/i)).toHaveCount(0);
    expect(db.rows("set_phrases")).toHaveLength(1);
  });
});

test.describe("requesting phrases for a situation", () => {
  const generated = [
    {
      phrase_arabic: "الله يرحمه",
      phrase_english: "May God have mercy on him",
      transliteration: "allah yarhamu",
      notes: "Said on hearing of a death.",
    },
    {
      phrase_arabic: "البقاء لله",
      phrase_english: "Permanence belongs to God",
      transliteration: "al-baqa lillah",
      notes: "",
    },
  ];

  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("set_phrase_occasions", [
      aSetPhraseOccasion({ id: occasionId(0), name: "Greetings" }),
      aSetPhraseOccasion({ id: occasionId(1), name: "Funeral", slug: "funeral" }),
    ]);
    db.seed("set_phrases", []);
  });

  test("refuses a situation too short to act on", async ({ page, backend }) => {
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("hi");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText(/describe the situation in a sentence/i)).toBeVisible();
    expect(backend.callsTo("request-situation-phrases")).toHaveLength(0);
  });

  test("fills the box from a suggestion chip", async ({ page }) => {
    await page.goto("/admin/set-phrases");

    await page.getByRole("button", { name: "Bargaining at the souq" }).click();

    await expect(page.getByPlaceholder(/Comforting someone/)).toHaveValue("Bargaining at the souq");
  });

  test("asks for the situation, dialect and count", async ({ page, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("  Comforting a grieving friend  ");
    await page.locator("select").last().selectOption("10");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText("2 phrases")).toBeVisible();
    // Trimmed before sending: the same trimmed string is what gets stored as
    // the scenario on every inserted draft.
    expect(backend.lastCallTo("request-situation-phrases")?.body).toEqual({
      situation: "Comforting a grieving friend",
      dialect: "Gulf",
      count: 10,
    });
  });

  test("renders each generated phrase with its gloss and note", async ({ page, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText("الله يرحمه")).toBeVisible();
    await expect(page.getByText("allah yarhamu")).toBeVisible();
    await expect(page.getByText("May God have mercy on him")).toBeVisible();
    await expect(page.getByText("Said on hearing of a death.")).toBeVisible();
  });

  test("says so when the model returns nothing usable", async ({ page, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: [] });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText(/no phrases returned/i)).toBeVisible();
  });

  test("surfaces an error the function reports in its body", async ({ page, backend }) => {
    // A 200 carrying `{ error }` is the shape the function uses for a handled
    // failure, and the card unwraps `message` in preference to `error`.
    backend.stubFunction("request-situation-phrases", {
      error: "credits_exhausted",
      message: "AI credits exhausted.",
    });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText("AI credits exhausted.")).toBeVisible();
  });

  test("surfaces a non-2xx failure", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("request-situation-phrases", 500);
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    await expect(page.getByText(/non-2xx status code/i)).toBeVisible();
  });

  test("saves one generated phrase as a draft", async ({ page, db, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();

    await expect(page.getByText(/added to drafts/i)).toBeVisible();
    expect(db.lastWriteTo("set_phrases")).toMatchObject({ method: "POST" });
    expect(db.lastWriteTo("set_phrases")?.payload[0]).toMatchObject({
      dialect: "Gulf",
      occasion_id: null,
      phrase_arabic: "الله يرحمه",
      phrase_phonetic_ar: "allah yarhamu",
      phrase_english: "May God have mercy on him",
      cultural_note: "Said on hearing of a death.",
      scenario_english: "Comforting a grieving friend",
      formality: "neutral",
      difficulty: "A2",
      status: "draft",
      tags: ["situation-request"],
    });
  });

  test("attaches the chosen occasion", async ({ page, db, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.locator("select").first().selectOption({ label: "Funeral" });
    await page.getByRole("button", { name: /generate phrases/i }).click();
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();

    await expect(page.getByText(/added to drafts/i)).toBeVisible();
    expect(db.lastWriteTo("set_phrases")?.payload[0]).toMatchObject({
      occasion_id: occasionId(1),
    });
  });

  test("marks a saved phrase as added and stops offering it", async ({ page, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();

    await expect(page.getByRole("button", { name: /^Added$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Add to drafts$/ })).toHaveCount(1);
  });

  test("adds the remaining phrases in one go", async ({ page, db, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();
    await expect(page.getByRole("button", { name: /^Added$/ })).toHaveCount(1);

    await page.getByRole("button", { name: /add all to drafts/i }).click();

    // One already saved, so only the second is written and only it is counted.
    await expect(page.getByText("Added 1 draft phrases for review")).toBeVisible();
    expect(db.writesTo("set_phrases")).toHaveLength(2);
    await expect(page.getByRole("button", { name: /^Added$/ })).toHaveCount(2);
  });

  test("counts only the inserts that worked", async ({ page, db, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    db.failWrites("set_phrases", 403);
    await page.getByRole("button", { name: /add all to drafts/i }).click();

    await expect(page.getByText("Added 0 draft phrases for review")).toBeVisible();
    expect(db.rows("set_phrases")).toHaveLength(0);
  });

  test("shows a rejected single save as a failure", async ({ page, db, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();

    db.failWrites("set_phrases", 403);
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();

    await expect(page.getByText(/added to drafts/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Added$/ })).toHaveCount(0);
  });

  test("saved drafts appear in the review queue below", async ({ page, backend }) => {
    backend.stubFunction("request-situation-phrases", { phrases: generated });
    await page.goto("/admin/set-phrases");

    await page.getByPlaceholder(/Comforting someone/).fill("Comforting a grieving friend");
    await page.getByRole("button", { name: /generate phrases/i }).click();
    await page.getByRole("button", { name: /^Add to drafts$/ }).first().click();

    await expect(page.getByText("Phrases (1)")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve$/ })).toBeVisible();
  });
});

test.describe("who can open it", () => {
  test("a content reviewer may work the queue", async ({ page, signInAs, db }) => {
    // /admin/set-phrases is one of three paths rbac.ts allow-lists for the
    // content_reviewer role, and it is the whole point of that role.
    await signInAs("content_reviewer");
    db.seed("set_phrase_occasions", [aSetPhraseOccasion({ id: occasionId(0) })]);
    db.seed("set_phrases", [aSetPhrase({ phrase_english: "good morning" })]);

    await page.goto("/admin/set-phrases");

    await expect(page.getByRole("heading", { name: /Set Phrases \(Gulf\)/ })).toBeVisible();
    await expect(page.getByText("good morning")).toBeVisible();
  });

  test("a recorder may too", async ({ page, signInAs, db }) => {
    await signInAs("recorder");
    db.seed("set_phrase_occasions", []);
    db.seed("set_phrases", []);

    await page.goto("/admin/set-phrases");

    await expect(page.getByRole("heading", { name: /Set Phrases \(Gulf\)/ })).toBeVisible();
  });

  test("a signed-in learner is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("free");

    await page.goto("/admin/set-phrases");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a signed-out visitor is sent to the admin login", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/admin/set-phrases");

    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("the back arrow", () => {
  test("leads to a route that does not exist", async ({ page, signInAs, db }) => {
    // Pinned, not fixed. The dashboard is the index route of /admin; there is
    // no /admin/dashboard, so the only navigation control on this page lands
    // the admin on the 404 screen.
    await signInAs("admin");
    db.seed("set_phrase_occasions", []);
    db.seed("set_phrases", []);
    await page.goto("/admin/set-phrases");

    await page.locator("button:has(svg.lucide-arrow-left)").click();

    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByText(/404/)).toBeVisible();
  });
});
