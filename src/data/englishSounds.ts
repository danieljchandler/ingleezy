/**
 * The English Sounds journey — 28 stops teaching the English sound system to
 * Arabic speakers, replacing the old Alphabet Journey (which taught the
 * Arabic alphabet — the wrong direction once the app itself flipped).
 *
 * This is deliberately a SOUND curriculum, not a letter curriculum. Every
 * learner who reaches this page already reads Latin letters — they meet
 * English text throughout the rest of the app. What they don't have is
 * reliable command of the sounds English uses that Arabic doesn't, or of the
 * few dozen sounds Arabic has that map onto English in a way that produces a
 * detectable accent or a real comprehension failure (bit/beat, park/bark).
 * Teaching "the alphabet" would reteach something already known and skip the
 * thing that is actually missing.
 *
 * The order is contrastive-difficulty order, not A-B-C order, synthesised
 * from the applied-linguistics literature on Arabic-L1 English pronunciation
 * (Swan & Smith's "Learner English", TESOL.org's Arabic-speaker pronunciation
 * guidance, and corpus/epenthesis studies on Arabic EFL learners — see
 * RETARGET.md for the research notes). Four groups of seven, matching the
 * four-checkpoint shape the old Journey used:
 *
 *  1. Sounds Arabic already has (م ب ت د س ن ل) — fast, confidence-building,
 *     almost no new teaching, but still worth walking through explicitly
 *     because a beginner's ear needs to hear them named before it can hear
 *     what is different about stop 22 onward.
 *  2. The rest of the "familiar" set, ending on ر — same letter-concept as
 *     Arabic's ر, different mechanics (an English /r/ is not a tap or trill).
 *  3. Sounds that are genuinely IN Arabic but easy to mis-teach as absent —
 *     ش ث ذ — plus the dialect-dependent ق/ج → /g/ case, then the vowel
 *     LENGTH bridge: Arabic already marks short vs long vowels (فتحة vs
 *     ألف), so beat/bit and fool/full and bet/bat are taught as "the same
 *     length idea you already have, on a vowel English also splits by
 *     quality."
 *  4. The sounds Arabic genuinely does not have: /p/, /v/, /tʃ/, /ŋ/, /ʒ/ —
 *     each taught by contrast against the Arabic sound a learner's ear will
 *     substitute — plus consonant clusters (Arabic syllable structure
 *     forbids most of English's, producing the well-documented "sipring"/
 *     "isport" vowel-epenthesis repair) and final-consonant devoicing,
 *     which the literature flags as disproportionately important because
 *     it is a WORD-FINAL phenomenon and Arabic-L1 errors cluster there.
 *
 * Every phonology rule this curriculum teaches against is also one of the
 * three hardcoded FALLBACK_INTERFERENCE_RULES the AI coaching prompts use
 * (supabase/functions/_shared/englishPromptCore.ts) — p→b, v→f, cluster
 * epenthesis — so a learner who walks this Journey meets the same three
 * patterns the writing coach and pronunciation feedback are already primed
 * to watch for.
 */

/** One "how is it spelled" example for the Spell step. */
export interface SoundSpelling {
  /** The letter or letters that write this sound, e.g. "th", "ee", "ph". */
  grapheme: string;
  /** A real word using that spelling. */
  example: string;
}

/** One example word for the Examples step, tagged by where the sound sits. */
export interface SoundExample {
  en: string;
  /** Arabic gloss of the whole word — the scaffold, not the target. */
  ar: string;
  position: "initial" | "medial" | "final";
}

/** One word for the Spot step's "tap every word with this sound" grid. */
export interface SpotWord {
  word: string;
  hasSound: boolean;
}

/**
 * One pair for the Spell/Contrast steps: the target word, and the word an
 * Arabic-speaking ear is documented to substitute for it (park/bark), or —
 * for the vowel-length and cluster/devoicing stops, where there is no single
 * "the" substitution — the nearest real-word minimal contrast that makes the
 * same point audible (spend/send, bag/back).
 */
export interface MinimalPair {
  target: string;
  confuse: string;
}

export interface EnglishSound {
  code: string;
  order_index: number;
  /** Big glyph shown on the Meet step. */
  display: string;
  /** IPA, shown small beside the glyph. */
  ipa: string;
  keyword: string;
  keyword_ar: string;
  /**
   * Place-and-manner instructions only — tongue/lip/teeth position. The
   * voicing check (hand on throat) is generated once in MouthGuidePanel from
   * `voiced`, rather than repeated in every entry.
   */
  mouth_ar: string;
  /** The specific Arabic-L1 pitfall for this sound, one or two sentences. */
  interference_ar: string;
  /** Omitted for vowel/concept stops where voicing isn't the teaching point. */
  voiced?: boolean;
  spellings: SoundSpelling[];
  examples: SoundExample[];
  spotWords: SpotWord[];
  minimalPairs: MinimalPair[];
}

export const ENGLISH_SOUNDS: EnglishSound[] = [
  // ── Group A: sounds Arabic already has — fast, confidence-building ───────
  {
    code: "m", order_index: 0, display: "m", ipa: "/m/", keyword: "moon", keyword_ar: "قمر", voiced: true,
    mouth_ar: "أغلق شفتيك تماماً ودع الصوت يخرج من الأنف — تماماً مثل حرف م العربي.",
    interference_ar: "لا يوجد فرق يُذكر هنا. هذا التوقف سريع ليبني ثقتك قبل الأصوات الأصعب.",
    spellings: [{ grapheme: "m", example: "moon" }, { grapheme: "mm", example: "summer" }],
    examples: [
      { en: "moon", ar: "قمر", position: "initial" },
      { en: "camera", ar: "كاميرا", position: "medial" },
      { en: "team", ar: "فريق", position: "final" },
    ],
    spotWords: [
      { word: "moon", hasSound: true }, { word: "sun", hasSound: false },
      { word: "summer", hasSound: true }, { word: "winter", hasSound: false },
      { word: "team", hasSound: true }, { word: "boat", hasSound: false },
      { word: "camera", hasSound: true }, { word: "chair", hasSound: false },
    ],
    minimalPairs: [{ target: "moon", confuse: "noon" }, { target: "team", confuse: "teen" }],
  },
  {
    code: "b", order_index: 1, display: "b", ipa: "/b/", keyword: "book", keyword_ar: "كتاب", voiced: true,
    mouth_ar: "أغلق شفتيك ثم افتحهما فجأة مع صوت من حنجرتك — تماماً مثل حرف ب العربي.",
    interference_ar: "سهل عليك — لكن انتبه لاحقاً: هذا هو الصوت الذي يستبدل به المتحدثون بالعربية صوت /p/ الإنجليزي.",
    spellings: [{ grapheme: "b", example: "book" }, { grapheme: "bb", example: "rabbit" }],
    examples: [
      { en: "book", ar: "كتاب", position: "initial" },
      { en: "table", ar: "طاولة", position: "medial" },
      { en: "job", ar: "وظيفة", position: "final" },
    ],
    spotWords: [
      { word: "book", hasSound: true }, { word: "cook", hasSound: false },
      { word: "table", hasSound: true }, { word: "chair", hasSound: false },
      { word: "job", hasSound: true }, { word: "car", hasSound: false },
      { word: "rabbit", hasSound: true }, { word: "mouse", hasSound: false },
    ],
    minimalPairs: [{ target: "book", confuse: "cook" }, { target: "job", confuse: "jog" }],
  },
  {
    code: "t", order_index: 2, display: "t", ipa: "/t/", keyword: "table", keyword_ar: "طاولة",
    voiced: false,
    mouth_ar: "ضع طرف لسانك خلف أسنانك العلوية مباشرة وأطلق الهواء فجأة — قريب من حرف ت العربي.",
    interference_ar: "قريب جداً من العربية. الفرق الوحيد أن الإنجليزية أحياناً تنفخ هواءً أقوى في بداية الكلمة.",
    spellings: [{ grapheme: "t", example: "table" }, { grapheme: "tt", example: "letter" }, { grapheme: "ed", example: "walked" }],
    examples: [
      { en: "table", ar: "طاولة", position: "initial" },
      { en: "letter", ar: "رسالة", position: "medial" },
      { en: "cat", ar: "قطة", position: "final" },
    ],
    spotWords: [
      { word: "table", hasSound: true }, { word: "sofa", hasSound: false },
      { word: "letter", hasSound: true }, { word: "money", hasSound: false },
      { word: "cat", hasSound: true }, { word: "dog", hasSound: false },
      { word: "start", hasSound: true }, { word: "finish", hasSound: false },
    ],
    minimalPairs: [{ target: "cat", confuse: "cap" }, { target: "letter", confuse: "ledger" }],
  },
  {
    code: "d", order_index: 3, display: "d", ipa: "/d/", keyword: "door", keyword_ar: "باب", voiced: true,
    mouth_ar: "نفس وضع /t/ — طرف اللسان خلف الأسنان العلوية — لكن مع اهتزاز في حلقك. مثل حرف د العربي.",
    interference_ar: "لا صعوبة هنا؛ استخدمه لاحقاً كمرجع صوتي عند تعلّم /t/ في نهاية الكلمة (خطوة final_devoicing).",
    spellings: [{ grapheme: "d", example: "door" }, { grapheme: "dd", example: "ladder" }, { grapheme: "ed", example: "played" }],
    examples: [
      { en: "door", ar: "باب", position: "initial" },
      { en: "ladder", ar: "سلّم", position: "medial" },
      { en: "friend", ar: "صديق", position: "final" },
    ],
    spotWords: [
      { word: "door", hasSound: true }, { word: "wall", hasSound: false },
      { word: "ladder", hasSound: true }, { word: "window", hasSound: false },
      { word: "friend", hasSound: true }, { word: "family", hasSound: false },
      { word: "sad", hasSound: true }, { word: "happy", hasSound: false },
    ],
    minimalPairs: [{ target: "door", confuse: "tore" }, { target: "sad", confuse: "sat" }],
  },
  {
    code: "s", order_index: 4, display: "s", ipa: "/s/", keyword: "sun", keyword_ar: "شمس", voiced: false,
    mouth_ar: "ضع طرف لسانك قريباً من سقف الفم خلف الأسنان ودع الهواء يمرّ بصفير — تماماً مثل حرف س العربي.",
    interference_ar: "سهل، لكن انتبه لجمع الأسماء الإنجليزية: تُنطق s أحياناً /s/ وأحياناً /z/ حسب الحرف قبلها.",
    spellings: [{ grapheme: "s", example: "sun" }, { grapheme: "ss", example: "class" }, { grapheme: "c", example: "city" }],
    examples: [
      { en: "sun", ar: "شمس", position: "initial" },
      { en: "lesson", ar: "درس", position: "medial" },
      { en: "bus", ar: "حافلة", position: "final" },
    ],
    spotWords: [
      { word: "sun", hasSound: true }, { word: "moon", hasSound: false },
      { word: "lesson", hasSound: true }, { word: "answer", hasSound: false },
      { word: "bus", hasSound: true }, { word: "car", hasSound: false },
      { word: "class", hasSound: true }, { word: "team", hasSound: false },
    ],
    minimalPairs: [{ target: "bus", confuse: "buzz" }, { target: "sink", confuse: "zinc" }],
  },
  {
    code: "n", order_index: 5, display: "n", ipa: "/n/", keyword: "night", keyword_ar: "ليل", voiced: true,
    mouth_ar: "ضع طرف لسانك خلف الأسنان العلوية ودع الصوت يخرج من الأنف — تماماً مثل حرف ن العربي.",
    interference_ar: "لا صعوبة هنا. احتفظ به كمرجع: صوت /ŋ/ لاحقاً هو نفس هذا الصوت لكن من الحلق لا من الأسنان.",
    spellings: [{ grapheme: "n", example: "night" }, { grapheme: "nn", example: "dinner" }, { grapheme: "kn", example: "know" }],
    examples: [
      { en: "night", ar: "ليل", position: "initial" },
      { en: "dinner", ar: "عشاء", position: "medial" },
      { en: "sun", ar: "شمس", position: "final" },
    ],
    spotWords: [
      { word: "night", hasSound: true }, { word: "day", hasSound: false },
      { word: "dinner", hasSound: true }, { word: "lunch", hasSound: false },
      { word: "sun", hasSound: true }, { word: "moon", hasSound: false },
      { word: "know", hasSound: true }, { word: "learn", hasSound: false },
    ],
    minimalPairs: [{ target: "night", confuse: "light" }, { target: "sun", confuse: "sum" }],
  },
  {
    code: "l", order_index: 6, display: "l", ipa: "/l/", keyword: "light", keyword_ar: "نور", voiced: true,
    mouth_ar: "ضع طرف لسانك خلف الأسنان العلوية ودع الصوت يمرّ من جانبي اللسان — تماماً مثل حرف ل العربي.",
    interference_ar: "سهل في أول الكلمة. الأصعب هو /l/ في نهاية الكلمة (مثل table)، حيث يميل اللسان العربي لتفخيمه أكثر من اللازم.",
    spellings: [{ grapheme: "l", example: "light" }, { grapheme: "ll", example: "yellow" }],
    examples: [
      { en: "light", ar: "نور", position: "initial" },
      { en: "yellow", ar: "أصفر", position: "medial" },
      { en: "table", ar: "طاولة", position: "final" },
    ],
    spotWords: [
      { word: "light", hasSound: true }, { word: "dark", hasSound: false },
      { word: "yellow", hasSound: true }, { word: "orange", hasSound: false },
      { word: "table", hasSound: true }, { word: "desk", hasSound: false },
      { word: "small", hasSound: true }, { word: "big", hasSound: false },
    ],
    minimalPairs: [{ target: "light", confuse: "right" }, { target: "load", confuse: "road" }],
  },

  // ── Group B: the rest of the familiar set, ending on the retrained ر ─────
  {
    code: "k", order_index: 7, display: "k", ipa: "/k/", keyword: "key", keyword_ar: "مفتاح", voiced: false,
    mouth_ar: "ارفع مؤخرة لسانك لتلمس سقف الحلق ثم أطلق الهواء فجأة — تماماً مثل حرف ك العربي.",
    interference_ar: "سهل، لكن قارنه لاحقاً بصوت /g/ (خطوة g) الذي ينطقه بعض اللهجات الخليجية والمصرية بشكل طبيعي.",
    spellings: [{ grapheme: "k", example: "key" }, { grapheme: "c", example: "cat" }, { grapheme: "ck", example: "back" }],
    examples: [
      { en: "key", ar: "مفتاح", position: "initial" },
      { en: "market", ar: "سوق", position: "medial" },
      { en: "back", ar: "ظهر", position: "final" },
    ],
    spotWords: [
      { word: "key", hasSound: true }, { word: "door", hasSound: false },
      { word: "market", hasSound: true }, { word: "store", hasSound: false },
      { word: "back", hasSound: true }, { word: "front", hasSound: false },
      { word: "cat", hasSound: true }, { word: "dog", hasSound: false },
    ],
    minimalPairs: [{ target: "back", confuse: "bag" }, { target: "cap", confuse: "cab" }],
  },
  {
    code: "f", order_index: 8, display: "f", ipa: "/f/", keyword: "face", keyword_ar: "وجه", voiced: false,
    mouth_ar: "ضع أسنانك العلوية على شفتك السفلى ودع الهواء يمرّ بينهما — تماماً مثل حرف ف العربي.",
    interference_ar: "سهل، وهو أيضاً الصوت الذي يستبدل به المتحدثون بالعربية صوت /v/ الإنجليزي — راجع خطوة v لاحقاً.",
    spellings: [{ grapheme: "f", example: "face" }, { grapheme: "ff", example: "coffee" }, { grapheme: "ph", example: "phone" }],
    examples: [
      { en: "face", ar: "وجه", position: "initial" },
      { en: "coffee", ar: "قهوة", position: "medial" },
      { en: "leaf", ar: "ورقة شجر", position: "final" },
    ],
    spotWords: [
      { word: "face", hasSound: true }, { word: "hand", hasSound: false },
      { word: "coffee", hasSound: true }, { word: "tea", hasSound: false },
      { word: "leaf", hasSound: true }, { word: "root", hasSound: false },
      { word: "phone", hasSound: true }, { word: "watch", hasSound: false },
    ],
    minimalPairs: [{ target: "fan", confuse: "van" }, { target: "leaf", confuse: "leave" }],
  },
  {
    code: "h", order_index: 9, display: "h", ipa: "/h/", keyword: "house", keyword_ar: "بيت", voiced: false,
    mouth_ar: "افتح فمك قليلاً وأطلق نفَساً هادئاً بلا احتكاك — أخفّ من حرف ه العربي، وأخفّ بكثير من ح.",
    interference_ar: "الخطر هو نطقه أقوى مما يجب، قريباً من ح العربية. اجعله نفَساً خفيفاً جداً لا احتكاكاً في الحلق.",
    spellings: [{ grapheme: "h", example: "house" }, { grapheme: "wh", example: "who" }],
    examples: [
      { en: "house", ar: "بيت", position: "initial" },
      { en: "behind", ar: "خلف", position: "medial" },
    ],
    spotWords: [
      { word: "house", hasSound: true }, { word: "car", hasSound: false },
      { word: "behind", hasSound: true }, { word: "under", hasSound: false },
      { word: "hand", hasSound: true }, { word: "arm", hasSound: false },
      { word: "who", hasSound: true }, { word: "what", hasSound: false },
    ],
    minimalPairs: [{ target: "hat", confuse: "at" }, { target: "hill", confuse: "ill" }],
  },
  {
    code: "w", order_index: 10, display: "w", ipa: "/w/", keyword: "water", keyword_ar: "ماء", voiced: true,
    mouth_ar: "دوّر شفتيك كأنك ستصفر، ثم افتحهما وأنت تنطق الصوت — تماماً مثل حرف و العربي.",
    interference_ar: "لا صعوبة هنا. لا تخلطه مع /v/ — الشفتان مستديرتان في /w/ ولا تلمس الأسنانَ الشفةَ كما في /v/.",
    spellings: [{ grapheme: "w", example: "water" }, { grapheme: "wh", example: "where" }],
    examples: [
      { en: "water", ar: "ماء", position: "initial" },
      { en: "away", ar: "بعيداً", position: "medial" },
    ],
    spotWords: [
      { word: "water", hasSound: true }, { word: "fire", hasSound: false },
      { word: "away", hasSound: true }, { word: "here", hasSound: false },
      { word: "window", hasSound: true }, { word: "door", hasSound: false },
      { word: "west", hasSound: true }, { word: "east", hasSound: false },
    ],
    minimalPairs: [{ target: "west", confuse: "vest" }, { target: "wine", confuse: "vine" }],
  },
  {
    code: "y", order_index: 11, display: "y", ipa: "/j/", keyword: "yes", keyword_ar: "نعم", voiced: true,
    mouth_ar: "ارفع وسط لسانك قريباً من سقف الفم كأنك ستقول /i/ ثم انزلق منه — تماماً مثل حرف ي العربي.",
    interference_ar: "لا صعوبة هنا. الالتباس الوحيد هو مع j في بداية كلمات مثل job، والتي تُنطق /dʒ/ لا /j/.",
    spellings: [{ grapheme: "y", example: "yes" }, { grapheme: "u", example: "university" }],
    examples: [
      { en: "yes", ar: "نعم", position: "initial" },
      { en: "beyond", ar: "أبعد من", position: "medial" },
    ],
    spotWords: [
      { word: "yes", hasSound: true }, { word: "no", hasSound: false },
      { word: "year", hasSound: true }, { word: "month", hasSound: false },
      { word: "yellow", hasSound: true }, { word: "blue", hasSound: false },
      { word: "young", hasSound: true }, { word: "old", hasSound: false },
    ],
    minimalPairs: [{ target: "yet", confuse: "jet" }, { target: "yolk", confuse: "joke" }],
  },
  {
    code: "z", order_index: 12, display: "z", ipa: "/z/", keyword: "zoo", keyword_ar: "حديقة حيوانات", voiced: true,
    mouth_ar: "نفس وضع /s/ — طرف اللسان قريب من سقف الفم — لكن مع اهتزاز في حلقك. مثل حرف ز العربي.",
    interference_ar: "الفخ الشائع: نهايات الجمع مثل dogs وboys تُكتب s لكنها تُنطق /z/ — والعربية لا تفرّق بينهما كتابياً فينسى المتعلم النطق المجهور.",
    spellings: [{ grapheme: "z", example: "zoo" }, { grapheme: "s", example: "dogs" }, { grapheme: "se", example: "cheese" }],
    examples: [
      { en: "zoo", ar: "حديقة حيوانات", position: "initial" },
      { en: "dozen", ar: "دزينة", position: "medial" },
      { en: "cheese", ar: "جبن", position: "final" },
    ],
    spotWords: [
      { word: "zoo", hasSound: true }, { word: "park", hasSound: false },
      { word: "dozen", hasSound: true }, { word: "pair", hasSound: false },
      { word: "cheese", hasSound: true }, { word: "bread", hasSound: false },
      { word: "dogs", hasSound: true }, { word: "cats", hasSound: false },
    ],
    minimalPairs: [{ target: "zoo", confuse: "sue" }, { target: "prize", confuse: "price" }],
  },
  {
    code: "r", order_index: 13, display: "r", ipa: "/r/", keyword: "red", keyword_ar: "أحمر", voiced: true,
    mouth_ar: "اجعل طرف لسانك يرتفع دون أن يلمس سقف الفم، وحافظ عليه ثابتاً — لا رجّة ولا نقرة، فقط انزلاقة واحدة ناعمة.",
    interference_ar: "نفس الحرف ر موجود في العربية لكن بآلية مختلفة تماماً: العربية تُرجّج اللسان (تكراره)، والإنجليزية لا. الرَّجرجة هي أوضح علامة على لكنة عربية في الإنجليزية.",
    spellings: [{ grapheme: "r", example: "red" }, { grapheme: "rr", example: "sorry" }, { grapheme: "wr", example: "write" }],
    examples: [
      { en: "red", ar: "أحمر", position: "initial" },
      { en: "sorry", ar: "آسف", position: "medial" },
      { en: "car", ar: "سيارة", position: "final" },
    ],
    spotWords: [
      { word: "red", hasSound: true }, { word: "blue", hasSound: false },
      { word: "sorry", hasSound: true }, { word: "happy", hasSound: false },
      { word: "car", hasSound: true }, { word: "bus", hasSound: false },
      { word: "write", hasSound: true }, { word: "read", hasSound: true },
    ],
    minimalPairs: [{ target: "red", confuse: "led" }, { target: "right", confuse: "light" }],
  },

  // ── Group C: sounds already IN Arabic (don't under-teach them), the ─────
  // ── dialect-dependent /g/, and the vowel-LENGTH bridge ───────────────────
  {
    code: "sh", order_index: 14, display: "sh", ipa: "/ʃ/", keyword: "shoe", keyword_ar: "حذاء", voiced: false,
    mouth_ar: "دوّر شفتيك قليلاً للأمام وارفع وسط لسانك قريباً من سقف الفم — تماماً مثل حرف ش العربي.",
    interference_ar: "هذا الصوت موجود في العربية بالضبط — احتفظ به كمرجع صوتي حين تصل إلى /tʃ/ (خطوة ch)، وهو النفخة نفسها لكن مع بداية انفجارية.",
    spellings: [{ grapheme: "sh", example: "shoe" }, { grapheme: "ti", example: "nation" }, { grapheme: "ci", example: "special" }],
    examples: [
      { en: "shoe", ar: "حذاء", position: "initial" },
      { en: "washing", ar: "غسيل", position: "medial" },
      { en: "fish", ar: "سمك", position: "final" },
    ],
    spotWords: [
      { word: "shoe", hasSound: true }, { word: "sock", hasSound: false },
      { word: "washing", hasSound: true }, { word: "cooking", hasSound: false },
      { word: "fish", hasSound: true }, { word: "meat", hasSound: false },
      { word: "shop", hasSound: true }, { word: "sit", hasSound: false },
    ],
    minimalPairs: [{ target: "shoe", confuse: "sue" }, { target: "wash", confuse: "was" }],
  },
  {
    code: "th_voiceless", order_index: 15, display: "th", ipa: "/θ/", keyword: "think", keyword_ar: "فكّر", voiced: false,
    mouth_ar: "ضع طرف لسانك بين أسنانك العلوية والسفلية بخفة ودع الهواء يمرّ من حوله — تماماً مثل حرف ث العربي الفصيح.",
    interference_ar: "الصوت نفسه موجود في الفصحى (ث)، لكن كثيراً من اللهجات العامية تستبدله بـ /t/ أو /s/ في الحديث اليومي — فقد يحتاج لسانك إعادة تدريب رغم أنك 'تعرف' الحرف.",
    spellings: [{ grapheme: "th", example: "think" }],
    examples: [
      { en: "think", ar: "فكّر", position: "initial" },
      { en: "author", ar: "مؤلّف", position: "medial" },
      { en: "bath", ar: "حمّام", position: "final" },
    ],
    spotWords: [
      { word: "think", hasSound: true }, { word: "know", hasSound: false },
      { word: "author", hasSound: true }, { word: "writer", hasSound: false },
      { word: "bath", hasSound: true }, { word: "sink", hasSound: false },
      { word: "three", hasSound: true }, { word: "four", hasSound: false },
    ],
    minimalPairs: [{ target: "think", confuse: "sink" }, { target: "bath", confuse: "bat" }],
  },
  {
    code: "th_voiced", order_index: 16, display: "th", ipa: "/ð/", keyword: "this", keyword_ar: "هذا", voiced: true,
    mouth_ar: "نفس وضع /θ/ — طرف اللسان بين الأسنان — لكن مع اهتزاز في حلقك. مثل حرف ذ العربي الفصيح.",
    interference_ar: "نفس ملاحظة /θ/: موجود في الفصحى (ذ) لكن العامية غالباً تستبدله بـ /d/ أو /z/. كلمات الوظائف الشائعة (this, that, the) كلها تستخدمه — تجاهله يُسمع في كل جملة تقريباً.",
    spellings: [{ grapheme: "th", example: "this" }],
    examples: [
      { en: "this", ar: "هذا", position: "initial" },
      { en: "mother", ar: "أمّ", position: "medial" },
      { en: "breathe", ar: "يتنفّس", position: "final" },
    ],
    spotWords: [
      { word: "this", hasSound: true }, { word: "that", hasSound: true },
      { word: "mother", hasSound: true }, { word: "father", hasSound: true },
      { word: "cat", hasSound: false }, { word: "dog", hasSound: false },
      { word: "breathe", hasSound: true }, { word: "sleep", hasSound: false },
    ],
    minimalPairs: [{ target: "this", confuse: "dis" }, { target: "then", confuse: "den" }],
  },
  {
    code: "g", order_index: 17, display: "g", ipa: "/g/", keyword: "green", keyword_ar: "أخضر", voiced: true,
    mouth_ar: "نفس وضع /k/ — مؤخرة اللسان تلمس سقف الحلق — لكن مع اهتزاز في حلقك.",
    interference_ar: "ليس صوتاً غريباً على أذنك: كثير من اللهجات الخليجية تنطق حرف ق هكذا، والمصرية تنطق ج هكذا. لكن لا حرف عربي واحد يكتبه دائماً — لهذا احفظ الصوت لا الحرف.",
    spellings: [{ grapheme: "g", example: "green" }, { grapheme: "gg", example: "bigger" }, { grapheme: "gu", example: "guest" }],
    examples: [
      { en: "green", ar: "أخضر", position: "initial" },
      { en: "bigger", ar: "أكبر", position: "medial" },
      { en: "dog", ar: "كلب", position: "final" },
    ],
    spotWords: [
      { word: "green", hasSound: true }, { word: "blue", hasSound: false },
      { word: "bigger", hasSound: true }, { word: "smaller", hasSound: false },
      { word: "dog", hasSound: true }, { word: "cat", hasSound: false },
      { word: "guest", hasSound: true }, { word: "host", hasSound: false },
    ],
    minimalPairs: [{ target: "goat", confuse: "coat" }, { target: "big", confuse: "bick" }],
  },
  {
    code: "beat_bit", order_index: 18, display: "ee · i", ipa: "/iː/ vs /ɪ/", keyword: "beat / bit", keyword_ar: "يضرب / قطعة صغيرة", voiced: undefined,
    mouth_ar: "كلا الصوتين من مقدمة اللسان، لكن /iː/ أطول وأشدّ توتراً في اللسان، و/ɪ/ أقصر وأرخى — نفس فكرة الحركة الطويلة والقصيرة في العربية (فتحة مقابل ألف)، لكن هنا الفرق أيضاً في جودة الصوت لا الطول فقط.",
    interference_ar: "الفصحى لا تملك إلا /i/ الطويلة و/i/ القصيرة كنفس الصوت بطولين — فأذنك تسمع bit وbeat كأنهما نفس الحركة بطول مختلف فقط، فتخلط بين الكلمتين تماماً.",
    spellings: [{ grapheme: "ee", example: "sheep" }, { grapheme: "ea", example: "beat" }, { grapheme: "i", example: "bit" }],
    examples: [
      { en: "sheep", ar: "خروف", position: "medial" },
      { en: "ship", ar: "سفينة", position: "medial" },
      { en: "sleep", ar: "ينام", position: "medial" },
    ],
    spotWords: [
      { word: "sheep", hasSound: true }, { word: "ship", hasSound: false },
      { word: "beat", hasSound: true }, { word: "bit", hasSound: false },
      { word: "green", hasSound: true }, { word: "sit", hasSound: false },
      { word: "sleep", hasSound: true }, { word: "big", hasSound: false },
    ],
    minimalPairs: [{ target: "sheep", confuse: "ship" }, { target: "beat", confuse: "bit" }, { target: "seat", confuse: "sit" }],
  },
  {
    code: "fool_full", order_index: 19, display: "oo · u", ipa: "/uː/ vs /ʊ/", keyword: "fool / full", keyword_ar: "أحمق / ممتلئ", voiced: undefined,
    mouth_ar: "كلاهما بشفتين مستديرتين، لكن /uː/ أطول مع شفتين أشدّ استدارة، و/ʊ/ أقصر وأرخى — نفس فكرة الضمة الطويلة (و) مقابل القصيرة في العربية، مع فرق إضافي في جودة الصوت.",
    interference_ar: "نفس مشكلة beat/bit: أذنك المعتادة على الفصحى تسمعهما صوتاً واحداً بطولين، فتخلط pool بـ pull وfool بـ full.",
    spellings: [{ grapheme: "oo", example: "food" }, { grapheme: "u", example: "put" }, { grapheme: "oul", example: "could" }],
    examples: [
      { en: "food", ar: "طعام", position: "medial" },
      { en: "book", ar: "كتاب", position: "medial" },
      { en: "put", ar: "يضع", position: "medial" },
    ],
    spotWords: [
      { word: "food", hasSound: true }, { word: "book", hasSound: false },
      { word: "pool", hasSound: true }, { word: "pull", hasSound: false },
      { word: "moon", hasSound: true }, { word: "put", hasSound: false },
      { word: "fool", hasSound: true }, { word: "full", hasSound: false },
    ],
    minimalPairs: [{ target: "pool", confuse: "pull" }, { target: "fool", confuse: "full" }, { target: "Luke", confuse: "look" }],
  },
  {
    code: "bet_bat", order_index: 20, display: "e · a", ipa: "/ɛ/ vs /æ/", keyword: "bet / bat", keyword_ar: "رهان / مضرب", voiced: undefined,
    mouth_ar: "كلاهما من وسط الفم، لكن /æ/ يحتاج فكاً مفتوحاً أكثر بكثير من /ɛ/ — كأنك تبتسم وتفتح فمك بوضوح لصوت /æ/.",
    interference_ar: "لا يوجد صوت /æ/ في الفصحى إطلاقاً — أقرب صوت لديك هو الفتحة العادية، فتُنطق bat وbet متشابهتين. افتح فكك أكثر مما تشعر أنه طبيعي.",
    spellings: [{ grapheme: "e", example: "bed" }, { grapheme: "a", example: "cat" }],
    examples: [
      { en: "bed", ar: "سرير", position: "medial" },
      { en: "cat", ar: "قطة", position: "medial" },
      { en: "man", ar: "رجل", position: "medial" },
    ],
    spotWords: [
      { word: "bed", hasSound: true }, { word: "bad", hasSound: false },
      { word: "pen", hasSound: true }, { word: "pan", hasSound: false },
      { word: "ten", hasSound: true }, { word: "man", hasSound: false },
      { word: "let", hasSound: true }, { word: "lat", hasSound: false },
    ],
    minimalPairs: [{ target: "bed", confuse: "bad" }, { target: "pen", confuse: "pan" }, { target: "met", confuse: "mat" }],
  },

  // ── Group D: sounds Arabic doesn't have, taught by direct contrast; ─────
  // ── clusters and final devoicing as the capstone concepts ───────────────
  {
    code: "p", order_index: 21, display: "p", ipa: "/p/", keyword: "park", keyword_ar: "حديقة", voiced: false,
    mouth_ar: "نفس وضع /b/ تماماً — الشفتان تُغلقان ثم تُفتحان فجأة — لكن بلا أي اهتزاز في حلقك، ومع نفخة هواء أقوى.",
    interference_ar: "لا يوجد /p/ في العربية إطلاقاً، فيستبدله كل متحدث بـ /b/ تلقائياً: park تصبح bark، people تصبح beople. ضع يدك أمام فمك — يجب أن تشعر بنفخة هواء واضحة لا تشعر بها في /b/.",
    spellings: [{ grapheme: "p", example: "park" }, { grapheme: "pp", example: "happy" }],
    examples: [
      { en: "park", ar: "حديقة", position: "initial" },
      { en: "happy", ar: "سعيد", position: "medial" },
      { en: "stop", ar: "يتوقف", position: "final" },
    ],
    spotWords: [
      { word: "park", hasSound: true }, { word: "bark", hasSound: false },
      { word: "happy", hasSound: true }, { word: "baby", hasSound: false },
      { word: "stop", hasSound: true }, { word: "start", hasSound: false },
      { word: "pen", hasSound: true }, { word: "ben", hasSound: false },
    ],
    minimalPairs: [{ target: "park", confuse: "bark" }, { target: "pin", confuse: "bin" }, { target: "cap", confuse: "cab" }],
  },
  {
    code: "v", order_index: 22, display: "v", ipa: "/v/", keyword: "very", keyword_ar: "جداً", voiced: true,
    mouth_ar: "نفس وضع /f/ تماماً — الأسنان العلوية على الشفة السفلى — لكن مع اهتزاز في حلقك.",
    interference_ar: "لا يوجد /v/ في العربية، فيستبدله كل متحدث بـ /f/: very تصبح ferry، village تصبح fillage. ضع يدك على حلقك — يجب أن تشعر باهتزاز واضح لا تشعر به في /f/.",
    spellings: [{ grapheme: "v", example: "very" }, { grapheme: "ve", example: "have" }],
    examples: [
      { en: "very", ar: "جداً", position: "initial" },
      { en: "travel", ar: "يسافر", position: "medial" },
      { en: "have", ar: "يملك", position: "final" },
    ],
    spotWords: [
      { word: "very", hasSound: true }, { word: "ferry", hasSound: false },
      { word: "travel", hasSound: true }, { word: "trouble", hasSound: false },
      { word: "have", hasSound: true }, { word: "half", hasSound: false },
      { word: "village", hasSound: true }, { word: "filling", hasSound: false },
    ],
    minimalPairs: [{ target: "very", confuse: "ferry" }, { target: "van", confuse: "fan" }, { target: "vine", confuse: "fine" }],
  },
  {
    code: "ch", order_index: 23, display: "ch", ipa: "/tʃ/", keyword: "chair", keyword_ar: "كرسي", voiced: false,
    mouth_ar: "ابدأ بلسانك ملتصقاً بسقف الفم كأنك ستقول /t/، ثم أطلقه بسرعة إلى وضع /sh/ — إنه اندماج الصوتين في حركة واحدة.",
    interference_ar: "ليس صوتاً موجوداً وحده في العربية، فتسمعه أذنك أقرب لـ /sh/ العادي وتُسقط بداية /t/ الانفجارية: chair تصبح أقرب لـ shair.",
    spellings: [{ grapheme: "ch", example: "chair" }, { grapheme: "tch", example: "watch" }],
    examples: [
      { en: "chair", ar: "كرسي", position: "initial" },
      { en: "teacher", ar: "معلّم", position: "medial" },
      { en: "watch", ar: "ساعة", position: "final" },
    ],
    spotWords: [
      { word: "chair", hasSound: true }, { word: "share", hasSound: false },
      { word: "teacher", hasSound: true }, { word: "student", hasSound: false },
      { word: "watch", hasSound: true }, { word: "wash", hasSound: false },
      { word: "cheap", hasSound: true }, { word: "sheep", hasSound: false },
    ],
    minimalPairs: [{ target: "chair", confuse: "share" }, { target: "cheap", confuse: "sheep" }, { target: "watch", confuse: "wash" }],
  },
  {
    code: "ng", order_index: 24, display: "ng", ipa: "/ŋ/", keyword: "sing", keyword_ar: "يغنّي", voiced: true,
    mouth_ar: "ارفع مؤخرة لسانك لتلمس سقف الحلق — نفس وضع /g/ تماماً — لكن دع الصوت يخرج من الأنف بدل الفم.",
    interference_ar: "في العربية يظهر هذا الصوت فقط تلقائياً قبل ك أو ق (مثل عنكبوت)، وليس صوتاً مستقلاً بنهاية كلمة. لذا نهايات -ing الإنجليزية تُنطق خطأً /n/+/g/ منفصلين، أو /n/+/k/ — جرّب دون أن تُغلق فمك بعدها إطلاقاً.",
    spellings: [{ grapheme: "ng", example: "sing" }, { grapheme: "n", example: "think" }],
    examples: [
      { en: "sing", ar: "يغنّي", position: "final" },
      { en: "morning", ar: "صباح", position: "medial" },
      { en: "strong", ar: "قوي", position: "final" },
    ],
    spotWords: [
      { word: "sing", hasSound: true }, { word: "sin", hasSound: false },
      { word: "morning", hasSound: true }, { word: "moaning", hasSound: false },
      { word: "strong", hasSound: true }, { word: "strung", hasSound: true },
      { word: "run", hasSound: false }, { word: "long", hasSound: true },
    ],
    minimalPairs: [{ target: "sing", confuse: "sin" }, { target: "running", confuse: "runnin'" }],
  },
  {
    code: "zh", order_index: 25, display: "zh", ipa: "/ʒ/", keyword: "measure", keyword_ar: "يقيس", voiced: true,
    mouth_ar: "نفس وضع /sh/ تماماً — لكن مع اهتزاز في حلقك. أندر أصوات الإنجليزية، ويظهر غالباً في وسط الكلمة لا أولها.",
    interference_ar: "غير موجود في العربية، فيُستبدل غالباً بـ /sh/ العادي (بلا اهتزاز): يبدو measure وكأنها mesher. أصله كلمات مستعارة من الفرنسية، فلا تقلق من ندرته.",
    spellings: [{ grapheme: "s", example: "measure" }, { grapheme: "si", example: "vision" }, { grapheme: "g", example: "beige" }],
    examples: [
      { en: "measure", ar: "يقيس", position: "medial" },
      { en: "vision", ar: "رؤية", position: "medial" },
      { en: "beige", ar: "بيج", position: "final" },
    ],
    spotWords: [
      { word: "measure", hasSound: true }, { word: "pleasure", hasSound: true },
      { word: "vision", hasSound: true }, { word: "mission", hasSound: false },
      { word: "beige", hasSound: true }, { word: "page", hasSound: false },
      { word: "usual", hasSound: true }, { word: "casual", hasSound: true },
    ],
    minimalPairs: [{ target: "vision", confuse: "mission" }, { target: "leisure", confuse: "lesion" }],
  },
  {
    code: "clusters", order_index: 26, display: "str-", ipa: "CCC-", keyword: "street", keyword_ar: "شارع", voiced: undefined,
    mouth_ar: "انطق الحروف الساكنة المتتالية معاً بلا أي حركة بينها — العربية لا تبدأ كلمة بحرفين ساكنين متتاليين أبداً، والإنجليزية تفعل هذا باستمرار.",
    interference_ar: "أذنك تُصرّ على وضع حركة قصيرة بين الحروف الساكنة: street تصبح إستريت، spring تصبح سبرينغ بحركة زائدة. هذا موثّق بدقة في أبحاث متعلمي الإنجليزية من الخليج — تدرّب على البدء بالحرف الساكن مباشرة بلا 'إ' في أوله.",
    spellings: [{ grapheme: "str", example: "street" }, { grapheme: "spr", example: "spring" }, { grapheme: "sks", example: "desks" }],
    examples: [
      { en: "street", ar: "شارع", position: "initial" },
      { en: "spring", ar: "ربيع", position: "initial" },
      { en: "desks", ar: "مكاتب", position: "final" },
    ],
    spotWords: [
      { word: "street", hasSound: true }, { word: "road", hasSound: false },
      { word: "spring", hasSound: true }, { word: "summer", hasSound: false },
      { word: "desks", hasSound: true }, { word: "chairs", hasSound: false },
      { word: "splash", hasSound: true }, { word: "pour", hasSound: false },
    ],
    minimalPairs: [{ target: "play", confuse: "pay" }, { target: "stop", confuse: "top" }, { target: "black", confuse: "back" }],
  },
  {
    code: "final_devoicing", order_index: 27, display: "-d / -t", ipa: "voiced vs voiceless (final)", keyword: "bag / back", keyword_ar: "حقيبة / ظهر", voiced: undefined,
    mouth_ar: "احتفظ بالاهتزاز في حلقك حتى آخر الكلمة تماماً — لا توقفه قبل أن تنتهي من نطق الحرف الأخير.",
    interference_ar: "المتحدثون بالعربية يميلون لإيقاف اهتزاز الحلق قبل نهاية الكلمة، فتتحول الحروف المجهورة الأخيرة إلى مهموسة تلقائياً: bag تُسمع back، rob تُسمع rope. هذا هو الفرق الوحيد بين كلمتين مثل bed وbet — لا شيء آخر يميّزهما.",
    spellings: [{ grapheme: "-g", example: "bag" }, { grapheme: "-ck", example: "back" }, { grapheme: "-d", example: "bed" }],
    examples: [
      { en: "bag", ar: "حقيبة", position: "final" },
      { en: "rob", ar: "يسرق", position: "final" },
      { en: "bed", ar: "سرير", position: "final" },
    ],
    spotWords: [
      { word: "bag", hasSound: true }, { word: "back", hasSound: false },
      { word: "rob", hasSound: true }, { word: "rope", hasSound: false },
      { word: "bed", hasSound: true }, { word: "bet", hasSound: false },
      { word: "dog", hasSound: true }, { word: "dock", hasSound: false },
    ],
    minimalPairs: [{ target: "bag", confuse: "back" }, { target: "rob", confuse: "rope" }, { target: "bed", confuse: "bet" }],
  },
];

export const SOUNDS_BY_CODE: Record<string, EnglishSound> = Object.fromEntries(
  ENGLISH_SOUNDS.map((s) => [s.code, s]),
);

/** Indices of sounds that anchor each checkpoint (every 7 → 4 checkpoints). */
export const CHECKPOINT_INDICES = [6, 13, 20, 27];

/** The 6 mini-lesson step ids, in order. */
export const SOUND_STEPS = [
  "meet",
  "mouth",
  "spell",
  "examples",
  "spot",
  "contrast",
] as const;
export type SoundStepId = (typeof SOUND_STEPS)[number];
