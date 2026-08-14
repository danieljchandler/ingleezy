import { test, expect } from "@playwright/test";
import { signIn, stubSupabase, TEST_USER_ID, wordId } from "./support/supabase";

test.describe("signed out", () => {
  test("landing page renders with a sign-up call to action", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /real spoken arabic/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /join the beta/i })).toBeVisible();
  });

  test("protected routes redirect to /auth", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/review");

    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: /أهلاً بعودتك/ })).toBeVisible();
  });

  test("/today still resolves after the page was merged into Home", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/today");

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});

test.describe("signed in — home", () => {
  test("shows the daily queue inline instead of linking to a separate page", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { myWordsDue: 3 });
    await page.goto("/");

    // The queue itself, not a "Start today" card that navigates elsewhere.
    await expect(page.getByRole("heading", { name: "اليوم", exact: true })).toBeVisible();
    await expect(page.getByText(/أنجزت \d+ من \d+ مهام/)).toBeVisible();
    await expect(page.getByRole("button", { name: /start today/i })).toHaveCount(0);
  });

  test("due banner counts every deck and routes into the session", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 3 });
    await page.goto("/");

    // 2 curriculum + 3 saved words — the banner used to show only one deck.
    const banner = page.getByRole("button", { name: /5 بطاقات مستحقة للمراجعة/ });
    await expect(banner).toBeVisible();

    await banner.click();
    await expect(page).toHaveURL(/\/review$/);
  });
});

test.describe("signed in — analytics", () => {
  test("word mastery reflects live SRS state, not a frozen stage column", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: {
        // Two well-established cards: high stability, several reviews. Read from
        // the persisted `stage` column these would show as New forever, since
        // only the Anki importer ever writes it.
        //
        // user_id is required now that the backend applies the query's filters —
        // the page scopes this read to the signed-in learner.
        user_vocabulary: [
          { id: "v1", user_id: TEST_USER_ID, repetitions: 9, ease_factor: 120, review_count: 9, correct_count: 8, word_arabic: "أ", word_english: "a" },
          { id: "v2", user_id: TEST_USER_ID, repetitions: 7, ease_factor: 90, review_count: 7, correct_count: 7, word_arabic: "ب", word_english: "b" },
        ],
      },
    });
    await page.goto("/analytics");

    const mastered = page.locator("div").filter({ hasText: /^Mastered/ }).first();
    await expect(mastered).toContainText("2");
    await expect(mastered).toContainText("100%");
  });
});

test.describe("signed in — review session", () => {
  test("shows a curriculum card with session-wide progress", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 2, myWordsDue: 4, phrasesDue: 1 });
    await page.goto("/review");

    await expect(page.getByText("word 1")).toBeVisible();
    // Progress spans the whole day, not just the deck in front of you.
    await expect(page.getByText(/المنهج · 1 \/ 2 مستحقة · 5 أخرى في مجموعات ثانية/)).toBeVisible();
  });

  test("forwards past an empty deck into one that has cards", async ({ page }) => {
    await signIn(page);
    // Nothing in curriculum, work waiting in saved words.
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 3 });
    await page.goto("/review");

    await expect(page).toHaveURL(/\/review\/my-words$/);
    await expect(page.getByText(/كلماتي · 1 \/ 3 مستحقة/)).toBeVisible();
  });

  test("offers the next deck instead of dead-ending when a deck is clear", async ({ page }) => {
    await signIn(page);
    // Saved words are clear, but phrases are still due.
    await stubSupabase(page, { myWordsDue: 0, phrasesDue: 2 });
    await page.goto("/review/my-words");

    await expect(page.getByRole("heading", { name: /أنهيت هذه المجموعة/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "تابع مع بطاقتان في عباراتي" })).toBeVisible();
  });

  test("reports the session finished when every deck is clear", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { curriculumDue: 0, myWordsDue: 0, phrasesDue: 0 });
    await page.goto("/review/my-words");

    await expect(page.getByRole("heading", { name: /أنجزت كل المراجعات/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /تابع مع/ })).toHaveCount(0);
  });
});

test.describe("signed in — curriculum", () => {
  const STAGE_ID = "55555555-0000-4000-8000-000000000001";
  const LESSON_A = "66666666-0000-4000-8000-000000000001";
  const LESSON_B = "66666666-0000-4000-8000-000000000002";

  const curriculumTables = (progress: Record<string, unknown>[] = []) => ({
    curriculum_stages: [
      {
        id: STAGE_ID,
        name: "Foundations",
        name_arabic: "الأساسيات",
        stage_number: 1,
        cefr_level: "A1",
        description: null,
        display_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    lessons: [
      {
        id: LESSON_A,
        stage_id: STAGE_ID,
        title: "Greetings",
        title_arabic: "تحيات",
        icon: "📚",
        gradient: "bg-gradient-green",
        display_order: 1,
        dialect_module: "Gulf",
        cefr_target: "A1",
        duration_minutes: 15,
        unlock_condition: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: LESSON_B,
        stage_id: STAGE_ID,
        title: "At the Market",
        title_arabic: "في السوق",
        icon: "📚",
        gradient: "bg-gradient-green",
        display_order: 2,
        dialect_module: "Gulf",
        cefr_target: "A1",
        duration_minutes: 15,
        // Deliberately does not contain either lesson title — the specs locate
        // lesson rows by their name, and this text is part of the same link.
        unlock_condition: "Finish the previous lesson first",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    // Real rows rather than a pre-shaped embed. The curriculum page counts a
    // lesson's words through `vocabulary_words(id)`, and the backend resolves
    // that relationship itself now — so the words have to exist and point at
    // their lesson, exactly as they would in the database.
    vocabulary_words: [
      { id: wordId(1), lesson_id: LESSON_A, word_arabic: "كلمة1", word_english: "word 1" },
      { id: wordId(2), lesson_id: LESSON_A, word_arabic: "كلمة2", word_english: "word 2" },
      { id: wordId(3), lesson_id: LESSON_B, word_arabic: "كلمة3", word_english: "word 3" },
    ],
    lesson_progress: progress,
  });

  test("lists stages with their lessons — the curriculum used to be admin-only", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    await expect(page.getByRole("heading", { name: "Foundations" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Greetings/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /At the Market/ })).toBeVisible();

    // Gating is soft: `unlock_condition` is advice printed under the lesson, not
    // something that stops the link working. Asserting it renders keeps the
    // column alive in the fixtures — it is one of the columns missing from the
    // generated types, so nothing else would catch it being dropped.
    await expect(page.getByRole("link", { name: /At the Market/ })).toContainText(
      "Finish the previous lesson first",
    );
  });

  test("marks exactly one lesson as next up", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    // One obvious next action, not a wall of equally-weighted rows.
    await expect(page.getByText("Next up")).toHaveCount(1);
  });

  test("shows a completed lesson with its best score, and moves next up along", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: curriculumTables([
        {
          user_id: TEST_USER_ID,
          lesson_id: LESSON_A,
          status: "completed",
          last_word_index: 0,
          words_seen: 2,
          words_total: 2,
          best_score: 90,
          completed_at: new Date().toISOString(),
        },
      ]),
    });
    await page.goto("/curriculum");

    await expect(page.getByText(/Completed · best 90%/)).toBeVisible();
    const nextUp = page.getByRole("link", { name: /At the Market/ });
    await expect(nextUp).toContainText("Next up");
  });

  test("a lesson row links into the lesson", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: curriculumTables() });
    await page.goto("/curriculum");

    await page.getByRole("link", { name: /Greetings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${LESSON_A}$`));
  });
});

test.describe("signed in — grammar drills", () => {
  /**
   * The page selects `user_concept_mastery` with `curriculum_concepts!inner(...)`
   * embedded and filters on the embedded `kind` and `dialect`. These fixtures
   * therefore seed both sides and let the backend resolve the join, rather than
   * pre-shaping the joined row — which is what the old double required, and
   * which meant the `!inner` and the embedded filters were never exercised.
   */
  const conceptFor = (key: string, label: string) => ({
    id: `concept-${key}`,
    key,
    display_english: label,
    kind: "grammar",
    dialect: "Gulf",
  });

  const masteryFor = (key: string, exposures: number, correct: number) => ({
    user_id: TEST_USER_ID,
    concept_id: `concept-${key}`,
    exposures,
    correct,
    incorrect: exposures - correct,
    ease: 2.3,
    strength: correct / exposures >= 0.8 ? "strong" : "learning",
    next_due_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  });

  /** Seed a set of categories with the scores the learner has earned on each. */
  const drilled = (entries: Array<[key: string, label: string, exposures: number, correct: number]>) => ({
    curriculum_concepts: entries.map(([key, label]) => conceptFor(key, label)),
    user_concept_mastery: entries.map(([key, , exposures, correct]) =>
      masteryFor(key, exposures, correct),
    ),
  });

  test("a category the learner has drilled shows its standing", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: drilled([["negation", "Negation", 10, 3]]) });
    await page.goto("/grammar");

    // The score used to be rendered once on the results screen and dropped.
    await expect(page.getByText(/بداية الطريق · 30%/)).toBeVisible();
  });

  test("shows nothing for categories never drilled", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: { curriculum_concepts: [], user_concept_mastery: [] } });
    await page.goto("/grammar");

    await expect(page.getByRole("button", { name: /Negation/ })).toBeVisible();
    // A zeroed-out bar on a category you've never opened is noise, not data.
    await expect(page.getByText(/·\s*\d+%/)).toHaveCount(0);
  });

  test("nudges toward one category instead of six equal tiles", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: drilled([
        // All eight rungs attempted — with any tile untouched the nudge
        // switches to "You haven't tried X yet", which is the other branch.
        ["articles", "Articles", 10, 9],
        ["verb-conjugation", "Verb Conjugation", 10, 9],
        ["prepositions", "Prepositions", 10, 9],
        ["pronouns", "Pronouns", 10, 9],
        ["negation", "Negation", 10, 2],
        ["possessives", "Possessives", 10, 9],
        ["questions", "Question Forms", 10, 9],
        ["sentence-structure", "Sentence Structure", 10, 9],
      ]),
    });
    await page.goto("/grammar");

    await expect(page.getByText(/أضعف نقاطك/)).toContainText("النفي");
  });
});

test.describe("signed in — curriculum leeches", () => {
  const reviewRow = (over: Record<string, unknown> = {}) => ({
    id: "44444444-0000-4000-8000-000000000000",
    user_id: TEST_USER_ID,
    word_id: wordId(0),
    ease_factor: 5,
    difficulty: 5,
    interval_days: 1,
    repetitions: 2,
    lapses: 7,
    is_leech: false,
    mnemonic: null,
    last_reviewed_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    next_review_at: new Date(Date.now() - 86400000).toISOString(),
    ...over,
  });

  test("a stuck curriculum card offers the rescue panel", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      curriculumDue: 1,
      tables: { word_reviews: [reviewRow({ is_leech: true })] },
    });
    await page.goto("/review");

    // The personal decks have had this since leech tracking landed; the deck
    // the app hands every learner had nothing.
    await expect(page.getByText("متعثر مع هذه البطاقة؟")).toBeVisible();
    await expect(page.getByRole("button", { name: /ولّد وسيلة تذكّر/ })).toBeVisible();
  });

  test("shows an already-saved mnemonic instead of the generate button", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      curriculumDue: 1,
      tables: {
        word_reviews: [reviewRow({ is_leech: true, mnemonic: "sounds like the English word" })],
      },
    });
    await page.goto("/review");

    await expect(page.getByText("sounds like the English word")).toBeVisible();
    await expect(page.getByRole("button", { name: /ولّد وسيلة تذكّر/ })).toHaveCount(0);
  });

  test("stays out of the way on a card that isn't stuck", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      curriculumDue: 1,
      tables: { word_reviews: [reviewRow({ is_leech: false })] },
    });
    await page.goto("/review");

    await expect(page.getByText("word 1")).toBeVisible();
    await expect(page.getByText("متعثر مع هذه البطاقة؟")).toHaveCount(0);
  });
});

test.describe("signed in — mistakes", () => {
  const errorRow = (over: Record<string, unknown> = {}) => ({
    id: `e-${Math.random().toString(36).slice(2)}`,
    user_id: TEST_USER_ID,
    dialect: "Gulf",
    source: "pronunciation",
    target_arabic: "شغل",
    produced_arabic: "شغال",
    error_kind: "mispronunciation",
    resolved_at: null,
    created_at: new Date().toISOString(),
    ...over,
  });

  test("shows what the learner keeps getting wrong", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: {
        learner_errors: [
          errorRow(),
          errorRow(),
          errorRow({ target_arabic: "مشى", produced_arabic: null, source: "quiz" }),
        ],
      },
    });
    await page.goto("/mistakes");

    // Every one of these was recorded and fed to the AI; none of it was ever
    // shown to the person who made them.
    await expect(page.getByText("شغل", { exact: true })).toBeVisible();
    await expect(page.getByText("مرتين · آخرها اليوم")).toBeVisible();
    await expect(page.getByText("شغال")).toBeVisible();
  });

  test("ranks the most troublesome target first", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, {
      tables: {
        learner_errors: [
          errorRow({ target_arabic: "once" }),
          errorRow({ target_arabic: "thrice" }),
          errorRow({ target_arabic: "thrice" }),
          errorRow({ target_arabic: "thrice" }),
        ],
      },
    });
    await page.goto("/mistakes");

    // Not [dir='rtl']: since the Arabic-first flip the <html> root itself is
    // rtl and matches first — and the mistake targets are English besides.
    const headings = page.locator("h1, h2, h3, p, span").filter({ hasText: /^(once|thrice)$/ });
    await expect(headings.first()).toHaveText("thrice");
  });

  test("congratulates a clean record instead of showing an empty list", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { tables: { learner_errors: [] } });
    await page.goto("/mistakes");

    await expect(page.getByText("لا شيء عالق.")).toBeVisible();
  });
});
