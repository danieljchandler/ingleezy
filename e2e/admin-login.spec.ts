import { expect, test, type Page } from "./support/fixtures";
import { aRole, TEST_USER_ID } from "../src/test/support/factories";

/**
 * `/admin/login` — the only admin route outside `AdminLayout`.
 *
 * It has to sit outside, because the layout sends unauthenticated visitors
 * here: nesting it would loop. It is also a second, separate sign-in form from
 * `/auth`, with its own validation, its own sign-up mode and its own wording,
 * and it grants nothing on its own — a fresh account lands on the layout's
 * "Access Denied" and is bounced straight back.
 */

const EMAIL = "admin@example.com";
const PASSWORD = "correct-horse";

async function fillCredentials(
  page: Page,
  { email = EMAIL, password = PASSWORD }: { email?: string; password?: string } = {},
) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
}

test.describe("the form", () => {
  test.beforeEach(async ({ signInAs, page }) => {
    await signInAs("anonymous");
    await page.goto("/admin/login");
  });

  test("opens in sign-in mode", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /admin panel/i })).toBeVisible();
    await expect(page.getByText(/sign in to manage content/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("rejects an address the browser accepts but zod does not", async ({ page, backend }) => {
    // type="email" stops anything without an @, so a domain with no dot is the
    // only value that reaches the app's own validator.
    await fillCredentials(page, { email: "a@b" });
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/please enter a valid email/i)).toBeVisible();
    expect(backend.db.reads).toHaveLength(0);
  });

  test("rejects a password under six characters", async ({ page }) => {
    await fillCredentials(page, { password: "short" });
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
  });

  test("hides the password until asked", async ({ page }) => {
    const field = page.getByLabel("Password");
    await expect(field).toHaveAttribute("type", "password");

    await page.locator("button:has(svg.lucide-eye)").click();
    await expect(field).toHaveAttribute("type", "text");

    await page.locator("button:has(svg.lucide-eye-off)").click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("switches to sign-up and back", async ({ page }) => {
    await page.getByRole("button", { name: /don't have an account/i }).click();

    await expect(page.getByText(/create an account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^create account$/i })).toBeVisible();

    await page.getByRole("button", { name: /already have an account/i }).click();

    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("offers a way back to the learner app", async ({ page }) => {
    await page.getByRole("button", { name: /back to ingleezy/i }).click();

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});

test.describe("signing in", () => {
  test("an admin lands on the dashboard", async ({ page, signInAs, backend, db }) => {
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    db.seed("user_roles", [aRole("admin")]);

    await page.goto("/admin/login");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/Gulf Arabic Module/)).toBeVisible();
  });

  test("a wrong password says so without naming which half was wrong", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");
    await page.goto("/admin/login");

    await fillCredentials(page, { password: "wrong-password" });
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    await expect(page.getByText(/check your email and password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("an account with no admin role is bounced straight back", async ({
    page,
    signInAs,
    backend,
    db,
  }) => {
    // The form grants nothing by itself. Signing in works; the layout then
    // finds no privileged role and returns the visitor to this page — which is
    // the only feedback that the account is not an admin.
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    db.seed("user_roles", []);

    await page.goto("/admin/login");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/access denied/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("a recorder gets in", async ({ page, signInAs, backend, db }) => {
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    db.seed("user_roles", [aRole("recorder")]);

    await page.goto("/admin/login");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/admin$/);
  });

  test("a content reviewer gets in as far as the dashboard", async ({
    page,
    signInAs,
    backend,
    db,
  }) => {
    // rbac.ts allow-lists "/admin" itself for a reviewer, so the landing page
    // works even though most of what it links to does not.
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    db.seed("user_roles", [aRole("content_reviewer")]);

    await page.goto("/admin/login");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(/access denied/i)).toHaveCount(0);
  });

  test("reports an unexpected failure rather than hanging", async ({
    page,
    signInAs,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    await signInAs("anonymous");
    await page.goto("/admin/login");

    // A sign-in that fails for any reason other than bad credentials falls to
    // the catch and surfaces the raw message.
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "server_error", error_description: "upstream is down" }),
      }),
    );

    await fillCredentials(page);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/upstream is down/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
  });
});

test.describe("signing up", () => {
  test("a new account is created but granted nothing", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/admin/login");

    await page.getByRole("button", { name: /don't have an account/i }).click();
    await fillCredentials(page, { email: "newcomer@example.com" });
    await page.getByRole("button", { name: /^create account$/i }).click();

    await expect(page.getByText(/account created/i)).toBeVisible();
    await expect(page.getByText(/contact an admin to grant you admin access/i)).toBeVisible();
  });

  test("an address already in use says to sign in instead", async ({ page, signInAs, backend }) => {
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);

    await page.goto("/admin/login");
    await page.getByRole("button", { name: /don't have an account/i }).click();
    await fillCredentials(page);
    await page.getByRole("button", { name: /^create account$/i }).click();

    await expect(page.getByText(/account exists/i)).toBeVisible();
    await expect(page.getByText(/try signing in instead/i)).toBeVisible();
  });

  test("stays on the form after signing up", async ({ page, signInAs }) => {
    // Pinned, not fixed. Sign-up leaves the visitor on /admin/login in sign-up
    // mode with the credentials still filled in — no redirect, and no switch
    // back to sign-in — so the obvious next action is to submit the same form
    // again, which now reports the account already exists.
    await signInAs("anonymous");
    await page.goto("/admin/login");

    await page.getByRole("button", { name: /don't have an account/i }).click();
    await fillCredentials(page, { email: "newcomer@example.com" });
    await page.getByRole("button", { name: /^create account$/i }).click();

    await expect(page.getByText(/account created/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("button", { name: /^create account$/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("newcomer@example.com");
  });
});

test.describe("who sees it", () => {
  test("an admin who is already signed in still gets the form", async ({ page, signInAs }) => {
    // Pinned, not fixed. Nothing redirects an authenticated admin away, so the
    // page offers to sign in an account that is already signed in.
    await signInAs("admin");

    await page.goto("/admin/login");

    await expect(page.getByRole("heading", { name: /admin panel/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });
});
