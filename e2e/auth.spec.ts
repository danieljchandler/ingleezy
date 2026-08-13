import { expect, test } from "./support/fixtures";
import { anInviteCode, aProfile, daysAgo, TEST_USER_ID } from "../src/test/support/factories";

/**
 * Sign-in, sign-up and password reset.
 *
 * `src/pages/Auth.tsx` is 399 lines that no test had ever submitted a form to.
 * The invite-code flow in particular has three network round-trips and a
 * compensating sign-out, and none of it was exercised.
 */

const EMAIL = "learner@example.com";
const PASSWORD = "correct-horse";

/** Fill the form. The invite field only exists in sign-up mode. */
async function fillCredentials(
  page: import("@playwright/test").Page,
  { email = EMAIL, password = PASSWORD, invite }: { email?: string; password?: string; invite?: string } = {},
) {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  if (invite !== undefined) await page.getByLabel(/invite code/i).fill(invite);
}

test.describe("the form validates before it hits the network", () => {
  test.beforeEach(async ({ signInAs, page }) => {
    await signInAs("anonymous");
    await page.goto("/auth");
  });

  test("rejects an address the browser accepts but the app does not", async ({ page, backend }) => {
    // "a@b" is deliberate. The input is type="email", so anything without an @
    // is stopped by the browser and the app's own validator never runs. A
    // domain with no dot is the gap between the two — native validation allows
    // it, EMAIL_RE in Auth.tsx does not.
    await fillCredentials(page, { email: "a@b" });
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page.getByText(/valid email address/i)).toBeVisible();
    // Nothing should have been sent.
    expect(backend.db.reads).toHaveLength(0);
  });

  test("the browser stops a value with no @ before the app sees it", async ({ page, backend }) => {
    await fillCredentials(page, { email: "not-an-email" });
    await page.getByRole("button", { name: /^log in$/i }).click();

    // Native constraint validation blocks the submit entirely, so neither the
    // app's message nor a request appears.
    await expect(page.getByText(/valid email address/i)).toHaveCount(0);
    expect(backend.db.reads).toHaveLength(0);
  });

  test("rejects a password under six characters", async ({ page }) => {
    await fillCredentials(page, { password: "short" });
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
  });

  test("requires an invite code to sign up", async ({ page }) => {
    await page.getByRole("button", { name: /create an account/i }).click();
    await fillCredentials(page, { invite: "" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/invite code required/i)).toBeVisible();
  });
});

test.describe("signing in", () => {
  test("a correct password lands the learner on the home page", async ({ page, signInAs, backend }) => {
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    backend.db.seed("profiles", [aProfile({ onboarding_completed: true })]);

    await page.goto("/auth");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page.getByText(/welcome back/i).first()).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("a wrong password explains itself without leaking whether the account exists", async ({
    page,
    signInAs,
  }) => {
    await signInAs("anonymous");
    await page.goto("/auth");

    await fillCredentials(page, { password: "wrong-password" });
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page.getByText(/wrong email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("an unfinished onboarding sends the learner there instead of home", async ({
    page,
    signInAs,
    backend,
  }) => {
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    backend.db.seed("profiles", [aProfile({ onboarding_completed: false })]);

    await page.goto("/auth");
    await fillCredentials(page);
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("returns the learner to the page they were bounced from", async ({
    page,
    signInAs,
    backend,
  }) => {
    // ProtectedRoute stashes the attempted path in location.state; the whole
    // point of that is for it to be honoured after sign-in.
    await signInAs("anonymous");
    backend.addUser(TEST_USER_ID, EMAIL);
    backend.db.seed("profiles", [aProfile()]);

    await page.goto("/my-words");
    await expect(page).toHaveURL(/\/auth$/);

    await fillCredentials(page);
    await page.getByRole("button", { name: /^log in$/i }).click();

    await expect(page).toHaveURL(/\/my-words$/);
  });
});

test.describe("signing up with an invite code", () => {
  test.beforeEach(async ({ signInAs, page }) => {
    await signInAs("anonymous");
    await page.goto("/auth");
    await page.getByRole("button", { name: /create an account/i }).click();
  });

  test("a valid code creates the account and redeems the code", async ({ page, backend }) => {
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-GOOD", uses: 0, max_uses: 5 })]);

    await fillCredentials(page, { email: "new@example.com", invite: "hakiya-good" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/account created/i)).toBeVisible();

    // The redemption is the half that actually matters — a code that verifies
    // but never redeems would let one code create unlimited accounts.
    expect(backend.db.rows("invite_codes")[0].uses).toBe(1);
    expect(backend.db.rows("invite_redemptions")).toHaveLength(1);
  });

  test("uppercases the code, so a lowercase paste still works", async ({ page, backend }) => {
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-GOOD" })]);

    await page.getByLabel(/invite code/i).fill("hakiya-good");
    await expect(page.getByLabel(/invite code/i)).toHaveValue("HAKIYA-GOOD");
  });

  test("a code that does not exist is refused before the account is created", async ({
    page,
    backend,
  }) => {
    backend.db.seed("invite_codes", []);

    await fillCredentials(page, { email: "new@example.com", invite: "NOPE-1234" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/invalid, expired, or fully used code/i)).toBeVisible();
    // The comment in Auth.tsx says this ordering exists so bad codes don't
    // leave orphan users behind. Assert it actually does.
    expect(backend.db.rows("invite_redemptions")).toHaveLength(0);
  });

  test("a fully used code is refused", async ({ page, backend }) => {
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-FULL", uses: 5, max_uses: 5 })]);

    await fillCredentials(page, { email: "new@example.com", invite: "HAKIYA-FULL" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/invalid, expired, or fully used code/i)).toBeVisible();
  });

  test("an expired code is refused", async ({ page, backend }) => {
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-OFF", expires_at: daysAgo(1) })]);

    await fillCredentials(page, { email: "new@example.com", invite: "HAKIYA-OFF" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/invalid, expired, or fully used code/i)).toBeVisible();
  });

  test("an email that already has an account says so", async ({ page, backend }) => {
    backend.db
      .seed("invite_codes", [anInviteCode({ code: "HAKIYA-GOOD" })])
      .seed("profiles", [aProfile()]);
    backend.addUser("00000000-0000-4000-8000-000000000077", "taken@example.com");

    await fillCredentials(page, { email: "taken@example.com", invite: "HAKIYA-GOOD" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/already registered/i)).toBeVisible();
  });

  test("a redemption that loses the race signs the new account back out", async ({
    page,
    backend,
  }) => {
    // The comment in Auth.tsx describes this: someone takes the last seat
    // between verify and redeem. Without the compensating sign-out the learner
    // ends up with an account that bypassed the invite gate entirely.
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-RACE" })]);
    backend.stubRpc("redeem_invite_code", () => {
      throw new Error("no seats left");
    });

    await fillCredentials(page, { email: "new@example.com", invite: "HAKIYA-RACE" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/couldn't be redeemed/i)).toBeVisible();

    // What matters is that the session is gone: an account that reached the app
    // without redeeming a code would have bypassed the beta gate entirely.
    const session = await page.evaluate(() => window.localStorage.getItem("sb-e2e-auth-token"));
    expect(session).toBeNull();

    // And it stays gone — a protected route bounces them straight back.
    await page.goto("/my-words");
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("the failed sign-up still lands on the home page rather than back on the form", async ({
    page,
    backend,
  }) => {
    // Recording current behaviour, which is a little surprising: signUp creates
    // a session, the redirect effect in Auth.tsx fires on it, and the learner is
    // navigated to "/" before the compensating signOut lands. They end up signed
    // out on the landing page rather than on the form with the error visible.
    // Harmless — the toast still explains it, and the session is cleared — but
    // it is why the assertion above checks the session rather than the URL.
    backend.db.seed("invite_codes", [anInviteCode({ code: "HAKIYA-RACE2" })]);
    backend.stubRpc("redeem_invite_code", () => {
      throw new Error("no seats left");
    });

    await fillCredentials(page, { email: "new2@example.com", invite: "HAKIYA-RACE2" });
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });
});

test.describe("password reset", () => {
  test("sends a reset email for a valid address", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/auth");

    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByRole("button", { name: /forgot password/i }).click();

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
  });

  test("asks for the email first when the field is empty", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/auth");

    await page.getByRole("button", { name: /forgot password/i }).click();

    await expect(page.getByText(/enter your email above first/i)).toBeVisible();
  });
});

test.describe("switching between modes", () => {
  test("the invite field appears only when signing up", async ({ page, signInAs }) => {
    await signInAs("anonymous");
    await page.goto("/auth");

    await expect(page.getByLabel(/invite code/i)).toHaveCount(0);

    await page.getByRole("button", { name: /create an account/i }).click();
    await expect(page.getByLabel(/invite code/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /join hakiya/i })).toBeVisible();
  });
});
