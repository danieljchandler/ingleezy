import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBrandMigration } from "./brandMigration";

/**
 * The one-time rename of every localStorage key from `lahja*` to `ingleezy*`.
 *
 * This runs in `main.tsx` before React mounts, on every existing user's next
 * visit, exactly once. Getting it wrong is not recoverable from inside the app:
 * a key that is dropped takes the learner's review queue, dialect choice or
 * display preferences with it, and there is no second chance because the
 * migration flag is set regardless.
 *
 * So the properties worth pinning are the destructive ones — that nothing is
 * lost, that an existing new-format value is never clobbered by a stale old
 * one, and that a storage failure mid-run cannot leave the data half-moved and
 * the flag set.
 */

const FLAG = "ingleezy:migrated:v1";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("exact key renames", () => {
  it("moves each old key to its new name", () => {
    localStorage.setItem("lahja_dialect_module", "Egyptian");
    localStorage.setItem("lahja_bridge_view_enabled", "true");
    localStorage.setItem("lahja_freechat_v1", "[]");

    runBrandMigration();

    expect(localStorage.getItem("ingleezy_dialect_module")).toBe("Egyptian");
    expect(localStorage.getItem("ingleezy_bridge_view_enabled")).toBe("true");
    expect(localStorage.getItem("ingleezy_freechat_v1")).toBe("[]");
  });

  it("removes the old key once it has been copied", () => {
    localStorage.setItem("lahja_dialect_module", "Egyptian");

    runBrandMigration();

    // Leaving both would make the next writer's choice of key decide which one
    // the app reads.
    expect(localStorage.getItem("lahja_dialect_module")).toBeNull();
  });

  it("keeps a value already written under the new name", () => {
    // The app has already been used post-rename; the old key is a leftover.
    localStorage.setItem("lahja_dialect_module", "Gulf");
    localStorage.setItem("ingleezy_dialect_module", "Yemeni");

    runBrandMigration();

    expect(localStorage.getItem("ingleezy_dialect_module")).toBe("Yemeni");
    expect(localStorage.getItem("lahja_dialect_module")).toBeNull();
  });

  it("does nothing for a key that was never set", () => {
    runBrandMigration();

    expect(localStorage.getItem("ingleezy_dialect_module")).toBeNull();
  });

  it("preserves an empty string rather than treating it as absent", () => {
    localStorage.setItem("lahja_bridge_view_enabled", "");

    runBrandMigration();

    // `""` is falsy but is a real stored value; a truthiness check here would
    // silently drop it.
    expect(localStorage.getItem("ingleezy_bridge_view_enabled")).toBe("");
  });
});

describe("prefix renames", () => {
  it("renames every lahja: key to ingleezy:", () => {
    localStorage.setItem("lahja:review-queue:user-1", "[1,2,3]");
    localStorage.setItem("lahja:display-prefs", '{"tashkil":true}');
    localStorage.setItem("lahja:home-layout", "compact");

    runBrandMigration();

    expect(localStorage.getItem("ingleezy:review-queue:user-1")).toBe("[1,2,3]");
    expect(localStorage.getItem("ingleezy:display-prefs")).toBe('{"tashkil":true}');
    expect(localStorage.getItem("ingleezy:home-layout")).toBe("compact");
    expect(localStorage.getItem("lahja:review-queue:user-1")).toBeNull();
  });

  it("renames the whole per-user family, not just the first", () => {
    for (let i = 0; i < 20; i++) {
      localStorage.setItem(`lahja:review-queue:user-${i}`, String(i));
    }

    // Snapshotting the key list first is what makes this work — removing keys
    // while walking `localStorage.key(i)` reindexes the store and skips half of
    // them.
    runBrandMigration();

    for (let i = 0; i < 20; i++) {
      expect(localStorage.getItem(`ingleezy:review-queue:user-${i}`)).toBe(String(i));
      expect(localStorage.getItem(`lahja:review-queue:user-${i}`)).toBeNull();
    }
  });

  it("keeps a value already under the new prefix", () => {
    localStorage.setItem("lahja:display-prefs", "old");
    localStorage.setItem("ingleezy:display-prefs", "new");

    runBrandMigration();

    expect(localStorage.getItem("ingleezy:display-prefs")).toBe("new");
    expect(localStorage.getItem("lahja:display-prefs")).toBeNull();
  });

  it("leaves keys belonging to anything else alone", () => {
    localStorage.setItem("sb-auth-token", "session");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("mylahja:thing", "not ours");

    runBrandMigration();

    expect(localStorage.getItem("sb-auth-token")).toBe("session");
    expect(localStorage.getItem("theme")).toBe("dark");
    // The prefix has to match at position zero — a substring match would
    // rename third-party keys.
    expect(localStorage.getItem("mylahja:thing")).toBe("not ours");
  });
});

describe("running more than once", () => {
  it("marks itself done", () => {
    runBrandMigration();

    expect(localStorage.getItem(FLAG)).toBe("1");
  });

  it("does not undo a later rename on a second run", () => {
    localStorage.setItem("lahja_dialect_module", "Egyptian");
    runBrandMigration();

    // The learner switches dialect after the migration.
    localStorage.setItem("ingleezy_dialect_module", "Yemeni");
    // And an old key reappears somehow — a restored backup, a second tab.
    localStorage.setItem("lahja_dialect_module", "Gulf");
    runBrandMigration();

    // The flag short-circuits, so the stale value cannot overwrite the live
    // one. It also means the stale key is left behind, which is the price.
    expect(localStorage.getItem("ingleezy_dialect_module")).toBe("Yemeni");
    expect(localStorage.getItem("lahja_dialect_module")).toBe("Gulf");
  });
});

describe("when storage misbehaves", () => {
  it("does nothing at all when localStorage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });

    // Safari in private mode, and any browser with cookies blocked. Throwing
    // here would take down the whole app before React mounts.
    expect(() => runBrandMigration()).not.toThrow();
  });

  it("still migrates the rest when one key fails", () => {
    localStorage.setItem("lahja_dialect_module", "Egyptian");
    localStorage.setItem("lahja_freechat_v1", "[]");

    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "ingleezy_dialect_module") throw new Error("QuotaExceededError");
      return realSet.call(this, key, value);
    });

    runBrandMigration();

    // Each key is moved inside its own try, so one quota failure does not
    // abandon the ones after it.
    expect(localStorage.getItem("ingleezy_freechat_v1")).toBe("[]");
  });

  it("marks itself done even when a key could not be moved", () => {
    localStorage.setItem("lahja_dialect_module", "Egyptian");

    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "ingleezy_dialect_module") throw new Error("QuotaExceededError");
      return realSet.call(this, key, value);
    });

    runBrandMigration();
    vi.restoreAllMocks();

    // The copy and the delete share one try block, so a `setItem` that throws
    // skips the `removeItem` after it — nothing is destroyed. That ordering is
    // the whole safety property of this file.
    expect(localStorage.getItem("lahja_dialect_module")).toBe("Egyptian");

    // Pinned, not fixed: the flag is still set. The value survives under the
    // old name but the migration will never look at it again, so the app reads
    // the new key, finds nothing, and falls back to its default — a silent
    // reset to Gulf with the real choice stranded one key away.
    expect(localStorage.getItem(FLAG)).toBe("1");
    expect(localStorage.getItem("ingleezy_dialect_module")).toBeNull();
  });
});
