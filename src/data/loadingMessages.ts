/**
 * Bilingual status copy for the long AI waits.
 *
 * These strings are **chrome, not content**. They are never spoken by TTS, never
 * enter the SRS/vocabulary pipeline, and are never checked by the MSA-leak
 * detector in `supabase/functions/_shared/aiBrain.ts`. That detector exists to
 * keep *learning material* out of fusha; this file is the app talking to the
 * learner, which is a different register. Please don't "fix" these into MSA, and
 * please don't feed them to the generators.
 *
 * Dialect policy: there is no neutral spoken Arabic — every colloquial phrasing
 * picks a side (Gulf شوي vs Egyptian شوية). Since the app serves Gulf, Egyptian
 * and Yemeni learners from the same chrome, these lean on vocabulary and forms
 * that read naturally across all three, and avoid the MSA tells (سوف، الذي،
 * أريد، case endings). No harakat: chrome isn't study material, and vowelling
 * colloquial Arabic looks wrong to a native reader.
 *
 * `getDeck` takes an optional dialect so per-dialect decks can be added later
 * without touching a single call site.
 *
 * The English is not a literal translation of the Arabic — it's the same joke,
 * told in English.
 */

export interface LoadingMessage {
  /** Colloquial Arabic. Rendered RTL with lang="ar". */
  ar: string;
  /** The same beat in English. This is the line screen readers get. */
  en: string;
}

export type LoadingTask =
  | "passage"
  | "story"
  | "episode"
  | "episodeAudio"
  | "transcribeAnalysis"
  | "pronunciation"
  | "grammarDrill"
  | "scrape"
  | "analyze"
  | "quiz"
  | "image"
  | "generic";

/**
 * Decks are ordered narratives, never shuffled wholesale: entry 0 is literal and
 * honest, the middle carries the motif, and the **last entry is held for as long
 * as the wait runs**. Cycling back round to "Setting up…" at t=80s is a lie and
 * reads as a hang, so `messageIndexForElapsed` clamps instead of wrapping.
 */
export const LOADING_DECKS: Record<LoadingTask, readonly LoadingMessage[]> = {
  // Up to PASSAGE_TIMEOUT_MS = 110s. The longest wait in the app, so it gets the
  // longest deck; see ReadingPractice for the matching dwell.
  passage: [
    { ar: "نجهز لك نص جديد", en: "Setting up a fresh passage…" },
    { ar: "الدلة على النار", en: "The dallah's on the fire — this one takes a minute" },
    { ar: "نختار كلمات تعرفها", en: "Picking words you already know…" },
    { ar: "نحيك السطور مثل السدو", en: "Weaving the lines like sadu…" },
    { ar: "نحط الحركات", en: "Adding the vowel marks…" },
    { ar: "نراجع الترجمة", en: "Checking the translation…" },
    { ar: "لسه شغالين… ما نسيناك", en: "Still going — we haven't forgotten you" },
  ],

  story: [
    { ar: "نفتح دفتر الحكايات", en: "Opening the book of tales…" },
    { ar: "كان يا ما كان…", en: "Once upon a time…" },
    { ar: "نزوق الحكاية شوي", en: "Adding a little colour…" },
    { ar: "القهوة صبت والحكاية جاية", en: "Coffee's poured, the story's on its way" },
  ],

  episode: [
    { ar: "نكتب حلقة اليوم", en: "Writing today's episode…" },
    { ar: "نرتب مين يقول ايش", en: "Working out who says what…" },
    { ar: "نجهز المجلس", en: "Setting out the majlis…" },
  ],

  episodeAudio: [
    { ar: "نجمع الأصوات", en: "Gathering the voices…" },
    { ar: "المايك شغال", en: "Mic's on — recording…" },
    { ar: "ننظف التسجيل", en: "Tidying up the recording…" },
    { ar: "قربنا نخلص", en: "Nearly there…" },
  ],

  transcribeAnalysis: [
    { ar: "نفك الكلام كلمة كلمة", en: "Unpicking it word by word…" },
    { ar: "ندور على القواعد", en: "Hunting down the grammar…" },
    { ar: "نرتب المفردات", en: "Sorting out the vocabulary…" },
    { ar: "باقي شوي", en: "Almost done…" },
  ],

  pronunciation: [
    { ar: "نسمعك زين", en: "Having a good listen…" },
    { ar: "نقارن نطقك", en: "Comparing your pronunciation…" },
    { ar: "لحظة بس", en: "One moment…" },
  ],

  grammarDrill: [
    { ar: "نطبخ لك تمرين", en: "Cooking up an exercise…" },
    { ar: "نختار الأمثلة", en: "Picking the examples…" },
    { ar: "جاهز بعد شوي", en: "Ready in a moment…" },
  ],

  scrape: [{ ar: "نجيب البوست", en: "Fetching the post…" }],

  analyze: [
    { ar: "نقرا النص", en: "Reading it through…" },
    { ar: "نطلع لك الكلمات المفيدة", en: "Pulling out the useful words…" },
    { ar: "لحظة بس", en: "Just a moment…" },
  ],

  quiz: [
    { ar: "نجهز الأسئلة", en: "Setting your questions…" },
    { ar: "لا تغش!", en: "No peeking…" },
  ],

  image: [
    { ar: "الرسام يرسم", en: "Our artist is painting…" },
    { ar: "نلون الصورة", en: "Adding the colours…" },
  ],

  generic: [
    { ar: "لحظة…", en: "One moment…" },
    { ar: "الدلة على النار", en: "The dallah's on the fire…" },
    { ar: "قربنا نخلص", en: "Nearly there…" },
  ],
};

/**
 * The tutor upload pipeline reports *real* progress (`useTutorUpload` drives a
 * genuine percentage), so it gets no rotating deck — replacing honest stage
 * labels with jokes would be a downgrade. Instead the real English label stays
 * verbatim and picks up an Arabic companion here, matched by prefix so the
 * dynamic "Generating images (3 of 12)…" resolves too.
 */
const TUTOR_COMPANIONS: ReadonlyArray<readonly [prefix: string, ar: string]> = [
  ["Uploading audio", "نرفع التسجيل"],
  ["Transcribing audio", "نفرغ الكلام"],
  ["Segmenting transcript", "نقسم الكلام"],
  ["Classifying vocabulary", "نرتب المفردات"],
  ["Preparing audio clips", "نجهز المقاطع"],
  ["Generating images", "الرسام يرسم"],
  ["Decoding audio", "نفك الصوت"],
  ["Clipping", "نقص المقاطع"],
  ["Saving flashcards", "نحفظ البطاقات"],
];

/** Arabic companion for a real progress label. Falls back to a neutral line. */
export function arabicCompanionFor(label: string): string {
  const hit = TUTOR_COMPANIONS.find(([prefix]) => label.startsWith(prefix));
  return hit ? hit[1] : "شغالين عليها";
}

/**
 * Resolve a deck. `dialect` is accepted but not yet used — it's here so
 * per-dialect decks can land later as a pure addition.
 */
export function getDeck(
  task: LoadingTask,
  _dialect?: string,
): readonly LoadingMessage[] {
  return LOADING_DECKS[task] ?? LOADING_DECKS.generic;
}
