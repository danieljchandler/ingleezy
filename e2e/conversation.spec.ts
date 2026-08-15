import { expect, test } from "./support/fixtures";
import { streaming } from "../src/test/support/server/functions";
import { TEST_USER_ID } from "../src/test/support/factories";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { SupabaseBackend } from "../src/test/support/server/handler";
import type { Page } from "@playwright/test";

/**
 * Free Chat — the conversation simulator.
 *
 * Two conversations in one page, and they do not share a transport. The typed
 * one streams SSE from `free-chat` over a raw `fetch`; the live one opens a
 * WebRTC peer connection to OpenAI with an ephemeral key minted by
 * `realtime-session-token`. Live mode is the *default*, so the panel mounts
 * and dials on arrival before a learner has asked for anything.
 *
 * Three protocol details make this page fragile in ways a shallow test misses:
 * the reply is accumulated across deltas, a `[[CORRECTION]]` first line is
 * split off the front of the accumulated text once the stream ends, and the
 * composer only exists once the conversation has started — so "type a message"
 * is not a reachable action from a cold page.
 */

const OPENER = "أهلاً! كيف حالك اليوم؟";

function seedChat(db: MemoryDb) {
  db.seed("user_phrases", []);
  db.seed("user_vocabulary", []);
}

/**
 * Declare the noise live mode makes on arrival.
 *
 * Not incidental — it is what the page does. `liveMode` initialises to `true`,
 * so the panel mounts, auto-starts, mints a session token and then posts an SDP
 * offer straight to api.openai.com. The fixture aborts that request (nothing
 * leaves the machine either way; the allow-list only silences the assertion),
 * the connection fails, and the hook logs it. Every single spec on this page
 * has to account for that, including the ones that never touch voice — which is
 * itself the finding, pinned under "live voice" below.
 */
function tolerateLiveDial(
  expectConsoleErrors: (patterns: RegExp[]) => void,
  allowExternalHosts: (hosts: string[]) => void,
) {
  expectConsoleErrors([/\[realtime\] start error/, /Failed to fetch/]);
  allowExternalHosts(["api.openai.com"]);
}

/**
 * Assert the tutor said something.
 *
 * The reply goes through `TappableArabicText`, which renders one tappable span
 * per word inside a flex container with `gap-1`. The spacing is CSS, not text,
 * so the paragraph's own textContent is the words run together and no locator
 * matches the sentence as written. Asserting word by word is what is actually
 * on screen — and it still catches a broken accumulation, because a reply that
 * lost its earlier deltas is missing those words.
 */
async function expectSaid(page: Page, sentence: string) {
  for (const word of sentence.split(/\s+/)) {
    await expect(page.getByText(word, { exact: true }).first()).toBeVisible();
  }
}

/**
 * Leave live mode.
 *
 * Needed after *every* navigation to this page, not just the first: `liveMode`
 * is component state initialised to `true`, so it comes back on with every
 * fresh mount and the panel covers the typed conversation underneath. Tolerant
 * of already being out, so a reload path and a cold path can share one helper.
 */
async function exitLive(page: Page) {
  // Wait for the toggle before reading it. `count()` resolves immediately
  // rather than waiting, so checking it on a page that has not finished
  // hydrating reports zero and silently skips the click — leaving the live
  // panel mounted over everything the test then looks for.
  const toggle = page.getByRole("button", { name: /إغلاق المباشر|مكالمة صوتية/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.textContent())?.includes("إغلاق المباشر")) await toggle.click();
  // Assert on the panel unmounting rather than on the topic picker, which is
  // only there when the conversation is empty — this helper is also used on the
  // reload path, where a stored thread is what comes back.
  await expect(page.getByRole("button", { name: /إغلاق المباشر/ })).toHaveCount(0);
}

async function startTopic(page: Page, label = "حديث حر") {
  await page.getByRole("button", { name: label }).click();
}

async function send(page: Page, text: string) {
  await page.getByPlaceholder("اكتب بالإنجليزي…").fill(text);
  await page.getByPlaceholder("اكتب بالإنجليزي…").press("Enter");
}

test.describe("starting a conversation", () => {
  test.beforeEach(async ({ signInAs, db, backend, expectConsoleErrors, allowExternalHosts }) => {
    tolerateLiveDial(expectConsoleErrors, allowExternalHosts);
    await signInAs("free");
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));
  });

  test("offers topics rather than a blank box", async ({ page }) => {
    await page.goto("/conversation");
    await exitLive(page);

    // A blank chat box in a language the learner cannot yet write is a dead
    // start; the tutor opens the conversation instead.
    for (const topic of ["حديث حر", "قهوة ☕", "العائلة 👨‍👩‍👧", "العمل 💼", "السفر ✈️", "الطعام 🍽️"]) {
      await expect(page.getByRole("button", { name: topic })).toBeVisible();
    }
  });

  test("has no composer until the tutor has spoken", async ({ page }) => {
    await page.goto("/conversation");
    await exitLive(page);

    // Pinned as-is: the input is mounted only once `messages` is non-empty, so
    // a learner who wants to open with their own sentence has to pick a topic
    // first and talk over the tutor's greeting.
    await expect(page.getByPlaceholder("اكتب بالإنجليزي…")).toHaveCount(0);

    await startTopic(page);
    await expectSaid(page, OPENER);
    await expect(page.getByPlaceholder("اكتب بالإنجليزي…")).toBeVisible();
  });

  test("opens with an empty history so the tutor speaks first", async ({ page, backend }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    await expectSaid(page, OPENER);
    const body = backend.lastCallTo("free-chat")?.body as { messages: unknown[] };
    // No user turn is invented to prompt the opener — the function is handed
    // nothing and the system prompt does the work.
    expect(body.messages).toHaveLength(0);
  });

  test("passes the chosen topic as a hint", async ({ page, backend }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page, "قهوة ☕");

    await expectSaid(page, OPENER);
    expect(backend.lastCallTo("free-chat")?.body).toMatchObject({
      topicHint: "ordering at a café",
    });
  });

  test("sends no hint for free talk", async ({ page, backend }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page, "حديث حر");

    await expectSaid(page, OPENER);
    const body = backend.lastCallTo("free-chat")?.body as { topicHint?: string };
    // "حديث حر" is the absence of a topic, not a topic called free talk.
    expect(body.topicHint).toBeUndefined();
  });

  test("tells the tutor the dialect and the learner's level", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Egyptian" } });
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    await expectSaid(page, OPENER);
    // Both are what keep the reply comprehensible. Without the level the tutor
    // answers an A1 learner in C1 Arabic; without the dialect it answers a
    // Cairo learner in Gulf.
    expect(backend.lastCallTo("free-chat")?.body).toMatchObject({
      dialect: "Egyptian",
      cefrLevel: "A2",
    });
  });
});

test.describe("the streamed reply", () => {
  test.beforeEach(async ({ signInAs, db, expectConsoleErrors, allowExternalHosts }) => {
    tolerateLiveDial(expectConsoleErrors, allowExternalHosts);
    await signInAs("free");
    seedChat(db);
  });

  test("accumulates the reply across frames", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming("أهلاً ", "وسهلاً ", "بك"));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // Three frames, one greeting. A handler that replaced rather than appended
    // would leave only "بك", and a single-chunk fixture would never show it.
    await expectSaid(page, "أهلاً وسهلاً بك");
  });

  test("keeps the whole thread in each request", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await send(page, "أنا بخير");

    await expect
      .poll(() => {
        const body = backend.lastCallTo("free-chat")?.body as
          | { messages: Array<{ role: string; content: string }> }
          | undefined;
        return body?.messages.length ?? 0;
      })
      .toBe(2);
    const body = backend.lastCallTo("free-chat")?.body as {
      messages: Array<{ role: string; content: string }>;
    };
    // Both turns, in order, with roles. A tutor sent only the newest line
    // answers every follow-up as if it were the first thing said.
    expect(body.messages[0]).toMatchObject({ role: "assistant", content: OPENER });
    expect(body.messages[1]).toMatchObject({ role: "user", content: "أنا بخير" });
  });

  test("shows the learner's own line straight away", async ({ page, backend, db }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    db.delayFunction("free-chat", 400);
    await send(page, "أنا بخير");

    await expect(page.getByText("أنا بخير")).toBeVisible();
    await expect(page.getByPlaceholder("اكتب بالإنجليزي…")).toHaveValue("");
  });

  test("lifts a correction out of the front of the reply", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () =>
      streaming("[[CORRECTION]] ", "Say أنا بخير, not أنا بخيرة.", "\n\n", "طيب! وش سويت اليوم؟"),
    );

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // The correction arrives inline in the same stream and is only separable
    // once the stream has finished — splitting per-frame would cut it in half.
    // It renders as its own bubble so feedback is not buried inside the reply.
    await expect(page.getByText("Say أنا بخير, not أنا بخيرة.")).toBeVisible();
    await expectSaid(page, "طيب! وش سويت اليوم؟");
    await expect(page.getByText(/\[\[CORRECTION\]\]/)).toHaveCount(0);
  });

  test("shows no correction bubble when the reply carries none", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    await expectSaid(page, OPENER);
    await expect(page.locator("svg.lucide-circle-alert")).toHaveCount(0);
  });

  test("ignores frames that carry no content", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => ({
      status: 200,
      body: null,
      stream: [
        { choices: [{ delta: { role: "assistant" } }] },
        { choices: [{ delta: { content: OPENER } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    }));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    await expectSaid(page, OPENER);
    await expect(page.getByText(/undefined/)).toHaveCount(0);
  });

  test("re-enables the composer once the stream ends", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    // `[DONE]` is what breaks the read loop. Without it the box stays disabled
    // and the conversation is one turn long forever.
    await expect(page.getByPlaceholder("اكتب بالإنجليزي…")).toBeEnabled();
  });

  test("sends nothing for an empty box", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);
    const before = backend.callsTo("free-chat").length;

    await page.getByPlaceholder("اكتب بالإنجليزي…").press("Enter");

    expect(backend.callsTo("free-chat")).toHaveLength(before);
  });
});

test.describe("when the chat fails", () => {
  test.beforeEach(async ({ signInAs, db, expectConsoleErrors, allowExternalHosts }) => {
    // Every test here stubs free-chat to fail, and the page logs the stream
    // error it recovers from — that log is the expected evidence, not noise.
    expectConsoleErrors([/\[realtime\] start error/, /Failed to fetch/, /free-chat stream error/]);
    allowExternalHosts(["api.openai.com"]);
    await signInAs("free");
    seedChat(db);
  });

  test("removes the empty bubble rather than leaving it spinning", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("free-chat", 500, { error: "Tutor unavailable" });

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // The placeholder assistant bubble is inserted before the request. On
    // failure it has to come back out, or the chat shows a spinner that never
    // resolves and the topic picker never returns.
    await expect(page.getByText("Tutor unavailable")).toBeVisible();
    await expect(page.getByText("اختر موضوعاً للبدء")).toBeVisible();
  });

  test("names rate limiting as its own thing", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("free-chat", 429, { error: "rate limited" });

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // A learner who is going too fast can wait; one whose tutor is down cannot.
    // The 429 message overrides whatever the body said.
    await expect(page.getByText(/Slow down/)).toBeVisible();
  });

  test("names exhausted credits as its own thing", async ({
    page,
    backend,
  }) => {
    backend.stubFunctionFailure("free-chat", 402, { error: "payment required" });

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // 402 is an operator problem, not a learner one, and the message says so
    // rather than blaming the learner's connection.
    await expect(page.getByText(/نفد رصيد الذكاء الاصطناعي/)).toBeVisible();
  });
});

test.describe("what a learner can keep", () => {
  test.beforeEach(async ({ signInAs, db, backend, expectConsoleErrors, allowExternalHosts }) => {
    tolerateLiveDial(expectConsoleErrors, allowExternalHosts);
    await signInAs("free");
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));
  });

  test("saves a reply as a phrase", async ({ page, db }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.getByRole("button", { name: /احفظ العبارة/ }).click();

    await expect.poll(() => db.rows("user_phrases").length).toBe(1);
    // Saved with an empty English on purpose — the tutor's reply has no
    // translation attached, and My Phrases is where it gets filled in.
    expect(db.rows("user_phrases")[0]).toMatchObject({
      user_id: TEST_USER_ID,
      phrase_arabic: OPENER,
      phrase_english: "",
      source: "free-chat",
    });
  });

  test("says a phrase is already saved rather than duplicating it", async ({
    page,
    db,
    backend,
  }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    db.failWrites("user_phrases", 400, { message: "هذه العبارة موجودة بالفعل" });
    await page.getByRole("button", { name: /احفظ العبارة/ }).click();

    // The duplicate is detected server-side and reported in Arabic; the page
    // matches on that Arabic substring to tell "already there" from "failed".
    await expect(page.getByText("محفوظة من قبل")).toBeVisible();
  });

  test("offers no save controls while the reply is still streaming", async ({
    page,
    backend,
    db,
  }) => {
    db.delayFunction("free-chat", 600);

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);

    // Saving half a sentence would store half a sentence. The action row is
    // gated on `!streaming`.
    await expect(page.getByRole("button", { name: /احفظ العبارة/ })).toHaveCount(0);
    await expectSaid(page, OPENER);
    await expect(page.getByRole("button", { name: /احفظ العبارة/ })).toBeVisible();
  });

  test("plays replies through the multilingual English voice", async ({ page, backend }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.getByRole("button", { name: /تشغيل/ }).click();

    // Replies are English now, so the dialect-routed Arabic voices are gone:
    // one multilingual provider covers the reply and any Arabic aside in a
    // correction line.
    await expect.poll(() => backend.callsTo("elevenlabs-tts").length).toBe(1);
    expect(backend.callsTo("munsit-tts")).toHaveLength(0);
  });

  test("keeps the same English voice regardless of the learner's dialect", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Yemeni" } });
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.getByRole("button", { name: /تشغيل/ }).click();

    await expect.poll(() => backend.callsTo("elevenlabs-tts").length).toBe(1);
    expect(backend.callsTo("azure-tts")).toHaveLength(0);
  });

  test("routes Egyptian speech to an Egyptian voice", async ({
    page,
    signInAs,
    db,
    backend,
  }) => {
    await signInAs("free", { profile: { preferred_dialect: "Egyptian" } });
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.getByRole("button", { name: /تشغيل/ }).click();

    await expect.poll(() => backend.callsTo("elevenlabs-tts").length).toBe(1);
  });
});

test.describe("the conversation between visits", () => {
  test.beforeEach(async ({ signInAs, db, backend, expectConsoleErrors, allowExternalHosts }) => {
    tolerateLiveDial(expectConsoleErrors, allowExternalHosts);
    await signInAs("free");
    seedChat(db);
    backend.stubFunction("free-chat", () => streaming(OPENER));
  });

  test("is still there after a reload", async ({ page }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.reload();
    await exitLive(page);

    // Kept in localStorage, not the database — so it survives a reload but not
    // a different device, and nothing about this conversation is on the server.
    await expectSaid(page, OPENER);
  });

  test("is dropped when the learner switches dialect", async ({ page, db }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.goto("/settings");
    await page.getByRole("button", { name: /مصري/ }).click();
    // Settings stages the picker in form state; nothing is persisted until Save
    // Changes. Navigating away on the click alone leaves the app still in Gulf,
    // the thread is then correctly restored, and that looks exactly like the
    // drop failing.
    await page.getByRole("button", { name: "حفظ التغييرات" }).click();
    await expect
      .poll(() => db.rows("profiles")[0]?.preferred_dialect)
      .toBe("Egyptian");

    await page.goto("/conversation");
    await exitLive(page);

    // The stored thread carries the dialect it was held in. Restoring a Gulf
    // conversation into an Egyptian session would have the tutor answer its own
    // earlier turns in the wrong dialect.
    await expect(page.getByText("اختر موضوعاً للبدء")).toBeVisible();
  });

  test("is cleared by New", async ({ page }) => {
    await page.goto("/conversation");
    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    await page.getByRole("button", { name: /جديد/ }).click();

    await expect(page.getByText("اختر موضوعاً للبدء")).toBeVisible();
    await page.reload();
    // New clears the stored copy too, otherwise the next visit resurrects it.
    await expect(page.getByText("حالك", { exact: true })).toHaveCount(0);
  });
});

test.describe("live voice", () => {
  test.beforeEach(async ({ signInAs, db, expectConsoleErrors, allowExternalHosts }) => {
    tolerateLiveDial(expectConsoleErrors, allowExternalHosts);
    await signInAs("free");
    seedChat(db);
  });

  test("dials before the learner asks for it", async ({
    page,
    backend,
  }) => {

    await page.goto("/conversation");

    // Pinned as-is. `liveMode` initialises to `true`, so arriving on the page
    // mounts the panel, which auto-starts on mount: the mic is opened and a
    // realtime session token is minted before the learner has clicked
    // anything. Every visit to /conversation costs a token call.
    await expect.poll(() => backend.callsTo("realtime-session-token").length).toBe(1);
    expect(backend.lastCallTo("realtime-session-token")?.body).toMatchObject({
      dialect: "Gulf",
      difficulty: "beginner",
    });
  });

  test("reports a failed connection instead of hanging on Connecting", async ({
    page,
  }) => {

    await page.goto("/conversation");

    // The SDP exchange goes straight to api.openai.com, which the fixture
    // blocks as a foreign host — the same shape as a real network failure or a
    // rejected ephemeral key. What matters is that the panel leaves
    // "Connecting…" and says so.
    await expect(page.getByText("انقطع الاتصال")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("اضغط «إنهاء المكالمة» للخروج.")).toBeVisible();
  });

  test("says why the token was refused", async ({ page, backend }) => {
    backend.stubFunctionFailure("realtime-session-token", 500, {
      error: "OPENAI_API_KEY not configured",
    });

    await page.goto("/conversation");

    // The token function's own message is surfaced rather than a bare status —
    // an unconfigured key and a rejected user look identical otherwise.
    await expect(page.getByText(/OPENAI_API_KEY not configured/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("hands the page back when live is exited", async ({ page }) => {

    await page.goto("/conversation");
    await expect(page.getByText(/انقطع الاتصال|جارٍ الاتصال/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /إغلاق المباشر/ }).click();

    await expect(page.getByText("اختر موضوعاً للبدء")).toBeVisible();
    await expect(page.getByRole("button", { name: /مكالمة صوتية/ })).toBeVisible();
  });

  test("does not dial again once exited", async ({ page, backend }) => {
    backend.stubFunction("free-chat", () => streaming(OPENER));

    await page.goto("/conversation");
    await expect.poll(() => backend.callsTo("realtime-session-token").length).toBe(1);

    await exitLive(page);
    await startTopic(page);
    await expectSaid(page, OPENER);

    // Unmounting the panel stops the session; nothing re-dials behind a typed
    // conversation.
    expect(backend.callsTo("realtime-session-token")).toHaveLength(1);
  });
});
