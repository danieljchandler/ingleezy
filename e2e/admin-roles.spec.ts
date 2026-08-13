import { expect, test } from "./support/fixtures";
import { aProfile, aRole, TEST_USER_ID } from "../src/test/support/factories";
import type { SupabaseBackend } from "../src/test/support/server/handler";

/**
 * /admin/bible-access — where roles are handed out and taken away.
 *
 * This page is the only way any of the three managed roles gets granted, and
 * one of them (`bible_reader`) is the sole key to material with no route guard
 * in front of it. So the interesting assertions are not "does the form work"
 * but "can it grant something it should not, and does revoking really revoke".
 *
 * It never touches `auth.users` directly, because the client cannot: emails
 * live in a schema the anon key cannot read. Both halves of the flow —
 * resolving an identifier and listing who currently holds what — go through
 * security-definer RPCs, which is why the tests care about *which* RPC was
 * called with what, rather than about a table read.
 */

const READER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const READER_ROLE_ROW = "22222222-0000-4000-8000-000000000000";

/** Register an account so `admin_find_user` can resolve it by email. */
function anAccount(backend: SupabaseBackend, id: string, email: string) {
  backend.addUser(id, email);
  backend.db.add("profiles", aProfile({ user_id: id, display_name: email.split("@")[0] }));
}

test.describe("who may open it", () => {
  test("lets an admin in", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);

    await page.goto("/admin/bible-access");

    await expect(page.getByRole("heading", { name: "Role Access Management" })).toBeVisible();
  });

  test("turns a recorder away", async ({ page, signInAs }) => {
    await signInAs("recorder");

    await page.goto("/admin/bible-access");

    // The page's own `isAdmin` check is the backstop; the layout's allow-list
    // is the front door. Either way the grant form must not render.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveCount(0);
  });

  test("turns a content reviewer away", async ({ page, signInAs }) => {
    await signInAs("content_reviewer");

    await page.goto("/admin/bible-access");

    // Especially this one: a content reviewer who could reach this page could
    // grant themselves `bible_reader`, and the Bible pages' rule is admin OR
    // (bible_reader AND NOT content_reviewer) — they would then only need to
    // revoke their own reviewer role to be inside.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveCount(0);
  });
});

test.describe("listing who holds what", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    anAccount(backend, READER, "layla@example.com");
    anAccount(backend, OTHER, "omar@example.com");
  });

  test("shows each holder with the email the RPC resolved", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");

    // The email is the only human-readable handle an admin has — profiles has
    // no email column, so a page that could not resolve it would list UUIDs.
    await expect(page.getByText("layla@example.com")).toBeVisible();
    // Scoped to the table: "Bible reader" also appears in the page's own
    // description and in the role picker's current value.
    await expect(page.getByRole("cell", { name: "Bible reader" })).toBeVisible();
  });

  test("leaves out roles it does not manage", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    db.add("user_roles", aRole("recorder", { id: "22222222-0000-4000-8000-000000000009", user_id: OTHER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    // `recorder` and `admin` are not grantable here, so showing them would
    // offer a revoke button for something this page cannot restore.
    await expect(page.getByText("omar@example.com")).toHaveCount(0);
  });

  test("narrows the list to one role", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    db.add("user_roles", aRole("content_reviewer", { id: "22222222-0000-4000-8000-000000000002", user_id: OTHER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: "Content reviewer" }).click();

    await expect(page.getByText("omar@example.com")).toBeVisible();
    await expect(page.getByText("layla@example.com")).toHaveCount(0);
  });

  test("dates each grant", async ({ page, db }) => {
    db.add(
      "user_roles",
      aRole("bible_reader", {
        id: READER_ROLE_ROW,
        user_id: READER,
        created_at: "2026-03-04T00:00:00.000Z",
      }),
    );

    await page.goto("/admin/bible-access");

    // Access granted long ago and forgotten is the thing an audit is looking
    // for, so the date has to be real rather than "Invalid Date".
    await expect(page.getByText("layla@example.com")).toBeVisible();
    await expect(page.getByText(/2026|3\/4\/2026|04\/03\/2026/).first()).toBeVisible();
  });

  test("says so when nobody holds a managed role", async ({ page }) => {
    await page.goto("/admin/bible-access");

    await expect(page.getByText("No matching role assignments.")).toBeVisible();
  });

  test("reports a failed load rather than an empty list", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));
    // The RPC, not the table: `admin_list_managed_roles` is security-definer
    // and reads `user_roles` server-side, so the client never issues that read
    // and failing the table would leave the listing working.
    db.failRpc("admin_list_managed_roles");

    await page.goto("/admin/bible-access");

    // "Nobody has access" and "we could not check" must not look the same on a
    // page whose whole job is knowing who has access.
    await expect(page.getByText("Failed to load role assignments")).toBeVisible();
  });
});

test.describe("granting a role", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);
    anAccount(backend, READER, "layla@example.com");
  });

  test("resolves an email and writes the role", async ({ page, db, backend }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("Bible reader granted")).toBeVisible();
    expect(backend.rpcCalls.filter((c) => c.name === "admin_find_user")).toHaveLength(1);
    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ user_id: READER, role: "bible_reader" });
  });

  test("takes a UUID as well as an email", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill(READER);
    await page.getByRole("button", { name: "Add" }).click();

    // An admin acting on a support ticket usually has the UUID and not the
    // address, so both have to resolve.
    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "bible_reader" });
  });

  test("grants whichever role was chosen", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Beta tester" }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "beta_tester" });
  });

  test("refuses an identifier that resolves to nobody", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("nobody@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // A typo must not become a role row against a user id that does not exist
    // — nothing in the schema would ever clean that up.
    await expect(page.getByText("User not found")).toBeVisible();
    expect(db.rows("user_roles").filter((r) => r.role === "bible_reader")).toHaveLength(0);
  });

  test("will not grant the same role twice", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // A duplicate row would show twice in the list and take two revokes to
    // undo — the second of which an admin would have no reason to look for.
    await expect(page.getByText("This role is already assigned to that user.")).toBeVisible();
    expect(db.rows("user_roles").filter((r) => r.role === "bible_reader")).toHaveLength(1);
  });

  test("adds a second, different role to the same person", async ({ page, db }) => {
    db.add("user_roles", aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Content reviewer" }).click();
    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // The duplicate check is per role, not per user. It has to be: this exact
    // combination — reader plus reviewer — is the one the Bible pages treat as
    // "no access", so an admin has to be able to create it.
    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.user_id === READER).length)
      .toBe(2);
  });

  test("clears the box after a successful grant", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Bible reader granted")).toBeVisible();

    // Left populated, the next Enter grants the same person again.
    await expect(page.getByPlaceholder("User email or UUID")).toHaveValue("");
  });

  test("grants on Enter as well as on the button", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByPlaceholder("User email or UUID").press("Enter");

    await expect
      .poll(() => db.rows("user_roles").find((r) => r.user_id === READER))
      .toMatchObject({ role: "bible_reader" });
  });

  test("will not submit an empty box", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  test("reports a write that failed", async ({ page, db, expectConsoleErrors }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("user_roles", 500);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByPlaceholder("User email or UUID").fill("layla@example.com");
    await page.getByRole("button", { name: "Add" }).click();

    // Silence here would leave an admin believing they had granted access that
    // does not exist, and the learner emailing again a week later.
    await expect(page.getByText("Failed to grant role")).toBeVisible();
  });
});

test.describe("revoking a role", () => {
  test.beforeEach(async ({ signInAs, backend, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [
      aRole("admin"),
      aRole("bible_reader", { id: READER_ROLE_ROW, user_id: READER }),
    ]);
    anAccount(backend, READER, "layla@example.com");
  });

  test("deletes the grant", async ({ page, db }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.locator("button.text-destructive").click();

    await expect(page.getByText("Role revoked")).toBeVisible();
    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.role === "bible_reader"))
      .toHaveLength(0);
  });

  test("removes only the row that was revoked", async ({ page, db }) => {
    db.add("user_roles", aRole("content_reviewer", { id: "22222222-0000-4000-8000-000000000002", user_id: READER }));

    await page.goto("/admin/bible-access");
    await expect(page.getByRole("cell", { name: "Bible reader" })).toBeVisible();

    // Deleting by role-row id rather than by user is what makes this possible;
    // deleting by user would take both roles away at once.
    await page.locator("button.text-destructive").first().click();
    await expect(page.getByText("Role revoked")).toBeVisible();

    await expect
      .poll(() => db.rows("user_roles").filter((r) => r.user_id === READER).map((r) => r.role))
      .toEqual(["content_reviewer"]);
  });

  test("keeps the row on screen when the delete fails", async ({
    page,
    db,
    expectConsoleErrors,
  }) => {
    expectConsoleErrors([/.*/]);
    db.failWrites("user_roles", 500);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    await page.locator("button.text-destructive").click();

    // The list is filtered optimistically on success only. Dropping the row on
    // failure would tell an admin that access they still hold is gone.
    await expect(page.getByText("Failed to revoke role")).toBeVisible();
    await expect(page.getByText("layla@example.com")).toBeVisible();
  });

  test("gives the revoke button no accessible name", async ({ page }) => {
    await page.goto("/admin/bible-access");
    await expect(page.getByText("layla@example.com")).toBeVisible();

    // Recorded against the app-wide icon-button baseline rather than worked
    // around silently. This one is worth naming: it is an irreversible action
    // on a page full of similar rows, announced to a screen reader as "button"
    // with no indication of whose access it removes.
    const revoke = page.locator("button.text-destructive");
    await expect(revoke).toHaveCount(1);
    expect(await revoke.getAttribute("aria-label")).toBeNull();
  });
});

test.describe("what the page cannot do", () => {
  test("offers no way to grant admin", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin")]);

    await page.goto("/admin/bible-access");
    await expect(page.getByText("No matching role assignments.")).toBeVisible();

    await page.getByRole("combobox").first().click();

    // The three managed roles are content-facing. Admin is not among them, so
    // the console cannot mint another console user — that stays a database
    // operation with a human behind it.
    await expect(page.getByRole("option", { name: "Bible reader" })).toBeVisible();
    await expect(page.getByRole("option", { name: /^Admin/ })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /^Recorder/ })).toHaveCount(0);
  });

  test("shows an existing admin nothing to revoke", async ({ page, signInAs, db }) => {
    await signInAs("admin");
    db.seed("user_roles", [aRole("admin"), aRole("admin", { id: "22222222-0000-4000-8000-00000000000a", user_id: TEST_USER_ID })]);

    await page.goto("/admin/bible-access");

    // The same filter from the other side: an admin row is not listed, so it
    // cannot be revoked from here either.
    await expect(page.getByText("No matching role assignments.")).toBeVisible();
  });
});
