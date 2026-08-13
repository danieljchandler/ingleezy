import { expect, test, type Page } from "./support/fixtures";
import {
  aDiscoverVideo,
  aProfile,
  aSetPhrase,
  aUserSetPhrase,
  aUserVocabulary,
  aUserXp,
  aWordReview,
  aVocabularyWord,
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
 * The home page — the daily queue.
 *
 * Home is the only screen most learners see every day, and its job is to answer
 * one question: what should I do now? The queue is assembled from four
 * independent sources (three SRS decks, the set-phrase deck, the Discover feed,
 * and localStorage completions), and a task that is wrongly hidden is invisible
 * — there is no error, no empty state, nothing to notice. That is the failure
 * mode these specs exist for.
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

test.describe("the daily queue", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    // A placement level, or the page renders the placement banner instead and
    // the queue is not what is under test.
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("shows the queue with a task count", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ tasks done/)).toBeVisible();
  });

  test("lists the tasks that are always available", async ({ page }) => {
    await page.goto("/");

    // These four have no precondition — hiding one is how a learner ends up
    // with an empty-looking day.
    await expect(page.getByText("Daily challenge")).toBeVisible();
    await expect(page.getByText("Today's story")).toBeVisible();
    await expect(page.getByText("Read 1 short passage")).toBeVisible();
    await expect(page.getByText("1 Souq article")).toBeVisible();
  });

  test("counts every deck in the flashcards task, not just one", async ({ page, db }) => {
    seedDueCurriculum(db, 2);
    db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), next_review_at: daysAgo(1) }),
    ]);

    // The task used to count only the personal deck, so curriculum cards due
    // never appeared in the queue at all.
    await expect(async () => {
      await page.goto("/");
      await expect(page.getByText("Review 3 words")).toBeVisible();
    }).toPass();
  });

  test("says 'word' rather than 'words' for a single card", async ({ page, db }) => {
    seedDueCurriculum(db, 1);
    await page.goto("/");

    await expect(page.getByText("Review 1 word", { exact: true })).toBeVisible();
  });

  test("hides the flashcards task when no card is due and none was reviewed", async ({
    page,
    db,
  }) => {
    db.seed("word_reviews", []);
    db.seed("user_vocabulary", []);

    await page.goto("/");
    await expect(page.getByText(/Review \d+ words?/)).toHaveCount(0);
    await expect(page.getByText("Flashcards reviewed")).toHaveCount(0);
  });

  test("hides the video card when the feed is empty", async ({ page, db }) => {
    db.seed("discover_videos", []);
    await page.goto("/");

    // Offering a video with nothing to watch sends the learner to an empty
    // page.
    await expect(page.getByRole("heading", { name: /Watch today's video/ })).toHaveCount(0);
  });

  test("leads with the video once the feed has something in it", async ({ page, db }) => {
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Watch today's video/ })).toBeVisible();
  });

  test("puts the video above the rest of the day", async ({ page, db }) => {
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await page.goto("/");

    // Watching native video is the app's core loop and it used to sit at the
    // bottom of the page, under the whole queue — reachable only by scrolling
    // past everything else. It now deliberately follows the daily-goals
    // header ("learners see their target first" — see Index.tsx), so the
    // guard is: video below the goals, but above every queue row.
    const video = await page.getByRole("heading", { name: /Watch today's video/ }).boundingBox();
    const goals = await page.getByRole("heading", { name: "Today", exact: true }).boundingBox();
    const firstQueueRow = await page
      .getByRole("button", { name: /estimated \d+ minutes/ })
      .first()
      .boundingBox();
    expect(video!.y).toBeGreaterThan(goals!.y);
    expect(video!.y).toBeLessThan(firstQueueRow!.y);
  });

  test("still counts the video in the day's total", async ({ page, db }) => {
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await completeTasks(page, "listening");
    await page.goto("/");

    // It renders as the card at the top rather than as a queue row, but it is
    // still one of today's tasks — dropping it out of the count would make a
    // finished day read as unfinished.
    await expect(page.getByText(/1 of \d+ tasks done/)).toBeVisible();
    await expect(page.getByText("Watched")).toBeVisible();
  });

  test("counts due set phrases", async ({ page, db }) => {
    seedDuePhrases(db, 4);
    await page.goto("/");

    await expect(page.getByText("Practice 4 phrases")).toBeVisible();
  });

  test("remembers what was finished earlier today", async ({ page }) => {
    await completeTasks(page, "reading", "souq");
    await page.goto("/");

    await expect(page.getByText(/2 of \d+ tasks done/)).toBeVisible();
  });

  test("congratulates a fully cleared queue", async ({ page, db }) => {
    db.seed("word_reviews", []);
    db.seed("user_vocabulary", []);
    db.seed("user_set_phrases", []);
    db.seed("discover_videos", []);
    await completeTasks(page, "daily-challenge", "daily-story", "reading", "souq");

    await page.goto("/");

    await expect(page.getByText("Daily goal complete")).toBeVisible();
  });
});

test.describe("starting a task", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("a task row opens its page", async ({ page }) => {
    await page.goto("/");
    await page.getByText("1 Souq article").click();

    await expect(page).toHaveURL(/\/souq-news$/);
  });

  test("the flashcards task goes to the session that walks every deck", async ({ page, db }) => {
    seedDueCurriculum(db, 2);
    await page.goto("/");
    await page.getByText("Review 2 words").click();

    // "/review" rather than a single deck — otherwise cards due elsewhere are
    // stranded until the learner remembers to visit that deck.
    await expect(page).toHaveURL(/\/review$/);
  });

  test("the video card opens today's clip and completes on click", async ({ page, db }) => {
    db.seed("discover_videos", [aDiscoverVideo({ id: videoId(0), dialect: "Gulf" })]);
    await page.goto("/");
    await page.getByRole("button", { name: /^Watch video:/ }).click();

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
  }) => {
    await page.goto("/");
    await page.getByText("Read 1 short passage").click();
    await expect(page).toHaveURL(/\/reading$/);

    // Reading marks itself done when a passage is actually finished. Marking it
    // on click would let a learner clear the queue by tapping through it.
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), TODAY_KEY());
    expect(JSON.parse(stored ?? "[]")).not.toContain("reading");
  });
});

test.describe("the daily goal", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
  });

  test("counts only XP earned today", async ({ page, db }) => {
    db.seed("user_xp", [
      aUserXp({ total_xp: 5000, xp_today: 40, xp_today_date: new Date().toISOString().slice(0, 10) }),
    ]);

    await page.goto("/");
    await expect(page.getByText("40", { exact: true }).first()).toBeVisible();
  });

  test("ignores yesterday's total", async ({ page, db }) => {
    db.seed("user_xp", [aUserXp({ xp_today: 90, xp_today_date: daysAgo(1).slice(0, 10) })]);

    await page.goto("/");
    // The ring resets at midnight; carrying yesterday's number over would show
    // a goal already met before the learner has done anything.
    await expect(page.getByText("0", { exact: true }).first()).toBeVisible();
  });

  test("saves a new goal and applies it without a reload", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /daily goal/i }).click();
    await page.getByRole("spinbutton").fill("250");
    await page.getByRole("button", { name: /^save$/i }).click();

    const stored = await page.evaluate(() => window.localStorage.getItem("today.goal"));
    expect(stored).toBe("250");
  });

  test("refuses a goal that is not a positive number", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /daily goal/i }).click();
    await page.getByRole("spinbutton").fill("0");
    await page.getByRole("button", { name: /^save$/i }).click();

    // A zero goal would divide by zero in the ring; the input is left as-is
    // rather than being stored.
    const stored = await page.evaluate(() => window.localStorage.getItem("today.goal"));
    expect(stored).toBeNull();
  });
});

test.describe("prompts on the home page", () => {
  test("asks an unplaced learner to take the placement quiz", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level: null, placement_level_gulf: null })]);

    await page.goto("/");
    await expect(page.getByText(/Take the Placement Quiz/)).toBeVisible();
  });

  test("stops asking once a level is on file for the active dialect", async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "B1" })]);

    await page.goto("/");
    await expect(page.getByText(/Take the Placement Quiz/)).toHaveCount(0);
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
    await expect(page.getByText(/Take the Placement Quiz/)).toBeVisible();
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

  test("shows the review shortcut only when cards are due", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);
    seedDueCurriculum(db, 3);

    await page.goto("/");
    await expect(page.getByText(/3 cards due for review/)).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("shows the landing page rather than an empty queue", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Today", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /join the beta/i })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Admin" })).toBeVisible();
  });

  test("hides the admin control from a plain learner", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
  });

  test("signing out returns the learner to the landing page", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("profiles", [aProfile({ placement_level_gulf: "A2" })]);

    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();

    // The landing hero, not a signed-in shell with the data blanked out.
    await expect(page.getByRole("button", { name: /join the beta/i })).toBeVisible();
  });
});
