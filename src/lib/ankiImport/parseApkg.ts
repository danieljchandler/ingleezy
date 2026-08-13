import { unzipSync, strFromU8 } from "fflate";
import initSqlJs, { type Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { stripAnkiHtml, isArabic } from "./normalize";
import { splitWordAndSentence } from "./splitSentence";
import {
  ANKI_FILE_SIZE_LIMIT,
  ANKI_IMPORT_LIMIT,
  type ParsedAnkiCard,
  type ParsedAnkiDeck,
} from "./types";

let sqlPromise: Promise<any> | null = null;
function loadSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlPromise;
}

const COLLECTION_FILES = ["collection.anki21b", "collection.anki21", "collection.anki2"];

export async function parseApkg(file: File): Promise<ParsedAnkiDeck> {
  if (file.size > ANKI_FILE_SIZE_LIMIT) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(0)} MB. Limit is ${ANKI_FILE_SIZE_LIMIT / 1024 / 1024} MB.`,
    );
  }

  // Avoid an extra ~1 GB copy on huge decks — feed the ArrayBuffer view straight to fflate.
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));

  // Locate the collection sqlite db
  let dbBytes: Uint8Array | null = null;
  for (const name of COLLECTION_FILES) {
    if (entries[name]) {
      dbBytes = entries[name];
      break;
    }
  }
  if (!dbBytes) {
    // anki21b is sometimes zstd-compressed; we don't support that path.
    if (entries["collection.anki21b"]) {
      throw new Error(
        "This .apkg uses the new compressed (anki21b) format. In Anki, export with 'Support older Anki versions' enabled, then try again.",
      );
    }
    throw new Error("Could not find a collection database inside the file.");
  }

  // Media filename map: { "0": "front.jpg", "1": "audio.mp3", ... }
  const mediaMap = new Map<string, Uint8Array>();
  if (entries["media"]) {
    try {
      const mediaJson = JSON.parse(strFromU8(entries["media"])) as Record<string, string>;
      for (const [numericName, originalName] of Object.entries(mediaJson)) {
        const bytes = entries[numericName];
        if (bytes) mediaMap.set(originalName, bytes);
      }
    } catch {
      // ignore malformed media manifest
    }
  }

  const SQL = await loadSql();
  const db: Database = new SQL.Database(dbBytes);

  try {
    // Field names from models (col.models is a JSON blob)
    const modelInfo = readModels(db);
    const deckNames = readDecks(db);

    const cards: ParsedAnkiCard[] = [];
    const noteRowsRes = db.exec(
      "SELECT id, mid, flds, tags FROM notes ORDER BY id ASC LIMIT " + (ANKI_IMPORT_LIMIT + 1),
    );

    if (noteRowsRes.length === 0) {
      return { cards: [], media: mediaMap, totalNotes: 0, truncated: false };
    }

    const noteRows = noteRowsRes[0].values as Array<[number, number, string, string]>;

    // Card scheduling + deck id: pick the *best* card per note (highest type/ivl).
    const cardsByNote = readCardsByNote(db);

    const totalNotes = noteRows.length;
    const truncated = totalNotes > ANKI_IMPORT_LIMIT;
    const sliced = truncated ? noteRows.slice(0, ANKI_IMPORT_LIMIT) : noteRows;

    for (const [nid, mid, flds, tagsStr] of sliced) {
      const fields = (flds ?? "").split("\u001f");
      const model = modelInfo.get(mid);
      const mapped = mapFields(fields, model);
      if (!mapped) continue;

      const tags = (tagsStr || "")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

      const cardSched = cardsByNote.get(nid);
      const rawDeck = cardSched?.did != null ? deckNames.get(cardSched.did) : undefined;
      // Anki nests decks with "::" separators; keep the leaf for display.
      const deckName = rawDeck ? rawDeck.split("::").pop() || rawDeck : undefined;

      cards.push({
        ankiNoteId: nid,
        ankiCardId: cardSched?.cardId,
        modelName: model?.name,
        deckName,
        tags,
        wordArabic: mapped.wordArabic,
        wordEnglish: mapped.wordEnglish,
        phonetic: mapped.phonetic,
        sentenceArabic: mapped.sentenceArabic,
        sentenceEnglish: mapped.sentenceEnglish,
        imageRefs: mapped.imageRefs,
        audioRefs: mapped.audioRefs,
        ankiType: cardSched?.type,
        ankiQueue: cardSched?.queue,
        ankiIvl: cardSched?.ivl,
        ankiReps: cardSched?.reps,
        ankiLapses: cardSched?.lapses,
        ankiFactor: cardSched?.factor,
        ankiDue: cardSched?.due,
      });
    }

    return { cards, media: mediaMap, totalNotes, truncated };
  } finally {
    db.close();
  }
}

function readDecks(db: Database): Map<number, string> {
  const out = new Map<number, string>();
  try {
    const res = db.exec("SELECT decks FROM col LIMIT 1");
    if (!res.length) return out;
    const blob = res[0].values[0]?.[0];
    if (typeof blob !== "string") return out;
    const json = JSON.parse(blob) as Record<string, any>;
    for (const [, d] of Object.entries(json)) {
      const id = Number(d.id);
      if (Number.isFinite(id)) out.set(id, String(d.name || ""));
    }
  } catch {
    // ignore
  }
  return out;
}

interface ModelInfo {
  id: number;
  name: string;
  fields: string[];
}

function readModels(db: Database): Map<number, ModelInfo> {
  const out = new Map<number, ModelInfo>();
  try {
    const res = db.exec("SELECT models FROM col LIMIT 1");
    if (!res.length) return out;
    const blob = res[0].values[0]?.[0];
    if (typeof blob !== "string") return out;
    const json = JSON.parse(blob) as Record<string, any>;
    for (const [, m] of Object.entries(json)) {
      const id = Number(m.id);
      out.set(id, {
        id,
        name: String(m.name || ""),
        fields: Array.isArray(m.flds) ? m.flds.map((f: any) => String(f.name || "")) : [],
      });
    }
  } catch {
    // ignore
  }
  return out;
}

interface CardSched {
  cardId: number;
  did: number;
  type: number;
  queue: number;
  ivl: number;
  reps: number;
  lapses: number;
  factor: number;
  due: number;
}

function readCardsByNote(db: Database): Map<number, CardSched> {
  const out = new Map<number, CardSched>();
  try {
    const res = db.exec(
      "SELECT id, nid, did, type, queue, ivl, reps, lapses, factor, due FROM cards",
    );
    if (!res.length) return out;
    for (const row of res[0].values as Array<[number, number, number, number, number, number, number, number, number, number]>) {
      const [id, nid, did, type, queue, ivl, reps, lapses, factor, due] = row;
      const existing = out.get(nid);
      // Prefer the most "mature" card per note: highest type then highest ivl.
      if (
        !existing ||
        type > existing.type ||
        (type === existing.type && ivl > existing.ivl)
      ) {
        out.set(nid, { cardId: id, did, type, queue, ivl, reps, lapses, factor, due });
      }
    }
  } catch {
    // ignore
  }
  return out;
}

interface MappedFields {
  wordArabic: string;
  wordEnglish: string;
  phonetic?: string;
  sentenceArabic?: string;
  sentenceEnglish?: string;
  imageRefs: string[];
  audioRefs: string[];
}

/**
 * Heuristic field mapper. Anki notes don't have a fixed schema, so we infer:
 *  - Arabic-script field → headword (or example sentence if it's long).
 *  - Latin-script field → English.
 *  - A field named "Sentence"/"Example"/"Context" → sentence.
 *  - A field named "Pronunciation"/"Phonetic"/"Reading" → phonetic.
 *  - Images and [sound:] tokens collected across all fields.
 */
function mapFields(fields: string[], model: ModelInfo | undefined): MappedFields | null {
  const fieldNames = model?.fields ?? fields.map((_, i) => `Field ${i + 1}`);

  const allImages: string[] = [];
  const allAudio: string[] = [];

  type Slot = { name: string; text: string; arabic: boolean };
  const slots: Slot[] = fields.map((raw, i) => {
    const { text, imageRefs, audioRefs } = stripAnkiHtml(raw || "");
    allImages.push(...imageRefs);
    allAudio.push(...audioRefs);
    return { name: (fieldNames[i] || `Field ${i + 1}`).toLowerCase(), text, arabic: isArabic(text) };
  });

  const findByName = (...needles: string[]) =>
    slots.find((s) => s.text && needles.some((n) => s.name.includes(n)));

  const arabicSlot =
    findByName("arabic", "front", "word", "expression", "hanzi", "headword") ||
    slots.find((s) => s.arabic && s.text.length > 0);

  const englishSlot =
    findByName("english", "meaning", "translation", "back", "definition") ||
    slots.find((s) => !s.arabic && s.text.length > 0 && s !== arabicSlot);

  const sentenceSlot = findByName("sentence", "example", "context", "usage");
  const phoneticSlot = findByName("pronunciation", "phonetic", "reading", "transliteration", "romanization");

  if (!arabicSlot || !arabicSlot.text) return null;

  // If the dedicated sentence slot is Arabic, use it directly.
  let sentenceArabic: string | undefined;
  let sentenceEnglish: string | undefined;
  if (sentenceSlot && isArabic(sentenceSlot.text)) {
    sentenceArabic = sentenceSlot.text;
  }

  // Otherwise, split the headword if it looks like a sentence.
  const split = splitWordAndSentence({
    word: arabicSlot.text,
    sentence: sentenceArabic,
  });
  const wordArabic = split.word;
  if (split.sentence) sentenceArabic = split.sentence;

  // English sentence could live next to the Arabic example.
  if (sentenceSlot && !isArabic(sentenceSlot.text)) {
    sentenceEnglish = sentenceSlot.text;
  }

  return {
    wordArabic,
    wordEnglish: englishSlot?.text || "",
    phonetic: phoneticSlot?.text,
    sentenceArabic,
    sentenceEnglish,
    imageRefs: allImages,
    audioRefs: allAudio,
  };
}
