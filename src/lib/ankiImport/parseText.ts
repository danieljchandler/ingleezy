import Papa from "papaparse";
import { isArabic, stripAnkiHtml } from "./normalize";
import { splitWordAndSentence } from "./splitSentence";
import { ANKI_IMPORT_LIMIT, type ParsedAnkiCard, type ParsedAnkiDeck } from "./types";

/**
 * Parse a plain Anki text export (TSV or CSV).
 * Supports Anki's `#html:true`, `#separator:tab|comma|semicolon`, and `#tags column:N` hints.
 */
export async function parseAnkiText(file: File): Promise<ParsedAnkiDeck> {
  const raw = await file.text();
  const lines = raw.split(/\r?\n/);

  let separator: string | undefined;
  let isHtml = false;
  let tagsColumn = -1;
  let dataStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#")) {
      dataStart = i;
      break;
    }
    const lower = line.toLowerCase();
    if (lower.startsWith("#separator:")) {
      const v = lower.split(":")[1]?.trim();
      if (v === "tab") separator = "\t";
      else if (v === "comma") separator = ",";
      else if (v === "semicolon") separator = ";";
      else if (v && v.length === 1) separator = v;
    } else if (lower.startsWith("#html:")) {
      isHtml = lower.includes("true");
    } else if (lower.startsWith("#tags column:")) {
      const n = parseInt(lower.split(":")[1] || "0", 10);
      if (Number.isFinite(n) && n > 0) tagsColumn = n - 1;
    }
    dataStart = i + 1;
  }

  // Auto-detect separator from the first data line if not declared.
  if (!separator) {
    const sample = lines.slice(dataStart, dataStart + 5).join("\n");
    if (file.name.endsWith(".csv")) separator = ",";
    else if (sample.includes("\t")) separator = "\t";
    else separator = ",";
  }

  const body = lines.slice(dataStart).join("\n");
  const parsed = Papa.parse<string[]>(body, {
    delimiter: separator,
    skipEmptyLines: true,
  });

  const cards: ParsedAnkiCard[] = [];
  const rows = parsed.data;
  const totalNotes = rows.length;
  const truncated = totalNotes > ANKI_IMPORT_LIMIT;
  const sliced = truncated ? rows.slice(0, ANKI_IMPORT_LIMIT) : rows;

  for (const row of sliced) {
    if (!Array.isArray(row) || row.length === 0) continue;

    const tags =
      tagsColumn >= 0 && row[tagsColumn]
        ? row[tagsColumn].split(/\s+/).filter(Boolean)
        : [];

    const fields = row
      .map((cell, idx) => (idx === tagsColumn ? "" : cell || ""))
      .map((cell) => {
        if (isHtml) {
          const { text } = stripAnkiHtml(cell);
          return text;
        }
        return cell.trim();
      })
      .filter((_, idx) => idx !== tagsColumn);

    const arabicIdx = fields.findIndex((f) => isArabic(f));
    if (arabicIdx === -1) continue;

    const wordRaw = fields[arabicIdx];
    const english = fields.find((f, i) => i !== arabicIdx && f && !isArabic(f)) || "";
    const sentenceCandidate = fields.find((f, i) => i !== arabicIdx && f && isArabic(f));

    const split = splitWordAndSentence({ word: wordRaw, sentence: sentenceCandidate });

    cards.push({
      tags,
      wordArabic: split.word,
      wordEnglish: english,
      sentenceArabic: split.sentence,
      imageRefs: [],
      audioRefs: [],
    });
  }

  return { cards, media: new Map(), totalNotes, truncated };
}
