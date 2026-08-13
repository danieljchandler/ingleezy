/**
 * Client-side xlsx parser for Lahja lesson plan files.
 *
 * Expected sheets:
 *   📋 Lesson Overview
 *   📖 Vocabulary
 *   🗺️ Lesson Sequence
 *   🖼️ Image Scenes
 *   🃏 Flashcard Spec
 *   💬 Real-World Prompts
 *
 * Uses the SheetJS (xlsx) library.
 */
import * as XLSX from 'xlsx';

export interface ParsedVocabEntry {
  number: number;
  arabic: string;
  transliteration: string;
  english: string;
  category: string;
  imageScene: string;
  teachingNote: string;
}

export interface ParsedLessonOverview {
  stageLabel: string;      // e.g. "Stage 1 — Foundations (Pre-A1 → A1)"
  lessonLabel: string;     // e.g. "Lesson 1 of 20  |  Week 1, Day 1"
  lessonNumber: number;
  duration: string;        // e.g. "~15 minutes"
  durationMinutes: number;
  cefrTarget: string;
  approach: string;
  vocabIntroduced: string;
  grammar: string;
  contentType: string;
  outputExpected: string;
  unlockCondition: string;
  title: string;           // derived from lesson overview header
}

export interface ParsedLessonPlan {
  overview: ParsedLessonOverview;
  vocabulary: ParsedVocabEntry[];
  lessonSequence: Record<string, string>[];
  imageScenes: Record<string, string>[];
  flashcardSpec: Record<string, string>[];
  realWorldPrompts: Record<string, string>[];
  designRationale: Record<string, string>[];
  soundSpotlight: Record<string, string>[];
}

function getSheetByPartialName(workbook: XLSX.WorkBook, partial: string): XLSX.WorkSheet | null {
  const name = workbook.SheetNames.find(n => n.includes(partial));
  return name ? workbook.Sheets[name] : null;
}

function sheetToRows(sheet: XLSX.WorkSheet): (string | number | null)[][] {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows: (string | number | null)[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | number | null)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v : null);
    }
    rows.push(row);
  }
  return rows;
}

function parseOverview(sheet: XLSX.WorkSheet): ParsedLessonOverview {
  const rows = sheetToRows(sheet);

  const fieldMap: Record<string, string> = {};
  let title = '';

  for (const row of rows) {
    const a = String(row[0] || '').trim();
    const b = String(row[1] || '').trim();

    // The first non-empty row with content in A is usually the title
    if ((a.includes('HAKIYA') || a.includes('LAHJA')) && a.includes('Lesson')) {
      // Parse title from header like "HAKIYA  |  Stage 1 · Lesson 1 · Objects — The World Around You"
      const parts = a.split('·');
      title = parts.length >= 3 ? parts.slice(2).join('·').trim() : a;
    }

    if (b) {
      fieldMap[a] = b;
    }
  }

  const lessonLabel = fieldMap['Lesson'] || '';
  const lessonMatch = lessonLabel.match(/Lesson\s+(\d+)/);
  const lessonNumber = lessonMatch ? parseInt(lessonMatch[1], 10) : 1;

  const durationStr = fieldMap['Duration'] || '';
  const durationMatch = durationStr.match(/(\d+)/);
  const durationMinutes = durationMatch ? parseInt(durationMatch[1], 10) : 15;

  return {
    stageLabel: fieldMap['Stage'] || '',
    lessonLabel,
    lessonNumber,
    duration: durationStr,
    durationMinutes,
    cefrTarget: fieldMap['CEFR Target'] || '',
    approach: fieldMap['Approach'] || '',
    vocabIntroduced: fieldMap['Vocab introduced'] || '',
    grammar: fieldMap['Grammar'] || '',
    contentType: fieldMap['Content type'] || '',
    outputExpected: fieldMap['Output expected'] || '',
    unlockCondition: fieldMap['Unlock condition'] || '',
    title,
  };
}

function parseVocabulary(sheet: XLSX.WorkSheet): { vocab: ParsedVocabEntry[]; designRationale: Record<string, string>[]; soundSpotlight: Record<string, string>[] } {
  const rows = sheetToRows(sheet);
  const vocab: ParsedVocabEntry[] = [];
  const designRationale: Record<string, string>[] = [];
  const soundSpotlight: Record<string, string>[] = [];

  let section: 'header' | 'vocab' | 'sound' | 'rationale' = 'header';

  for (const row of rows) {
    const a = String(row[0] || '').trim();

    if (a === '#') {
      section = 'vocab';
      continue;
    }
    if (a.includes('SOUND SPOTLIGHT')) {
      section = 'sound';
      continue;
    }
    if (a.includes('DESIGN RATIONALE')) {
      section = 'rationale';
      continue;
    }

    if (section === 'vocab') {
      const num = parseInt(a, 10);
      if (!isNaN(num) && row[1]) {
        vocab.push({
          number: num,
          arabic: String(row[1] || '').trim(),
          transliteration: String(row[2] || '').trim(),
          english: String(row[3] || '').trim(),
          category: String(row[4] || '').trim(),
          imageScene: String(row[5] || '').trim(),
          teachingNote: String(row[6] || '').trim(),
        });
      }
    }

    if (section === 'sound' && a && row[2]) {
      soundSpotlight.push({
        sound: a,
        example: String(row[2] || '').trim(),
        explanation: String(row[3] || '').trim(),
      });
    }

    if (section === 'rationale' && a && row[1]) {
      designRationale.push({
        principle: a,
        explanation: String(row[1] || '').trim(),
      });
    }
  }

  return { vocab, designRationale, soundSpotlight };
}

function parseGenericSheet(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const rows = sheetToRows(sheet);
  const results: Record<string, string>[] = [];
  let headers: string[] = [];
  let foundHeaders = false;

  for (const row of rows) {
    const a = String(row[0] || '').trim();

    // Look for header row (starts with #)
    if (a === '#' && !foundHeaders) {
      headers = row.map(c => String(c || '').trim());
      foundHeaders = true;
      continue;
    }

    if (foundHeaders && row.some(c => c !== null && c !== '')) {
      const entry: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        if (headers[i]) {
          entry[headers[i]] = String(row[i] || '').trim();
        }
      }
      if (Object.values(entry).some(v => v)) {
        results.push(entry);
      }
    }
  }

  // If no headers found, just dump key-value pairs
  if (!foundHeaders) {
    for (const row of rows) {
      const a = String(row[0] || '').trim();
      const b = String(row[1] || '').trim();
      if (a && !a.includes('|') && !a.includes('SPEC') && !a.includes('SEQUENCE') && !a.includes('SCENE') && !a.includes('PROMPT')) {
        const entry: Record<string, string> = {};
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== null) {
            entry[`col_${i}`] = String(row[i]).trim();
          }
        }
        if (Object.values(entry).some(v => v)) {
          results.push(entry);
        }
      }
    }
  }

  return results;
}

export function parseLessonXlsx(buffer: ArrayBuffer): ParsedLessonPlan {
  const workbook = XLSX.read(buffer, { type: 'array' });

  const overviewSheet = getSheetByPartialName(workbook, 'Lesson Overview') || getSheetByPartialName(workbook, 'Overview');
  const vocabSheet = getSheetByPartialName(workbook, 'Vocabulary');
  const sequenceSheet = getSheetByPartialName(workbook, 'Lesson Sequence') || getSheetByPartialName(workbook, 'Sequence');
  const imageScenesSheet = getSheetByPartialName(workbook, 'Image Scene');
  const flashcardSheet = getSheetByPartialName(workbook, 'Flashcard');
  const promptsSheet = getSheetByPartialName(workbook, 'Prompt') || getSheetByPartialName(workbook, 'Real-World');

  const overview = overviewSheet ? parseOverview(overviewSheet) : {
    stageLabel: '', lessonLabel: '', lessonNumber: 1, duration: '',
    durationMinutes: 15, cefrTarget: '', approach: '', vocabIntroduced: '',
    grammar: '', contentType: '', outputExpected: '', unlockCondition: '', title: 'Untitled Lesson',
  };

  const { vocab, designRationale, soundSpotlight } = vocabSheet
    ? parseVocabulary(vocabSheet)
    : { vocab: [], designRationale: [], soundSpotlight: [] };

  return {
    overview,
    vocabulary: vocab,
    lessonSequence: sequenceSheet ? parseGenericSheet(sequenceSheet) : [],
    imageScenes: imageScenesSheet ? parseGenericSheet(imageScenesSheet) : [],
    flashcardSpec: flashcardSheet ? parseGenericSheet(flashcardSheet) : [],
    realWorldPrompts: promptsSheet ? parseGenericSheet(promptsSheet) : [],
    designRationale,
    soundSpotlight,
  };
}
