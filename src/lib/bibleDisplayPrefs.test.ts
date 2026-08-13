import { describe, expect, it } from "vitest";
import * as bible from "./bibleDisplayPrefs";
import * as display from "./displayPrefs";

/**
 * The deprecated Bible-flavoured aliases for the display preferences.
 *
 * These exist so the older imports keep working while the codebase migrates to
 * `@/lib/displayPrefs`. A re-export shim looks too trivial to test right up
 * until someone edits the real module and the alias quietly stops pointing at
 * the same thing — at which point the Bible reader and the rest of the app
 * write the same preference to two different places, and toggling tashkeel in
 * settings stops affecting the passage on screen.
 *
 * So the test is identity, not behaviour: every alias must be the very same
 * function object, and nothing may be re-implemented here.
 */

describe("the aliases", () => {
  it("points each name at the module it forwards to", () => {
    // Identity rather than equivalence — a copy would drift on the next edit
    // to displayPrefs and nothing would notice.
    expect(bible.loadBibleDisplayPrefs).toBe(display.loadDisplayPrefs);
    expect(bible.saveBibleDisplayPrefs).toBe(display.saveDisplayPrefs);
    expect(bible.subscribeBibleDisplayPrefs).toBe(display.subscribeDisplayPrefs);
    expect(bible.DEFAULT_BIBLE_DISPLAY_PREFS).toBe(display.DEFAULT_DISPLAY_PREFS);
  });

  it("re-exports stripTashkil under its own name", () => {
    // The one export that was never renamed, so a careless edit could shadow
    // it with a local copy without the name changing.
    expect(bible.stripTashkil).toBe(display.stripTashkil);
  });

  it("adds nothing of its own", () => {
    const expected = [
      "DEFAULT_BIBLE_DISPLAY_PREFS",
      "loadBibleDisplayPrefs",
      "saveBibleDisplayPrefs",
      "subscribeBibleDisplayPrefs",
      "stripTashkil",
    ].sort();

    // A shim that grows its own logic is no longer a shim, and the migration
    // that is meant to end in deleting this file can never finish.
    expect(Object.keys(bible).sort()).toEqual(expected);
  });
});

describe("reading and writing through the alias", () => {
  it("shares one storage key with the canonical module", () => {
    bible.saveBibleDisplayPrefs({ ...display.DEFAULT_DISPLAY_PREFS, showTashkil: false });

    // The whole risk this file carries: two keys means the Bible reader and
    // the settings page disagree about what the learner chose.
    expect(display.loadDisplayPrefs().showTashkil).toBe(false);

    display.saveDisplayPrefs({ ...display.DEFAULT_DISPLAY_PREFS, showTashkil: true });
    expect(bible.loadBibleDisplayPrefs().showTashkil).toBe(true);
  });

  it("notifies a subscriber registered through the alias", () => {
    let seen = 0;
    const unsubscribe = bible.subscribeBibleDisplayPrefs(() => {
      seen += 1;
    });

    display.saveDisplayPrefs({ ...display.DEFAULT_DISPLAY_PREFS, showTashkil: false });

    expect(seen).toBe(1);
    unsubscribe();
  });
});
