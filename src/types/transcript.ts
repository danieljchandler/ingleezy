 export type WordToken = {
   id: string;
   surface: string;         // as spoken in transcript
   standard?: string;       // more standard spelling (optional)
   gloss?: string;          // English meaning for this individual word
   compoundRef?: string;    // if part of a compound phrase, references the first word's surface
 };
 
 export type TranscriptLine = {
   id: string;
   arabic: string;          // full sentence as spoken
   translation: string;     // English sentence translation
   literal?: string;        // word-for-word English gloss of the whole line
  /**
   * The same sentence rewritten in Modern Standard Arabic (فصحى) — a
   * conversion, not a translation, so a Fusha learner can see which pieces the
   * dialect changed. Absent on everything analysed before the Fusha pass
   * existed; `useFushaLines` fills those in on demand.
   */
  fusha?: string;
   tokens: WordToken[];     // clickable words
   startMs?: number;        // for future audio sync
   endMs?: number;
  segmentType?: 'audio' | 'text_overlay';
  /** Set by the translation ensemble when the line couldn't be settled confidently. */
  needs_review?: boolean;
  /**
   * Why the line needs review — set whenever `needs_review` is true.
   * `ensemble_disagreement` means the three models genuinely disagreed;
   * `call2_fallback` means the ensemble returned nothing and the Qwen analysis
   * pass filled it (unverified, but not disputed); `empty` means no model
   * produced a translation. These want different attention in review.
   */
  review_reason?: 'ensemble_disagreement' | 'call2_fallback' | 'empty';
  /**
   * Fanar-Shaheen-MT alternative rendering. Present on lines the ensemble
   * disputed, and on lines Shaheen's arbitration settled — there it is the
   * evidence for the choice rather than a competing option.
   */
  altTranslation?: string;
  /**
   * Set when a disputed line was settled by the Shaheen-MT tiebreak rather than
   * by the ensemble itself, e.g. `shaheen→claude-sonnet-4.5`. Such a line has
   * `needs_review` false but did not reach a clean ensemble majority.
   */
  resolved_by?: string;
 };
 
export type VocabItem = {
  arabic: string;
  english: string;
  root?: string;
  sentenceText?: string;
  sentenceEnglish?: string;
  startMs?: number;
  endMs?: number;
};
 
 export type GrammarPoint = {
   title: string;
   explanation: string;
   examples?: string[];
 };
 
export type OnScreenTextSegment = {
  text: string;
  translation: string;
  transliteration?: string;
  startSeconds: number;
  endSeconds: number;
  confidence: 'high' | 'medium' | 'low';
};

export type TranscriptResult = {
  rawTranscriptArabic: string;     // original blob
  lines: TranscriptLine[];
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
  /** Text overlays detected in the video (POV captions, subtitles, title cards, etc.). */
  onScreenText?: OnScreenTextSegment[];
  dialectValidation?: { content: string; timestamp: string } | null;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  /** Full merged Arabic with tashkeel from Farasa — feed to ElevenLabs TTS for accurate pronunciation. */
  diacritizedTranscript?: string | null;
  /** City-level Gulf dialect from CAMeL-Lab BERT model, independent of LLM detection. */
  camelDialect?: { code: string; dialect: string; confidence: number; isGulf: boolean } | null;
};

// ── Transcript Editor types (ASR word-level segments) ──────────────

/** A single word with timing data from ASR output. */
export type Word = {
  word: string;
  start: number;      // seconds
  end: number;        // seconds
  confidence: number; // 0–1
};

/** A subtitle segment composed of timed words. */
export type Segment = {
  id: string;
  video_id: string;
  start: number;       // seconds
  end: number;         // seconds
  text: string;        // Arabic
  translation: string; // English
  literal?: string;    // word-for-word English gloss
  confidence: number;  // average of word confidences
  words: Word[];
  speaker?: string;
};

/** Operation types for the undo stack. */
export type UndoOperation =
  | { type: 'SplitOp'; originalSegment: Segment; resultSegments: [Segment, Segment] }
  | { type: 'MergeOp'; originalSegments: [Segment, Segment]; resultSegment: Segment }
  | { type: 'EditTextOp'; segmentId: string; previousText: string; newText: string }
  | { type: 'ShiftTimestampOp'; segmentId: string; field: 'start' | 'end'; previousValue: number; newValue: number }
  | { type: 'AIReplaceOp'; segmentId: string; previousText: string; newText: string }
  | { type: 'RippleTimestampOp'; changes: Array<{ segmentId: string; field: 'start' | 'end'; previousValue: number; newValue: number }> };

/** Result of gap analysis between segments. */
export type GapWarning = {
  type: 'gap' | 'overlap' | 'too-short' | 'too-long';
  severity: 'warning' | 'error';
  message: string;
  segmentIndex: number;
  /** Second segment index (for gap/overlap between two segments). */
  segmentIndexB?: number;
};

/** Publish-checklist item. */
export type PublishCheckItem = {
  label: string;
  passed: boolean;
};