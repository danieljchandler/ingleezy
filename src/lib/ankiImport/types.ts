export type HakiyaStage =
  | "NEW"
  | "LEARNING_1D"
  | "LEARNING_3D"
  | "REVIEWING_7D"
  | "REVIEWING_14D"
  | "MATURE_21D";

/** @deprecated Use HakiyaStage. Kept as an alias during the Lahja → Hakiya rename. */
export type LahjaStage = HakiyaStage;

export interface AnkiMediaRef {
  filename: string;
  bytes: Uint8Array;
  kind: "image" | "audio";
}

export interface ParsedAnkiCard {
  // identity
  ankiNoteId?: number;
  ankiCardId?: number;
  modelName?: string;
  deckName?: string;
  tags: string[];

  // content
  wordArabic: string;
  wordEnglish: string;
  phonetic?: string;
  sentenceArabic?: string;
  sentenceEnglish?: string;

  // media references (filenames inside the apkg media map)
  imageRefs: string[];
  audioRefs: string[];

  // anki scheduling
  ankiType?: number; // 0=new, 1=learning, 2=review, 3=relearning
  ankiQueue?: number;
  ankiIvl?: number; // days (for type=2)
  ankiReps?: number;
  ankiLapses?: number;
  ankiFactor?: number; // /1000 = ease
  ankiDue?: number;
}

export interface ParsedAnkiDeck {
  cards: ParsedAnkiCard[];
  media: Map<string, Uint8Array>; // filename -> bytes
  totalNotes: number;
  truncated: boolean;
}

export interface ImportProgress {
  phase:
    | "reading"
    | "parsing"
    | "uploading-media"
    | "inserting"
    | "done"
    | "error";
  current?: number;
  total?: number;
  message?: string;
}

export const ANKI_IMPORT_LIMIT = 11000;
export const ANKI_FILE_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GB
