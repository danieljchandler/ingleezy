/**
 * The 28 letters of the Arabic alphabet, in standard order.
 *
 * Static seed data for the Alphabet Journey feature. Forms are real Unicode
 * characters; names use MSA names with a friendly transliteration.
 *
 * Example words are 3 common nouns starting with that letter, with a
 * short English gloss. Audio/translations are fetched on-demand via the
 * existing TTS pipeline.
 */

export interface ArabicLetterExample {
  ar: string;
  translit: string;
  en: string;
}

export interface ArabicLetter {
  code: string;
  /** Isolated glyph */
  isolated: string;
  /** Initial form (start of word) */
  initial: string;
  /** Medial form (middle of word) */
  medial: string;
  /** Final form (end of word) */
  final: string;
  /** Letter name in Arabic, e.g. ألف */
  name_ar: string;
  /** Friendly Latin transliteration of the name, e.g. "alif" */
  name_translit: string;
  /** Tip on the sound, e.g. "like 'a' in father" */
  sound_hint: string;
  /** 3 example words starting with this letter */
  examples: ArabicLetterExample[];
  /** Order index in the alphabet (0..27) */
  order_index: number;
  /**
   * Optional visual variants — alternate glyphs learners will encounter for
   * this base letter (e.g. hamza-carrier alif forms أ إ آ, or dotless ya ى).
   * Rendered as a small "also written as" row on the Meet step.
   */
  variants?: { glyph: string; note: string }[];
}

export const ARABIC_LETTERS: ArabicLetter[] = [
  { code: "alif", isolated: "ا", initial: "ا", medial: "ـا", final: "ـا", name_ar: "ألف", name_translit: "alif", sound_hint: "long 'aa' like in 'father'. Often carries a hamza (ء) on top or below.", order_index: 0,
    examples: [{ ar: "أب", translit: "ab", en: "father" }, { ar: "أم", translit: "umm", en: "mother" }, { ar: "أرنب", translit: "arnab", en: "rabbit" }],
    variants: [
      { glyph: "ا", note: "plain alif" },
      { glyph: "أ", note: "hamza on top (short 'a')" },
      { glyph: "إ", note: "hamza below (short 'i')" },
      { glyph: "آ", note: "madda — long 'aa'" },
    ] },
  { code: "ba", isolated: "ب", initial: "بـ", medial: "ـبـ", final: "ـب", name_ar: "باء", name_translit: "ba", sound_hint: "'b' as in 'book'", order_index: 1,
    examples: [{ ar: "بيت", translit: "bayt", en: "house" }, { ar: "باب", translit: "bab", en: "door" }, { ar: "بحر", translit: "baḥr", en: "sea" }] },
  { code: "ta", isolated: "ت", initial: "تـ", medial: "ـتـ", final: "ـت", name_ar: "تاء", name_translit: "ta", sound_hint: "'t' as in 'top'", order_index: 2,
    examples: [{ ar: "تمر", translit: "tamr", en: "dates" }, { ar: "تفاحة", translit: "tuffaha", en: "apple" }, { ar: "تاج", translit: "taj", en: "crown" }] },
  { code: "tha", isolated: "ث", initial: "ثـ", medial: "ـثـ", final: "ـث", name_ar: "ثاء", name_translit: "tha", sound_hint: "'th' as in 'think'", order_index: 3,
    examples: [{ ar: "ثوب", translit: "thawb", en: "robe" }, { ar: "ثلج", translit: "thalj", en: "snow" }, { ar: "ثلاثة", translit: "thalatha", en: "three" }] },
  { code: "jim", isolated: "ج", initial: "جـ", medial: "ـجـ", final: "ـج", name_ar: "جيم", name_translit: "jim", sound_hint: "'j' as in 'jam' (Gulf: often 'y'; Egyptian: hard 'g' as in 'go'; Yemeni: 'j')", order_index: 4,
    examples: [{ ar: "جمل", translit: "jamal", en: "camel" }, { ar: "جبل", translit: "jabal", en: "mountain" }, { ar: "جزر", translit: "jazar", en: "carrots" }] },
  { code: "ha", isolated: "ح", initial: "حـ", medial: "ـحـ", final: "ـح", name_ar: "حاء", name_translit: "ḥa", sound_hint: "deep breathy 'h' from the throat", order_index: 5,
    examples: [{ ar: "حصان", translit: "ḥiṣan", en: "horse" }, { ar: "حليب", translit: "ḥalib", en: "milk" }, { ar: "حب", translit: "ḥubb", en: "love" }] },
  { code: "kha", isolated: "خ", initial: "خـ", medial: "ـخـ", final: "ـخ", name_ar: "خاء", name_translit: "kha", sound_hint: "raspy 'ch' like Scottish 'loch'", order_index: 6,
    examples: [{ ar: "خبز", translit: "khubz", en: "bread" }, { ar: "خروف", translit: "kharuf", en: "sheep" }, { ar: "خيمة", translit: "khayma", en: "tent" }] },
  { code: "dal", isolated: "د", initial: "د", medial: "ـد", final: "ـد", name_ar: "دال", name_translit: "dal", sound_hint: "'d' as in 'door'", order_index: 7,
    examples: [{ ar: "دار", translit: "dar", en: "house" }, { ar: "دجاجة", translit: "dajaja", en: "chicken" }, { ar: "دب", translit: "dubb", en: "bear" }] },
  { code: "dhal", isolated: "ذ", initial: "ذ", medial: "ـذ", final: "ـذ", name_ar: "ذال", name_translit: "dhal", sound_hint: "'th' as in 'this'", order_index: 8,
    examples: [{ ar: "ذيل", translit: "dhayl", en: "tail" }, { ar: "ذهب", translit: "dhahab", en: "gold" }, { ar: "ذئب", translit: "dhi'b", en: "wolf" }] },
  { code: "ra", isolated: "ر", initial: "ر", medial: "ـر", final: "ـر", name_ar: "راء", name_translit: "ra", sound_hint: "rolled 'r' like Spanish", order_index: 9,
    examples: [{ ar: "رجل", translit: "rajul", en: "man" }, { ar: "ريح", translit: "riḥ", en: "wind" }, { ar: "رمل", translit: "raml", en: "sand" }] },
  { code: "zay", isolated: "ز", initial: "ز", medial: "ـز", final: "ـز", name_ar: "زاي", name_translit: "zay", sound_hint: "'z' as in 'zoo'", order_index: 10,
    examples: [{ ar: "زيت", translit: "zayt", en: "oil" }, { ar: "زهرة", translit: "zahra", en: "flower" }, { ar: "زرافة", translit: "zarafa", en: "giraffe" }] },
  { code: "sin", isolated: "س", initial: "سـ", medial: "ـسـ", final: "ـس", name_ar: "سين", name_translit: "sin", sound_hint: "'s' as in 'sun'", order_index: 11,
    examples: [{ ar: "سمك", translit: "samak", en: "fish" }, { ar: "سماء", translit: "sama'", en: "sky" }, { ar: "سيارة", translit: "sayyara", en: "car" }] },
  { code: "shin", isolated: "ش", initial: "شـ", medial: "ـشـ", final: "ـش", name_ar: "شين", name_translit: "shin", sound_hint: "'sh' as in 'shoe'", order_index: 12,
    examples: [{ ar: "شمس", translit: "shams", en: "sun" }, { ar: "شجرة", translit: "shajara", en: "tree" }, { ar: "شاي", translit: "shay", en: "tea" }] },
  { code: "sad", isolated: "ص", initial: "صـ", medial: "ـصـ", final: "ـص", name_ar: "صاد", name_translit: "ṣad", sound_hint: "heavy emphatic 's'", order_index: 13,
    examples: [{ ar: "صقر", translit: "ṣaqr", en: "falcon" }, { ar: "صديق", translit: "ṣadiq", en: "friend" }, { ar: "صباح", translit: "ṣabaḥ", en: "morning" }] },
  { code: "dad", isolated: "ض", initial: "ضـ", medial: "ـضـ", final: "ـض", name_ar: "ضاد", name_translit: "ḍad", sound_hint: "heavy emphatic 'd'", order_index: 14,
    examples: [{ ar: "ضوء", translit: "ḍaw'", en: "light" }, { ar: "ضيف", translit: "ḍayf", en: "guest" }, { ar: "ضفدع", translit: "ḍifda'", en: "frog" }] },
  { code: "ta_heavy", isolated: "ط", initial: "طـ", medial: "ـطـ", final: "ـط", name_ar: "طاء", name_translit: "ṭa", sound_hint: "heavy emphatic 't'", order_index: 15,
    examples: [{ ar: "طائر", translit: "ṭa'ir", en: "bird" }, { ar: "طبيب", translit: "ṭabib", en: "doctor" }, { ar: "طاولة", translit: "ṭawila", en: "table" }] },
  { code: "za", isolated: "ظ", initial: "ظـ", medial: "ـظـ", final: "ـظ", name_ar: "ظاء", name_translit: "ẓa", sound_hint: "heavy emphatic 'th/z'", order_index: 16,
    examples: [{ ar: "ظل", translit: "ẓill", en: "shade" }, { ar: "ظهر", translit: "ẓuhr", en: "noon" }, { ar: "ظرف", translit: "ẓarf", en: "envelope" }] },
  { code: "ayn", isolated: "ع", initial: "عـ", medial: "ـعـ", final: "ـع", name_ar: "عين", name_translit: "ayn", sound_hint: "deep throat constriction — unique to Arabic", order_index: 17,
    examples: [{ ar: "عين", translit: "ayn", en: "eye" }, { ar: "عنب", translit: "inab", en: "grapes" }, { ar: "عسل", translit: "asal", en: "honey" }] },
  { code: "ghayn", isolated: "غ", initial: "غـ", medial: "ـغـ", final: "ـغ", name_ar: "غين", name_translit: "ghayn", sound_hint: "like a French 'r', gargled", order_index: 18,
    examples: [{ ar: "غزال", translit: "ghazal", en: "gazelle" }, { ar: "غيمة", translit: "ghayma", en: "cloud" }, { ar: "غدا", translit: "ghadan", en: "tomorrow" }] },
  { code: "fa", isolated: "ف", initial: "فـ", medial: "ـفـ", final: "ـف", name_ar: "فاء", name_translit: "fa", sound_hint: "'f' as in 'fan'", order_index: 19,
    examples: [{ ar: "فيل", translit: "fil", en: "elephant" }, { ar: "فم", translit: "fam", en: "mouth" }, { ar: "فراشة", translit: "farasha", en: "butterfly" }] },
  { code: "qaf", isolated: "ق", initial: "قـ", medial: "ـقـ", final: "ـق", name_ar: "قاف", name_translit: "qaf", sound_hint: "deep 'k' from the back of the throat (Gulf/Yemeni: often hard 'g'; Egyptian: often a glottal stop, like a dropped 'k')", order_index: 20,
    examples: [{ ar: "قلم", translit: "qalam", en: "pen" }, { ar: "قمر", translit: "qamar", en: "moon" }, { ar: "قطة", translit: "qiṭṭa", en: "cat" }] },
  { code: "kaf", isolated: "ك", initial: "كـ", medial: "ـكـ", final: "ـك", name_ar: "كاف", name_translit: "kaf", sound_hint: "'k' as in 'kite'", order_index: 21,
    examples: [{ ar: "كتاب", translit: "kitab", en: "book" }, { ar: "كلب", translit: "kalb", en: "dog" }, { ar: "كرسي", translit: "kursi", en: "chair" }] },
  { code: "lam", isolated: "ل", initial: "لـ", medial: "ـلـ", final: "ـل", name_ar: "لام", name_translit: "lam", sound_hint: "'l' as in 'love'", order_index: 22,
    examples: [{ ar: "ليل", translit: "layl", en: "night" }, { ar: "لبن", translit: "laban", en: "milk/yogurt" }, { ar: "لون", translit: "lawn", en: "color" }] },
  { code: "mim", isolated: "م", initial: "مـ", medial: "ـمـ", final: "ـم", name_ar: "ميم", name_translit: "mim", sound_hint: "'m' as in 'moon'", order_index: 23,
    examples: [{ ar: "ماء", translit: "ma'", en: "water" }, { ar: "مدرسة", translit: "madrasa", en: "school" }, { ar: "مفتاح", translit: "miftaḥ", en: "key" }] },
  { code: "nun", isolated: "ن", initial: "نـ", medial: "ـنـ", final: "ـن", name_ar: "نون", name_translit: "nun", sound_hint: "'n' as in 'noon'", order_index: 24,
    examples: [{ ar: "نجم", translit: "najm", en: "star" }, { ar: "نهر", translit: "nahr", en: "river" }, { ar: "نحلة", translit: "naḥla", en: "bee" }] },
  { code: "ha_soft", isolated: "ه", initial: "هـ", medial: "ـهـ", final: "ـه", name_ar: "هاء", name_translit: "ha", sound_hint: "soft 'h' as in 'hello'. Ta marbuta (ة) is a related feminine ending.", order_index: 25,
    examples: [{ ar: "هلال", translit: "hilal", en: "crescent" }, { ar: "هدية", translit: "hadiyya", en: "gift" }, { ar: "هواء", translit: "hawa'", en: "air" }],
    variants: [
      { glyph: "ه", note: "plain ha" },
      { glyph: "ة", note: "ta marbuta (feminine ending)" },
    ] },
  { code: "waw", isolated: "و", initial: "و", medial: "ـو", final: "ـو", name_ar: "واو", name_translit: "waw", sound_hint: "'w' as in 'water' or long 'oo'", order_index: 26,
    examples: [{ ar: "ورد", translit: "ward", en: "roses" }, { ar: "ولد", translit: "walad", en: "boy" }, { ar: "وردة", translit: "warda", en: "rose" }],
    variants: [
      { glyph: "و", note: "plain waw" },
      { glyph: "ؤ", note: "waw with hamza" },
    ] },
  { code: "ya", isolated: "ي", initial: "يـ", medial: "ـيـ", final: "ـي", name_ar: "ياء", name_translit: "ya", sound_hint: "'y' as in 'yes' or long 'ee'", order_index: 27,
    examples: [{ ar: "يد", translit: "yad", en: "hand" }, { ar: "يوم", translit: "yawm", en: "day" }, { ar: "ياسمين", translit: "yasmin", en: "jasmine" }],
    variants: [
      { glyph: "ي", note: "plain ya" },
      { glyph: "ى", note: "alif maqsura (dotless, word-final)" },
      { glyph: "ئ", note: "ya with hamza" },
    ] },
];

export const LETTERS_BY_CODE: Record<string, ArabicLetter> = Object.fromEntries(
  ARABIC_LETTERS.map((l) => [l.code, l]),
);

/** Indices of letters that anchor each checkpoint (every 7 letters → 4 checkpoints). */
export const CHECKPOINT_INDICES = [6, 13, 20, 27];

/** The 6 mini-lesson step ids, in order. */
export const LETTER_STEPS = [
  "meet",
  "examples",
  "trace",
  "faces",
  "spot",
  "sound",
] as const;
export type LetterStepId = (typeof LETTER_STEPS)[number];
