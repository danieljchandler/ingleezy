import { expect, test } from "./support/fixtures";
import { anInviteCode } from "../src/test/support/factories";

/**
 * The admin screen that controls who gets into the product at all.
 *
 * Invite codes gate sign-up — the app is closed beta, and `Auth.tsx` refuses to
 * create an account without a valid one.
 */

test.describe("invite codes", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("admin");
  });

  test("lists the codes that exist", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: "c1", code: "INGLEEZY-AAAA", note: "Twitter batch" }),
      anInviteCode({ id: "c2", code: "INGLEEZY-BBBB", note: null }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("INGLEEZY-AAAA")).toBeVisible();
    await expect(page.getByText("Twitter batch")).toBeVisible();
  });

  test("suggests a code so an admin need not invent one", async ({ page, db }) => {
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await expect(page.getByLabel(/^code$/i)).not.toHaveValue("");
  });

  test("creates a code, uppercased and attributed to the admin", async ({ page, db }) => {
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/^code$/i).fill("launch-week");
    await page.getByLabel(/note/i).fill("Launch week");
    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();

    const write = db.lastWriteTo("invite_codes");
    expect(write?.method).toBe("POST");
    // Codes are compared uppercased at redemption, so they must be stored that
    // way or a lowercase entry would never match.
    expect(write?.payload[0]).toMatchObject({ code: "LAUNCH-WEEK", note: "Launch week" });
    expect(write?.payload[0].created_by).toBeTruthy();
  });

  test("never creates a code with fewer than one use", async ({ page, db }) => {
    // A zero-use code is a code that can never be redeemed, so the form floors
    // it rather than storing something useless.
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/max uses/i).fill("0");
    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();
    expect(Number(db.lastWriteTo("invite_codes")?.payload[0].max_uses)).toBeGreaterThanOrEqual(1);
  });

  test("leaves the expiry unset when no number of days is given", async ({ page, db }) => {
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();
    expect(db.lastWriteTo("invite_codes")?.payload[0].expires_at).toBeNull();
  });

  test("sets a future expiry when days are given", async ({ page, db }) => {
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/expires/i).fill("7");
    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();

    const expiresAt = db.lastWriteTo("invite_codes")?.payload[0].expires_at;
    expect(new Date(String(expiresAt)).getTime()).toBeGreaterThan(Date.now());
  });

  test("clears the form after a successful create", async ({ page, db }) => {
    // Otherwise a second click re-submits the same code and collides.
    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/note/i).fill("Launch week");
    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();
    await expect(page.getByLabel(/note/i)).toHaveValue("");
  });

  test("says so when a code cannot be created", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);

    db.seed("invite_codes", []);
    await page.goto("/admin/invite-codes");

    db.failWrites("invite_codes", 409, {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: null,
      hint: null,
    });

    await page.getByRole("button", { name: /create/i }).first().click();

    await expect(page.getByText(/could not create code/i)).toBeVisible();
  });
});

