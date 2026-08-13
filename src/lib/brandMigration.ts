/**
 * One-time migration of localStorage keys from the old `lahja*` brand
 * to `hakiya*`. Runs at app boot and is a no-op after the first run.
 *
 * Keep this file dependency-free so it can be imported from main.tsx
 * before the React tree mounts.
 */
const MIGRATED_FLAG = "hakiya:migrated:v1";

// Exact key renames (no prefix, just whole keys).
const EXACT_KEYS: Array<[string, string]> = [
  ["lahja_dialect_module", "hakiya_dialect_module"],
  ["lahja_bridge_view_enabled", "hakiya_bridge_view_enabled"],
  ["lahja_bible_session", "hakiya_bible_session"],
  ["lahja_freechat_v1", "hakiya_freechat_v1"],
];

// Every key starting with `lahja:` becomes `hakiya:` (matches review-queue
// per-user keys, display-prefs, home-layout, continue, image style, etc.).
const PREFIX_FROM = "lahja:";
const PREFIX_TO = "hakiya:";

export function runBrandMigration() {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    if (ls.getItem(MIGRATED_FLAG) === "1") return;

    // 1. Exact renames
    for (const [from, to] of EXACT_KEYS) {
      try {
        const v = ls.getItem(from);
        if (v != null && ls.getItem(to) == null) ls.setItem(to, v);
        if (v != null) ls.removeItem(from);
      } catch {
        /* ignore individual key errors */
      }
    }

    // 2. Prefix renames — snapshot keys first (mutating during iteration is unsafe)
    const toRename: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX_FROM)) toRename.push(k);
    }
    for (const oldKey of toRename) {
      try {
        const newKey = PREFIX_TO + oldKey.slice(PREFIX_FROM.length);
        const v = ls.getItem(oldKey);
        if (v != null && ls.getItem(newKey) == null) ls.setItem(newKey, v);
        ls.removeItem(oldKey);
      } catch {
        /* ignore */
      }
    }

    ls.setItem(MIGRATED_FLAG, "1");
  } catch {
    /* storage unavailable — silently skip */
  }
}
