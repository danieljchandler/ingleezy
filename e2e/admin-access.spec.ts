import { expect, test } from "./support/fixtures";
import { anInviteCode, aRole, TEST_USER_ID } from "../src/test/support/factories";

/** Invite codes have no exported id helper; these only need to be distinct. */
const inviteCodeId = (index: number) => `eeeeeeee-0000-4000-8000-00000000000${index}`;

/**
 * The two admin screens that hand out access: invite codes and role grants.
 *
 * Both control who can get in and what they can see, and neither had any
 * coverage. An invite code is the only way to create an account during the
 * closed beta, so a code that is generated wrong, deleted by accident, or shown
 * as live when it is spent all cost real signups. Role grants decide Bible
 * access, content review and beta features, and the grant path goes through two
 * security-definer RPCs — `admin_find_user` to resolve an email the client
 * cannot read, then a plain insert — with a duplicate check between them.
 */

const OTHER_USER = "00000000-0000-4000-8000-000000000009";

test.describe("invite codes", () => {
  test.beforeEach(async ({ signInAs, db }) => {
    await signInAs("admin");
    db.seed("invite_codes", []);
  });

  test("offers a generated code rather than a blank field", async ({ page }) => {
    await page.goto("/admin/invite-codes");

    // Typing a code by hand invites collisions and ambiguous characters; the
    // generator draws from an alphabet with no O/0 or I/1.
    const value = await page.getByLabel("Code").inputValue();
    expect(value).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  test("rolls a different code on request", async ({ page }) => {
    await page.goto("/admin/invite-codes");

    const first = await page.getByLabel("Code").inputValue();
    await page.getByRole("button", { name: "Roll" }).click();

    await expect(page.getByLabel("Code")).not.toHaveValue(first);
  });

  test("creates a code with the values entered", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");

    await page.getByLabel("Code").fill("launch01");
    await page.getByLabel(/note/i).fill("Twitter launch batch");
    await page.getByLabel(/max uses/i).fill("25");
    await page.getByRole("button", { name: /create code/i }).click();

    await expect(page.getByText(/invite code created/i)).toBeVisible();

    const created = db.rows("invite_codes")[0];
    // Uppercased on write, because redemption uppercases what the learner
    // types — a lowercase row would never match.
    expect(created.code).toBe("LAUNCH01");
    expect(created.note).toBe("Twitter launch batch");
    expect(Number(created.max_uses)).toBe(25);
    expect(created.created_by).toBe(TEST_USER_ID);
  });

  test("turns a number of days into a real expiry", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/expires in/i).fill("7");
    await page.getByRole("button", { name: /create code/i }).click();
    await expect(page.getByText(/invite code created/i)).toBeVisible();

    const expiry = new Date(String(db.rows("invite_codes")[0].expires_at)).getTime();
    const sevenDays = Date.now() + 7 * 86_400_000;
    expect(Math.abs(expiry - sevenDays)).toBeLessThan(60_000);
  });

  test("leaves a code without an expiry when none is given", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");
    await page.getByRole("button", { name: /create code/i }).click();
    await expect(page.getByText(/invite code created/i)).toBeVisible();

    // "never" is the placeholder and the intended default; an accidental
    // Invalid Date here would make every code instantly dead.
    expect(db.rows("invite_codes")[0].expires_at).toBeNull();
  });

  test("floors max uses at one", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");

    await page.getByLabel(/max uses/i).fill("0");
    await page.getByRole("button", { name: /create code/i }).click();
    await expect(page.getByText(/invite code created/i)).toBeVisible();

    // A zero-use code is a code that cannot be redeemed — worse than useless,
    // because it looks live in the list.
    expect(Number(db.rows("invite_codes")[0].max_uses)).toBe(1);
  });

  test("resets the form after a code is created", async ({ page }) => {
    await page.goto("/admin/invite-codes");

    const first = await page.getByLabel("Code").inputValue();
    await page.getByLabel(/note/i).fill("Twitter launch batch");
    await page.getByRole("button", { name: /create code/i }).click();
    await expect(page.getByText(/invite code created/i)).toBeVisible();

    // Leaving the old values would make the next Create silently produce a
    // duplicate code with the wrong note.
    await expect(page.getByLabel("Code")).not.toHaveValue(first);
    await expect(page.getByLabel(/note/i)).toHaveValue("");
  });

  test("will not create a code with no code", async ({ page, db }) => {
    await page.goto("/admin/invite-codes");

    await page.getByLabel("Code").fill("");

    await expect(page.getByRole("button", { name: /create code/i })).toBeDisabled();
    expect(db.rows("invite_codes")).toHaveLength(0);
  });

  test("says so when the code already exists", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.seed("invite_codes", [anInviteCode({ id: inviteCodeId(0), code: "LAUNCH01" })]);
    await page.goto("/admin/invite-codes");

    // The unique constraint lives in Postgres, and the in-memory backend does
    // not model constraints — so the 23505 is injected rather than provoked.
    // What is under test is the page's response to it, not the database.
    db.failNextWrite("invite_codes", 409, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "invite_codes_code_key"',
      details: null,
      hint: null,
    });

    await page.getByLabel("Code").fill("LAUNCH01");
    await page.getByRole("button", { name: /create code/i }).click();

    // Reporting nothing would leave the admin thinking they had handed out a
    // code that does not exist.
    await expect(page.getByText(/could not create code/i)).toBeVisible();
  });

  test("lists existing codes with how much of each is left", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: inviteCodeId(0), code: "LAUNCH01", uses: 3, max_uses: 10 }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("LAUNCH01")).toBeVisible();
    await expect(page.getByText("3/10 used")).toBeVisible();
  });

  test("marks a code that has been used up", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: inviteCodeId(0), code: "SPENT001", uses: 5, max_uses: 5 }),
    ]);

    await page.goto("/admin/invite-codes");

    // There is no is_active column — exhaustion and expiry are the only two
    // ways a code dies, so the list has to show both or an admin cannot tell a
    // live code from a dead one.
    await expect(page.getByText("used up")).toBeVisible();
  });

  test("marks a code that has expired", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({
        id: inviteCodeId(0),
        code: "OLDCODE1",
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("expired")).toBeVisible();
  });

  test("shows a live code as neither expired nor spent", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({
        id: inviteCodeId(0),
        code: "LIVECODE",
        uses: 1,
        max_uses: 5,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);

    await page.goto("/admin/invite-codes");

    await expect(page.getByText("LIVECODE")).toBeVisible();
    await expect(page.getByText("expired")).toHaveCount(0);
    await expect(page.getByText("used up")).toHaveCount(0);
  });

  test("deletes exactly the code asked for", async ({ page, db }) => {
    db.seed("invite_codes", [
      anInviteCode({ id: inviteCodeId(0), code: "KEEPTHIS" }),
      anInviteCode({ id: inviteCodeId(1), code: "DELETEME" }),
    ]);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("DELETEME")).toBeVisible();

    await page
      .locator("div")
      .filter({ hasText: /^DELETEME/ })
      .getByRole("button", { name: "Delete" })
      .first()
      .click();

    await expect.poll(() => db.rows("invite_codes").length, { timeout: 10_000 }).toBe(1);
    // A delete without its filter would clear every code in the beta at once.
    expect(db.rows("invite_codes")[0].code).toBe("KEEPTHIS");
  });

  test("reports a failed delete instead of pretending it worked", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.seed("invite_codes", [anInviteCode({ id: inviteCodeId(0), code: "LAUNCH01" })]);

    await page.goto("/admin/invite-codes");
    await expect(page.getByText("LAUNCH01")).toBeVisible();

    db.failWrites("invite_codes", 403);
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText(/delete failed/i)).toBeVisible();
    expect(db.rows("invite_codes")).toHaveLength(1);
  });

  test("says so when there are no codes yet", async ({ page }) => {
    await page.goto("/admin/invite-codes");

    await expect(page.getByText(/no codes yet/i)).toBeVisible();
  });

  test("does not claim an empty list when the query failed", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.seed("invite_codes", [anInviteCode({ id: inviteCodeId(0) })]);
    db.failAlways("invite_codes", 500);

    await page.goto("/admin/invite-codes");

    // "No codes yet" after a failed request would prompt an admin to generate
    // a second batch on top of one that already exists.
    await expect(page.getByText(/no codes yet/i)).toHaveCount(0);
  });
});

test.describe("granting roles", () => {
  test.beforeEach(async ({ signInAs, backend }) => {
    await signInAs("admin");
    backend.addUser(OTHER_USER, "learner@example.com");
  });

  test("grants a role by email", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/email or uuid/i).fill("learner@example.com");
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/bible reader granted/i)).toBeVisible();

    // The email is resolved server-side: profiles has no email column, so
    // admin_find_user is the only way the client can turn one into a user id.
    const granted = db.rows("user_roles").find((row) => row.user_id === OTHER_USER);
    expect(granted?.role).toBe("bible_reader");
  });

  test("grants a role by user id", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/email or uuid/i).fill(OTHER_USER);
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/bible reader granted/i)).toBeVisible();
    expect(db.rows("user_roles").some((row) => row.user_id === OTHER_USER)).toBe(true);
  });

  test("grants the role that was selected", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/email or uuid/i).fill("learner@example.com");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Beta tester" }).click();
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/beta tester granted/i)).toBeVisible();
    expect(
      db.rows("user_roles").find((row) => row.user_id === OTHER_USER)?.role,
    ).toBe("beta_tester");
  });

  test("refuses an identifier that matches no account", async ({ page, db }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/email or uuid/i).fill("nobody@example.com");
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/user not found/i)).toBeVisible();
    // Granting to a resolved-to-nothing id would create an orphan row that no
    // account could ever use and no admin could ever find.
    expect(db.rows("user_roles").some((row) => row.user_id === OTHER_USER)).toBe(false);
  });

  test("does not grant the same role twice", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: "role-existing", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");
    await page.getByPlaceholder(/email or uuid/i).fill("learner@example.com");
    await page.getByRole("button", { name: /^add$/i }).click();

    await expect(page.getByText(/already assigned/i)).toBeVisible();
    expect(db.rows("user_roles").filter((row) => row.user_id === OTHER_USER)).toHaveLength(1);
  });

  test("clears the field after a grant, so the next one starts clean", async ({ page }) => {
    await page.goto("/admin/bible-access");

    await page.getByPlaceholder(/email or uuid/i).fill("learner@example.com");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText(/bible reader granted/i)).toBeVisible();

    await expect(page.getByPlaceholder(/email or uuid/i)).toHaveValue("");
  });

  test("will not submit an empty identifier", async ({ page }) => {
    await page.goto("/admin/bible-access");

    await expect(page.getByRole("button", { name: /^add$/i })).toBeDisabled();
  });

  test("lists the grants with the email each belongs to", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: "role-existing", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");

    // The email is the only human-readable identifier here; a table of bare
    // UUIDs is unauditable.
    await expect(page.getByText("learner@example.com")).toBeVisible();
    await expect(page.getByRole("table").getByText("Bible reader")).toBeVisible();
  });

  test("filters the list to one role", async ({ page, db, backend }) => {
    const third = "00000000-0000-4000-8000-000000000008";
    backend.addUser(third, "tester@example.com");
    db.add(
      "user_roles",
      aRole("bible_reader", { id: "role-a", user_id: OTHER_USER }),
      aRole("beta_tester", { id: "role-b", user_id: third }),
    );

    await page.goto("/admin/bible-access");
    await expect(page.getByText("tester@example.com")).toBeVisible();

    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Bible reader" }).click();

    await expect(page.getByText("learner@example.com")).toBeVisible();
    await expect(page.getByText("tester@example.com")).toHaveCount(0);
  });

  test("says so when nothing matches the filter", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: "role-a", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Content reviewer" }).click();

    await expect(page.getByText(/no matching role assignments/i)).toBeVisible();
  });

  test("revokes exactly the grant asked for", async ({ page, db, backend }) => {
    const third = "00000000-0000-4000-8000-000000000008";
    backend.addUser(third, "tester@example.com");
    db.add(
      "user_roles",
      aRole("bible_reader", { id: "role-a", user_id: OTHER_USER }),
      aRole("beta_tester", { id: "role-b", user_id: third }),
    );

    await page.goto("/admin/bible-access");
    await expect(page.getByText("learner@example.com")).toBeVisible();

    await page
      .getByRole("row")
      .filter({ hasText: "learner@example.com" })
      .getByRole("button")
      .click();

    await expect(page.getByText(/role revoked/i)).toBeVisible();
    // Revoking by row id, so the other grant survives — a delete keyed on
    // user_id or role alone would take out more than was asked.
    const remaining = db.rows("user_roles").filter((row) => row.id === "role-b");
    expect(remaining).toHaveLength(1);
  });

  test("reports a failed revoke rather than removing the row from the screen", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.add("user_roles", aRole("bible_reader", { id: "role-a", user_id: OTHER_USER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("learner@example.com")).toBeVisible();

    db.failWrites("user_roles", 403);
    await page.getByRole("row").filter({ hasText: "learner@example.com" }).getByRole("button").click();

    await expect(page.getByText(/failed to revoke/i)).toBeVisible();
    // The row is dropped from local state on success only; dropping it on
    // failure would show an admin a revocation that never happened.
    await expect(page.getByText("learner@example.com")).toBeVisible();
    expect(db.rows("user_roles").some((row) => row.id === "role-a")).toBe(true);
  });

  test("turns a non-admin away", async ({ page, signInAs }) => {
    await signInAs("recorder");
    await page.goto("/admin/bible-access");

    // Recorders reach /admin, but handing out roles is not theirs to do.
    await expect(page.getByText(/only admins can manage role access/i)).toBeVisible();
  });
});
