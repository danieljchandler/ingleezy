import { beforeAll, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import initSqlJs from "sql.js";
import { ANKI_FILE_SIZE_LIMIT, ANKI_IMPORT_LIMIT } from "./types";

/**
 * Reading a real Anki package.
 *
 * An `.apkg` is a zip containing a SQLite collection, a `media` manifest
 * mapping numbered files back to their original names, and those numbered
 * files. Nothing about it is self-describing: fields are stored as a single
 * 0x1f-separated string, the field *names* live in a JSON blob on the `col`
 * table, and which field is the Arabic one has to be inferred from those names
 * and from the text itself.
 *
 * That inference is what these tests are for. A deck imported with front and
 * back swapped produces thousands of cards that are wrong in a way no error
 * surfaces — the learner finds out during a review session, after the scheduler
 * has already committed.
 *
 * The tests build genuine packages: real SQLite via sql.js, real zips via
 * fflate. Only the module's wasm *locator* is replaced, because the source
 * imports it with Vite's `?url` suffix, which resolves to a browser URL that
 * Node cannot fetch.
 */

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

// Hand the module under test an already-initialised sql.js rather than letting
// it locate a wasm file by URL. The engine is real; only the loader changes.
vi.mock("sql.js", async () => {
  const actual = (await vi.importActual<typeof import("sql.js")>("sql.js")).default;
  const ready = actual();
  return { default: async () => await ready };
});

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: "unused-in-node" }));

interface NoteSpec {
  id: number;
  mid: number;
  /** Field values, joined with the 0x1f separator Anki uses. */
  fields: string[];
  tags?: string;
}

interface CardSpec {
  id: number;
  nid: number;
  did?: number;
  type?: number;
  queue?: number;
  due?: number;
  ivl?: number;
  factor?: number;
  reps?: number;
  lapses?: number;
}

interface ModelSpec {
  id: number;
  name: string;
  fieldNames: string[];
}

/** Build a collection database with the tables parseApkg reads. */
function collectionBytes(options: {
  models?: ModelSpec[];
  decks?: Record<number, string>;
  notes?: NoteSpec[];
  cards?: CardSpec[];
}): Uint8Array {
  const {
    models = [{ id: 1, name: "Basic", fieldNames: ["Front", "Back"] }],
    decks = { 1: "Default" },
    notes = [],
    cards = [],
  } = options;

  const db = new SQL.Database();
  db.run("CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT, decks TEXT)");
  db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT)");
  db.run(
    "CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, type INTEGER, " +
      "queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER)",
  );

  const modelsJson = Object.fromEntries(
    models.map((m) => [
      String(m.id),
      { id: m.id, name: m.name, flds: m.fieldNames.map((name, ord) => ({ name, ord })) },
    ]),
  );
  const decksJson = Object.fromEntries(
    Object.entries(decks).map(([id, name]) => [id, { id: Number(id), name }]),
  );
  db.run("INSERT INTO col (id, models, decks) VALUES (1, ?, ?)", [
    JSON.stringify(modelsJson),
    JSON.stringify(decksJson),
  ]);

  for (const note of notes) {
    db.run("INSERT INTO notes (id, mid, flds, tags) VALUES (?, ?, ?, ?)", [
      note.id,
      note.mid,
      note.fields.join(""),
      note.tags ?? "",
    ]);
  }
  for (const card of cards) {
    db.run(
      "INSERT INTO cards (id, nid, did, type, queue, due, ivl, factor, reps, lapses) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        card.id,
        card.nid,
        card.did ?? 1,
        card.type ?? 0,
        card.queue ?? 0,
        card.due ?? 0,
        card.ivl ?? 0,
        card.factor ?? 0,
        card.reps ?? 0,
        card.lapses ?? 0,
      ],
    );
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

/** Zip a collection (and optional media) into an .apkg-shaped File. */
function apkgOf(
  entries: Record<string, Uint8Array>,
  { name = "deck.apkg", size }: { name?: string; size?: number } = {},
): File {
  const zipped = zipSync(entries);
  return {
    name,
    size: size ?? zipped.length,
    arrayBuffer: async () =>
      zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength),
  } as unknown as File;
}

const aDeck = (options: Parameters<typeof collectionBytes>[0], filename = "collection.anki2") =>
  apkgOf({ [filename]: collectionBytes(options) });

/** One Basic note with Arabic on the front. */
const ONE_NOTE: Parameters<typeof collectionBytes>[0] = {
  notes: [{ id: 100, mid: 1, fields: ["باب", "door"], tags: "nouns household" }],
  cards: [{ id: 200, nid: 100, type: 2, ivl: 30, reps: 12, factor: 2500, lapses: 1 }],
};

beforeAll(async () => {
  SQL = await initSqlJs();
});

describe("opening the package", () => {
  it("reads a collection.anki2", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck(ONE_NOTE));

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].wordArabic).toBe("باب");
  });

  it("reads a collection.anki21 as well", async () => {
    const { parseApkg } = await import("./parseApkg");

    // Newer exports name the database differently; only supporting one name
    // rejects most modern decks.
    const deck = await parseApkg(aDeck(ONE_NOTE, "collection.anki21"));

    expect(deck.cards).toHaveLength(1);
  });

  it("says so when there is no collection inside", async () => {
    const { parseApkg } = await import("./parseApkg");

    await expect(parseApkg(apkgOf({ "readme.txt": strToU8("not a deck") }))).rejects.toThrow(
      /Could not find a collection database/,
    );
  });

  it("refuses a file over the size limit before unzipping it", async () => {
    const { parseApkg } = await import("./parseApkg");
    const oversized = apkgOf({ "collection.anki2": collectionBytes(ONE_NOTE) }, {
      size: ANKI_FILE_SIZE_LIMIT + 1,
    });

    // Unzipping first would allocate the whole decompressed deck in memory
    // before finding out it was too big.
    await expect(parseApkg(oversized)).rejects.toThrow(/Limit is/);
  });
});

describe("mapping the fields", () => {
  it("uses the model's field names when they say which is which", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        models: [{ id: 1, name: "Arabic", fieldNames: ["English", "Arabic"] }],
        notes: [{ id: 100, mid: 1, fields: ["door", "باب"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    // English first is a common layout; positional assumptions swap it.
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("falls back to detecting the Arabic when the names say nothing", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        models: [{ id: 1, name: "Custom", fieldNames: ["Field A", "Field B"] }],
        notes: [{ id: 100, mid: 1, fields: ["door", "باب"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("picks up a named sentence field", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        models: [{ id: 1, name: "Arabic", fieldNames: ["Word", "Meaning", "Example Sentence"] }],
        notes: [{ id: 100, mid: 1, fields: ["باب", "door", "فتحت الباب ودخلت"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    expect(deck.cards[0]).toMatchObject({
      wordArabic: "باب",
      sentenceArabic: "فتحت الباب ودخلت",
    });
  });

  it("picks up a named pronunciation field", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        models: [{ id: 1, name: "Arabic", fieldNames: ["Word", "Meaning", "Transliteration"] }],
        notes: [{ id: 100, mid: 1, fields: ["باب", "door", "baab"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    expect(deck.cards[0].phonetic).toBe("baab");
  });

  it("strips the HTML Anki stores fields in", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        notes: [{ id: 100, mid: 1, fields: ["<b>باب</b><br>", "<div>door</div>"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    // Almost every real deck has styling in its fields; markup in a headword
    // breaks dedupe and transcript matching alike.
    expect(deck.cards[0]).toMatchObject({ wordArabic: "باب", wordEnglish: "door" });
  });

  it("collects the media a note references", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        notes: [
          {
            id: 100,
            mid: 1,
            fields: ['باب <img src="door.jpg">', "door [sound:door.mp3]"],
          },
        ],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    expect(deck.cards[0].imageRefs).toEqual(["door.jpg"]);
    expect(deck.cards[0].audioRefs).toEqual(["door.mp3"]);
  });

  it("skips a note with nothing that looks like a headword", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        // No field names to latch onto, and no Arabic anywhere.
        models: [{ id: 1, name: "Custom", fieldNames: ["Field A", "Field B"] }],
        notes: [
          { id: 100, mid: 1, fields: ["hello", "world"] },
          { id: 101, mid: 1, fields: ["باب", "door"] },
        ],
        cards: [
          { id: 200, nid: 100 },
          { id: 201, nid: 101 },
        ],
      }),
    );

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].wordArabic).toBe("باب");
    // Counted before the filter, so the UI can report what was dropped.
    expect(deck.totalNotes).toBe(2);
  });

  it("imports an English-only note when the field is called Front", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        // "Front" and "Back" — Anki's default Basic model, so this is the
        // common case, not a contrived one.
        notes: [{ id: 100, mid: 1, fields: ["hello", "world"] }],
        cards: [{ id: 200, nid: 100 }],
      }),
    );

    // Pinned, not fixed. The name match ("arabic", "front", "word", …) is
    // tried before the is-Arabic check and wins outright, so any populated
    // "Front" field becomes the headword whatever language it is in. A French
    // or Japanese deck imported by mistake produces a full deck of cards
    // rather than being rejected, and the only signal is that the Arabic
    // column is not Arabic.
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].wordArabic).toBe("hello");
  });

  it("reads the tags off the note", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck(ONE_NOTE));

    expect(deck.cards[0].tags).toEqual(["nouns", "household"]);
  });
});

describe("scheduling and provenance", () => {
  it("carries the card's Anki scheduling across", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck(ONE_NOTE));

    // These feed mapAnkiSchedule; losing them starts a years-old deck from
    // scratch.
    expect(deck.cards[0]).toMatchObject({
      ankiType: 2,
      ankiIvl: 30,
      ankiReps: 12,
      ankiFactor: 2500,
      ankiLapses: 1,
    });
  });

  it("records the note and card ids", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck(ONE_NOTE));

    expect(deck.cards[0].ankiNoteId).toBe(100);
    expect(deck.cards[0].ankiCardId).toBe(200);
  });

  it("names the model and the deck", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        ...ONE_NOTE,
        decks: { 5: "Arabic::Gulf::Nouns" },
        cards: [{ id: 200, nid: 100, did: 5 }],
      }),
    );

    expect(deck.cards[0].modelName).toBe("Basic");
    // Anki nests decks with "::"; the full path is unreadable as a label.
    expect(deck.cards[0].deckName).toBe("Nouns");
  });

  it("takes the most-studied card when a note has several", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        notes: [{ id: 100, mid: 1, fields: ["باب", "door"] }],
        cards: [
          // A reversed-card note: the recognition card is mature, the recall
          // card was never studied.
          { id: 200, nid: 100, type: 0, ivl: 0, reps: 0 },
          { id: 201, nid: 100, type: 2, ivl: 60, reps: 20 },
        ],
      }),
    );

    // Taking the first would throw away twenty reviews.
    expect(deck.cards[0].ankiIvl).toBe(60);
    expect(deck.cards[0].ankiReps).toBe(20);
  });

  it("survives a note with no card row at all", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(
      aDeck({
        notes: [{ id: 100, mid: 1, fields: ["باب", "door"] }],
        cards: [],
      }),
    );

    // An orphaned note is still a word worth importing; it just arrives new.
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].ankiIvl).toBeUndefined();
  });
});

describe("media", () => {
  it("maps the numbered archive entries back to their filenames", async () => {
    const { parseApkg } = await import("./parseApkg");

    const file = apkgOf({
      "collection.anki2": collectionBytes(ONE_NOTE),
      media: strToU8(JSON.stringify({ "0": "door.jpg", "1": "door.mp3" })),
      "0": new Uint8Array([1, 2, 3]),
      "1": new Uint8Array([4, 5, 6]),
    });

    const deck = await parseApkg(file);

    // The cards reference original names; without the manifest the bytes are
    // unreachable.
    expect([...deck.media.keys()].sort()).toEqual(["door.jpg", "door.mp3"]);
    expect(deck.media.get("door.jpg")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("ignores a manifest entry whose file is missing", async () => {
    const { parseApkg } = await import("./parseApkg");

    const file = apkgOf({
      "collection.anki2": collectionBytes(ONE_NOTE),
      media: strToU8(JSON.stringify({ "0": "door.jpg", "9": "gone.mp3" })),
      "0": new Uint8Array([1, 2, 3]),
    });

    const deck = await parseApkg(file);

    expect([...deck.media.keys()]).toEqual(["door.jpg"]);
  });

  it("imports the deck anyway when the manifest is unreadable", async () => {
    const { parseApkg } = await import("./parseApkg");

    const file = apkgOf({
      "collection.anki2": collectionBytes(ONE_NOTE),
      media: strToU8("{not json"),
    });

    // Losing the pictures is survivable; losing the words is not.
    const deck = await parseApkg(file);

    expect(deck.cards).toHaveLength(1);
    expect(deck.media.size).toBe(0);
  });

  it("handles a package with no media section", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck(ONE_NOTE));

    expect(deck.media.size).toBe(0);
  });
});

describe("size", () => {
  it("truncates a deck past the import limit and says so", async () => {
    const { parseApkg } = await import("./parseApkg");
    const count = ANKI_IMPORT_LIMIT + 5;

    const deck = await parseApkg(
      aDeck({
        notes: Array.from({ length: count }, (_, i) => ({
          id: 100 + i,
          mid: 1,
          fields: [`كلمة${i}`, `word ${i}`],
        })),
        cards: Array.from({ length: count }, (_, i) => ({ id: 1000 + i, nid: 100 + i })),
      }),
    );

    expect(deck.truncated).toBe(true);
    expect(deck.cards).toHaveLength(ANKI_IMPORT_LIMIT);
  });

  it("returns an empty deck when the collection has no notes", async () => {
    const { parseApkg } = await import("./parseApkg");

    const deck = await parseApkg(aDeck({ notes: [], cards: [] }));

    expect(deck.cards).toEqual([]);
    expect(deck.totalNotes).toBe(0);
    expect(deck.truncated).toBe(false);
  });
});
