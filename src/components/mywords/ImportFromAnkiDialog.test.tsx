import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile, aUserVocabulary, TEST_USER_ID, vocabId } from "@/test/support/factories";
import { ImportFromAnkiDialog } from "./ImportFromAnkiDialog";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Bringing an existing Anki deck into the app.
 *
 * This is the single highest-stakes import in the product. Someone arriving
 * with two years of Anki has thousands of cards and, more importantly, the
 * *schedule* attached to them — intervals, ease, lapses. Dropping that and
 * starting everyone at zero would mean two years of reviews done again, which
 * is not a migration anybody would accept. So the schedule is mapped rather
 * than reset, and the media is carried across so the cards still look like
 * their cards.
 *
 * The deduplication is the other half: importing on top of words already saved
 * here has to skip them, or the learner ends up reviewing the same word twice a
 * day forever with no way to tell the copies apart.
 *
 * The parsers are mocked. `.apkg` is a zip containing a SQLite database, read
 * through sql.js — the parsing itself is covered by src/lib/ankiImport's own
 * tests, and what is worth testing here is the dialog's own state machine.
 */

const parseApkg = vi.fn();
const parseAnkiText = vi.fn();
const uploadAnkiMediaBatch = vi.fn(async () => new Map<string, { url: string }>());

vi.mock("@/lib/ankiImport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ankiImport")>("@/lib/ankiImport");
  return {
    ...actual,
    parseApkg: (file: File) => parseApkg(file),
    parseAnkiText: (file: File) => parseAnkiText(file),
    uploadAnkiMediaBatch: (...args: unknown[]) => uploadAnkiMediaBatch(...(args as [])),
  };
});

const aCard = (over: Record<string, unknown> = {}) => ({
  wordArabic: "سوق",
  wordEnglish: "market",
  phonetic: "sooq",
  sentenceArabic: "رحت السوق",
  sentenceEnglish: "I went to the market",
  imageRefs: [],
  audioRefs: [],
  tags: ["nouns"],
  deckName: "Gulf Arabic",
  ankiNoteId: 1,
  ankiCardId: 1,
  // The scheduling fields the mapper reads, in Anki's own units: ease is
  // per-mille (2500 = 2.5) and the interval is in days.
  ankiType: 2,
  ankiReps: 12,
  ankiLapses: 1,
  ankiIvl: 30,
  ankiFactor: 2500,
  ...over,
});

const aDeck = (cards: Array<Record<string, unknown>>, media = new Map<string, Uint8Array>()) => ({
  cards,
  media,
  deckNames: ["Gulf Arabic"],
  noteTypes: [],
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  parseApkg.mockReset();
  parseAnkiText.mockReset();
  uploadAnkiMediaBatch.mockReset();
  uploadAnkiMediaBatch.mockResolvedValue(new Map());
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  localStorage.setItem("ingleezy_dialect_module", "Gulf");
  const harness = renderWithProviders(
    <ImportFromAnkiDialog open onOpenChange={() => {}} />,
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [
          aProfile({ user_id: TEST_USER_ID, preferred_dialect: "Gulf" }),
        ]);
        seed(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

const choose = async (name: string, size = 1024) => {
  const file = new File([new Uint8Array(Math.min(size, 4096))], name);
  Object.defineProperty(file, "size", { value: size });
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
  return file;
};

/** Get as far as the preview with one deck loaded. */
async function toPreview(deck = aDeck([aCard()]), seed?: (backend: SupabaseBackend) => void) {
  parseApkg.mockResolvedValue(deck);
  const harness = render(seed ?? (() => {}));
  await choose("collection.apkg");
  await waitFor(() => expect(screen.getByRole("button", { name: /import/i })).toBeInTheDocument());
  return harness;
}

describe("choosing a file", () => {
  it("reads an Anki package", async () => {
    parseApkg.mockResolvedValue(aDeck([aCard()]));
    render();

    await choose("collection.apkg");

    expect(parseApkg).toHaveBeenCalled();
    expect(parseAnkiText).not.toHaveBeenCalled();
  });

  it("reads a text export the same way", async () => {
    parseAnkiText.mockResolvedValue(aDeck([aCard()]));
    render();

    await choose("cards.txt");

    // Plenty of people export to TSV rather than package their collection, and
    // turning them away would be turning away the deck.
    expect(parseAnkiText).toHaveBeenCalled();
    expect(parseApkg).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a deck", async () => {
    render();

    await choose("holiday.jpg");

    // Parsing a photo would fail somewhere deep in a zip reader with a message
    // nobody could act on.
    expect(parseApkg).not.toHaveBeenCalled();
    expect(parseAnkiText).not.toHaveBeenCalled();
  });

  it("refuses a file too large to read in the browser", async () => {
    render();

    await choose("huge.apkg", 3 * 1024 * 1024 * 1024);

    // The whole file is read into memory to unzip it; a collection with years
    // of audio would take the tab down rather than import.
    expect(parseApkg).not.toHaveBeenCalled();
  });

  it("says so when the deck has nothing importable in it", async () => {
    parseApkg.mockResolvedValue(aDeck([]));
    render();

    await choose("collection.apkg");

    // An empty result is usually the wrong note type rather than an empty
    // collection, and silently showing a preview of nothing explains neither.
    await waitFor(() => expect(screen.queryByRole("button", { name: /^import/i })).toBeNull());
  });

  it("stays on the upload step when the file cannot be read", async () => {
    parseApkg.mockRejectedValue(new Error("Not a valid Anki package"));
    render();

    await choose("collection.apkg");

    await waitFor(() => expect(fileInput()).toBeInTheDocument());
  });
});

describe("previewing the deck", () => {
  it("shows what was found before anything is written", async () => {
    await toPreview(aDeck([aCard(), aCard({ wordArabic: "مطعم", wordEnglish: "restaurant" })]));

    // Importing thousands of cards is not undoable in one gesture, so the
    // learner sees the shape of it first.
    expect(screen.getByText("سوق")).toBeInTheDocument();
    expect(screen.getByText("مطعم")).toBeInTheDocument();
  });

  it("names the deck the cards came from", async () => {
    await toPreview();

    expect(screen.getAllByText(/Gulf Arabic/).length).toBeGreaterThan(0);
  });

  it("writes nothing until the learner says so", async () => {
    const { backend } = await toPreview();

    expect(backend.db.writesTo("user_vocabulary")).toEqual([]);
  });
});

describe("importing", () => {
  it("keeps the schedule the cards already had", async () => {
    const harness = await toPreview(aDeck([aCard({ ankiReps: 12, ankiIvl: 30, ankiLapses: 1 })]));

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() =>
      expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1),
    );
    const row = harness.backend.db.rows("user_vocabulary")[0];
    // The entire argument for importing rather than starting over: two years of
    // reviews are carried across rather than done again.
    expect(row.repetitions).toBe(12);
    expect(row.interval_days).toBe(30);
    expect(row.lapses).toBe(1);
    expect(typeof row.next_review_at).toBe("string");
  });

  it("keeps the tags and the deck name", async () => {
    const harness = await toPreview();

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1));
    // How a learner navigates their own deck. Flattening it into one
    // undifferentiated list is what makes an imported collection unusable.
    expect(harness.backend.db.rows("user_vocabulary")[0]).toMatchObject({
      tags: ["nouns"],
      deck_name: "Gulf Arabic",
      source: "anki_import",
    });
  });

  it("keeps the sentence and the phonetic reading", async () => {
    const harness = await toPreview();

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1));
    expect(harness.backend.db.rows("user_vocabulary")[0]).toMatchObject({
      phonetic: "sooq",
      sentence_text: "رحت السوق",
      sentence_english: "I went to the market",
    });
  });

  it("files the cards under the dialect being studied", async () => {
    const harness = await toPreview();

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1));
    expect(harness.backend.db.rows("user_vocabulary")[0].dialect).toBe("Gulf");
  });

  it("records the import as a batch", async () => {
    const harness = await toPreview();

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(harness.backend.db.rows("anki_import_batches")).toHaveLength(1));
    // Every card points back at its batch, which is what makes a bad import
    // reversible as a group rather than card by card.
    const [batch] = harness.backend.db.rows("anki_import_batches");
    expect(batch).toMatchObject({ source_filename: "collection.apkg", total_cards: 1 });
    expect(harness.backend.db.rows("user_vocabulary")[0].import_batch_id).toBe(batch.id);
  });

  it("skips a word the learner already has", async () => {
    const harness = await toPreview(
      aDeck([aCard({ wordArabic: "سوق" }), aCard({ wordArabic: "مطعم", ankiNoteId: 2 })]),
      (backend) =>
        backend.db.seed("user_vocabulary", [
          aUserVocabulary({ id: vocabId(0), user_id: TEST_USER_ID, word_arabic: "سوق" }),
        ]),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    // Two copies of one word means reviewing it twice a day forever, with
    // nothing on either card to say which is which.
    await waitFor(() => expect(screen.getByText(/duplicates skipped/i)).toBeInTheDocument());
    expect(
      harness.backend.db.rows("user_vocabulary").filter((row) => row.word_arabic === "سوق"),
    ).toHaveLength(1);
  });

  it("skips a card with no Arabic on it", async () => {
    const harness = await toPreview(
      aDeck([aCard(), aCard({ wordArabic: "   ", ankiNoteId: 2 })]),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    // A note type whose field order differs produces rows with an empty front;
    // importing them fills the deck with blank cards.
    await waitFor(() => expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1));
  });

  it("does not import the same word twice from one deck", async () => {
    const harness = await toPreview(
      aDeck([aCard(), aCard({ ankiNoteId: 2, ankiCardId: 2 })]),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    // Anki decks routinely hold several cards per note — a recognition card and
    // a production one — and they share a front.
    await waitFor(() => expect(screen.getByText(/duplicates skipped/i)).toBeInTheDocument());
    expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1);
  });

  it("reports what it did", async () => {
    await toPreview();

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(screen.getByText("Import complete")).toBeInTheDocument());
    expect(screen.getByText("1 new cards added")).toBeInTheDocument();
  });

  it("goes back to the preview when the write fails", async () => {
    const harness = await toPreview(aDeck([aCard()]), (backend) =>
      backend.db.failInserts("user_vocabulary", 403, { message: "denied" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    // Back where they can try again, rather than stranded on a progress bar
    // that will never finish.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^import/i })).toBeInTheDocument(),
    );
    expect(harness.backend.db.rows("user_vocabulary")).toEqual([]);
  });
});

describe("carrying the media across", () => {
  it("uploads only the files the cards actually reference", async () => {
    const media = new Map<string, Uint8Array>([
      ["souq.jpg", new Uint8Array([1])],
      ["unused.jpg", new Uint8Array([2])],
    ]);
    uploadAnkiMediaBatch.mockResolvedValue(
      new Map([["souq.jpg", { url: "https://cdn.test/souq.jpg" }]]),
    );
    const harness = await toPreview(
      aDeck([aCard({ imageRefs: ["souq.jpg"] })], media),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(uploadAnkiMediaBatch).toHaveBeenCalled());
    // An Anki collection carries every file ever attached, including from notes
    // long since deleted; uploading all of it is someone's whole storage quota.
    const uploaded = (uploadAnkiMediaBatch.mock.calls[0] as unknown[])[1] as Array<{
      filename: string;
    }>;
    expect(uploaded.map((file) => file.filename)).toEqual(["souq.jpg"]);
    await waitFor(() =>
      expect(harness.backend.db.rows("user_vocabulary")[0].image_url).toBe(
        "https://cdn.test/souq.jpg",
      ),
    );
  });

  it("imports the card even when its media did not upload", async () => {
    uploadAnkiMediaBatch.mockResolvedValue(new Map());
    const harness = await toPreview(
      aDeck([aCard({ imageRefs: ["souq.jpg"] })], new Map([["souq.jpg", new Uint8Array([1])]])),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    // The word is the card; the picture is decoration on it.
    await waitFor(() => expect(harness.backend.db.rows("user_vocabulary")).toHaveLength(1));
    expect(harness.backend.db.rows("user_vocabulary")[0].image_url).toBeNull();
  });
});
