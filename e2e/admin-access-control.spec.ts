import { expect, test } from "./support/fixtures";
import { aProfile, anInviteCode, aRole } from "../src/test/support/factories";

/**
 * The two admin screens that control who gets into the product at all.
 *
 * Invite codes gate sign-up — the app is closed beta, and `Auth.tsx` refuses to
 * create an account without a valid one. Role management grants the privileged
 * roles, including `admin` itself. Neither had any coverage.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

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

test.describe("role management", () => {
  test.beforeEach(async ({ signInAs, db, backend }) => {
    await signInAs("admin");
    // Emails live in auth.users, which is why admin_find_user is an RPC — the
    // client cannot resolve one itself.
    backend.addUser(OTHER_USER, "learner@example.com");
    db.seed("profiles", [aProfile(), aProfile({ user_id: OTHER_USER, display_name: "Learner" })]);
  });

  test("lists who currently holds a managed role", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: "r1", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");

    await expect(page.getByText("learner@example.com")).toBeVisible();
  });

  test("grants a role by email", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/user email or uuid/i).fill("learner@example.com");
    await page.getByRole("button", { name: /add|grant/i }).first().click();

    await expect
      .poll(() => db.writesTo("user_roles").filter((w) => w.method === "POST").length)
      .toBeGreaterThanOrEqual(1);

    const write = db.writesTo("user_roles").find((w) => w.method === "POST");
    expect(write?.payload[0]).toMatchObject({ user_id: OTHER_USER });
  });

  test("refuses an email that matches no account", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/user email or uuid/i).fill("nobody@example.com");
    await page.getByRole("button", { name: /add|grant/i }).first().click();

    await expect(page.getByText(/user not found/i)).toBeVisible();
    expect(db.writesTo("user_roles")).toHaveLength(0);
  });

  test("does not grant the same role twice", async ({ page, db }) => {
    // A duplicate row would leave two rows to revoke, so revoking once would
    // appear to do nothing.
    db.add("user_roles", aRole("bible_reader", { id: "r1", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");
    await page.getByPlaceholder(/user email or uuid/i).fill("learner@example.com");
    await page.getByRole("button", { name: /add|grant/i }).first().click();

    await expect(page.getByText(/already assigned/i)).toBeVisible();
    expect(db.writesTo("user_roles").filter((w) => w.method === "POST")).toHaveLength(0);
  });

  test("cannot be submitted with a blank identifier", async ({ page }) => {
    // Disabled rather than clickable-and-ignored, which is the better of the
    // two: nothing to misread as having worked.
    await page.goto("/admin/bible-access");

    const submit = page.getByRole("button", { name: /add|grant/i }).first();
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder(/user email or uuid/i).fill("learner@example.com");
    await expect(submit).toBeEnabled();
  });
});
