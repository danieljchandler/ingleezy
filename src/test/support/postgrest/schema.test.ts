import { describe, expect, it } from "vitest";
import { findRelationship, getTable, loadSchema } from "./schema";

/**
 * The schema registry is parsed out of the generated Supabase types, so these
 * assertions double as a canary: if the generator's output format changes, the
 * emulator would silently start believing the database has no tables, and every
 * query would 404 for the wrong reason. Better to fail here, loudly.
 */
describe("schema registry", () => {
  const schema = loadSchema();

  it("finds the app's tables", () => {
    // A floor, not an exact count — tables get added.
    expect(schema.tables.size).toBeGreaterThan(50);
  });

  it("reads every column of a representative table", () => {
    const table = getTable("user_set_phrases");
    expect(table).toBeDefined();
    expect([...(table?.columns ?? [])].sort()).toEqual([
      "created_at",
      "difficulty",
      "ease_factor",
      "id",
      "interval_days",
      "last_quality",
      "last_reviewed_at",
      "next_review_at",
      "phrase_id",
      "repetitions",
      "source",
      "updated_at",
      "user_id",
    ]);
  });

  it("distinguishes columns that are required on insert from defaulted ones", () => {
    const table = getTable("user_set_phrases");
    // phrase_id and user_id have no default; the rest do.
    expect([...(table?.requiredOnInsert ?? [])].sort()).toEqual(["phrase_id", "user_id"]);
  });

  it("does not mistake the nested Row/Insert keys for tables", () => {
    expect(schema.tables.has("Row")).toBe(false);
    expect(schema.tables.has("Insert")).toBe(false);
    expect(schema.tables.has("Relationships")).toBe(false);
  });

  it("picks up views alongside tables", () => {
    expect(schema.tables.has("leaderboard_profiles")).toBe(true);
  });

  describe("relationships", () => {
    it("resolves an embed where the child holds the foreign key", () => {
      // user_set_phrases.phrase_id -> set_phrases.id
      const found = findRelationship("user_set_phrases", "set_phrases");
      expect(found?.direction).toBe("parent-holds-fk");
      expect(found?.relationship.columns).toEqual(["phrase_id"]);
      expect(found?.relationship.referencedColumns).toEqual(["id"]);
    });

    it("resolves an embed in the reverse direction", () => {
      // The app selects set_phrases with set_phrase_occasions(name) embedded,
      // and the FK lives on the occasions side.
      const found = findRelationship("set_phrases", "set_phrase_occasions");
      expect(found).toBeDefined();
    });

    it("resolves the embeds the review queue depends on", () => {
      expect(findRelationship("vocabulary_words", "lessons")).toBeDefined();
      expect(findRelationship("vocabulary_words", "topics")).toBeDefined();
    });

    it("returns nothing for two unrelated tables", () => {
      expect(findRelationship("profiles", "listen_episodes")).toBeUndefined();
    });
  });
});
