import { describe, expect, it } from "vitest";
import { defaultsFor } from "./columnDefaults";

/**
 * The defaults parser reads real migrations, so these assert against the
 * schema as it actually is. That is the point: a migration that changes a
 * default should change what the test backend fills in, and if the parser
 * stops finding a column the specs that rely on it would start seeing
 * `undefined` again — silently, since a missing key renders as nothing.
 */

describe("literal defaults", () => {
  it("reads a numeric default from a CREATE TABLE body", () => {
    // `uses INTEGER NOT NULL DEFAULT 0` — the one that started this: the admin
    // console renders `{uses}/{max_uses} used` straight after an insert that
    // omits `uses`.
    expect(defaultsFor("invite_codes").get("uses")).toBe(0);
    expect(defaultsFor("invite_codes").get("max_uses")).toBe(1);
  });

  it("reads a boolean default", () => {
    expect(defaultsFor("profiles").get("show_on_leaderboard")).toBe(true);
  });

  it("reads a quoted string default", () => {
    expect(defaultsFor("listen_episodes").get("audio_mode")).toBe("on_demand");
  });

  it("strips a type cast from the literal", () => {
    // Defaults are frequently written `'pending'::text`; the cast is not part
    // of the value.
    for (const [, value] of defaultsFor("listen_episodes")) {
      expect(String(value)).not.toContain("::");
    }
  });
});

describe("what it declines to guess", () => {
  it("leaves function-call defaults alone", () => {
    // `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and
    // `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` are both filled in
    // separately by `withDefaults`, which can actually produce a value.
    // Recording them here as literals would write the string "gen_random_uuid()"
    // into every row.
    expect(defaultsFor("invite_codes").has("id")).toBe(false);
    expect(defaultsFor("invite_codes").has("created_at")).toBe(false);
  });

  it("has nothing to say about a column with no default", () => {
    expect(defaultsFor("invite_codes").has("code")).toBe(false);
  });

  it("returns an empty map for a table it has never heard of", () => {
    expect(defaultsFor("not_a_table").size).toBe(0);
  });
});

describe("coverage across the schema", () => {
  it("finds defaults on a good spread of tables", () => {
    // A smoke test on the parser rather than on any one table: if a regex
    // stopped matching, this collapses towards zero long before an individual
    // spec notices a hole in a row.
    const tables = [
      "invite_codes",
      "profiles",
      "listen_episodes",
      "user_letter_progress",
      "beta_feedback",
    ];
    const found = tables.filter((table) => defaultsFor(table).size > 0);
    expect(found).toEqual(tables);
  });

  it("never records a constraint clause as a column", () => {
    // `PRIMARY KEY (a, b)` and `CHECK (x > 0)` sit in the same comma-separated
    // list as the columns, and `CHECK (status = 'new')` even contains a quoted
    // literal — so a naive split would invent columns named PRIMARY and CHECK.
    for (const table of ["invite_codes", "profiles", "beta_feedback"]) {
      for (const column of defaultsFor(table).keys()) {
        expect(column).toMatch(/^[a-z_][a-z0-9_]*$/);
        expect(["primary", "check", "unique", "constraint", "foreign"]).not.toContain(
          column.toLowerCase(),
        );
      }
    }
  });
});
