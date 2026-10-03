import { expect, test, type Page } from "./support/fixtures";
import {
  aDiscoverVideo,
  aProfile,
  aReviewStreak,
  aSetPhrase,
  aUserSetPhrase,
  aUserVocabulary,
  aVocabularyWord,
  aWordReview,
  daysAgo,
  many,
  reviewId,
  setPhraseId,
  userSetPhraseId,
  videoId,
  vocabId,
  wordId,
} from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Today — the front door.
 *
 * Today is the only screen most learners see every day, and its job is to
 * answer one question: what should I do now? So it is a greeting, the streak, a
 * three-step plan with one button, and a way to the tutor. The plan is built
 * from the daily queue, which is assembled from independent sources (three SRS
 * decks, the set-phrase deck, the Discover feed, and localStorage completions),
 * and a task that is wrongly hidden is invisible — there is no error, no empty
 * state, nothing to notice. That is the failure mode these specs exist for.
 *
 * Completions live in localStorage keyed by local date, so they are asserted
 * through the UI and through the storage key rather than the database.
 */

const TODAY_KEY = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `today.completed.${now.getFullYear()}-${month}-${day}`;
};

/** Mark tasks done before the page boots, as a previous visit would have. */
async function completeTasks(page: Page, ...taskIds: string[]) {
  await page.addInitScript(
    ({ key, ids }) => window.localStorage.setItem(key, JSON.stringify(ids)),
    { key: TODAY_KEY(), ids: taskIds },
  );
}

/** `count` curriculum cards due yesterday. */
function seedDueCurriculum(db: MemoryDb, count: number) {
  db.seed(
    "vocabulary_words",
    many(aVocabularyWord, count, (index) => ({ id: wordId(index) })),
  );
  db.seed(
    "word_reviews",
    many(aWordReview, count, (index) => ({
      id: reviewId(index),
      word_id: wordId(index),
      next_review_at: daysAgo(1),
    })),
  );
}

/** `count` set phrases due yesterday. */
function seedDuePhrases(db: MemoryDb, count: number) {
  db.seed(
    "set_phrases",
    many(aSetPhrase, count, (index) => ({ id: setPhraseId(index) })),
  );
  db.seed(
    "user_set_phrases",
    many(aUserSetPhrase, count, (index) => ({
      id: userSetPhraseId(index),
      phrase_id: setPhraseId(index),
      next_review_at: daysAgo(1),
    })),
  );
}

/**
 * A quiet day: no clip published, no card or phrase due. The plan is then the
 * three always-available daily tasks, which makes its contents predictable.
 */
function seedQuietDay(db: MemoryDb) {
  db.seed("discover_videos", []);
  db.seed("word_reviews", []);
  db.seed("user_vocabulary", []);
  db.seed("user_set_phrases", []);
}

/** A plan step, by its accessible name ("<title> — تقريباً n دقائق"). */
const step = (page: Page, title: string | RegExp) =>
  page.getByRole("button", {
    name: typeof title === "string" ? new RegExp(`^(مكتملة: )?${title} —`) : title,
  });

const showExtras = (page: Page) => page.getByRole("button", { name: /إذا عندك وقت/ }).click();

test.describe("the plan", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    // A placement level, or the page leads with the placement prompt instead.
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("is three steps with its progress", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "خطة اليوم" })).toBeVisible();
    await expect(page.getByText(/· 0 من 3$/)).toBeVisible();
    await expect(step(page, "تحدي اليوم")).toBeVisible();
    await expect(step(page, "قصة اليوم")).toBeVisible();
    await expect(step(page, "اقرأ نصاً قصيراً")).toBeVisible();
  });

  test("keeps the rest of the queue one tap away", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");

    // The news article has no precondition, so it is always available — it is
    // simply fourth in line. Hiding it would be how a learner loses it.
    await expect(step(page, "مقال من أخبار السوق")).toHaveCount(0);
    await showExtras(page);
    await expect(step(page, "مقال من أخبار السوق")).toBeVisible();
  });

  test("counts every deck in the review step, not just one", async ({ page, db }) => {
    seedDueCurriculum(db, 2);
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), next_review_at: daysAgo(1) }),
    ]);

    // The task used to count only the personal deck, so curriculum cards due
    // never appeared in the queue at all.
    await expect(async () => {
      await page.goto("/");
      await expect(step(page, "راجع 3 كلمات")).toBeVisible();
    }).toPass();
  });

  test("says 'word' rather than 'words' for a single card", async ({ page, db }) => {
    seedDueCurriculum(db, 1);
    await page.goto("/");

    await expect(step(page, "راجع كلمة واحدة")).toBeVisible();
  });

  test("leaves review out when no card is due and none was reviewed", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");
    await showExtras(page);

    await expect(page.getByText(/راجع .*(كلمة|كلمتين|كلمات)/)).toHaveCount(0);
    await expect(page.getByText("أنجزت مراجعة البطاقات")).toHaveCount(0);
  });

  test("leaves the clip out when the feed is empty", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");

    // Offering a video with nothing to watch sends the learner to an empty page.
    await expect(step(page, "شاهد فيديو اليوم")).toHaveCount(0);
  });

  test("leads with today's clip once the feed has one", async ({ page, db }) => {
    seedQuietDay(db);
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await page.goto("/");

    // Watching real English is the app's core loop, so it is the plan's first
    // step, above the daily one-offs.
    const clip = await step(page, "شاهد فيديو اليوم").boundingBox();
    const challenge = await step(page, "تحدي اليوم").boundingBox();
    expect(clip!.y).toBeLessThan(challenge!.y);
  });

  test("counts the clip in the day's progress once watched", async ({ page, db }) => {
    seedQuietDay(db);
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await completeTasks(page, "listening");
    await page.goto("/");

    await expect(page.getByText(/· 1 من 3$/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^مكتملة: شاهد فيديو اليوم/ })).toBeVisible();
  });

  test("offers due set phrases among the extras", async ({ page, db }) => {
    seedDuePhrases(db, 4);
    await page.goto("/");
    await showExtras(page);

    await expect(step(page, "تدرّب على 4 عبارات")).toBeVisible();
  });

  test("remembers what was finished earlier today", async ({ page, db }) => {
    seedQuietDay(db);
    await completeTasks(page, "daily-challenge", "daily-story");
    await page.goto("/");

    await expect(page.getByText(/· 2 من 3$/)).toBeVisible();
  });

  test("congratulates a finished plan", async ({ page, db }) => {
    seedQuietDay(db);
    await completeTasks(page, "daily-challenge", "daily-story", "reading");
    await page.goto("/");

    await expect(page.getByText("خلّصت خطة اليوم")).toBeVisible();
  });
});

test.describe("starting a task", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("the button starts the first step", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");
    await page.getByRole("button", { name: /^ابدأ: تحدي اليوم/ }).click();

    await expect(page).toHaveURL(/\/daily-challenge$/);
  });

  test("the button moves on to the first unfinished step", async ({ page, db }) => {
    seedQuietDay(db);
    await completeTasks(page, "daily-challenge");
    await page.goto("/");
    await page.getByRole("button", { name: /^كمّل: قصة اليوم/ }).click();

    await expect(page).toHaveURL(/\/today\/story$/);
  });

  test("an extra opens its page", async ({ page, db }) => {
    seedQuietDay(db);
    await page.goto("/");
    await showExtras(page);
    await step(page, "مقال من أخبار السوق").click();

    await expect(page).toHaveURL(/\/souq-news$/);
  });

  test("the review step goes to the session that walks every deck", async ({ page, db }) => {
    seedDueCurriculum(db, 2);
    await page.goto("/");
    await step(page, "راجع كلمتين").click();

    // "/review" rather than a single deck — otherwise cards due elsewhere are
    // stranded until the learner remembers to visit that deck.
    await expect(page).toHaveURL(/\/review$/);
  });

  test("the clip step opens today's clip and completes on click", async ({ page, db }) => {
    seedQuietDay(db);
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await page.goto("/");
    await step(page, "شاهد فيديو اليوم").click();

    // Straight to the clip, not the browse list: the point of "today's video"
    // is that the choice has already been made.
    await expect(page).toHaveURL(new RegExp(`/discover/${videoId(0)}$`));

    // The video page marks nothing done, so the click is the only completion
    // signal available.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), TODAY_KEY());
    expect(JSON.parse(stored ?? "[]")).toContain("listening");
  });

  test("opening a task with its own completion event does not pre-complete it", async ({
    page,
    db,
  }) => {
    seedQuietDay(db);
    await page.goto("/");
    await step(page, "اقرأ نصاً قصيراً").click();
    await expect(page).toHaveURL(/\/reading$/);

    // Reading marks itself done when a passage is actually finished. Marking it
    // on click would let a learner clear the plan by tapping through it.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), TODAY_KEY());
    expect(JSON.parse(stored ?? "[]")).not.toContain("reading");
  });
});

test.describe("the streak", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("shows the live run from the learner's row", async ({ page, db }) => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    db.seed("review_streaks", [aReviewStreak({ current_streak: 4, last_review_date: key })]);
    await page.goto("/");

    await expect(page.getByRole("region", { name: "سلسلة 4 أيام" })).toBeVisible();
    await expect(page.getByRole("list", { name: "آخر سبعة أيام" }).getByLabel("تم")).toHaveCount(4);
  });

  test("invites a learner with no run to start one", async ({ page, db }) => {
    db.seed("review_streaks", []);
    await page.goto("/");

    await expect(page.getByText("ابدأ سلسلتك اليوم")).toBeVisible();
  });
});

test.describe("prompts on Today", () => {
  test("asks an unplaced learner to take the placement quiz", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);

    await page.goto("/");
    await expect(page.getByText(/اختبار تحديد المستوى/)).toBeVisible();
  });

  test("stops asking once a level is on file for the active dialect", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "B1" })]);

    await page.goto("/");
    await expect(page.getByText(/اختبار تحديد المستوى/)).toHaveCount(0);
  });

  test("a level in another dialect does not count as placed", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed(
      "profiles",
      [aProfile({ placement_level: null, placement_level_egyptian: "C1", placement_level_gulf: null })],
    );

    await page.goto("/");
    // Placement is per dialect deliberately: fluency in Egyptian says nothing
    // about Gulf, and treating it as equivalent mis-levels the whole feed.
    await expect(page.getByText(/اختبار تحديد المستوى/)).toBeVisible();
  });

  test("sends a learner who never finished onboarding back to it", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ onboarding_completed: false })]);

    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("greets the learner by name", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ display_name: "Sara Ahmed", placement_level_gulf: "A2" })]);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/(صباح|مساء) الخير، Sara$/);
  });

  test("puts the tutor one tap away", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await page.getByRole("link", { name: "كيف أقول…؟" }).click();
    await expect(page).toHaveURL(/\/how-do-i-say$/);
  });
});

test.describe("signed out", () => {
  test("shows the landing page rather than an empty plan", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "خطة اليوم" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /انضم للتجربة/ })).toBeVisible();
  });
});

test.describe("the old address", () => {
  test("/today lands on Today, for old bookmarks", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/today");
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByRole("heading", { name: "خطة اليوم" })).toBeVisible();
  });
});

test.describe("the header", () => {
  test("offers an admin the admin area, and everyone else nothing", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("admin");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "الإدارة" })).toBeVisible();
  });

  test("hides the admin control from a plain learner", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "الإدارة" })).toHaveCount(0);
  });

  test("reaches the account from the emblem", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await page.getByRole("link", { name: /حسابك/ }).click();
    await expect(page).toHaveURL(/\/me$/);
  });
});

test.describe("signing out", () => {
  test("from Settings returns the learner to the landing page", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    // Sign-out lived in Today's header next to four other icons. It belongs
    // with the account, and Settings already had it.
    await page.goto("/settings");
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();

    // The landing hero, not a signed-in shell with the data blanked out.
    await expect(page.getByRole("button", { name: /انضم للتجربة/ })).toBeVisible();
  });
});
