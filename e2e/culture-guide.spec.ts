import { expect, test } from "./support/fixtures";
import { streaming } from "../src/test/support/server/functions";
import type { MemoryDb } from "../src/test/support/postgrest/store";
import type { Page } from "@playwright/test";

/**
 * The culture guide — the app's only streamed conversation.
 *
 * Everything else here talks to an edge function and waits for a whole answer.
 * This page opens a raw `fetch`, reads the body as a stream, and appends each
 * delta to the message as it arrives. That is three separate things that can
 * break independently: the frames arriving, the accumulation across them, and
 * the terminator that stops the loop.
 *
 * The tests stream answers in several pieces on purpose. A single-chunk stream
 * would pass even if the accumulation replaced the message rather than
 * appending to it, which is exactly the bug this shape of code invites.
 */

function seedGuide(db: MemoryDb) {
  db.seed("human_review_requests", []);
}

async function ask(page: Page, text = "How do I greet my host's mother?") {
  await page.getByPlaceholder("صف موقفك…").fill(text);
  await page.getByPlaceholder("صف موقفك…").press("Enter");
}

test.describe("asking the guide", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedGuide(db);
  });

  test("streams an answer in as it arrives", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () =>
      streaming("Greet her ", "with السلام عليكم", " and wait to be offered a seat."),
    );

    await page.goto("/culture-guide");
    await ask(page);

    // Three frames, one sentence. If the handler replaced rather than appended,
    // only the last fragment would survive — and with a one-chunk fixture that
    // bug would be invisible.
    await expect(
      page.getByText("Greet her with السلام عليكم and wait to be offered a seat."),
    ).toBeVisible();
  });

  test("sends the conversation and the learner's dialect", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => streaming("Sure."));

    await page.goto("/culture-guide");
    await ask(page, "What do I bring to a Gulf wedding?");

    await expect.poll(() => backend.lastCallTo("culture-guide")?.body).toMatchObject({
      dialect: "Gulf",
    });
    const body = backend.lastCallTo("culture-guide")?.body as { messages: Array<{ content: string }> };
    // The whole thread, not just the newest line — a guide that forgot the
    // previous turn would answer every follow-up out of context.
    expect(body.messages.at(-1)?.content).toBe("What do I bring to a Gulf wedding?");
  });

  test("keeps the earlier turns in the next request", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => streaming("Bring sweets."));

    await page.goto("/culture-guide");
    await ask(page, "First question");
    await expect(page.getByText("Bring sweets.")).toBeVisible();

    await ask(page, "Second question");

    await expect
      .poll(() => {
        const body = backend.lastCallTo("culture-guide")?.body as
          | { messages: Array<{ role: string; content: string }> }
          | undefined;
        return body?.messages.length ?? 0;
      })
      .toBeGreaterThan(2);
  });

  test("shows the learner's own message immediately", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => streaming("An answer."));

    await page.goto("/culture-guide");
    await ask(page, "My question");

    await expect(page.getByText("My question")).toBeVisible();
  });

  test("clears the box after sending", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => streaming("An answer."));

    await page.goto("/culture-guide");
    await ask(page, "My question");

    await expect(page.getByPlaceholder("صف موقفك…")).toHaveValue("");
  });

  test("sends nothing for an empty box", async ({ page, backend }) => {
    await page.goto("/culture-guide");
    await page.getByPlaceholder("صف موقفك…").press("Enter");

    expect(backend.callsTo("culture-guide")).toHaveLength(0);
  });

  test("offers no send button until there is something to send", async ({ page }) => {
    await page.goto("/culture-guide");

    // Located by icon: the send button is icon-only and carries no accessible
    // name, so a screen reader announces it as "button". Counted against the
    // app-wide icon-button baseline.
    await expect(page.locator("button:has(svg.lucide-send)")).toBeDisabled();
  });
});

test.describe("when the stream goes wrong", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("free");
    seedGuide(db);
  });

  test("reports a refused request", async ({ page, backend, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionFailure("culture-guide", 500, { error: "Guide unavailable" });

    await page.goto("/culture-guide");
    await ask(page);

    // The error body is read before the stream is touched, so the message the
    // function chose is the one shown rather than a generic status.
    await expect(page.getByText("Guide unavailable")).toBeVisible();
  });

  test("reports a daily cap as its own thing", async ({
    page,
    backend,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    backend.stubFunctionCapped("culture-guide");

    await page.goto("/culture-guide");
    await ask(page);

    // A learner who has used their allowance can act on that; an outage they
    // cannot. The two must not read the same.
    await expect(page.getByText(/limit|upgrade|daily/i).first()).toBeVisible();
  });

  test("ends the turn when the stream terminates", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => streaming("Done."));

    await page.goto("/culture-guide");
    await ask(page);
    await expect(page.getByText("Done.")).toBeVisible();

    // `[DONE]` is what breaks the read loop. Without it the input would stay
    // disabled and the conversation would be one message long forever.
    await expect(page.getByPlaceholder("صف موقفك…")).toBeEnabled();
  });

  test("survives a frame that is not JSON", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => ({
      status: 200,
      body: null,
      // A frame the parser cannot read. The loop pushes it back onto the
      // buffer and waits for more, which is how a delta split across two TCP
      // reads is meant to be handled — so a genuinely malformed frame must not
      // spin or throw.
      stream: ["not json at all", { choices: [{ delta: { content: "Recovered." } }] }],
    }));

    await page.goto("/culture-guide");
    await ask(page);

    await expect(page.getByPlaceholder("صف موقفك…")).toBeEnabled();
  });

  test("ignores a frame carrying no content", async ({ page, backend }) => {
    backend.stubFunction("culture-guide", () => ({
      status: 200,
      body: null,
      // OpenAI sends role-only and finish-reason frames with no `content`;
      // appending `undefined` for each would print it into the answer.
      stream: [
        { choices: [{ delta: { role: "assistant" } }] },
        { choices: [{ delta: { content: "Just this." } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    }));

    await page.goto("/culture-guide");
    await ask(page);

    await expect(page.getByText("Just this.")).toBeVisible();
    await expect(page.getByText(/undefined/)).toHaveCount(0);
  });
});
