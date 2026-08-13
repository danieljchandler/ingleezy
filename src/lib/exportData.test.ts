import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSupabaseFetch } from "@/test/support/transports/vitest";
import { aUserVocabulary, aWordReview, reviewId, vocabId, wordId } from "@/test/support/factories";
import {
  exportReviewHistoryAsJSON,
  exportVocabularyAsCSV,
  exportVocabularyAsJSON,
} from "./exportData";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Exporting a learner's own data.
 *
 * This is the only way anything leaves the app, and the only copy of their work
 * a learner can keep if they stop paying or the service goes away. Two things
 * therefore have to hold: the file has to contain every row, and the CSV has to
 * survive being opened in Excel — Arabic definitions routinely contain commas
 * and quotation marks, and an unescaped one silently shifts every column after
 * it on that line.
 */

const USER = "11111111-1111-4111-8111-111111111111";

let backend: SupabaseBackend;
let restore: () => void;
let downloads: Array<{ filename: string; text: string }>;

beforeEach(() => {
  const installed = installSupabaseFetch({ signedInAs: USER });
  backend = installed.backend;
  restore = installed.restore;

  downloads = [];

  // jsdom's Blob has no `.text()`, and by the time the anchor is clicked the
  // content is behind an object URL — so the text is captured where it is
  // still a string, at construction, and keyed by the URL minted for it.
  const contents = new Map<Blob, string>();
  const RealBlob = globalThis.Blob;
  class RecordingBlob extends RealBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
      super(parts, options);
      contents.set(this, parts.map((part) => String(part)).join(""));
    }
  }
  vi.stubGlobal("Blob", RecordingBlob);

  const byUrl = new Map<string, string>();
  let counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob) => {
    const url = `blob:fixture/${counter++}`;
    byUrl.set(url, contents.get(blob) ?? "");
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ filename: this.download, text: byUrl.get(this.href) ?? "" });
  });

  // Frozen so the date in each filename is assertable rather than whatever
  // day the suite happens to run on.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-03-11T09:00:00Z"));
});

afterEach(() => {
  restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The last file handed to the browser. */
function lastDownload() {
  return downloads.at(-1)!;
}

describe("exporting vocabulary as JSON", () => {
  it("writes every saved word", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, word_arabic: "باب", word_english: "door" }),
      aUserVocabulary({ id: vocabId(1), user_id: USER, word_arabic: "كتاب", word_english: "book" }),
    ]);

    await exportVocabularyAsJSON(USER);

    const file = lastDownload();
    const rows = JSON.parse(file.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.word_arabic)).toEqual(["باب", "كتاب"]);
  });

  it("includes the review schedule, not just the words", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        user_id: USER,
        ease_factor: 4,
        interval_days: 12,
        repetitions: 6,
        lapses: 1,
      }),
    ]);

    await exportVocabularyAsJSON(USER);

    // A list of words without their scheduling is a word list, not a backup —
    // re-importing it would reset years of review history to day one.
    const row = (JSON.parse((lastDownload()).text) as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ interval_days: 12, repetitions: 6, lapses: 1 });
  });

  it("exports nobody else's words", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, word_arabic: "مِلكي" }),
      aUserVocabulary({
        id: vocabId(1),
        user_id: "00000000-0000-4000-8000-000000000009",
        word_arabic: "لغيري",
      }),
    ]);

    await exportVocabularyAsJSON(USER);

    const rows = JSON.parse((lastDownload()).text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].word_arabic).toBe("مِلكي");
  });

  it("names the file with today's date", async () => {
    backend.db.seed("user_vocabulary", [aUserVocabulary({ id: vocabId(0), user_id: USER })]);

    await exportVocabularyAsJSON(USER);

    // Learners export more than once; identical filenames overwrite each other
    // in the downloads folder.
    expect((lastDownload()).filename).toBe("ingleezy-vocabulary-2026-03-11.json");
  });

  it("writes an empty file rather than failing when nothing is saved", async () => {
    backend.db.seed("user_vocabulary", []);

    await exportVocabularyAsJSON(USER);

    expect(JSON.parse((lastDownload()).text)).toEqual([]);
  });

  it("reports a failed read rather than downloading a broken file", async () => {
    backend.db.failAlways("user_vocabulary", 500);

    // Handing over a file containing "null" would look like a successful
    // export of an empty account.
    await expect(exportVocabularyAsJSON(USER)).rejects.toThrow(/failed to export vocabulary/i);
    expect(downloads).toHaveLength(0);
  });
});

describe("exporting vocabulary as CSV", () => {
  it("writes a header row and one line per word", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, word_arabic: "باب", word_english: "door" }),
      aUserVocabulary({ id: vocabId(1), user_id: USER, word_arabic: "كتاب", word_english: "book" }),
    ]);

    await exportVocabularyAsCSV(USER);

    const lines = (lastDownload()).text.split("\n");
    expect(lines[0]).toContain("word_arabic");
    expect(lines).toHaveLength(3);
  });

  it("quotes a value containing a comma", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({
        id: vocabId(0),
        user_id: USER,
        word_english: "door, gate",
      }),
    ]);

    await exportVocabularyAsCSV(USER);

    // Unquoted, this shifts every column after it by one on that row — and the
    // learner does not find out until they open the file months later.
    expect((lastDownload()).text).toContain('"door, gate"');
  });

  it("doubles a quotation mark inside a value", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, word_english: 'the "door"' }),
    ]);

    await exportVocabularyAsCSV(USER);

    expect((lastDownload()).text).toContain('"the ""door"""');
  });

  it("quotes a value containing a newline", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, word_english: "door\nentrance" }),
    ]);

    await exportVocabularyAsCSV(USER);

    // Without the quotes this becomes two malformed rows.
    expect((lastDownload()).text).toContain('"door\nentrance"');
  });

  it("leaves a null as an empty field rather than the word null", async () => {
    backend.db.seed("user_vocabulary", [
      aUserVocabulary({ id: vocabId(0), user_id: USER, last_reviewed_at: null }),
    ]);

    await exportVocabularyAsCSV(USER);

    // "null" in a date column is worse than blank: a spreadsheet reads it as
    // text and the whole column stops being a date.
    expect((lastDownload()).text).not.toContain("null");
  });

  it("says so rather than downloading an empty CSV", async () => {
    backend.db.seed("user_vocabulary", []);

    // A CSV with only a header is indistinguishable from a broken export, and
    // unlike JSON there is no shape to tell them apart.
    await expect(exportVocabularyAsCSV(USER)).rejects.toThrow(/no vocabulary data/i);
    expect(downloads).toHaveLength(0);
  });
});

describe("exporting review history", () => {
  it("writes the schedule for each card", async () => {
    backend.db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), user_id: USER, word_id: wordId(0), repetitions: 4 }),
    ]);

    await exportReviewHistoryAsJSON(USER);

    const rows = JSON.parse((lastDownload()).text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word_id: wordId(0), repetitions: 4 });
  });

  it("names the file distinctly from the vocabulary export", async () => {
    backend.db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), user_id: USER, word_id: wordId(0) }),
    ]);

    await exportReviewHistoryAsJSON(USER);

    // Both land in the same folder on the same day.
    expect((lastDownload()).filename).toBe("ingleezy-reviews-2026-03-11.json");
  });

  it("exports nobody else's history", async () => {
    backend.db.seed("word_reviews", [
      aWordReview({ id: reviewId(0), user_id: USER, word_id: wordId(0) }),
      aWordReview({
        id: reviewId(1),
        user_id: "00000000-0000-4000-8000-000000000009",
        word_id: wordId(1),
      }),
    ]);

    await exportReviewHistoryAsJSON(USER);

    expect(JSON.parse((lastDownload()).text)).toHaveLength(1);
  });

  it("reports a failed read", async () => {
    backend.db.failAlways("word_reviews", 500);

    await expect(exportReviewHistoryAsJSON(USER)).rejects.toThrow(/failed to export review/i);
    expect(downloads).toHaveLength(0);
  });
});
