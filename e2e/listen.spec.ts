import { expect, test } from "./support/fixtures";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";

/**
 * Listen — generated audio episodes, and the two ways they get their audio.
 *
 * An episode is a script plus a choice about synthesis. `on_demand` renders a
 * line at a time as the learner taps it; `full` queues a background job to
 * render the whole thing, and the episode sits at `pending` until it lands.
 * That second mode is the interesting one, because the row is the only record
 * of a job the page cannot see — a `full` episode stuck at `pending` looks
 * identical whether the job is working or died half an hour ago.
 *
 * The episode page therefore has to stay usable in every audio state, including
 * the failed one: the script and the per-line playback are the product, and the
 * full recording is a convenience on top of it.
 */

const EPISODE = "bbbbbbbb-1111-4000-8000-000000000000";

const anEpisode = (over: Record<string, unknown> = {}) => ({
  id: EPISODE,
  title: "Morning Coffee",
  title_arabic: "قهوة الصباح",
  summary: "صديقان يسولفان عن قهوة الصباح",
  topic: "coffee",
  topic_category: "daily-life",
  dialect: "Gulf",
  format: "podcast",
  length_bucket: "short",
  audio_mode: "on_demand",
  audio_status: "ready",
  full_audio_url: null,
  duration_seconds: 90,
  line_durations: null,
  play_count: 0,
  creator_id: TEST_USER_ID,
  script: [
    { speaker: "A", english: "Good morning, everyone.", arabic: "صباح الخير", literal: "صباح الـ خير للجميع" },
    { speaker: "B", english: "Coffee first, always.", arabic: "القهوة أول شي", literal: "قهوة أولاً دايماً" },
  ],
  key_vocabulary: [{ english: "morning", arabic: "صباح" }],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

function seedListen(db: MemoryDb, rows: Array<Record<string, unknown>> = [anEpisode()]) {
  db.seed("listen_episodes", rows);
  db.seed("user_vocabulary", []);
}

test.describe("reaching Listen", () => {
  test("sends a signed-out visitor to sign in", async ({ page, signInAs }) => {
    await signInAs("anonymous");

    await page.goto("/listen");

    await expect(page).toHaveURL(/\/auth/);
  });

  test("opens on the library", async ({ page, signInAs, db }) => {
    await signInAs("free");
    seedListen(db);

    await page.goto("/listen");

    await expect(page.getByRole("heading", { name: "استمع" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "المكتبة" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});

test.describe("the library", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("lists an episode with its format and length", async ({ page, db }) => {
    seedListen(db);

    await page.goto("/listen");

    // Scoped to the card: the Create tab's format and length pickers are in
    // the DOM behind the inactive tab and carry the same words.
    const card = page.locator("a[href$='/listen/" + EPISODE + "']");
    await expect(card.getByRole("heading", { name: "Morning Coffee" })).toBeVisible();
    await expect(card.getByText("صديقان يسولفان عن قهوة الصباح")).toBeVisible();
    await expect(card.getByText("بودكاست")).toBeVisible();
    await expect(card.getByText("قصيرة")).toBeVisible();
  });

  test("marks an episode that already has a full recording", async ({ page, db }) => {
    seedListen(db, [
      anEpisode({ audio_mode: "full", full_audio_url: "https://cdn.test/episode.mp3" }),
    ]);

    await page.goto("/listen");

    await expect(page.getByText("صوت")).toBeVisible();
  });

  test("marks one that is still being recorded", async ({ page, db }) => {
    seedListen(db, [anEpisode({ audio_mode: "full", audio_status: "pending" })]);

    await page.goto("/listen");

    // The only sign that a background job exists at all. Without it a `full`
    // episode with no audio is indistinguishable from a broken one.
    await expect(page.getByText("نسجّل")).toBeVisible();
  });

  test("shows how often an episode has been played", async ({ page, db }) => {
    seedListen(db, [anEpisode({ play_count: 12 })]);

    await page.goto("/listen");

    await expect(page.getByText("▶ 12")).toBeVisible();
  });

  test("hides the play count for an episode nobody has opened", async ({ page, db }) => {
    seedListen(db, [anEpisode({ play_count: 0 })]);

    await page.goto("/listen");
    await expect(page.getByRole("heading", { name: "Morning Coffee" })).toBeVisible();

    await expect(page.getByText("▶ 0")).toHaveCount(0);
  });

  test("shows only the active dialect's episodes", async ({ page, db }) => {
    seedListen(db, [
      anEpisode({ title: "حلقة خليجية", dialect: "Gulf" }),
      anEpisode({
        id: "bbbbbbbb-1111-4000-8000-000000000001",
        title: "حلقة مصرية",
        dialect: "Egyptian",
      }),
    ]);

    await page.goto("/listen");

    // Listening practice is the one place a wrong dialect is worse than no
    // content — the whole point is training an ear on one accent.
    await expect(page.getByRole("heading", { name: "حلقة خليجية" })).toBeVisible();
    await expect(page.getByText("حلقة مصرية")).toHaveCount(0);
  });

  test("points an empty library at the create tab", async ({ page, db }) => {
    seedListen(db, []);

    await page.goto("/listen");

    await expect(page.getByText("ما فيه حلقات بعد لـGulf.")).toBeVisible();
    await expect(page.getByText("كن أول واحد — افتح تبويب «أنشئ».")).toBeVisible();
  });

  test("opens an episode", async ({ page, db }) => {
    seedListen(db);

    await page.goto("/listen");
    await page.getByRole("heading", { name: "Morning Coffee" }).click();

    await expect(page).toHaveURL(new RegExp(`/listen/${EPISODE}$`));
  });
});

test.describe("creating an episode", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedListen(db, []);
  });

  test("will not generate without a topic", async ({ page }) => {
    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();

    // Generation is a model call per episode; an empty topic would spend it on
    // nothing. The button is disabled rather than validating on click.
    await expect(page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ })).toBeDisabled();
  });

  test("never shows the message it has for a missing topic", async ({ page }) => {
    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();
    await expect(page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ })).toBeDisabled();

    // A dead branch, pinned. `handleGenerate` opens with
    // `if (!finalTopic) toast.error("Pick or type a topic first")`, but the only
    // caller is a button disabled on exactly that condition — so the message is
    // unreachable and a learner staring at a greyed-out button is told nothing
    // about what it wants.
    await expect(page.getByText("اختر موضوع أو اكتبه أول")).toHaveCount(0);
  });

  test("sends the format, length and audio mode the learner picked", async ({ page, backend }) => {
    backend.stubFunction("generate-listen-script", { episode: anEpisode() });

    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();
    await page.getByRole("button", { name: /محاضرة تِد/ }).click();
    await page.getByRole("button", { name: /طويلة/ }).click();
    await page.getByPlaceholder(/اكتب أي موضوع/).fill("desert farming");
    await page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ }).click();

    await expect
      .poll(() => backend.lastCallTo("generate-listen-script")?.body)
      .toMatchObject({
        format: "ted",
        length: "long",
        topic: "desert farming",
        dialect: "Gulf",
      });
  });

  test("defaults to on-demand synthesis", async ({ page, backend }) => {
    backend.stubFunction("generate-listen-script", { episode: anEpisode() });

    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();
    await page.getByPlaceholder(/اكتب أي موضوع/).fill("coffee");
    await page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ }).click();

    // The cheaper of the two: a line is rendered when the learner taps it, so
    // an episode nobody finishes costs nothing to synthesise beyond what was
    // heard.
    await expect
      .poll(() => backend.lastCallTo("generate-listen-script")?.body)
      .toMatchObject({ audioMode: "on_demand" });
  });

  test("takes a suggested topic as the topic", async ({ page }) => {
    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();

    const suggestion = page.locator("button.block.w-full.text-left").first();
    const label = (await suggestion.textContent())?.trim() ?? "";
    await suggestion.click();

    // Tapping a suggestion fills the box rather than generating immediately —
    // it is a starting point the learner can edit, and it is what turns the
    // disabled Generate button on.
    await expect(page.getByPlaceholder(/اكتب أي موضوع/)).toHaveValue(label);
    await expect(page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ })).toBeEnabled();
  });

  test("opens the episode it just made", async ({ page, backend }) => {
    backend.stubFunction("generate-listen-script", { episode: anEpisode() });

    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();
    await page.getByPlaceholder(/اكتب أي موضوع/).fill("coffee");
    await page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ }).click();

    await expect(page.getByText("الحلقة جاهزة")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/listen/${EPISODE}$`));
  });

  test("reports a refused generation and stays put", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("generate-listen-script");

    await page.goto("/listen");
    await page.getByRole("tab", { name: "أنشئ" }).click();
    await page.getByPlaceholder(/اكتب أي موضوع/).fill("coffee");
    await page.getByRole("button", { name: /ولّد الحلقة|نكتب حلقتك/ }).click();

    // Navigating to `/listen/undefined` is the failure mode the mutation's
    // own guard exists to prevent.
    await expect(page).toHaveURL(/\/listen$/);
  });
});

test.describe("an episode", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("free");
  });

  test("shows the script line by line", async ({ page, db }) => {
    seedListen(db);

    await page.goto(`/listen/${EPISODE}`);

    // Rendered through TappableEnglishText, so each word is its own lookup
    // target rather than one run of text.
    await expect(page.getByRole("heading", { name: "Morning Coffee" })).toBeVisible();
    await expect(page.getByRole("button", { name: "morning," })).toBeVisible();
    await expect(page.getByRole("button", { name: "Coffee" })).toBeVisible();
  });

  test("offers the key vocabulary", async ({ page, db }) => {
    seedListen(db);

    await page.goto(`/listen/${EPISODE}`);

    await expect(page.getByRole("heading", { name: "أهم المفردات" })).toBeVisible();
    await expect(page.getByText("morning", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /أضفها كلها لكلماتي/ })).toBeVisible();
  });

  test("saves the whole vocabulary list in one go", async ({ page, db }) => {
    seedListen(db);

    await page.goto(`/listen/${EPISODE}`);
    await page.getByRole("button", { name: /أضفها كلها لكلماتي/ }).click();

    await expect.poll(() => db.rows("user_vocabulary").length).toBeGreaterThan(0);
    expect(db.rows("user_vocabulary")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      word_arabic: "صباح",
    });
  });

  test("offers a full-episode play button once the audio exists", async ({ page, db }) => {
    seedListen(db, [
      anEpisode({
        audio_mode: "full",
        audio_status: "ready",
        full_audio_url: "https://cdn.test/episode.mp3",
      }),
    ]);

    await page.goto(`/listen/${EPISODE}`);

    await expect(page.getByRole("button", { name: /شغّل|أوقف/ }).first()).toBeVisible();
  });

  test("says the recording is still being made", async ({ page, db }) => {
    seedListen(db, [anEpisode({ audio_mode: "full", audio_status: "pending" })]);

    await page.goto(`/listen/${EPISODE}`);

    await expect(page.getByText(/نسجّل الأصوات/).first()).toBeVisible();
  });

  test("keeps the episode usable when the recording failed", async ({ page, db }) => {
    seedListen(db, [anEpisode({ audio_mode: "full", audio_status: "failed" })]);

    await page.goto(`/listen/${EPISODE}`);

    // The script is the product and per-line synthesis still works, so a failed
    // background job costs a convenience rather than the episode.
    await expect(
      page.getByText("ما ضبط الصوت — تقدر تشغّل كل سطر بالضغط عليه."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "morning," })).toBeVisible();
  });

  test("re-kicks a stale recording job", async ({ page, db, backend }) => {
    backend.stubFunction("generate-listen-audio", { ok: true });
    seedListen(db, [
      anEpisode({
        audio_mode: "full",
        audio_status: "pending",
        updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
    ]);

    await page.goto(`/listen/${EPISODE}`);

    // The row is the only record of a job the page cannot see. Untouched for
    // half an hour means the worker died, and nothing else would ever notice —
    // the episode would sit at "pending" forever.
    await expect.poll(() => backend.callsTo("generate-listen-audio").length).toBe(1);
  });

  test("leaves a fresh recording job alone", async ({ page, db, backend }) => {
    backend.stubFunction("generate-listen-audio", { ok: true });
    seedListen(db, [
      anEpisode({
        audio_mode: "full",
        audio_status: "pending",
        updated_at: new Date().toISOString(),
      }),
    ]);

    await page.goto(`/listen/${EPISODE}`);
    await expect(page.getByRole("heading", { name: "Morning Coffee" })).toBeVisible();

    // Still plausibly working. Re-kicking it would double the synthesis spend
    // on every episode anyone opened while it was rendering.
    expect(backend.callsTo("generate-listen-audio")).toHaveLength(0);
  });

  test("says so when the episode does not exist", async ({ page, db }) => {
    seedListen(db, []);

    await page.goto("/listen/bbbbbbbb-1111-4000-8000-00000000000f");

    await expect(page.getByText("ما لقينا الحلقة.")).toBeVisible();
  });

  test("goes back to the library", async ({ page, db }) => {
    seedListen(db);

    await page.goto(`/listen/${EPISODE}`);
    await page.getByRole("button", { name: /رجوع للمكتبة|رجوع/ }).first().click();

    await expect(page).toHaveURL(/\/listen$/);
  });
});
