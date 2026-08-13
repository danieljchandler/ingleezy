import { expect, test } from "./support/fixtures";
import { anInviteCode, aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { Page } from "@playwright/test";

/**
 * /admin/invite-codes — the door to the closed beta.
 *
 * Nobody can create an account without redeeming one of these, so a code is a
 * bearer token that an admin pastes into a DM. That shapes what matters here:
 * not the form, but the accounting. `uses` against `max_uses` and `expires_at`
 * are the only things standing between one code and an unbounded number of
 * signups, and both are evaluated in two places — this page, for display, and
 * `verify_invite_code` server-side, for enforcement. This spec covers the
 * display half and asserts the two agree about what "spent" means.
 */

/** Strings the page handed to the clipboard. */
const copiedText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copiedText: string[] }).__copiedText);

const CODE_ID = "eeeeeeee-0000-4000-8000-000000000000";

test.describe("who may open it", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("invite_codes", []);

    await page.goto("/admin/invite-codes");

    await expect(page.getByRole("heading", { name: "Beta Invite Codes" })).toBeVisible();
  });

  test("turns a content reviewer away", async ({ page, signInAs, db }) => {
    await signInAs("content_reviewer");
    db.seed("invite_codes", []);

    await page.goto("/admin/invite-codes");

    // A reviewer who could mint codes could hand out accounts. The layout's
    // allow-list is what stops that — this page has no check of its own.
    await expect(page.getByRole("heading", { name: "Beta Invite Codes" })).toHaveCount(0);
  });

  test("turns a plain learner away", async ({ page, signInAs, db }) => {
    await signInAs("free");
    db.seed("invite_codes", []);

    await page.goto("/admin/invite-codes");

    await expect(page.getByRole("heading", { name: "Beta Invite Codes" })).toHaveCount(0);
  });
});

test.describe("listing codes", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
  });

  test("shows a code with how much of it is left", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: CODE_ID, code: "INGLEEZY01", uses: 2, max_uses: 5, note: "Twitter batch" }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("INGLEEZY01")).toBeVisible();
    await expect(page.getByText("2/5 used")).toBeVisible();
    await expect(page.getByText("Twitter batch")).toBeVisible();
  });

  test("marks a code that has been used up", async ({ page, db }) => {
    db.seed("invite_codes", [anInviteCode({ id: CODE_ID, code: "SPENT001", uses: 3, max_uses: 3 })]);

    await page.goto("/admin/invite-codes");

    // An admin about to paste a code into a DM needs to know it will not work
    // before they send it, not after the recipient complains.
    await expect(page.getByText("used up")).toBeVisible();
  });

  test("marks a code that has run out of time", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({
        id: CODE_ID,
        code: "STALE001",
        uses: 0,
        max_uses: 5,
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/admin/invite-codes");

    // Expiry beats remaining uses: a code with five uses left is still dead.
    await expect(page.getByText("expired")).toBeVisible();
    await expect(page.getByText("used up")).toHaveCount(0);
  });

  test("shows the expiry date of a code still in date", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({
        id: CODE_ID,
        code: "LIVE0001",
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText(/expires /)).toBeVisible();
    await expect(page.getByText("expired")).toHaveCount(0);
  });

  test("leaves a never-expiring code undated", async ({ page, db }) => {
    db.seed("invite_codes", [anInviteCode({ id: CODE_ID, code: "FOREVER1", expires_at: null })]);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("FOREVER1")).toBeVisible();

    await expect(page.getByText(/expires /)).toHaveCount(0);
  });

  test("puts the newest code first", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({
        id: CODE_ID,
        code: "OLDCODE1",
        created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      }),
      anInviteCode({
        id: "eeeeeeee-0000-4000-8000-000000000001",
        code: "NEWCODE1",
        created_at: new Date().toISOString(),
      }),
    ]);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("NEWCODE1")).toBeVisible();

    // The one just made is the one about to be pasted somewhere.
    const codes = await page.locator("span.font-mono.font-semibold").allTextContents();
    expect(codes).toEqual(["NEWCODE1", "OLDCODE1"]);
  });

  test("says so when there are no codes", async ({ page, db }) => {
    db.seed("invite_codes", []);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("No codes yet.")).toBeVisible();
  });
});

test.describe("creating a code", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    db.seed("invite_codes", []);
  });

  test("offers a rollable code out of an unambiguous alphabet", async ({ page }) => {
    await page.goto("/admin/invite-codes");

    const first = await page.getByLabel("Code").inputValue();
    // Read aloud down a phone line or typed off a screenshot, so I/O/0/1 are
    // left out of the alphabet entirely.
    expect(first).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);

    await page.getByRole("button", { name: "Roll" }).click();
    await expect(page.getByLabel("Code")).not.toHaveValue(first);
  });

  test("writes the code an admin typed", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("LAUNCH01");
    await page.getByLabel("Note (optional)").fill("Podcast listeners");
    await page.getByLabel("Max uses").fill("25");
    await page.getByRole("button", { name: "Create code" }).click();

    await expect.poll(() => db.rows("invite_codes").length).toBe(1);
    expect(db.rows("invite_codes")[0]).toMatchObject({
      code: "LAUNCH01",
      note: "Podcast listeners",
      max_uses: 25,
      expires_at: null,
      created_by: TEST_USER_ID,
    });
  });

  test("stores a lowercase code in upper case", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("launch01");
    await page.getByRole("button", { name: "Create code" }).click();

    // Redemption compares against the stored value, so a code saved in the
    // case an admin happened to type would only work if typed back the same
    // way. Normalising on the way in is what makes it case-insensitive.
    await expect.poll(() => db.rows("invite_codes")[0]?.code).toBe("LAUNCH01");
  });

  test("turns a day count into a real expiry", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("WEEKONLY");
    await page.getByLabel("Expires in (days)").fill("7");
    await page.getByRole("button", { name: "Create code" }).click();

    await expect.poll(() => db.rows("invite_codes").length).toBe(1);
    const expires = new Date(String(db.rows("invite_codes")[0].expires_at)).getTime();
    const sevenDays = Date.now() + 7 * 86_400_000;
    expect(Math.abs(expires - sevenDays)).toBeLessThan(60_000);
  });

  test("treats a blank expiry as never", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("FOREVER1");
    await page.getByRole("button", { name: "Create code" }).click();

    // The field's placeholder says "never", and null is what the redemption
    // check reads as no expiry.
    await expect.poll(() => db.rows("invite_codes")[0]?.expires_at).toBeNull();
  });

  test("floors max uses at one", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("ZEROUSES");
    await page.getByLabel("Max uses").fill("0");
    await page.getByRole("button", { name: "Create code" }).click();

    // The column carries `CHECK (max_uses > 0)`, so sending 0 would be refused
    // by the database with a message no admin could act on. Clamping client-side
    // turns that into the thing they meant.
    await expect.poll(() => db.rows("invite_codes")[0]?.max_uses).toBe(1);
  });

  test("resets the form after a successful create", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    const original = await page.getByLabel("Code").inputValue();
    await page.getByLabel("Note (optional)").fill("First batch");
    await page.getByRole("button", { name: "Create code" }).click();
    await expect.poll(() => db.rows("invite_codes").length).toBe(1);

    // Otherwise the next Create writes the same code again, which fails on the
    // unique constraint and reads as a broken button.
    await expect(page.getByLabel("Code")).not.toHaveValue(original);
    await expect(page.getByLabel("Note (optional)")).toHaveValue("");
    await expect(page.getByLabel("Max uses")).toHaveValue("1");
  });

  test("will not create an empty code", async ({ page }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("");

    await expect(page.getByRole("button", { name: "Create code" })).toBeDisabled();
  });

  test("reports a rejected code rather than silently doing nothing", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    // The rejection is injected rather than provoked. `invite_codes.code` is
    // UNIQUE in the migration, but the in-memory backend only enforces
    // uniqueness on an insert's conflict target — so a real duplicate would be
    // accepted here. What this test is actually about is the page's handling of
    // a refused insert, and a 409 is the shape the database sends.
    db.failWrites("invite_codes", 409, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "invite_codes_code_key"',
      details: null,
      hint: null,
    });
    db.seed("invite_codes", [anInviteCode({ id: CODE_ID, code: "TAKEN001" })]);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("TAKEN001")).toBeVisible();

    await page.getByLabel("Code").fill("TAKEN001");
    await page.getByRole("button", { name: "Create code" }).click();

    await expect(page.getByText("Could not create code")).toBeVisible();
    expect(db.rows("invite_codes")).toHaveLength(1);
  });

  test("shows the new code in the list without a reload", async ({ page }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("No codes yet.")).toBeVisible();

    await page.getByLabel("Code").fill("FRESH001");
    await page.getByRole("button", { name: "Create code" }).click();

    await expect(page.getByText("FRESH001")).toBeVisible();
    await expect(page.getByText("0/1 used")).toBeVisible();
  });
});

test.describe("handling a code", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    db.seed("invite_codes", [anInviteCode({ id: CODE_ID, code: "HANDLE01" })]);
  });

  test("copies the code itself, not the row", async ({ page }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("HANDLE01")).toBeVisible();

    await page.getByRole("button", { name: "Copy" }).click();

    // The copy button exists because this string gets pasted into a DM. What
    // lands on the clipboard is the whole point of it.
    await expect.poll(() => copiedText(page)).toEqual(["HANDLE01"]);
    await expect(page.getByText("Copied")).toBeVisible();
  });

  test("deletes a code", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("HANDLE01")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Code deleted")).toBeVisible();
    await expect.poll(() => db.rows("invite_codes")).toHaveLength(0);
  });

  test("deletes without asking first", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await expect(page.getByText("HANDLE01")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => db.rows("invite_codes")).toHaveLength(0);

    // Recorded rather than endorsed. Every other destructive action in the
    // admin console confirms first; this one is a single click next to Copy,
    // both icon-only and 4px apart, and a code already sent to someone cannot
    // be recreated from the page — the value is gone with the row.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("reports a delete that failed", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("invite_codes", 500);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("HANDLE01")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Delete failed")).toBeVisible();
    await expect(page.getByText("HANDLE01")).toBeVisible();
  });
});

test.describe("what the console shows against what redemption enforces", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
  });

  test("calls a code spent at exactly the use that fills it", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: CODE_ID, code: "EDGE0001", uses: 4, max_uses: 5 }),
    ]);

    await page.goto("/admin/invite-codes");

    // The off-by-one that matters: `uses >= max_uses`, so a code on its last
    // use still reads as live. `verify_invite_code` uses the same comparison,
    // and a page that disagreed would have an admin retiring a code that still
    // had one signup in it.
    await expect(page.getByText("4/5 used")).toBeVisible();
    await expect(page.getByText("used up")).toHaveCount(0);
  });

  test("calls it spent the moment it is full", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: CODE_ID, code: "EDGE0002", uses: 5, max_uses: 5 }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("used up")).toBeVisible();
  });
});
