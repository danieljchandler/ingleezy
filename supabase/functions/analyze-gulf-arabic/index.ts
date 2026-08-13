import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  arbitrateDispute,
  jaccard,
  type ArbiterCandidate,
} from "../_shared/translationArbiter.ts";
import {
  callFarasaDiacritizeLines,
  type FarasaLinesOutcome,
} from "../_shared/farasa.ts";
import {
  parseDialectIssues,
  type DialectIssue,
} from "../_shared/dialectIssues.ts";
import {
  overlayDiacritizedPerLine,
  stripDiacritics,
} from "../_shared/arabicDiacritics.ts";
import {
  callCamelDialect,
  camelAgreesWithModule,
  type CamelFailureReason,
  type CamelOutcome,
  type CamelPrediction,
} from "../_shared/camelDialect.ts";
import {
  alignFushaLines,
  buildFushaSystemPrompt,
} from "../_shared/fushaBridge.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

// Helper to generate unique IDs
function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

 // Types matching src/types/transcript.ts
 interface WordToken {
   id: string;
   surface: string;
   standard?: string;
   gloss?: string;
   compoundRef?: string;
 }
 
 interface TranscriptLine {
   id: string;
   arabic: string;
   translation: string;
   literal?: string;
   /**
    * The same sentence in Modern Standard Arabic (فصحى). Not a translation —
    * see _shared/fushaBridge.ts. Empty when the Fusha pass failed or returned
    * something that wasn't Arabic; the row simply doesn't render.
    */
   fusha?: string;
   tokens: WordToken[];
   needs_review?: boolean;
   /** Why the line needs review — set whenever needs_review is true. */
   review_reason?: ReviewReason;
   /** Fanar-Shaheen-MT alternative rendering, on disputed and arbitrated lines. */
   altTranslation?: string;
   /** Set when the Shaheen-MT tiebreak settled the line, e.g. `shaheen→claude-sonnet-4.5`. */
   resolved_by?: string;
 }

/**
 * - `ensemble_disagreement` — the three translation models produced clusters
 *   that never reached a winning weight; the fallback priority picked one.
 * - `call2_fallback` — the ensemble returned nothing for this line and the
 *   Qwen analysis pass filled it. Unverified by the ensemble, not disputed.
 * - `empty` — no model produced a translation at all.
 */
type ReviewReason = 'ensemble_disagreement' | 'call2_fallback' | 'empty';
 
 interface VocabItem {
   arabic: string;
   english: string;
   root?: string;
   culturalContext?: string;
   idiomaticNuance?: string;
   dialectNotes?: string;
   exampleSentence?: { arabic: string; english: string };
 }
 
 interface GrammarPoint {
   title: string;
   explanation: string;
   examples?: string[];
 }
 
 interface TranscriptResult {
   rawTranscriptArabic: string;
   lines: TranscriptLine[];
   vocabulary: VocabItem[];
   grammarPoints: GrammarPoint[];
   culturalContext?: string;
  dialectValidation?: { content: string; timestamp: string; issues?: DialectIssue[] } | null;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  /** Full merged Arabic transcript with tashkeel added by Farasa. Feed to ElevenLabs TTS for accurate pronunciation. */
  diacritizedTranscript?: string | null;
  /** Dialect identification from CAMeL-Lab BERT model (city-level, independent of LLM). */
  camelDialect?: CamelPrediction | null;
 }


const strictJsonPrefix = (isRetry: boolean) =>
  isRetry
    ? "CRITICAL: Return ONLY valid JSON. No commentary, no markdown, no explanation. Just the JSON object.\n\n"
    : "";

// Module-level dialect override (Gulf | Egyptian | Yemeni). Set per-request.
let DIALECT_MODULE: 'Gulf' | 'Egyptian' | 'Yemeni' = 'Gulf';

const dialectFamilyLabel = () => {
  if (DIALECT_MODULE === 'Egyptian') return 'Egyptian Arabic (مصري)';
  if (DIALECT_MODULE === 'Yemeni') return 'Yemeni Arabic (يمني)';
  return 'Gulf Arabic (Khaliji)';
};

const dialectShortLabel = () => {
  if (DIALECT_MODULE === 'Egyptian') return 'Egyptian Arabic';
  if (DIALECT_MODULE === 'Yemeni') return 'Yemeni Arabic';
  return 'Gulf Arabic';
};

const getDialectNote = (dialect?: string, prefix = '\n') => {
  if (DIALECT_MODULE !== 'Gulf') {
    return `${prefix}The speaker is using ${dialectFamilyLabel()}. NEVER use Gulf, Levantine, or other Arabic dialects.`;
  }
  return dialect && dialect !== 'Gulf'
    ? `${prefix}The speaker is using ${dialect} Gulf Arabic dialect.`
    : `${prefix}The speaker is using Gulf Arabic (Khaliji) dialect.`;
};

/**
 * IMPORTANT: We intentionally do NOT ask the model to output per-word tokens.
 * That payload explodes in size and often gets truncated, yielding invalid JSON.
 * We generate tokens server-side from the Arabic sentence text.
 */
// ─── CALL 1 PROMPT ───────────────────────────────────────────────────────────
// Transcript merging only. Produces Arabic lines with NO translations.
// Translations, vocabulary, and grammar are handled in Call 2.
const getMergeOnlySystemPrompt = (isRetry: boolean = false, hasDualTranscripts: boolean = false, hasTripleTranscripts: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  const multiInstructions = hasTripleTranscripts
    ? `You are given MULTIPLE transcriptions of the same Arabic audio from different speech-to-text engines.
Compare them carefully and produce the BEST merged transcript using this priority order:

ENGINE QUALITY RANKING (2026 Arabic production benchmarks):
1. **Munsit** — TRUE Arabic-native dialect specialist (Khaleeji, Hijazi, Najdi, Emirati, Egyptian, Yemeni, Maghrebi). When present, **prefer Munsit's wording** for any dialectal phrase, idiom, or pronunciation-as-spelled choice. It is the most accurate engine for Arabic dialect speech.
2. **Soniox (stt-async-v4)** — Lowest WER on Arabic generally. Use Soniox when Munsit is missing or when Soniox + Fanar agree against Munsit on a clearly non-dialectal word.
3. **Fanar-Aura-STT-1** — Arabic-native model, especially strong on Gulf vocabulary. Use as a tie-breaker.
4. **Azure Speech (ar-EG / ar-YE / ar-SA)** — Locale-tuned: trust it heavily for Egyptian and Yemeni audio in particular.
5. **Deepgram Nova-3** — Best for word boundaries, punctuation, and overall structure. Use Deepgram for sentence segmentation cues, but DO NOT prefer its wording over the Arabic-native engines.

Merging rules:
- Where engines agree, use the shared text.
- Where Munsit disagrees with the others on a dialectal word/phrase, prefer Munsit.
- Where Munsit is absent, prefer Soniox/Fanar over Deepgram.
- Use Deepgram's text only as a last resort or for word boundaries / spacing.
- Do NOT simply concatenate. Merge intelligently at the sentence/clause level.
- ALWAYS prefer the spoken/dialectal form over formal/MSA spelling. Write words as they are pronounced.
- Use ALL transcripts to ensure NO spoken content is missed — include every word that was said.

`
    : hasDualTranscripts
    ? `You are given TWO transcriptions of the same Gulf Arabic audio from different speech-to-text engines.
Compare them carefully and produce the BEST merged transcript:
- Where they agree, use the shared text.
- Where they differ, choose whichever version sounds more natural and accurate for Gulf Arabic dialect.
- Do NOT simply concatenate them. Merge intelligently at the sentence/clause level.
- ALWAYS prefer the spoken/dialectal form over formal/MSA spelling. Write words as they are pronounced.
- Use BOTH transcripts to ensure NO spoken content is missed — include every word that was said.

`
    : '';
  return `${strictPrefix}${multiInstructions}You are merging Gulf Arabic speech-to-text transcriptions for language learners.

Output ONLY valid JSON matching this schema:
{
  "lines": [{"arabic": string}],
  "dialect": "Saudi" | "Kuwaiti" | "UAE" | "Bahraini" | "Qatari" | "Omani" | "Gulf",
  "difficulty": "Beginner" | "Intermediate" | "Advanced" | "Expert"
}

DIALECT IDENTIFICATION RULES:
Identify the Gulf Arabic dialect based on vocabulary, phonology, and speech patterns. Use ONLY one of these exact string values:
- "Saudi": Najdi/Hijazi — "وش"/"إيش" (what), "الحين" (now), "يبي"/"يبغى" (want), "يسير" (go), Najdi "g" for ق, "عيال" (kids), "شلون" (how are you).
- "Kuwaiti": "شنو" (what), "هواية" (a lot), "چذي"/"چذا" (like this), distinctive "چ" for ك in some words, "يبه" (wow), "ليش" (why).
- "UAE": "شو" with Levantine influence, "عيل" (then/so), "الحين" (now), "يلا" very frequent, Emirati "گ" for ق in some words, "شويه" (a bit).
- "Bahraini": Hybrid "شو"/"شنو", "ب"-prefixed verbs (بيروح/بيجي), features shared with both Kuwaiti and Eastern Saudi.
- "Qatari": "ش"-prefix interrogative patterns, "هاي" (this), Bedouin vocabulary influence, intonation distinct from Kuwaiti.
- "Omani": "إيش"/"ايش" (what), "حق" (for/of), universal "j" for ج, "كيف" used as greeting response, Dhofari/Muscat variation.
- "Gulf": ONLY if genuinely ambiguous — cannot be attributed to a single country with confidence.

DIFFICULTY CLASSIFICATION RULES (CEFR-anchored, evidence-based):
Rate using THESE concrete signals from the FULL transcript, not vibes. Do NOT default to "Intermediate" when uncertain — pick the level whose signals best match.

- "Beginner" (CEFR A1–A2): Greetings, family, food, daily routine. Sentences are typically ≤6 words. ≥70% of tokens are very common everyday words (pronouns, "في/من/على/يعني/بس", basic verbs like "راح/يبي/شاف/قال"). No idioms or cultural references. Slow clear speech.
- "Intermediate" (CEFR B1–B2): Familiar but extended topics (work, travel, opinions, simple stories). Multi-clause sentences 7–12 words. Mix of common + less common vocabulary. Some idiomatic dialect markers ("الحين/يعني/بس/خلاص/زين/طيب"). Normal conversational pace. A FEW (1–3) idiomatic expressions or cultural references.
- "Advanced" (CEFR C1): Abstract / specialised topics, implicit meaning, dense vocabulary. Long flexible sentences with subordination. Heavy dialectal compression and frequent idioms. Fast natural speech with reductions. Cultural references that require background knowledge.
- "Expert" (CEFR C2): Native-level nuance — literature, poetry, technical jargon, very fast informal speech, dense slang, sarcasm, near-saturated idiom use.

OBJECTIVE CHECKS to apply before picking a level:
1. Count rough sentence length: average words per spoken line.
2. Estimate rare-word ratio: how many tokens are NOT in the A1/A2 daily core.
3. Count idiomatic / cultural expressions explicitly.
4. Estimate speech density: are clauses chained or atomic?
If signals conflict (e.g. short lines but very rare vocabulary, or long lines but mostly common words), pick the level the majority of signals support — never the middle "safe" choice.


KEY SIGNALS:
- What: شنو(KW/BH/QA) | وش/إيش(SA) | شو(UAE/BH) | إيش(OM)
- Want: يبي/يبغى(SA/KW) | يريد(MSA — avoid)
- Now: الحين(SA/UAE) | هلأ | الكيف(OM)
- How/fine: شلون(SA/KW) | كيف(OM/formal) | زين(universal Gulf = good)
- چ/گ consonant shifts → KW or UAE
- ب-prefix on future verbs → BH
- حق possessive → OM

CRITICAL RULES FOR SPLITTING:
1. MAXIMUM 12 words per line. If a sentence is longer, SPLIT IT at natural clause boundaries (و، ف، بس، يعني، لأن، عشان).
2. MINIMUM 3 words per line. Merge very short fragments with adjacent content.
3. Each line should be ONE complete thought or clause - typically 5-10 words.
4. Split aggressively at:
   - Punctuation: . ، ؟ ! ؛
   - Conjunctions that start new clauses: و (and), ف (so), بس (but), يعني (meaning)
   - Natural speech pauses or topic shifts
5. Include ALL content from the transcript. Do NOT skip, summarize, or omit ANY spoken content. Every word that was said must appear in the output.
6. CRITICAL — SPOKEN FORM ONLY: Write Arabic EXACTLY as it is pronounced/spoken, NOT with proper/standard Arabic spelling. Use dialectal/colloquial forms. Examples:
   - Write "هالشي" NOT "هذا الشيء"
   - Write "وش" NOT "ماذا"
   - Write "يبي" NOT "يريد"
   - Write "وين" NOT "أين"
   - Write "شلون" NOT "كيف"
   - Write "اللحين" or "الحين" NOT "الآن"
   - Keep contractions, slang, filler words (يعني، هيه، آه) exactly as spoken.
   - Do NOT correct grammar or normalize spelling to MSA/formal Arabic.

7. TASHKEEL / HARAKAT — REQUIRED (dialect-accurate, not MSA):
   Every Arabic word in lines[].arabic MUST be FULLY voweled with tashkeel that matches HOW THE SPEAKER ACTUALLY PRONOUNCES IT in ${dialectFamilyLabel()}, NOT the MSA standard.
   - Mark all of: fatha (◌َ), damma (◌ُ), kasra (◌ِ), sukun (◌ْ), shadda (◌ّ), tanwin (◌ً ◌ٌ ◌ٍ), and dagger alif (◌ٰ) where relevant.
   - Use the DIALECTAL vowel actually heard, never the MSA equivalent.
   - Drop case endings (إعراب) the speaker doesn't pronounce. Colloquial Arabic almost never voices final فتحة/ضمة/كسرة — leave them as sukun or omit if the speaker pauses.
   - Keep shadda on every geminated consonant the speaker actually doubles.
   - Do NOT overlay MSA vowels on a dialectal pronunciation (e.g. never write «قَالَ» over a spoken «گَال» / «چَال»).
   ${DIALECT_MODULE === 'Egyptian'
     ? `Egyptian examples:
     - Write «إِزَّايْ» (NOT «كَيْفَ»)
     - Write «عَايِز» (NOT «أُرِيدُ»)
     - Write «دِلْوَقْتِي» with the actual short vowels heard
     - Write «بِتْعَمِل» (NOT «تَفْعَلُ»)
     - Write «النَّهَارْدَه» exactly as pronounced
     - Preserve the Egyptian ج as ج (pronounced /g/) without re-voweling toward MSA.`
     : DIALECT_MODULE === 'Yemeni'
       ? `Yemeni examples:
     - Write «بَيْش» / «كَيْفَش» with the actual short vowel heard
     - Write «شِي» / «شَيّ» as pronounced (keep shadda when geminated)
     - Preserve characteristic Yemeni vowel qualities (e.g. final imala) rather than normalizing to MSA
     - Write «ذِي» / «ذَا» with the actual vowel heard, not MSA «هَذَا».`
       : `Gulf examples (Kuwaiti / Saudi / Emirati / Qatari / Bahraini / Omani):
     - Write «شِنُو» (NOT «شَنُو») — Kuwaiti
     - Write «وِشْ» (NOT «وَشْ») — Saudi
     - Write «چِذِي» (NOT «كَذَا») — Kuwaiti
     - Write «يَبْغَى» (NOT «يُرِيدُ») — Saudi/Najdi
     - Write «شْلُونَك» as actually pronounced
     - Preserve چ and گ with their dialectal vowels, never re-vowel toward MSA «كَ» / «قَ».`}

IMPORTANT: Output Arabic text ONLY — no "translation" field in this step.

EXAMPLE of good splitting:
Long: "رحت السوق وشريت خضار وفواكه وبعدين رجعت البيت وسويت غدا" (too long - 11 words)
Split into:
- "رحت السوق وشريت خضار وفواكه" (6 words)
- "وبعدين رجعت البيت وسويت غدا" (5 words)

No additional text outside JSON.`;
};

const getMetaSystemPrompt = (isRetry: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  return `${strictPrefix}You are processing ${dialectShortLabel()} transcript text for language learners.

Output ONLY valid JSON matching this schema:
{
  "vocabulary": [{"arabic": string, "english": string, "root"?: string}],
  "grammarPoints": [{"title": string, "explanation": string, "examples"?: string[]}],
  "culturalContext"?: string
}

Rules:
- Vocabulary: 5–8 useful words with English meaning and root when applicable.
- GrammarPoints: 2–4 dialect-specific points with brief examples from the transcript.
- Keep it concise.

No additional text outside JSON.`;
};

// ─── CALL 2 PROMPT ───────────────────────────────────────────────────────────
// Analysis and enrichment. Receives the clean merged transcript from Call 1.
// Produces per-line translations, vocabulary, and grammar points.
const getAnalysisSystemPrompt = (isRetry: boolean = false, dialect?: string, visualContext?: string, isMeme: boolean = false) => {
  const strictPrefix = strictJsonPrefix(isRetry);
  const label = dialectShortLabel();
  const dialectNote = DIALECT_MODULE !== 'Gulf'
    ? `\nThe audio is ${dialectFamilyLabel()}. Prioritise ${label}-specific vocabulary, grammar patterns, and cultural notes. NEVER use Gulf, Levantine, or other dialects.`
    : (dialect && dialect !== 'Gulf'
        ? `\nThe audio is ${dialect} Gulf Arabic dialect. Prioritise ${dialect}-specific vocabulary, grammar patterns, and cultural notes in your output.`
        : '\nThe audio is Gulf Arabic (Khaliji) dialect.');
  const memeNote = isMeme
    ? `\nThis is a meme. The on-screen text is a primary source of meaning and must drive the culturalContext. Use only the provided Arabic lines and the verified video context below. If the joke/context is unclear, say it is unclear instead of inventing relationships, locations, or slang.\nVerified video context:\n${visualContext || 'No verified on-screen text context was provided.'}`
    : '';
  return `${strictPrefix}You are analyzing a ${label} transcript for language learners. You are given a clean pre-merged transcript split into numbered Arabic lines.${dialectNote}${memeNote}

Output ONLY valid JSON matching this schema:
{
  "lines": [{"arabic": string, "translation": string}],
  "vocabulary": [{"arabic": string, "english": string, "root"?: string}],
  "grammarPoints": [{"title": string, "explanation": string, "examples"?: string[]}],
  "culturalContext"?: string
}

Rules:
- lines: IMPORTANT — the output "lines" array MUST include ALL numbered lines from the input. Every single line, no exceptions. Keep the Arabic text EXACTLY as given, INCLUDING every tashkeel/harakat mark (fatha, damma, kasra, sukun, shadda, tanwin, dagger alif). The input lines arrive already voweled with dialect-accurate tashkeel — preserve every diacritic exactly. Do NOT strip, normalize, add, or re-vowel toward MSA. Provide a natural English translation for each line.
- vocabulary: 5–8 useful ${label} words or phrases with English meaning and root when applicable.
- grammarPoints: 2–4 dialect-specific grammar points with brief examples from the transcript.
- culturalContext: Optional brief cultural note about the content. For memes, explicitly incorporate any on-screen text and do not infer unsupported context.
- Keep translations and explanations concise.

No additional text outside JSON.`;
};

// ─── VOCAB ENRICHMENT PROMPT ─────────────────────────────────────────────────
// Sent to Claude Sonnet after the full vocab assembly (Qwen + Fanar union).
// Claude enriches each item — it never replaces Qwen's output.
const getVocabEnrichmentSystemPrompt = () =>
  `You are enriching a Gulf Arabic vocabulary list for language learners.
For each vocabulary item provided, add Gulf-specific depth.

Output ONLY valid JSON matching this schema:
{
  "enrichments": [
    {
      "arabic": "<exact arabic word as given>",
      "culturalContext": "<cultural context specific to Gulf/Khaliji usage>",
      "idiomaticNuance": "<how the word is actually used vs its literal meaning>",
      "dialectNotes": "<how this differs from MSA or other Arabic dialects — omit if not meaningfully different>",
      "exampleSentence": { "arabic": "<natural Gulf Arabic sentence>", "english": "<translation>" }
    }
  ]
}

Rules:
- One enrichment object per vocabulary item, matched by the exact arabic field value
- Keep each field concise (1–2 sentences)
- dialectNotes: only include when the word genuinely differs from MSA usage
- Output ONLY valid JSON. No commentary outside JSON.`;

// ─── FANAR DIALECT VALIDATION PROMPT ────────────────────────────────────────
// Sent to Fanar-C-2-27B after merge, in parallel with translation.
// Templated by DIALECT_MODULE: Egyptian and Yemeni transcripts must be judged
// against their own dialect norms, not Gulf ones. The result is persisted in
// engines_used.dialect_signals for the admin review flow.
const getFanarValidationSystemPrompt = () => {
  const { arabicName, contextName } =
    DIALECT_MODULE === 'Egyptian'
      ? { arabicName: 'اللهجة المصرية', contextName: 'المصري' }
      : DIALECT_MODULE === 'Yemeni'
        ? { arabicName: 'اللهجة اليمنية', contextName: 'اليمني' }
        : { arabicName: 'اللهجة الخليجية', contextName: 'الخليجي' };
  return `أنت خبير في ${arabicName}. راجع هذا النص المنقول وحدد أي مشاكل في:
- كلمات تبدو مُحوَّلة إلى الفصحى بدلاً من ${arabicName} المحكية (النوع: msa)
- كلمات أو عبارات تبدو مكتوبة بشكل غير صحيح أو مُحرَّفة (النوع: spelling)
- كلمات من لهجة عربية أخرى لا تنتمي إلى ${arabicName} (النوع: foreign_dialect)
- محتوى لا يتوافق ثقافياً مع السياق ${contextName} (النوع: cultural)

أخرج JSON صالحاً فقط، بدون أي نص خارج JSON، بهذه الصيغة:
{
  "issues": [
    { "line": 3, "word": "الكلمة", "kind": "msa", "severity": "low", "note": "شرح موجز" }
  ]
}

"line" رقم السطر (يبدأ من 1)، و"kind" واحدة من: msa | spelling | foreign_dialect | cultural،
و"severity" إما "low" أو "high" — استخدم "high" فقط لما يغيّر المعنى أو يجعل النص غير أصيل.
إذا لم تجد أي مشاكل، أخرج {"issues": []}. يمكن كتابة "note" بالعربية أو الإنجليزية.`;
};

// ─── FANAR VALIDATION RESPONSE ──────────────────────────────────────────────
// `flagged` used to be `content.length > 300` — a proxy for "found problems"
// that mis-fires both ways: a chatty clean pass flags, a terse real complaint
// doesn't. Asking for JSON lets the bit be driven by an actual issue count and
// lets the admin banner render a list instead of a truncated wall of text.
// ─── GLOSS ENRICHMENT PROMPT ─────────────────────────────────────────────────
// Generates per-word English translations for EVERY unique Arabic token.
// This is the critical step that was missing — previously only 5-8 vocab items
// and a small dictionary provided glosses, leaving 60-75% of tokens unglossed.
const getGlossEnrichmentPrompt = (dialect?: string) => {
  const label = dialectShortLabel();
  const dialectNote = DIALECT_MODULE !== 'Gulf'
    ? `The text is ${dialectFamilyLabel()}.`
    : (dialect && dialect !== 'Gulf'
        ? `The text is ${dialect} Gulf Arabic dialect.`
        : 'The text is Gulf Arabic (Khaliji) dialect.');
  return `You are a ${label} lexicographer. ${dialectNote}

Given a list of unique Arabic words from a transcript, provide the English meaning of EACH word.

Output ONLY valid JSON matching this schema:
{
  "glosses": {
    "arabicWord": "english meaning (1-4 words)"
  }
}

Rules:
- Translate EVERY word in the list. Do not skip any.
- For particles/prepositions (و، في، من، على), give their function word meaning.
- For verbs, give the contextual meaning (e.g. "went", "says", "wants").
- For dialect-specific words, give the dialectal meaning, not the MSA meaning.
- Keep meanings concise: 1-4 English words maximum.
- If a word is a proper noun or untranslatable, write "proper noun" or "filler word".
- Common compounds: if two adjacent words form a fixed phrase, include the compound as a separate key AND still gloss each word individually.

No additional text outside JSON.`;
};

// ─── TRANSLATION PROMPT ──────────────────────────────────────────────────────
// Used by Gemini 2.5 Flash (primary) and Qwen (fallback).
// Receives the numbered merged transcript produced by Call 1.
// Produces ONLY per-line translations — no vocabulary, no grammar.
const getTranslationSystemPrompt = (dialect?: string, visualContext?: string, sonioxTranslation?: string) => {
  const label = dialectShortLabel();
  const dialectNote = DIALECT_MODULE !== 'Gulf'
    ? `${getDialectNote(dialect)} Reflect ${label}-specific vocabulary and expressions in your translations.`
    : (dialect && dialect !== 'Gulf'
        ? `${getDialectNote(dialect)} Reflect regional vocabulary and expressions in your translations where appropriate.`
        : getDialectNote(undefined));
  const visualNote = visualContext
    ? `\n\nVideo context: ${visualContext}\nUse this context to improve translation accuracy and naturalness where relevant.`
    : '';
  const sonioxNote = sonioxTranslation
    ? `\n\nReference translation (Soniox ASR+Translation engine):\n${sonioxTranslation}\nThis machine translation is provided as a reference only. Use it to inform your translations but prioritize accuracy and natural English phrasing.`
    : '';
  return `You are a ${label} translator specializing in the ${label} dialect.${dialectNote}${visualNote}${sonioxNote}
You will be given numbered Arabic lines. For each line produce BOTH a natural English translation and a literal word-for-word gloss.

Output ONLY valid JSON matching this schema:
{"translations": ["Natural English for line 1", ...], "literals": ["Word-for-word gloss for line 1", ...]}

Rules:
- Both arrays must have exactly the same number of items as there are numbered lines, aligned by index.
- Translations should be natural and idiomatic, not word-for-word.
- Literals are a close word-for-word English gloss preserving the Arabic word order (e.g. "what news-your?" for "شخبارك؟"). They may sound stiff or ungrammatical — that is expected; they show learners how the sentence is built.
- Preserve the tone and meaning of Gulf Arabic dialect.
- Keep each translation concise.

No additional text outside JSON.`;
};

// Returned by the dedicated translation call (one per ensemble model)
type TranslationAI = { translations: string[]; literals?: string[] };

// ============================================================================
// TRANSLATION ENSEMBLE — Gemini + Claude (weight 1.0) + Qwen (weight 0.5)
// All three run in parallel; per-line winner is chosen by weighted vote with
// Jaccard token-overlap clustering. Gemini+Claude agreement always wins.
// ============================================================================
type EnsembleCandidate = {
  name: string;
  via: string;
  weight: number;
  translations: string[];
  literals: string[];
  status: 'ok' | 'failed' | 'parse_failed' | 'empty';
  latencyMs: number;
  chars: number;
  error?: string;
};

type EnsembleLineResult = {
  translation: string;
  literal: string;
  needs_review: boolean;
  winner_models: string[];
  /**
   * The candidates that actually produced text for this line. Retained so the
   * Shaheen tiebreak can arbitrate *between* them instead of only filling
   * blanks — without it, a disputed line's alternatives are gone by the time
   * the arbiter's rendering arrives.
   */
  candidates: ArbiterCandidate[];
};

/**
 * Merge candidate translations for ONE line using weighted clustering.
 * Returns the chosen translation, a needs_review flag, and which models won.
 */
function mergeOneLine(
  candidates: Array<{ name: string; weight: number; text: string; literal: string }>,
): EnsembleLineResult {
  const present = candidates.filter((c) => c.text && c.text.trim().length > 0);
  if (present.length === 0) {
    return { translation: '', literal: '', needs_review: true, winner_models: [], candidates: [] };
  }
  if (present.length === 1) {
    return {
      translation: present[0].text.trim(),
      literal: (present[0].literal ?? '').trim(),
      needs_review: present[0].weight < 1.0, // a single low-weight verifier is uncertain
      winner_models: [present[0].name],
      candidates: present,
    };
  }

  // Cluster by Jaccard >= 0.6
  const clusters: Array<{ members: typeof present; weight: number }> = [];
  for (const cand of present) {
    let added = false;
    for (const cluster of clusters) {
      const repr = cluster.members[0].text;
      if (jaccard(repr, cand.text) >= 0.6) {
        cluster.members.push(cand);
        cluster.weight += cand.weight;
        added = true;
        break;
      }
    }
    if (!added) clusters.push({ members: [cand], weight: cand.weight });
  }

  // Sort by weight desc
  clusters.sort((a, b) => b.weight - a.weight);
  const top = clusters[0];

  // Gemini + Claude agreement (cluster contains both) → always wins
  const hasGemini = (c: typeof top) => c.members.some((m) => m.name.includes('gemini'));
  const hasClaude = (c: typeof top) => c.members.some((m) => m.name.includes('claude'));
  const geminiClaudeCluster = clusters.find((c) => hasGemini(c) && hasClaude(c));
  if (geminiClaudeCluster) {
    // Pick the longest (most detailed) translation in that cluster
    const winner = geminiClaudeCluster.members
      .slice()
      .sort((a, b) => b.text.length - a.text.length)[0];
    return {
      translation: winner.text.trim(),
      literal: (winner.literal ?? '').trim(),
      needs_review: false,
      winner_models: geminiClaudeCluster.members.map((m) => m.name),
      candidates: present,
    };
  }

  // Otherwise: top cluster wins if its weight >= 1.5 (e.g. one peer + Qwen)
  if (top.weight >= 1.5) {
    const winner = top.members.slice().sort((a, b) => b.text.length - a.text.length)[0];
    return {
      translation: winner.text.trim(),
      literal: (winner.literal ?? '').trim(),
      needs_review: false,
      winner_models: top.members.map((m) => m.name),
      candidates: present,
    };
  }

  // Full disagreement (each model in its own cluster) → Claude > Gemini > Qwen by default
  const claude = present.find((c) => c.name.includes('claude'));
  const gemini = present.find((c) => c.name.includes('gemini'));
  const fallback = claude ?? gemini ?? present[0];
  return {
    translation: fallback.text.trim(),
    literal: (fallback.literal ?? '').trim(),
    needs_review: true,
    winner_models: [fallback.name],
    candidates: present,
  };
}

/**
 * Merge an array of candidate translation sets into a final per-line result.
 * Each candidate provides translations[] aligned to the same input line indices.
 */
function mergeTranslationEnsemble(
  candidates: EnsembleCandidate[],
  lineCount: number,
): { lines: EnsembleLineResult[]; agreements: { all_three: number; gemini_claude: number; needs_review: number }; perModelWins: Record<string, number> } {
  const okCands = candidates.filter((c) => c.status === 'ok' && c.translations.length > 0);
  const lines: EnsembleLineResult[] = [];
  const perModelWins: Record<string, number> = {};
  let all_three = 0;
  let gemini_claude = 0;
  let needs_review = 0;

  for (let i = 0; i < lineCount; i++) {
    const lineCands = okCands.map((c) => ({
      name: c.name,
      weight: c.weight,
      text: c.translations[i] ?? '',
      literal: c.literals[i] ?? '',
    }));
    const res = mergeOneLine(lineCands);
    lines.push(res);
    if (res.needs_review) needs_review++;
    const hasG = res.winner_models.some((n) => n.includes('gemini'));
    const hasC = res.winner_models.some((n) => n.includes('claude'));
    const hasQ = res.winner_models.some((n) => n.includes('qwen'));
    if (hasG && hasC && hasQ) all_three++;
    else if (hasG && hasC) gemini_claude++;
    for (const m of res.winner_models) perModelWins[m] = (perModelWins[m] ?? 0) + 1;
  }
  return { lines, agreements: { all_three, gemini_claude, needs_review }, perModelWins };
}

async function callTranslationModel(opts: {
  name: string;
  via: 'lovable' | 'openrouter';
  weight: number;
  model: string;
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  maxTokens: number;
}): Promise<EnsembleCandidate> {
  const t0 = Date.now();
  try {
    const resp = await callAI({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      userContent: opts.userContent,
      apiKey: opts.apiKey,
      gateway: opts.via,
      maxTokens: opts.maxTokens,
    });
    const latencyMs = Date.now() - t0;
    if (!resp.content) {
      return { name: opts.name, via: opts.via, weight: opts.weight, translations: [], literals: [], status: 'failed', latencyMs, chars: 0, error: resp.error };
    }
    const parsed = safeJsonParse<TranslationAI>(resp.content);
    if (!parsed?.translations?.length) {
      return { name: opts.name, via: opts.via, weight: opts.weight, translations: [], literals: [], status: 'parse_failed', latencyMs, chars: resp.content.length };
    }
    return {
      name: opts.name,
      via: opts.via,
      weight: opts.weight,
      translations: parsed.translations.map((t) => (typeof t === 'string' ? t : '')),
      literals: Array.isArray(parsed.literals)
        ? parsed.literals.map((l) => (typeof l === 'string' ? l : ''))
        : [],
      status: 'ok',
      latencyMs,
      chars: parsed.translations.join('').length,
    };
  } catch (e) {
    return {
      name: opts.name,
      via: opts.via,
      weight: opts.weight,
      translations: [],
      literals: [],
      status: 'failed',
      latencyMs: Date.now() - t0,
      chars: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// FUSHA PASS — dialect → Modern Standard Arabic, one line at a time.
//
// Deliberately its own call rather than a fourth array on the translation
// prompt. The ensemble clusters candidates by English token overlap to pick a
// winner, and a Fusha rendering has no bearing on which English translation is
// right — folding it in would make the three models' Arabic hostage to a vote
// about their English. It is also the field most likely to come back missing
// or misaligned, and a separate call means that failure costs the transcript
// one optional row instead of its translations.
// ============================================================================
type FushaOutcome = {
  lines: string[];
  model: string | null;
  status: 'ok' | 'failed' | 'parse_failed';
  latencyMs: number;
  /** How many lines actually came back with Arabic in them. */
  filled: number;
};

/**
 * Convert the merged dialect lines to Fusha, trying one model then a fallback.
 *
 * Never throws and never blocks: a transcript with no Fusha is a transcript
 * that renders exactly as it did before this feature existed.
 */
async function runFushaPass(opts: {
  numberedLines: string;
  lineCount: number;
  dialectLabel: string;
  apiKey: string;
}): Promise<FushaOutcome> {
  const t0 = Date.now();
  const systemPrompt = buildFushaSystemPrompt(opts.dialectLabel);
  // Claude first (strongest Arabic morphology of the pair), Gemini as fallback.
  const attempts: Array<{ model: string; gateway: 'openrouter' | 'lovable' }> = [
    { model: MODEL_IDS.CLAUDE, gateway: 'openrouter' },
    { model: MODEL_IDS.GEMINI_FLASH, gateway: 'lovable' },
  ];

  let lastStatus: FushaOutcome['status'] = 'failed';
  for (const attempt of attempts) {
    try {
      const resp = await callAI({
        model: attempt.model,
        gateway: attempt.gateway,
        systemPrompt,
        userContent: opts.numberedLines,
        apiKey: opts.apiKey,
        maxTokens: 16384,
      });
      if (!resp.content) {
        lastStatus = 'failed';
        console.warn(`[fusha] ${attempt.model} returned nothing: ${resp.error?.slice(0, 120) ?? 'no error'}`);
        continue;
      }
      const parsed = safeJsonParse<{ fusha?: unknown }>(resp.content);
      const lines = alignFushaLines(parsed, opts.lineCount);
      const filled = lines.filter((l) => l.length > 0).length;
      if (filled === 0) {
        lastStatus = 'parse_failed';
        console.warn(`[fusha] ${attempt.model} produced no usable Arabic across ${opts.lineCount} lines`);
        continue;
      }
      return { lines, model: attempt.model, status: 'ok', latencyMs: Date.now() - t0, filled };
    } catch (e) {
      lastStatus = 'failed';
      console.warn(`[fusha] ${attempt.model} threw:`, e instanceof Error ? e.message : String(e));
    }
  }

  return {
    lines: new Array(opts.lineCount).fill(''),
    model: null,
    status: lastStatus,
    latencyMs: Date.now() - t0,
    filled: 0,
  };
}

// Returned by Call 1 (merge only — no translations)
type MergeOnlyAI = {
  lines: Array<{ arabic: string }>;
  dialect?: 'Saudi' | 'Kuwaiti' | 'UAE' | 'Bahraini' | 'Qatari' | 'Omani' | 'Gulf';
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
};
 
type CallAIArgs = {
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  isRetry?: boolean;
  maxTokens?: number;
  model?: string; // defaults to 'qwen/qwen3-235b-a22b'
  gateway?: 'openrouter' | 'lovable'; // defaults to 'openrouter'
};

async function callAI({
  systemPrompt,
  userContent,
  apiKey,
  isRetry = false,
  maxTokens = 4096,
  model = 'qwen/qwen3-235b-a22b',
  gateway = 'openrouter',
}: CallAIArgs): Promise<{ content: string | null; error?: string; status?: number }> {
    const isLovable = gateway === 'lovable';
    const gatewayUrl = isLovable
      ? 'https://ai.gateway.lovable.dev/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const gatewayKey = isLovable ? (Deno.env.get('LOVABLE_API_KEY') ?? '') : apiKey;

    const controller = new AbortController();
    // Tightened from 55s → 40s so the full multi-stage pipeline (Call 1 + parallel
    // Call 2 stage + possible retries) fits within the edge runtime's 150s idle
    // timeout. Slow models will be aborted and fall back to alternates.
    const timeoutMs = 40_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(gatewayUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${gatewayKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      console.error('AI fetch failed:', { isRetry, elapsedMs, isAbort, error: String(e) });
      return {
        content: null,
        error: isAbort ? `AI request timed out after ${timeoutMs}ms` : String(e),
        status: isAbort ? 504 : 500,
      };
    } finally {
      clearTimeout(timeout);
    }

    const elapsedMs = Date.now() - startedAt;
    console.log('AI gateway response:', { status: response.status, ok: response.ok, isRetry, elapsedMs });
 
   if (!response.ok) {
     const errorText = await response.text();
     console.error('AI gateway error body (first 800 chars):', errorText?.slice?.(0, 800) ?? errorText);
     return { content: null, error: errorText, status: response.status };
   }
 
   // Safely read and parse the response body
   let responseText: string;
   try {
     responseText = await response.text();
   } catch (e) {
     console.error('Failed to read response body:', e);
     return { content: null, error: 'Failed to read AI response body', status: 500 };
   }
   
   if (!responseText || responseText.trim().length === 0) {
     console.error('AI gateway returned empty response body');
     return { content: null, error: 'AI returned empty response', status: 500 };
   }
   
   let data;
   try {
     data = JSON.parse(responseText);
   } catch (e) {
     console.error('Failed to parse AI response JSON:', e);
     console.error('Response text (first 500 chars):', responseText.slice(0, 500));
     return { content: null, error: 'Failed to parse AI response as JSON', status: 500 };
   }
   
   const content = data.choices?.[0]?.message?.content;
    return { content };
 }
 
type CallFanarArgs = {
  systemPrompt: string;
  userContent: string;
  apiKey: string;
  model?: string; // e.g. 'Fanar-C-2-27B' (default). Do NOT use 'Fanar-Sadiq' — Islamic RAG model.
  maxTokens?: number;
  temperature?: number;
};

async function callFanar({
  systemPrompt,
  userContent,
  apiKey,
  // Pin the concrete generation instead of the bare 'Fanar' alias: the alias
  // silently tracks whatever QCRI points it at (today Fanar-C-1-8.7B, 4k ctx).
  // Fanar-C-2-27B gives 32k context — required for whole-transcript merges.
  model = 'Fanar-C-2-27B',
  maxTokens = 4096,
  temperature = 0.2,
}: CallFanarArgs): Promise<{ content: string | null; error?: string; status?: number }> {
  const controller = new AbortController();
  // Fanar is known to be intermittently slow/unstable — keep its timeout short so
  // it can't single-handedly stall the parallel stage past the 150s edge budget.
  const timeoutMs = 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch('https://api.fanar.qa/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    console.error('Fanar fetch failed:', { model, elapsedMs, isAbort, error: String(e) });
    return {
      content: null,
      error: isAbort ? `Fanar request timed out after ${timeoutMs}ms` : String(e),
      status: isAbort ? 504 : 500,
    };
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('Fanar response:', { model, status: response.status, ok: response.ok, elapsedMs });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Fanar error body (first 800 chars):', errorText?.slice?.(0, 800) ?? errorText);
    return { content: null, error: errorText, status: response.status };
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (e) {
    console.error('Failed to read Fanar response body:', e);
    return { content: null, error: 'Failed to read Fanar response body', status: 500 };
  }

  if (!responseText || responseText.trim().length === 0) {
    console.error('Fanar returned empty response body');
    return { content: null, error: 'Fanar returned empty response', status: 500 };
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('Failed to parse Fanar response JSON:', e);
    return { content: null, error: 'Failed to parse Fanar response as JSON', status: 500 };
  }

  const content = data.choices?.[0]?.message?.content;
  return { content };
}

// ─── FANAR SHAHEEN-MT — dedicated AR→EN translation model ───────────────────
// Used only as a tiebreak on lines where the 3-way LLM ensemble disagreed or
// came back empty. One batched call per transcript (quota is 20/day), metered
// through the fanar_usage table under endpoint 'mt'.
// Fanar's documented free-tier cap for Fanar-Shaheen-MT-1 is 20/day. Default to
// 16 for headroom, overridable if the account's quota is higher. Note this is a
// budget of *calls*, not videos: the per-line fallback below can spend several
// on one video, and at the default a busy day silently loses the tiebreak.
const SHAHEEN_MT_DAILY_LIMIT = Math.max(
  1,
  Number(Deno.env.get('SHAHEEN_MT_DAILY_LIMIT')) || 16,
);
// Cap on per-line requests for one video. Each costs a budget slot, so keep it
// small — the disputed lines are ranked by the ensemble, so the first few are
// the ones most worth arbitrating.
const SHAHEEN_MT_MAX_PER_LINE = 4;

type ShaheenSkipReason =
  | 'no_api_key'
  | 'budget_exhausted'
  | 'http_error'
  | 'timeout'
  | 'network_error';

interface ShaheenOutcome {
  /** True once a request has actually been issued to Fanar. */
  attempted: boolean;
  /** Aligned 1:1 with the input lines; individual entries may be null. */
  translations: (string | null)[] | null;
  skipReason?: ShaheenSkipReason;
  httpStatus?: number;
  /** Calls already logged against today's budget when this run started. */
  budgetUsed?: number;
  /** How the request was issued. One line goes as itself; several go per line. */
  strategy?: 'single' | 'per_line';
}

/** One request to the MT endpoint. Shared by the batch call and the per-line retries. */
async function shaheenFetch(
  text: string,
  apiKey: string,
): Promise<
  | { ok: true; text: string }
  | { ok: false; skipReason: ShaheenSkipReason; httpStatus?: number }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch('https://api.fanar.qa/v1/translations', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Fanar-Shaheen-MT-1',
        text,
        langpair: 'ar-en',
        preprocessing: 'preserve_whitespace',
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Shaheen-MT error ${response.status}:`, errText.slice(0, 300));
      return { ok: false, skipReason: 'http_error', httpStatus: response.status };
    }
    const data = await response.json();
    return { ok: true, text: String(data.text ?? '') };
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    console.warn('Shaheen-MT fetch failed:', isAbort ? 'timeout after 30s' : String(e));
    return { ok: false, skipReason: isAbort ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Translate disputed lines with Fanar-Shaheen-MT-1.
 *
 * Returns an outcome rather than `string[] | null` so the caller can record
 * *why* nothing came back. Every failure here used to collapse into the same
 * `called:false` as "never invoked", which made a genuinely-attempted tiebreak
 * indistinguishable from a missing API key in `engines_used.translation`.
 */
async function callShaheenTranslate(
  lines: string[],
  apiKey: string,
): Promise<ShaheenOutcome> {
  if (lines.length === 0) return { attempted: false, translations: null };

  // Budget check + usage log via the fanar_usage table (endpoint 'mt').
  // Metering failures are non-fatal — worst case we drift toward the API's
  // own 20/day limit, which just makes this call 429 and get skipped.
  let svc: ReturnType<typeof createClient> | null = null;
  let budgetUsed = 0;
  try {
    svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await svc
      .from('fanar_usage')
      .select('*', { count: 'exact', head: true })
      .eq('endpoint', 'mt')
      .gte('created_at', `${today}T00:00:00Z`);
    budgetUsed = count ?? 0;
    if (budgetUsed >= SHAHEEN_MT_DAILY_LIMIT) {
      console.log(`Shaheen-MT: daily budget exhausted (${budgetUsed}/${SHAHEEN_MT_DAILY_LIMIT}) — skipping`);
      return { attempted: false, translations: null, skipReason: 'budget_exhausted', budgetUsed };
    }
  } catch (e) {
    console.warn('Shaheen-MT: budget check failed (continuing):', e instanceof Error ? e.message : String(e));
  }

  // The client carries no schema types here, so the insert row would infer
  // as `never` — narrow the table handle to just the insert we need.
  const usageTable = svc?.from('fanar_usage') as unknown as
    { insert: (row: Record<string, unknown>) => PromiseLike<unknown> } | undefined;
  const meter = () => {
    usageTable?.insert({ endpoint: 'mt' }).then(
      () => {},
      (e: unknown) => console.warn('Shaheen-MT: usage log failed:', String(e)),
    );
  };

  // One line is the only case the endpoint handles natively: `POST
  // /v1/translations` takes one blob of text and returns one translation.
  if (lines.length === 1) {
    const single = await shaheenFetch(lines[0], apiKey);
    if (!single.ok) {
      return {
        attempted: true,
        translations: null,
        skipReason: single.skipReason,
        httpStatus: single.httpStatus,
        budgetUsed,
      };
    }
    meter();
    budgetUsed += 1;
    const text = single.text.replace(/\s+/g, ' ').trim();
    return {
      attempted: true,
      translations: text ? [text] : null,
      strategy: 'single',
      budgetUsed,
    };
  }

  // More than one line goes straight to per-line requests.
  //
  // The batch call this replaces sent N newline-separated lines and hoped for N
  // back. It never once delivered them: `preprocessing: preserve_whitespace`
  // does not make the endpoint treat newlines as record separators, so every
  // run logged `line_count_mismatch (sent N, got 1)`, fell back to per-line, and
  // succeeded there. That cost one wasted call and one 30s round-trip on every
  // video, against a documented free-tier budget of 20 calls a day.
  const budget = Math.min(
    lines.length,
    SHAHEEN_MT_MAX_PER_LINE,
    Math.max(0, SHAHEEN_MT_DAILY_LIMIT - budgetUsed),
  );
  if (budget === 0) {
    return {
      attempted: false, translations: null,
      skipReason: 'budget_exhausted', budgetUsed,
    };
  }

  const out: (string | null)[] = new Array(lines.length).fill(null);
  let lastFailure: { skipReason: ShaheenSkipReason; httpStatus?: number } | null = null;
  for (let i = 0; i < budget; i++) {
    const single = await shaheenFetch(lines[i], apiKey);
    if (!single.ok) { lastFailure = single; break; }
    meter();
    budgetUsed += 1;
    const text = single.text.replace(/\s+/g, ' ').trim();
    if (text) out[i] = text;
  }
  const filled = out.filter(Boolean).length;
  console.log(
    `Shaheen-MT: per-line translated ${filled}/${lines.length} disputed lines ` +
    `(budget allowed ${budget})`,
  );
  return {
    attempted: true,
    translations: filled > 0 ? out : null,
    strategy: 'per_line',
    ...(filled === 0 && lastFailure
      ? { skipReason: lastFailure.skipReason, httpStatus: lastFailure.httpStatus }
      : {}),
    budgetUsed,
  };
}

function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function safeJsonParse<T>(content: string): T | null {
  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch {
    console.error('JSON parse error for content:', content.slice(0, 500));
    return null;
  }
}

// Create a simple fallback result when AI parsing fails
function createFallbackResult(transcript: string): TranscriptResult {
  // Split by common Arabic sentence endings and newlines
  const sentences = transcript
    .split(/[.،؟!؛\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const lines: TranscriptLine[] = sentences.map((sentence, index) => ({
    id: `line-${generateId()}-${index}`,
    arabic: sentence,
    translation: '',
    tokens: sentence.split(/\s+/).filter(Boolean).map((word, wordIndex) => ({
      id: `token-${generateId()}-${index}-${wordIndex}`,
      surface: word,
    })),
  }));

  return {
    rawTranscriptArabic: transcript,
    lines,
    vocabulary: [],
    grammarPoints: [],
  };
}

// Common Arabic particles/words that AI often skips - fallback dictionary
const COMMON_GLOSSES: Record<string, string> = {
  // Conjunctions & particles
  'و': 'and',
  'أو': 'or',
  'ولا': 'or/nor',
  'بس': 'but/only',
  'لكن': 'but',
  'يعني': 'meaning/like',
  'عشان': 'because/for',
  'لأن': 'because',
  'إذا': 'if',
  'لو': 'if',
  'لما': 'when',
  'بعدين': 'then/after',
  'وبعدين': 'and then',
  'ف': 'so',
  'فـ': 'so',
  // Prepositions
  'في': 'in',
  'من': 'from',
  'على': 'on',
  'إلى': 'to',
  'لـ': 'to/for',
  'ل': 'to/for',
  'مع': 'with',
  'عن': 'about',
  'بـ': 'with/by',
  'ب': 'with/by',
  // Pronouns
  'أنا': 'I',
  'انا': 'I',
  'إنت': 'you',
  'انت': 'you',
  'أنت': 'you',
  'إنتي': 'you (f)',
  'انتي': 'you (f)',
  'هو': 'he',
  'هي': 'she',
  'إحنا': 'we',
  'احنا': 'we',
  'نحن': 'we',
  'هم': 'they',
  'إنتو': 'you (pl)',
  'انتو': 'you (pl)',
  // Demonstratives
  'هذا': 'this',
  'هاذا': 'this',
  'هذي': 'this (f)',
  'هاذي': 'this (f)',
  'ذا': 'this',
  'ذي': 'this (f)',
  'هذاك': 'that',
  'ذاك': 'that',
  'هذيك': 'that (f)',
  'ذيك': 'that (f)',
  // Question words
  'شو': 'what',
  'وش': 'what',
  'ايش': 'what',
  'إيش': 'what',
  'ليش': 'why',
  'ليه': 'why',
  'وين': 'where',
  'كيف': 'how',
  'شلون': 'how',
  'متى': 'when',
  'مين': 'who',
  'منو': 'who',
  'كم': 'how many',
  // Common words
  'الحين': 'now',
  'اليوم': 'today',
  'أمس': 'yesterday',
  'بكرة': 'tomorrow',
  'بكره': 'tomorrow',
  'كل': 'all/every',
  'كثير': 'much/many',
  'واجد': 'much/many',
  'شوي': 'a little',
  'شوية': 'a little',
  'زين': 'good/ok',
  'طيب': 'ok/good',
  'تمام': 'ok/perfect',
  'أوكي': 'ok',
  'لا': 'no/not',
  'نعم': 'yes',
  'إي': 'yes',
  'اي': 'yes',
  'إيه': 'yes',
  'ايه': 'yes',
  'ما': 'not/what',
  'مو': 'not',
  'مب': 'not',
  'مش': 'not',
  'هناك': 'there',
  'هنا': 'here',
  'فيه': 'there is',
  'فيها': 'in it/there is',
  'اللي': 'which/that',
  'الي': 'which/that',
  'يلا': 'let\'s go',
  'خلاص': 'done/enough',
  'بعد': 'also/after',
  // Common verbs
  'كان': 'was',
  'يكون': 'to be',
  'عنده': 'he has',
  'عندي': 'I have',
  'عندك': 'you have',
  'أبي': 'I want',
  'ابي': 'I want',
  'يبي': 'he wants',
  'تبي': 'you want',
  'راح': 'went/will',
  'بيـ': 'will',
  'قال': 'said',
  'يقول': 'says',
};

// Strip punctuation from edges of a word for lookup
function stripPunctuation(word: string): string {
  return word.replace(/^[،؟.!:؛…\-—–"'()[\]{}«»]+|[،؟.!:؛…\-—–"'()[\]{}«»]+$/g, '');
}

// Check if a word is purely punctuation
function isPunctuation(word: string): boolean {
  return /^[،؟.!:؛…\-—–"'()[\]{}«»]+$/.test(word);
}

function toWordTokens(
  arabic: string,
  vocabulary: VocabItem[],
  wordGlosses: Record<string, string> = {}
): WordToken[] {
  // Build maps - both original and stripped versions for fuzzy matching
  const vocabMap = new Map(vocabulary.map((v) => [v.arabic, v.english] as const));
  const vocabMapStripped = new Map(vocabulary.map((v) => [stripDiacritics(v.arabic), v.english] as const));
  
  // Also create stripped version of wordGlosses
  const wordGlossesStripped: Record<string, string> = {};
  for (const [k, v] of Object.entries(wordGlosses)) {
    wordGlossesStripped[stripDiacritics(k)] = v;
  }

  // Helper: lookup a single word in all dictionaries (with punctuation stripping)
  function lookupSingle(surface: string): string | undefined {
    const stripped = stripDiacritics(surface);
    const noPunct = stripPunctuation(surface);
    const noPunctStripped = stripDiacritics(noPunct);
    return (
      vocabMap.get(surface) ??
      wordGlosses[surface] ??
      vocabMapStripped.get(stripped) ??
      wordGlossesStripped[stripped] ??
      // Try without punctuation
      vocabMap.get(noPunct) ??
      wordGlosses[noPunct] ??
      vocabMapStripped.get(noPunctStripped) ??
      wordGlossesStripped[noPunctStripped] ??
      COMMON_GLOSSES[surface] ??
      COMMON_GLOSSES[stripped] ??
      COMMON_GLOSSES[noPunct] ??
      COMMON_GLOSSES[noPunctStripped]
    );
  }

  // Helper: lookup a bigram (two consecutive words joined by space) in glosses/vocab
  function lookupBigram(w1: string, w2: string): string | undefined {
    const bigram = `${w1} ${w2}`;
    const strippedBigram = `${stripDiacritics(w1)} ${stripDiacritics(w2)}`;
    const noPunctBigram = `${stripPunctuation(w1)} ${stripPunctuation(w2)}`;
    return (
      vocabMap.get(bigram) ??
      wordGlosses[bigram] ??
      vocabMapStripped.get(strippedBigram) ??
      wordGlossesStripped[strippedBigram] ??
      wordGlosses[noPunctBigram] ??
      wordGlossesStripped[stripDiacritics(noPunctBigram)]
    );
  }

  // Helper: lookup a trigram (three consecutive words) in glosses/vocab
  function lookupTrigram(w1: string, w2: string, w3: string): string | undefined {
    const trigram = `${w1} ${w2} ${w3}`;
    const strippedTrigram = `${stripDiacritics(w1)} ${stripDiacritics(w2)} ${stripDiacritics(w3)}`;
    return (
      vocabMap.get(trigram) ??
      wordGlosses[trigram] ??
      vocabMapStripped.get(strippedTrigram) ??
      wordGlossesStripped[strippedTrigram]
    );
  }

  const words = arabic.split(/\s+/).filter(Boolean);
  const tokens: WordToken[] = [];
  let i = 0;

  while (i < words.length) {
    const surface = words[i];

    // Skip punctuation-only tokens — still include them but mark as punctuation
    if (isPunctuation(surface)) {
      tokens.push({
        id: `tok-${generateId()}-${i}`,
        surface,
        gloss: undefined, // punctuation doesn't need a gloss
      });
      i++;
      continue;
    }

    // Try trigram first (current word + next two words)
    if (i + 2 < words.length) {
      const trigramGloss = lookupTrigram(surface, words[i + 1], words[i + 2]);
      if (trigramGloss) {
        // Emit first word with the compound gloss
        tokens.push({
          id: `tok-${generateId()}-${i}`,
          surface,
          gloss: trigramGloss,
        });
        // Emit second and third words with compoundRef (NOT in gloss field)
        // Each still gets its own individual gloss
        tokens.push({
          id: `tok-${generateId()}-${i + 1}`,
          surface: words[i + 1],
          gloss: lookupSingle(words[i + 1]),
          compoundRef: surface,
        });
        tokens.push({
          id: `tok-${generateId()}-${i + 2}`,
          surface: words[i + 2],
          gloss: lookupSingle(words[i + 2]),
          compoundRef: surface,
        });
        i += 3;
        continue;
      }
    }

    // Try bigram (current word + next word)
    if (i + 1 < words.length) {
      const bigramGloss = lookupBigram(surface, words[i + 1]);
      if (bigramGloss) {
        tokens.push({
          id: `tok-${generateId()}-${i}`,
          surface,
          gloss: bigramGloss,
        });
        tokens.push({
          id: `tok-${generateId()}-${i + 1}`,
          surface: words[i + 1],
          gloss: lookupSingle(words[i + 1]),
          compoundRef: surface,
        });
        i += 2;
        continue;
      }
    }

    // Single word lookup
    const gloss = lookupSingle(surface);
    tokens.push({
      id: `tok-${generateId()}-${i}`,
      surface,
      gloss,
    });
    i++;
  }

  return tokens;
}

// Returned by Call 2 (translations + vocabulary + grammar from merged transcript)
type AnalysisAI = {
  lines: Array<{ arabic: string; translation: string }>;
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

type ClaudeEnrichmentAI = {
  enrichments: Array<{
    arabic: string;
    culturalContext?: string;
    idiomaticNuance?: string;
    dialectNotes?: string;
    exampleSentence?: { arabic: string; english: string };
  }>;
};

type MetaAI = {
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext?: string;
};

// ── CAMeL-Lab dialect identification ─────────────────────────────────────────
// Runs in parallel with Call 2 to validate the LLM-detected dialect. The client,
// the MADAR label map and the agreement rule all live in _shared/camelDialect.ts
// so this pipeline and the camel-analyze function can't drift apart again.
// Never blocks the pipeline — a failure is recorded, not thrown.

// ── Farasa diacritization ─────────────────────────────────────────────────────
// Adds short vowels (tashkeel) to unvoweled Arabic text via the QCRI Farasa
// REST API. The diacritized output is included in the response for downstream
// ElevenLabs TTS calls, which produce more accurate pronunciation with tashkeel.
//
// The endpoint cascade and failure classification live in _shared/farasa.ts —
// this pipeline and the `farasa` edge function used to carry divergent copies
// of both, and the copy here silently dropped responses that used the `result`
// field. The outcome is returned whole rather than reduced to `string | null`
// so `engines_used.diacritization` can say *why* a run has no tashkeel.
//
// One request per line, not one for the transcript. Farasa does not preserve
// the newlines it is sent and truncates long input — 245 characters back for a
// 748-character transcript in the last run — so the joined call left the
// pipeline guessing which output word belonged to which line, and it guessed
// wrong every time (0 of 143 words located across three consecutive audits).
// Per-line requests make output `i` belong to input `i` by construction.
async function callFarasaDiacritize(lines: string[]) {
  return await callFarasaDiacritizeLines(lines, { timeoutMs: 15_000 });
}

// Fallback: use Qwen + Gemini via OpenRouter for translation when needed
async function lovableAITranslate(arabicLines: string[], apiKey: string, dialect?: string): Promise<string[]> {
  const numberedLines = arabicLines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  const dialectNote = dialect ? getDialectNote(dialect, ' ') : '';
  const messages = [
    {
      role: "system",
      content: `You are an expert translator specializing in Gulf Arabic (Khaliji) dialect.${dialectNote} Translate each numbered Arabic line to natural English. Return ONLY the translations, numbered to match. No commentary.`,
    },
    {
      role: "user",
      content: `Translate these Gulf Arabic lines to English:\n\n${numberedLines}`,
    },
  ];

  async function callModel(model: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages }),
      });
      clearTimeout(timeout);
      if (!response.ok) {
        console.warn(`${model} translation error:`, response.status);
        return null;
      }
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || null;
    } catch (e) {
      clearTimeout(timeout);
      console.warn(`${model} translation failed:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  try {
    const [qwenText, geminiText] = await Promise.all([
      callModel('qwen/qwen3-235b-a22b'),
      callModel('google/gemini-2.5-flash'),
    ]);

    const generatedText = qwenText ?? geminiText ?? '';
    if (!generatedText) return [];

    const translations: string[] = [];
    const respLines = generatedText.split('\n').filter((l: string) => l.trim());
    for (let i = 0; i < arabicLines.length; i++) {
      const lineNum = i + 1;
      const match = respLines.find((l: string) => l.trim().startsWith(`${lineNum}.`) || l.trim().startsWith(`${lineNum})`));
      if (match) {
        translations.push(match.trim().replace(/^\d+[\.\)]\s*/, ''));
      } else if (i < respLines.length) {
        translations.push(respLines[i]?.trim().replace(/^\d+[\.\)]\s*/, '') || '');
      } else {
        translations.push('');
      }
    }
    console.log(`lovableAITranslate: produced ${translations.filter(t => t.length > 0).length}/${arabicLines.length} translations (qwen=${!!qwenText}, gemini=${!!geminiText})`);
    return translations;
  } catch (e) {
    console.warn('lovableAITranslate failed:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Allow internal service-role calls (e.g. from process-approved-video).
  // Detect by exact env match OR by inspecting the JWT payload for a
  // service role / missing sub claim — robust to env-var drift across functions.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = authHeader.slice('Bearer '.length).trim();
  let isInternalServiceCall = !!(serviceRoleKey && bearer === serviceRoleKey);
  if (!isInternalServiceCall) {
    try {
      const parts = bearer.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        // Service-role / anon JWTs have role but no user sub
        if (payload && (payload.role === 'service_role' || !payload.sub)) {
          isInternalServiceCall = true;
        }
      }
    } catch { /* not a JWT we can parse — fall through to user auth */ }
  }

  try {
    if (!isInternalServiceCall) {
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    const body = await req.json();
    const { transcript, munsitTranscript, fanarTranscript, sonioxTranscript, azureTranscript, scribeTranscript, cohereTranscript, sonioxTranslation, visualContext, originalUrl, videoId: pipelineVideoId, dialectModule, isMeme, onScreenTextSegments } = body;
    DIALECT_MODULE = (dialectModule === 'Egyptian' || dialectModule === 'Yemeni') ? dialectModule : 'Gulf';
    console.log('Dialect module for this request:', DIALECT_MODULE);

    // ── Quick phrase-translation shortcut ──────────────────────────────────
    // When called with { phrase } (no transcript), translate a short Arabic
    // word or phrase and return { translation } immediately.
    if (body.phrase && typeof body.phrase === 'string') {
      const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
      if (!OPENROUTER_API_KEY) {
        return new Response(JSON.stringify({ error: 'AI service not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.log('Phrase translation:', body.phrase);
      const resp = await callAI({
        systemPrompt: 'You are a Gulf Arabic translator. Translate the given Arabic word or phrase to English. Return ONLY the English translation — 1 to 5 words, no punctuation, no explanation.',
        userContent: body.phrase,
        apiKey: OPENROUTER_API_KEY,
        maxTokens: 30,
      });
      const translation = (resp.content ?? '').trim().replace(/^["'.]+|["'.]+$/g, '');
      return new Response(
        JSON.stringify({ translation: translation || null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ──────────────────────────────────────────────────────────────────────

    const memeMode = !!isMeme;
    const onScreenSegs = Array.isArray(onScreenTextSegments) ? onScreenTextSegments : [];
    const transcriptIsEmpty = !transcript || typeof transcript !== 'string' || transcript.trim().length < 3;

    if (transcriptIsEmpty && !(memeMode && onScreenSegs.length > 0)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid transcript' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasDual = Boolean(munsitTranscript && typeof munsitTranscript === 'string' && munsitTranscript.trim().length > 0);
    const hasFanar = Boolean(fanarTranscript && typeof fanarTranscript === 'string' && fanarTranscript.trim().length > 0);
    const hasSoniox = Boolean(sonioxTranscript && typeof sonioxTranscript === 'string' && sonioxTranscript.trim().length > 0);
    const hasAzure = Boolean(azureTranscript && typeof azureTranscript === 'string' && azureTranscript.trim().length > 0);
    const hasScribe = Boolean(scribeTranscript && typeof scribeTranscript === 'string' && scribeTranscript.trim().length > 0);
    const hasCohere = Boolean(cohereTranscript && typeof cohereTranscript === 'string' && cohereTranscript.trim().length > 0);
    const hasTriple = hasDual && hasFanar;
    const asrCount = 1 + (hasDual ? 1 : 0) + (hasFanar ? 1 : 0) + (hasSoniox ? 1 : 0) + (hasAzure ? 1 : 0) + (hasScribe ? 1 : 0) + (hasCohere ? 1 : 0);
    console.log('Analyzing transcript (lines + meta)...');
    console.log('Deepgram transcript length:', transcript.length);
    if (hasDual) console.log('Munsit transcript length:', munsitTranscript.length);
    if (hasFanar) console.log('Fanar transcript length:', fanarTranscript.length);
    if (hasSoniox) console.log('Soniox transcript length:', sonioxTranscript.length);
    if (hasAzure) console.log('Azure transcript length:', azureTranscript.length);
    if (hasScribe) console.log('Scribe transcript length:', scribeTranscript.length);
    if (hasCohere) console.log('Cohere transcript length:', cohereTranscript.length);

    const FANAR_API_KEY = Deno.env.get('FANAR_API_KEY')?.trim();
    const fanarLlmAvailable = Boolean(FANAR_API_KEY);
    if (fanarLlmAvailable) {
      console.log('Fanar LLM conjunction enabled');
    }


     let partial = false;

     // Build user content for the merge prompt (all available ASR transcripts).
     // Order matches the engine-priority ranking: Munsit > Soniox > Fanar > Azure > Deepgram.
     const transcriptParts: string[] = [];
     if (hasDual) transcriptParts.push(`Transcription (Munsit — Arabic-native dialect specialist, PREFER wording for dialectal phrases):\n${munsitTranscript}`);
     if (hasSoniox) transcriptParts.push(`Transcription (Soniox — lowest-WER engine, use when Munsit is missing):\n${sonioxTranscript}`);
     if (hasFanar) transcriptParts.push(`Transcription (Fanar — Arabic-native, tie-breaker):\n${fanarTranscript}`);
     if (hasScribe) transcriptParts.push(`Transcription (ElevenLabs Scribe — strongest on Arabic-English code-switching, PREFER for English words and mixed phrases):\n${scribeTranscript}`);
     if (hasCohere) transcriptParts.push(`Transcription (Cohere Transcribe Arabic — lowest average WER across Arabic dialects):\n${cohereTranscript}`);
     if (hasAzure) transcriptParts.push(`Transcription (Azure — locale-tuned for this dialect):\n${azureTranscript}`);
     transcriptParts.push(`Transcription (Deepgram — best for word boundaries; do NOT prefer its wording):\n${transcript}`);

     if (memeMode) {
       const audioNote = transcriptIsEmpty
         ? `THIS IS A MEME WITH NO SPOKEN AUDIO (or audio is silent / unintelligible). The transcripts above may be empty, garbled, or hallucinated by the speech-to-text engines. **DO NOT invent spoken Arabic.** If the audio engines produced text that doesn't correspond to clear speech, IGNORE it. Build the Arabic lines from the on-screen text below instead.`
         : `THIS IS A MEME. The audio above is real speech, but on-screen text is equally important. **DO NOT invent any Arabic that is not actually present in either the audio transcripts above OR the on-screen text below.** If a transcript engine clearly hallucinated, drop those lines.`;
       const onScreenBlock = onScreenSegs.length > 0
         ? `\n\nOn-screen text segments (from video frames, in time order):\n${onScreenSegs.map((s: any) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? `  →  ${s.translation}` : ''}`).join('\n')}`
         : '\n\n(No on-screen text detected.)';
       transcriptParts.push(`MEME CONTEXT:\n${audioNote}${onScreenBlock}\n\nWhen building lines[], merge spoken audio (if any) with on-screen text segments in time order. Mark each line implicitly by source: spoken lines first, then any on-screen-only text. Do not duplicate text that appears in both audio and on-screen overlay.`);
     }

     const linesUserContent = transcriptParts.length > 1 ? transcriptParts.join('\n\n') : transcript;

     const hasDualOrTriple = asrCount >= 2;

     // =====================================================================
     // CALL 1 — Transcript merging only
     // Send all ASR transcripts to Qwen. Produce merged Arabic lines only.
     // No translations. No vocabulary. No grammar. Just the merged text.
     // Fanar runs in parallel as a fallback merge source.
     // =====================================================================
     console.log('Call 1: merging ASR transcripts into clean Arabic lines...');

     let mergeOnlyAi: MergeOnlyAI | null = null;

     const [mergeResp, fanarMergeResp] = await Promise.all([
       callAI({
         systemPrompt: getMergeOnlySystemPrompt(false, hasDualOrTriple, hasTriple),
         userContent: linesUserContent,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 8192,
       }),
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getMergeOnlySystemPrompt(false, hasDualOrTriple, hasTriple),
             userContent: linesUserContent,
             apiKey: FANAR_API_KEY!,
             maxTokens: 8192,
           })
         : Promise.resolve({ content: null } as { content: string | null }),
     ]);

     // Check for fatal errors from Qwen Call 1
     if (!mergeResp.content && mergeResp.status) {
       if (mergeResp.status === 429) {
         return new Response(
           JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
           { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
       if (mergeResp.status === 402) {
         return new Response(
           JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
           { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }
     }

     if (mergeResp.content) {
       mergeOnlyAi = safeJsonParse<MergeOnlyAI>(mergeResp.content);
     }

     // Fallback to Fanar if Qwen Call 1 parse failed
     if (!mergeOnlyAi?.lines || mergeOnlyAi.lines.length === 0) {
       if (fanarMergeResp.content) {
         const fanarMergeAi = safeJsonParse<MergeOnlyAI>(fanarMergeResp.content);
         if (fanarMergeAi?.lines && fanarMergeAi.lines.length > 0) {
           console.log('Qwen Call 1 parse failed, using Fanar merge result');
           mergeOnlyAi = fanarMergeAi;
         }
       }
     }

     // Retry Qwen Call 1 with stricter prompt if still failed
     if (!mergeOnlyAi?.lines || mergeOnlyAi.lines.length === 0) {
       console.log('Call 1 parse failed, retrying with stricter prompt...');
       const mergeRetry = await callAI({
         systemPrompt: getMergeOnlySystemPrompt(true, hasDualOrTriple, hasTriple),
         userContent: linesUserContent,
         apiKey: OPENROUTER_API_KEY,
         isRetry: true,
         maxTokens: 8192,
       });
       if (mergeRetry.content) {
         mergeOnlyAi = safeJsonParse<MergeOnlyAI>(mergeRetry.content);
       }
     }

     // If Call 1 fails entirely — do NOT attempt Call 2
     if (!mergeOnlyAi?.lines || !Array.isArray(mergeOnlyAi.lines) || mergeOnlyAi.lines.length === 0) {
       console.error('Call 1 failed: could not produce merged transcript. Skipping Call 2.');
       partial = true;
       const fallback = createFallbackResult(transcript);
       return new Response(
         JSON.stringify({ success: true, result: fallback, partial }),
         { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       );
     }

     // Store the merged transcript from Call 1
     const mergedLines = mergeOnlyAi.lines;
     const detectedDialect = DIALECT_MODULE !== 'Gulf'
       ? (DIALECT_MODULE as any)
       : (mergeOnlyAi.dialect ?? 'Gulf');
     const detectedDifficulty = mergeOnlyAi.difficulty ?? 'Intermediate';
     console.log('Call 1 complete:', mergedLines.length, 'merged Arabic lines. Detected dialect:', detectedDialect, '| Difficulty:', detectedDifficulty);

     // Build numbered merged transcript text to feed into translation and Call 2
     const mergedTranscriptText = mergedLines
       .map((l, i) => `${i + 1}. ${l.arabic}`)
       .join('\n');

     // =====================================================================
     // TRANSLATION — Gemini 2.5 Pro (primary) / Qwen (fallback)
     // Receives the merged transcript from Call 1.
     // Produces per-line English translations only — separate from analysis.
     //
     // CALL 2 — Analysis and enrichment (vocabulary + grammar)
     // Receives the same merged transcript from Call 1.
     // Produces vocabulary, grammar points, and cultural context.
     //
     // CAMEL DIALECT ID — CAMeL-Lab BERT model via Hugging Face Inference API.
     // Identifies Gulf dialect at city level (Kuwait/Doha/Riyadh/Abu Dhabi/etc.)
     // independently of the LLM. Runs in parallel — result enriches the response
     // and validates the LLM-detected dialect. Never blocks the pipeline.
     //
     // FARASA DIACRITIZE — QCRI Farasa REST API adds tashkeel to merged Arabic.
     // Diacritized text is returned in the result for ElevenLabs TTS calls.
     //
     // All run in parallel. Translation is a separate concern from analysis.
     // =====================================================================
     console.log('Translation (Gemini), analysis (Qwen), meta (Fanar), CAMeL dialect, Farasa diac running in parallel...');

     const arabicOnlyText = mergedLines.map(l => l.arabic).join('\n');
     const hfApiKey = Deno.env.get('HUGGINGFACE_API_KEY') ?? '';

      const [translationEnsembleResult, fushaOutcome, analysisResp, fanarMetaResp, fanarValidResp, camelOutcome, diacOutcome] = await Promise.all([
        // TRANSLATION ENSEMBLE — Claude Sonnet 4.5 (1.0) + Gemini 3.5 Flash (1.0)
        // as co-equal peers, Qwen3-Max (0.5) as lower-weight verifier. Model
        // IDs are sourced from _shared/modelRegistry.ts (MODEL_LINEUPS.TRANSLATION)
        // so upgrades happen in one place. Do NOT hardcode IDs here.
        (async () => {
          const sys = getTranslationSystemPrompt(detectedDialect, visualContext, sonioxTranslation);
          const CLAUDE = 'anthropic/claude-sonnet-4.5';
          const GEMINI = 'google/gemini-3.5-flash';
          const QWEN = 'qwen/qwen3-max';
          const settled = await Promise.allSettled([
            callTranslationModel({
              name: CLAUDE,
              via: 'openrouter',
              weight: 1.0,
              model: CLAUDE,
              systemPrompt: sys,
              userContent: mergedTranscriptText,
              apiKey: OPENROUTER_API_KEY,
              maxTokens: 16384,
            }),
            callTranslationModel({
              name: GEMINI,
              via: 'lovable',
              weight: 1.0,
              model: GEMINI,
              systemPrompt: sys,
              userContent: mergedTranscriptText,
              apiKey: '',
              maxTokens: 16384,
            }),
            callTranslationModel({
              name: QWEN,
              via: 'openrouter',
              weight: 0.5,
              model: QWEN,
              systemPrompt: sys,
              userContent: mergedTranscriptText,
              apiKey: OPENROUTER_API_KEY,
              maxTokens: 8192,
            }),
          ]);
          const candidates: EnsembleCandidate[] = settled.map((s, i) => {
            const names = [CLAUDE, GEMINI, QWEN];
            const vias: Array<'lovable' | 'openrouter'> = ['openrouter', 'lovable', 'openrouter'];
            const weights = [1.0, 1.0, 0.5];
            if (s.status === 'fulfilled') return s.value;
            return {
              name: names[i],
              via: vias[i],
              weight: weights[i],
              translations: [],
              literals: [],
              status: 'failed' as const,
              latencyMs: 0,
              chars: 0,
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            };
          });
          return candidates;
        })(),
       // FUSHA PASS — the same lines rewritten in Modern Standard Arabic, so a
       // Fusha learner can see what the dialect changed rather than only what
       // it means. Non-blocking: failure leaves every line's `fusha` empty.
       runFushaPass({
         numberedLines: mergedTranscriptText,
         lineCount: mergedLines.length,
         dialectLabel: dialectFamilyLabel(),
         apiKey: OPENROUTER_API_KEY,
       }),
       // Call 2: vocabulary + grammar (Qwen, unchanged from Step 2)
       callAI({
         systemPrompt: getAnalysisSystemPrompt(false, detectedDialect, visualContext, memeMode),
         userContent: mergedTranscriptText,
         apiKey: OPENROUTER_API_KEY,
         isRetry: false,
         maxTokens: 8192,
       }),
       // Fanar meta enrichment (vocab/grammar/culture). Uses the general
       // Fanar-C-2-27B model — NOT Fanar-Sadiq, which is the Islamic-content
       // RAG model and was contaminating secular transcripts with
       // religious-context framing.
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getMetaSystemPrompt(true),
             userContent: mergedTranscriptText,
             apiKey: FANAR_API_KEY!,
             model: 'Fanar-C-2-27B',
             maxTokens: 2048,
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // Fanar-C-2-27B dialect validation
       fanarLlmAvailable
         ? callFanar({
             systemPrompt: getFanarValidationSystemPrompt(),
             userContent: mergedTranscriptText,
             apiKey: FANAR_API_KEY!,
             model: 'Fanar-C-2-27B',
             maxTokens: 1024,
           }).catch((e) => {
             console.warn('Fanar dialect validation failed (non-blocking):', e);
             return { content: null } as { content: string | null };
           })
         : Promise.resolve({ content: null } as { content: string | null }),
       // CAMeL-Lab BERT dialect ID. A missing key is reported as an outcome
       // (`no_api_key`) rather than short-circuited to null, so the stored
       // signal distinguishes "not configured" from "the call failed".
       callCamelDialect(arabicOnlyText, hfApiKey).catch((e) => {
         console.warn('CAMeL dialect call failed (non-blocking):', e);
         return { ok: false, reason: 'network_error' } as CamelOutcome;
       }),
       // Farasa diacritize. Like CAMeL, a failure carries its reason instead of
       // collapsing to null — "no tashkeel this run" needs to name whether the
       // service was unreachable or the API key was rejected.
       callFarasaDiacritize(mergedLines.map((l) => l.arabic)).catch((e) => {
         console.warn('Farasa diacritize failed (non-blocking):', e);
         return {
           lines: mergedLines.map(() => null),
           ok: false, succeeded: 0, failed: mergedLines.length,
           reason: 'all_endpoints_failed',
         } as FarasaLinesOutcome;
       }),
     ]);

     const camelDialectResult: CamelPrediction | null = camelOutcome.ok ? camelOutcome.result : null;
     const camelError: CamelFailureReason | null = camelOutcome.ok ? null : camelOutcome.reason;
     // The response still carries a whole diacritized transcript for downstream
     // TTS; lines Farasa could not do keep their original text.
     const diacritizedTranscript: string | null = diacOutcome.ok
       ? diacOutcome.lines.map((l, i) => l ?? mergedLines[i]?.arabic ?? '').join('\n')
       : null;

     // --- Log CAMeL dialect result vs LLM-detected dialect ---
     if (camelDialectResult) {
       const agrees = camelAgreesWithModule(camelDialectResult, DIALECT_MODULE);
       const agreement = agrees === null ? 'no bearing' : agrees ? 'agree' : 'disagree';
       console.log(
         `CAMeL dialect: ${camelDialectResult.dialect} (${camelDialectResult.code}, conf=${camelDialectResult.confidence})` +
         ` — LLM: ${detectedDialect} — module ${DIALECT_MODULE} — ${agreement}`,
       );
     } else {
       // Naming the reason is the whole point: "unavailable" used to cover a
       // missing key, a 404 and a cold start alike.
       console.log(`CAMeL dialect: unavailable (${camelError})`);
     }
     if (diacritizedTranscript) {
       console.log(`Farasa diacritize: ${diacritizedTranscript.length} chars of tashkeel-annotated Arabic`);
     } else if (!diacOutcome.ok) {
       console.warn(
         `Farasa diacritize: unavailable (${diacOutcome.reason})` +
           (diacOutcome.reason === 'invalid_api_key'
             ? ' — set FARASA_API_KEY (register at farasa.qcri.org); lines keep the LLM-supplied tashkeel only'
             : ''),
       );
     }

     // --- Parse Fanar dialect validation — accept JSON or raw text, never throw ---
     // The raw text is kept alongside the parsed issues: if Fanar answers in
     // prose instead of JSON, the admin banner still has something to show and
     // `flagged` falls back to the old length heuristic.
     let dialectValidation:
       { content: string; timestamp: string; issues?: DialectIssue[] } | null = null;
     if (fanarValidResp?.content) {
       const issues = parseDialectIssues(fanarValidResp.content);
       dialectValidation = {
         content: fanarValidResp.content,
         timestamp: new Date().toISOString(),
         ...(issues ? { issues } : {}),
       };
       console.log(
         `Fanar dialect validation: ${issues ? `${issues.length} issue(s) parsed` : 'unparseable, keeping raw text'}` +
         ` — first 150 chars: ${fanarValidResp.content.slice(0, 150)}`,
       );
       if (!issues) {
         // Genuinely unstructured now means Fanar answered in prose, not that
         // its JSON tripped the parser — worth the full text in the log, since
         // it is the only place the finding survives.
         console.warn(
           `Fanar dialect validation: no issue array recoverable from ` +
           `${fanarValidResp.content.length} chars — ${fanarValidResp.content.slice(0, 400)}`,
         );
       }
     }

      // --- TRANSLATION ENSEMBLE: merge Gemini + Claude + Qwen candidates per line ---
      const translationCandidates = translationEnsembleResult;
      for (const c of translationCandidates) {
        console.log(
          `[ensemble] ${c.name} (w=${c.weight}, via=${c.via}): status=${c.status}, ` +
            `lines=${c.translations.length}, latency=${c.latencyMs}ms, chars=${c.chars}` +
            (c.error ? `, error=${c.error.slice(0, 120)}` : ''),
        );
      }
      const okCount = translationCandidates.filter((c) => c.status === 'ok').length;
      if (okCount === 0) {
        console.warn('[ensemble] All 3 translation models failed — leaving translations empty.');
      }
      const ensembleMerge = mergeTranslationEnsemble(translationCandidates, mergedLines.length);
      const dedicatedTranslations: string[] = ensembleMerge.lines.map((l) => l.translation);
      const dedicatedLiterals: string[] = ensembleMerge.lines.map((l) => l.literal);
      const ensembleNeedsReview: boolean[] = ensembleMerge.lines.map((l) => l.needs_review);

      // ── SHAHEEN-MT TIEBREAK ──────────────────────────────────────────────
      // Only for lines the ensemble couldn't settle (needs_review) or left
      // empty: get a reference translation from Fanar-Shaheen-MT-1, the only
      // Arabic-native dedicated MT model in the stack. It is used two ways:
      //
      //   fill     — the line has no translation at all; Shaheen's becomes it.
      //   arbitrate — the line has competing candidates and no winner; whichever
      //               candidate Shaheen's rendering clearly backs wins, and the
      //               line comes off the review queue.
      //
      // Arbitration is what makes this a tiebreak. Without it the call was made,
      // the answer was received, and every disputed line stayed disputed with
      // Shaheen's text parked in `altTranslation` — which is why audits kept
      // reporting "tiebreak fired, filled 0".
      const shaheenByLine: (string | null)[] = new Array(mergedLines.length).fill(null);
      /** Model name Shaheen's arbitration settled each line on, where it did. */
      const shaheenResolvedBy: (string | null)[] = new Array(mergedLines.length).fill(null);
      // Ordered by how far apart the candidates are, widest first.
      //
      // Shaheen's budget is a handful of calls a day and only covers the first
      // few lines handed to it — the last run had 8 disputed lines and room for
      // 4. Taking them in transcript order spends that on whichever lines happen
      // to come first; taking the most divergent first spends it where a third
      // opinion actually changes something. Lines whose candidates nearly agree
      // are the ones arbitration would have found hardest to call anyway.
      const candidateSpread = (l: EnsembleLineResult): number => {
        const texts = l.candidates.map((c) => c.text).filter(Boolean);
        if (texts.length < 2) return 0;
        let closest = 0;
        for (let a = 0; a < texts.length; a++) {
          for (let b = a + 1; b < texts.length; b++) {
            closest = Math.max(closest, jaccard(texts[a], texts[b]));
          }
        }
        return 1 - closest;
      };
      const disputedIdx = ensembleMerge.lines
        .map((l, i) => (l.needs_review || !l.translation) ? i : -1)
        .filter((i) => i >= 0)
        .sort((a, b) => {
          // Empty lines first — filling one is worth more than settling a
          // dispute between two translations that both already exist.
          const emptyA = ensembleMerge.lines[a].translation ? 0 : 1;
          const emptyB = ensembleMerge.lines[b].translation ? 0 : 1;
          if (emptyA !== emptyB) return emptyB - emptyA;
          return candidateSpread(ensembleMerge.lines[b]) - candidateSpread(ensembleMerge.lines[a]);
        });
      // `attempted` vs `succeeded` are deliberately separate: the old single
      // `called` flag was set only on success, so a budget exhaustion, a 429 and
      // a missing API key all reported identically to "never ran". `called` is
      // retained as an alias of `succeeded` for one release so the admin UI and
      // any stored history keep reading.
      const shaheenProvenance: {
        attempted: boolean;
        succeeded: boolean;
        called: boolean;
        disputed_lines: number;
        /** Empty lines that Shaheen supplied a translation for. */
        filled: number;
        /** Disputed lines Shaheen settled in favour of an ensemble candidate. */
        resolved: number;
        /** Of those, ones settled because it backed several candidates equally. */
        corroborated: number;
        /** Disputed lines it saw but could not settle either way. */
        unresolved: number;
        /** Disputed lines the per-line budget never reached. */
        unarbitrated: number;
        skip_reason?: ShaheenSkipReason;
        http_status?: number;
        budget_used?: number;
        strategy?: 'single' | 'per_line';
      } = {
        attempted: false, succeeded: false, called: false,
        disputed_lines: disputedIdx.length, filled: 0, resolved: 0,
        corroborated: 0, unresolved: 0, unarbitrated: 0,
      };
      if (!fanarLlmAvailable) {
        shaheenProvenance.skip_reason = 'no_api_key';
      } else if (disputedIdx.length > 0) {
        const shaheenOut = await callShaheenTranslate(
          disputedIdx.map((i) => mergedLines[i].arabic),
          FANAR_API_KEY!,
        );
        shaheenProvenance.attempted = shaheenOut.attempted;
        if (shaheenOut.skipReason) shaheenProvenance.skip_reason = shaheenOut.skipReason;
        if (shaheenOut.httpStatus) shaheenProvenance.http_status = shaheenOut.httpStatus;
        if (typeof shaheenOut.budgetUsed === 'number') shaheenProvenance.budget_used = shaheenOut.budgetUsed;
        if (shaheenOut.strategy) shaheenProvenance.strategy = shaheenOut.strategy;

        if (shaheenOut.translations) {
          shaheenProvenance.succeeded = true;
          shaheenProvenance.called = true;
          disputedIdx.forEach((lineIdx, k) => {
            const t = shaheenOut.translations![k];
            if (t) shaheenByLine[lineIdx] = t;
          });

          for (const i of disputedIdx) {
            const arbiterText = shaheenByLine[i];
            if (!arbiterText) continue;
            if (!dedicatedTranslations[i]) {
              shaheenProvenance.filled++;
              continue;
            }
            if (!ensembleNeedsReview[i]) continue;

            const verdict = arbitrateDispute(arbiterText, ensembleMerge.lines[i].candidates);
            if (!verdict.winner) {
              shaheenProvenance.unresolved++;
              console.log(
                `Shaheen-MT arbitration line ${i + 1}: undecided ` +
                  `(${verdict.reason}, best=${verdict.score.toFixed(2)}, margin=${verdict.margin.toFixed(2)})`,
              );
              continue;
            }
            // The arbiter backs one candidate — adopt it and clear the flag.
            // Its own rendering still rides along as `altTranslation` so a
            // reviewer can see what settled the line.
            dedicatedTranslations[i] = verdict.winner.text.trim();
            if (verdict.winner.literal) dedicatedLiterals[i] = verdict.winner.literal.trim();
            ensembleNeedsReview[i] = false;
            shaheenResolvedBy[i] = `${verdict.winner.name}:${verdict.mode}`;
            shaheenProvenance.resolved++;
            if (verdict.mode === 'corroborated') shaheenProvenance.corroborated++;
            console.log(
              `Shaheen-MT arbitration line ${i + 1}: resolved to ${verdict.winner.name} ` +
                `via ${verdict.mode} (score=${verdict.score.toFixed(2)}, margin=${verdict.margin.toFixed(2)})`,
            );
          }

          // Disputed lines the budget never reached. Distinct from `unresolved`
          // — those got an opinion and it settled nothing, these were never
          // asked, and only the second is fixed by raising the budget.
          shaheenProvenance.unarbitrated = disputedIdx.filter(
            (i) => ensembleNeedsReview[i] && !shaheenByLine[i],
          ).length;

          // The merge's own needs_review tally is pre-arbitration; recount so
          // engines_used and the review queue can't disagree about how many
          // lines are actually still open.
          ensembleMerge.agreements.needs_review = ensembleNeedsReview.filter(Boolean).length;

          console.log(
            `Shaheen-MT tiebreak: ${disputedIdx.length} disputed lines → ` +
              `${shaheenProvenance.filled} filled, ${shaheenProvenance.resolved} resolved ` +
              `(${shaheenProvenance.corroborated} by corroboration), ` +
              `${shaheenProvenance.unresolved} still disputed, ` +
              `${shaheenProvenance.unarbitrated} never reached by the budget`,
          );
        } else {
          console.warn(
            `Shaheen-MT tiebreak produced nothing for ${disputedIdx.length} disputed lines ` +
              `(attempted=${shaheenOut.attempted}, reason=${shaheenOut.skipReason ?? 'unknown'})`,
          );
        }
      }

      // Structured provenance for engines_used.translation
      const translationProvenance = {
        strategy: 'weighted_ensemble',
        degraded: okCount < 3,
        active_models: okCount,
        agreements: ensembleMerge.agreements,
        shaheen: shaheenProvenance,
        tiers: translationCandidates.map((c) => ({
          name: c.name,
          via: c.via,
          weight: c.weight,
          status: c.status,
          latency_ms: c.latencyMs,
          chars: c.chars,
          lines_won: ensembleMerge.perModelWins[c.name] ?? 0,
          ...(c.error ? { error: c.error.slice(0, 200) } : {}),
        })),
      };
      // Structured provenance for engines_used.fusha. Kept separate from the
      // translation block: it is a different call to a different prompt, and
      // an audit asking "why has this video no Fusha row" should not have to
      // read it out of the translation tiers.
      const fushaProvenance = {
        status: fushaOutcome.status,
        model: fushaOutcome.model,
        latency_ms: fushaOutcome.latencyMs,
        lines_total: mergedLines.length,
        lines_filled: fushaOutcome.filled,
      };
      console.log(
        `[ensemble] merged ${dedicatedTranslations.length} lines | ` +
          `all_three=${ensembleMerge.agreements.all_three} ` +
          `gemini_claude=${ensembleMerge.agreements.gemini_claude} ` +
          `needs_review=${ensembleMerge.agreements.needs_review} | ` +
          `wins=${JSON.stringify(ensembleMerge.perModelWins)}`,
      );


     // --- Parse Call 2 (analysis) result ---
     let analysisAi: AnalysisAI | null = null;
     if (analysisResp.content) {
       analysisAi = safeJsonParse<AnalysisAI>(analysisResp.content);
     }

     // Retry Call 2 with stricter prompt if parse fails
     if (!analysisAi?.lines || analysisAi.lines.length === 0) {
       console.log('Call 2 parse failed, retrying with stricter prompt...');
       const analysisRetry = await callAI({
          systemPrompt: getAnalysisSystemPrompt(true, detectedDialect, visualContext, memeMode),
         userContent: mergedTranscriptText,
         apiKey: OPENROUTER_API_KEY,
         isRetry: true,
         maxTokens: 8192,
       });
       if (analysisRetry.content) {
         analysisAi = safeJsonParse<AnalysisAI>(analysisRetry.content);
       }
     }

     if (!analysisAi) {
       partial = true;
     }

     // Always use mergedLines (Call 1 output) as the authoritative Arabic source.
     // Call 2 provides translations (secondary fallback) + vocab + grammar only.
     const call2Lines = analysisAi?.lines ?? [];
     if (analysisAi && call2Lines.length < mergedLines.length) {
       console.warn(
         `Call 2 returned ${call2Lines.length} lines but Call 1 produced ${mergedLines.length}. Using Call 1 lines as authoritative Arabic source.`
       );
     }
     let vocab = Array.isArray(analysisAi?.vocabulary) ? analysisAi!.vocabulary : [];
     let grammarPoints = Array.isArray(analysisAi?.grammarPoints) ? analysisAi!.grammarPoints : [];
     let culturalContext = analysisAi?.culturalContext;

      // Build finalLines from mergedLines — always has the correct count.
      // Translation priority: dedicated Gemini/Qwen > Call 2 embedded > empty string.
      // Overlay Farasa diacritization onto each line so per-line `arabic`
      // includes tashkeel (pronunciation markings) — not just the top-level
      // `diacritizedTranscript` field.
      const overlay = overlayDiacritizedPerLine(
        mergedLines.map(l => l.arabic),
        diacOutcome.lines,
      );
      const diacritizedPerLine = overlay.lines;
      const diacritizedLineCount = diacritizedPerLine.filter(
        (l, i) => l !== mergedLines[i].arabic,
      ).length;
      console.log(
        `Diacritization overlay [${overlay.strategy}]: ` +
          `${overlay.matched}/${overlay.total} words located, ${overlay.filled} filled, ` +
          `${diacritizedLineCount}/${mergedLines.length} lines updated` +
          (diacOutcome.ok ? '' : ` (Farasa unavailable: ${diacOutcome.reason})`),
      );

      // Provenance for engines_used.diacritization. Without this, a run with no
      // tashkeel showed up nowhere in the stored record — the reason existed
      // only in the function logs, which is where the last three audits had to
      // go looking for it.
      //
      // `words_matched` is the diagnostic that matters. A successful Farasa call
      // with lines_diacritized:0 is ambiguous on its own — it could mean the
      // overlay failed to align (the bug this replaces) or simply that Call 1
      // had already voweled every word. Matched-but-not-filled is the second;
      // neither-matched-nor-filled is the first.
      const diacritizationProvenance = {
        provider: 'farasa',
        ok: diacOutcome.ok,
        strategy: overlay.strategy,
        lines_total: mergedLines.length,
        lines_diacritized: diacritizedLineCount,
        words_total: overlay.total,
        words_matched: overlay.matched,
        words_filled: overlay.filled,
        lines_returned: diacOutcome.succeeded,
        lines_failed: diacOutcome.failed,
        // What Farasa actually sent back. Three audits in a row reported
        // "succeeded but nothing landed" with no way to see the output that
        // failed to line up; this ends that.
        ...(diacOutcome.sample ? { sample: diacOutcome.sample } : {}),
        ...(diacOutcome.sampleInput ? { sample_input: diacOutcome.sampleInput } : {}),
        ...(diacOutcome.ok
          ? {}
          : {
              reason: diacOutcome.reason,
              ...(diacOutcome.reason === 'invalid_api_key'
                ? { config_hint: 'set FARASA_API_KEY — register at farasa.qcri.org' }
                : {}),
            }),
        // A call that succeeded but aligned to nothing is the overlay failing,
        // not the vendor. Name it so the next audit doesn't have to infer it.
        ...(diacOutcome.ok && overlay.total > 0 && overlay.matched === 0
          ? { warning: 'farasa_output_did_not_align' }
          : {}),
      };
      const finalLines = mergedLines.map((mergedLine, i) => {
        const ensembleTranslation = dedicatedTranslations[i] || call2Lines[i]?.translation || '';
        const needsReview = ensembleNeedsReview[i] ?? false;
        // Record *why* a line needs review. Without this, "all three models
        // disagreed" and "the ensemble produced nothing and Call 2's fallback
        // quietly filled it" are indistinguishable in the review queue — they
        // need very different attention.
        const reviewReason: ReviewReason | undefined = !needsReview
          ? undefined
          : !dedicatedTranslations[i] && call2Lines[i]?.translation
            ? 'call2_fallback'
            : ensembleTranslation
              ? 'ensemble_disagreement'
              : 'empty';
        return {
          arabic: diacritizedPerLine[i] || mergedLine.arabic,
          // Shaheen fills only when the ensemble + Call 2 both came back empty.
          translation: ensembleTranslation || shaheenByLine[i] || '',
          literal: dedicatedLiterals[i] || '',
          fusha: fushaOutcome.lines[i] || '',
          needs_review: needsReview,
          ...(reviewReason ? { review_reason: reviewReason } : {}),
          // Shaheen's own rendering rides along on any line it had an opinion
          // about — still-disputed ones so a reviewer has an alternative, and
          // arbitrated ones so they can see what settled it.
          ...(ensembleTranslation && shaheenByLine[i] && (needsReview || shaheenResolvedBy[i])
            ? { altTranslation: shaheenByLine[i]! }
            : {}),
          ...(shaheenResolvedBy[i] ? { resolved_by: `shaheen→${shaheenResolvedBy[i]}` } : {}),
        };
      });

      if (dedicatedTranslations.length > 0) {
        console.log(
          `Applied ensemble translations to ${dedicatedTranslations.length} lines ` +
            `(active=${translationProvenance.active_models}/3, ` +
            `needs_review=${translationProvenance.agreements.needs_review})`,
        );
      }

      // A Fusha pass that "succeeded" while filling 3 of 40 lines is a failure
      // the learner sees and the log would otherwise call ok. Print the ratio.
      console.log(
        `[fusha] ${fushaOutcome.status} via ${fushaOutcome.model ?? 'none'} — ` +
          `${fushaOutcome.filled}/${mergedLines.length} lines in ${fushaOutcome.latencyMs}ms`,
      );


     // Merge Fanar meta results if available
     if (fanarMetaResp.content) {
       const fanarMetaAi = safeJsonParse<MetaAI>(fanarMetaResp.content);
       if (fanarMetaAi) {
         console.log('Merging Fanar meta results...');
         // Union vocabularies (deduplicate by Arabic text)
         if (Array.isArray(fanarMetaAi.vocabulary)) {
           const existingArabic = new Set(vocab.map(v => v.arabic));
           const newVocab = fanarMetaAi.vocabulary.filter(v => v.arabic && !existingArabic.has(v.arabic));
           if (newVocab.length > 0) {
             vocab = [...vocab, ...newVocab];
             console.log(`Added ${newVocab.length} vocab items from Fanar meta`);
           }
         }
         // Union grammar points (deduplicate by title)
         if (Array.isArray(fanarMetaAi.grammarPoints)) {
           const existingTitles = new Set(grammarPoints.map(g => g.title.toLowerCase()));
           const newGrammar = fanarMetaAi.grammarPoints.filter(g => g.title && !existingTitles.has(g.title.toLowerCase()));
           if (newGrammar.length > 0) {
             grammarPoints = [...grammarPoints, ...newGrammar];
             console.log(`Added ${newGrammar.length} grammar points from Fanar meta`);
           }
         }
         // Prefer Fanar cultural context if richer (longer)
         if (fanarMetaAi.culturalContext && (!culturalContext || fanarMetaAi.culturalContext.length > culturalContext.length)) {
           culturalContext = fanarMetaAi.culturalContext;
           console.log('Using Fanar cultural context (richer)');
         }
       }
     }


      // ── Steps 5 & 6: Run Claude vocab enrichment and per-word gloss enrichment IN PARALLEL ──
      // Previously sequential — combined cost was pushing the function past the 150s
      // edge runtime idle limit. They are independent so we await them together.
      let allWordGlosses: Record<string, string> = {};

      // Prepare gloss inputs
      const allWordsSet = new Set<string>();
      for (const l of finalLines) {
        const words = String(l.arabic ?? '').trim().split(/\s+/).filter(Boolean);
        for (const w of words) {
          const cleaned = w.replace(/^[،؟.!:؛…\-—–"'()[\]{}«»]+|[،؟.!:؛…\-—–"'()[\]{}«»]+$/g, '');
          if (cleaned && !/^[،؟.!:؛…\-—–"'()[\]{}«»]+$/.test(cleaned)) {
            allWordsSet.add(cleaned);
          }
        }
      }
      const vocabArabicSet = new Set(vocab.map(v => v.arabic));
      const unknownWords = [...allWordsSet].filter(w => {
        const stripped = w.replace(/[\u064B-\u065F\u0670]/g, '');
        return !vocabArabicSet.has(w) && !vocabArabicSet.has(stripped) &&
               !COMMON_GLOSSES[w] && !COMMON_GLOSSES[stripped];
      });

      const claudeEnrichPromise = (vocab.length > 0)
        ? callAI({
            // OpenRouter uses the dotted ID; the hyphen form 404s on this route.
            model: 'anthropic/claude-sonnet-4.5',
            systemPrompt: getVocabEnrichmentSystemPrompt(),
            userContent: `Vocabulary list to enrich:\n${JSON.stringify(vocab.map(v => ({ arabic: v.arabic, english: v.english, root: v.root })))}`,
            apiKey: OPENROUTER_API_KEY,
            maxTokens: 4096,
          }).catch((e) => { console.warn('Claude vocab enrichment failed (non-blocking):', e); return { content: null }; })
        : Promise.resolve({ content: null } as { content: string | null });

      const glossPromise = (unknownWords.length > 0)
        ? callAI({
            model: 'google/gemini-2.5-flash',
            systemPrompt: getGlossEnrichmentPrompt(detectedDialect),
            userContent: `Translate each of these Arabic words to English:\n\n${unknownWords.join('\n')}`,
            apiKey: '',
            gateway: 'lovable',
            maxTokens: 4096,
          }).catch((e) => { console.warn('Gloss enrichment failed (non-blocking):', e); return { content: null }; })
        : Promise.resolve({ content: null } as { content: string | null });

      const [claudeEnrichResp, glossResp] = await Promise.all([claudeEnrichPromise, glossPromise]);

      // Apply Claude vocab enrichment
      if (claudeEnrichResp?.content) {
        try {
          const claudeEnrichAi = safeJsonParse<ClaudeEnrichmentAI>(claudeEnrichResp.content);
          if (claudeEnrichAi?.enrichments?.length) {
            const enrichmentMap = new Map(claudeEnrichAi.enrichments.map(e => [e.arabic, e]));
            vocab = vocab.map(item => {
              const enrichment = enrichmentMap.get(item.arabic);
              if (!enrichment) return item;
              const { arabic: _arabic, ...fields } = enrichment;
              return { ...item, ...fields };
            });
            console.log(`Claude enriched ${enrichmentMap.size} vocab items.`);
          }
        } catch (e) {
          console.warn('Claude vocab parse failed (non-blocking):', e);
        }
      }

      // Apply gloss enrichment
      if (glossResp?.content) {
        try {
          const glossResult = safeJsonParse<{ glosses: Record<string, string> }>(glossResp.content);
          if (glossResult?.glosses) {
            allWordGlosses = glossResult.glosses;
            console.log(`Gloss enrichment: received ${Object.keys(allWordGlosses).length} word translations`);
          }
        } catch (e) {
          console.warn('Gloss parse failed (non-blocking):', e);
        }
      } else if (unknownWords.length === 0) {
        console.log('Gloss enrichment: all words already covered by vocab + dictionary');
      }

      // Build the final TranscriptResult
      // Token glosses come from: AI-generated per-word glosses + vocabulary items + COMMON_GLOSSES fallback.
      const transcriptResult: TranscriptResult = {
        rawTranscriptArabic: transcript,
        lines: finalLines.map((l, idx) => ({
          id: `line-${generateId()}-${idx}`,
          arabic: String(l.arabic ?? '').trim(),
          translation: String(l.translation ?? '').trim(),
          literal: String(l.literal ?? '').trim(),
          fusha: String(l.fusha ?? '').trim(),
          needs_review: Boolean(l.needs_review),
          ...(l.review_reason ? { review_reason: l.review_reason } : {}),
          ...(l.altTranslation ? { altTranslation: String(l.altTranslation).trim() } : {}),
          ...(l.resolved_by ? { resolved_by: l.resolved_by } : {}),
          tokens: toWordTokens(String(l.arabic ?? '').trim(), vocab, allWordGlosses),
        })),
       vocabulary: vocab,
       grammarPoints,
       culturalContext,
       dialectValidation,
       dialect: detectedDialect,
       difficulty: detectedDifficulty,
       diacritizedTranscript: diacritizedTranscript ?? null,
       camelDialect: camelDialectResult ?? null,
     };

     console.log(
       'Analysis complete:',
       transcriptResult.lines.length,
       'lines,',
       transcriptResult.vocabulary.length,
       'vocab items',
       partial ? '(partial)' : ''
     );

      console.log(
        'Analysis complete:',
        transcriptResult.lines.length,
        'lines,',
        transcriptResult.vocabulary.length,
        'vocab items',
        partial ? '(partial)' : ''
      );

      // Store result in cache for future use (fire and forget)
      if (originalUrl) {
        try {
          const parsedUrl = new URL(originalUrl);
          const hostname = parsedUrl.hostname.replace(/^www\./, '').replace(/^m\./, '');
          
          let platform = 'other';
          let videoId = '';
          
          // Extract platform and video ID
          if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
            platform = 'youtube';
            const ytMatch = originalUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            videoId = ytMatch?.[1] || '';
          } else if (hostname.includes('tiktok.com')) {
            platform = 'tiktok';
            const match = originalUrl.match(/\/video\/(\d+)/);
            videoId = match?.[1] || '';
          }
          
          if (videoId) {
            // Include dialect module in the cache key so processing the same video
            // under a different module (Gulf vs Egyptian vs Yemeni) does not collide.
            const contentHash = `${platform}:${videoId}:${DIALECT_MODULE}`;
            const engines: string[] = [];
            if (transcript) engines.push('deepgram');
            if (hasDual) engines.push('munsit');
            if (hasFanar) engines.push('fanar');
            if (hasSoniox) engines.push('soniox');
            if (hasAzure) engines.push('azure');
            
            // Use service role client to cache
            const cacheUrl = Deno.env.get('SUPABASE_URL')!;
            const cacheKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            const cacheClient = createClient(cacheUrl, cacheKey);
            cacheClient.from('processed_videos').upsert({
              content_hash: contentHash,
              original_url: originalUrl,
              platform,
              video_id: videoId,
              processed_at: new Date().toISOString(),
              transcription_data: transcriptResult,
              processing_engines: engines,
              source_language: 'ar',
              dialect: detectedDialect || 'Gulf'
            }).then(({ error: cacheError }: { error: any }) => {
              if (cacheError) {
                console.warn('Failed to cache result:', cacheError.message);
              } else {
                console.log(`Cached result for ${contentHash}`);
              }
            });
          }
        } catch (cacheStoreError) {
          console.warn('Cache storage failed (non-blocking):', cacheStoreError);
        }
      }

      // If called from the pipeline with a videoId, persist results directly to DB.
      // This prevents data loss when the Supabase gateway kills the HTTP connection
      // at ~150s even though analysis completed successfully.
      if (pipelineVideoId && typeof pipelineVideoId === 'string') {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const svc = createClient(supabaseUrl, svcKey);

          const sanitizedLines = transcriptResult.lines.map((line) => ({
            ...line,
            tokens: Array.isArray(line.tokens) ? line.tokens
              : String(line.arabic ?? '').split(/\s+/).filter(Boolean)
                  .map((w: string, wi: number) => ({ id: `tok-${line.id ?? wi}-${wi}`, surface: w })),
          }));

          // Dialect signals: Fanar validation + CAMeL BERT dialect ID were
          // previously computed, logged, and thrown away. Persist them so the
          // admin review flow can act on them.
          //
          // `camel_agrees` is deliberately tri-state. It compares taught
          // modules, and stays null whenever CAMeL has no bearing on the
          // question — no prediction, an unrecognised label, MSA, or a dialect
          // outside the three modules. Comparing against a Gulf-only city map
          // meant a correct Egyptian or Yemeni call scored as disagreement and
          // raised `flagged` on content the model had got right.
          const camelAgrees = camelAgreesWithModule(camelDialectResult, DIALECT_MODULE);
          // Prefer a real issue count. The >300-char rule is only a fallback for
          // when Fanar answers in prose instead of the JSON it was asked for.
          const validationIssues = dialectValidation?.issues;
          const validationFlagged = validationIssues
            ? validationIssues.length > 0
            : (dialectValidation?.content?.length ?? 0) > 300;
          const dialectSignals = {
            llm_dialect: detectedDialect,
            fanar_validation: dialectValidation,
            camel: camelDialectResult ?? null,
            camel_agrees: camelAgrees,
            ...(camelError ? { camel_error: camelError } : {}),
            // An unconfigured engine and a broken one both leave camel null;
            // only one of them is fixed by setting a secret.
            ...(camelError === 'no_api_key'
              ? { camel_config_hint: 'set HUGGINGFACE_API_KEY to enable morphological dialect ID' }
              : {}),
            ...(validationIssues
              ? {
                  validation_issue_count: validationIssues.length,
                  validation_high_severity: validationIssues.filter((i) => i.severity === 'high').length,
                }
              : {}),
            // Whether `flagged` rests on a real issue count or on the length
            // fallback. The two mean different things and used to be reported
            // identically, so an audit could not tell a clean pass from a reply
            // nobody could read.
            validation_parsed: Boolean(validationIssues),
            flagged: camelAgrees === false || validationFlagged,
          };

          // Read-then-merge engines_used so we don't clobber ASR provenance written
          // by process-approved-video. Translation ensemble + dialect signals are additive.
          let mergedEnginesUsed: Record<string, unknown> = {
            translation: translationProvenance,
            fusha: fushaProvenance,
            dialect_signals: dialectSignals,
            diacritization: diacritizationProvenance,
          };
          try {
            const { data: existingRow } = await svc
              .from('discover_videos')
              .select('engines_used')
              .eq('id', pipelineVideoId)
              .single();
            const existing = (existingRow?.engines_used && typeof existingRow.engines_used === 'object')
              ? existingRow.engines_used as Record<string, unknown>
              : {};
            mergedEnginesUsed = {
              ...existing,
              translation: translationProvenance,
              fusha: fushaProvenance,
              dialect_signals: dialectSignals,
              diacritization: diacritizationProvenance,
            };
          } catch (_) {
            // non-fatal — fall back to translation-only
          }

          const { error: saveErr } = await svc.from('discover_videos').update({
            transcript_lines: sanitizedLines,
            vocabulary: transcriptResult.vocabulary || [],
            grammar_points: transcriptResult.grammarPoints || [],
            cultural_context: transcriptResult.culturalContext || null,
            dialect: transcriptResult.dialect || 'Gulf',
            difficulty: transcriptResult.difficulty || 'Intermediate',
            transcription_status: 'analysis_complete',
            transcription_error: null,
            engines_used: mergedEnginesUsed,
          }).eq('id', pipelineVideoId);

          if (saveErr) {
            console.error(`[analyze] Failed to persist results for video ${pipelineVideoId}:`, saveErr.message);
          } else {
            console.log(`[analyze] Persisted results directly for video ${pipelineVideoId}`);
          }
        } catch (persistErr) {
          console.error('[analyze] Direct DB persist failed:', persistErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, result: transcriptResult, partial }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

  } catch (error) {
    console.error('Error in analyze-gulf-arabic function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
