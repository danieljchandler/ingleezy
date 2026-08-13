/**
 * @deprecated Use `@/lib/displayPrefs` directly. These re-exports exist so
 * older imports keep working while we migrate the codebase.
 */
export {
  DEFAULT_DISPLAY_PREFS as DEFAULT_BIBLE_DISPLAY_PREFS,
  loadDisplayPrefs as loadBibleDisplayPrefs,
  saveDisplayPrefs as saveBibleDisplayPrefs,
  subscribeDisplayPrefs as subscribeBibleDisplayPrefs,
  stripTashkil,
} from "./displayPrefs";
export type { DisplayPrefs as BibleDisplayPrefs } from "./displayPrefs";
