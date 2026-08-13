/**
 * Static Bible book metadata.
 *
 * Each entry carries the USFM code, English name, Arabic name, canonical
 * book number (1-66, used by the Bolls.life API), and the total number of
 * chapters in that book.
 *
 * The list covers the 66-book Protestant canon.
 */

export interface BibleBook {
  usfm: string;
  /** Canonical book number (Genesis = 1, … Revelation = 66). Used by Bolls.life API. */
  bookNumber: number;
  name: string;
  nameArabic: string;
  chapters: number;
}

export const OLD_TESTAMENT: BibleBook[] = [
  { usfm: "GEN", bookNumber: 1, name: "Genesis", nameArabic: "التكوين", chapters: 50 },
  { usfm: "EXO", bookNumber: 2, name: "Exodus", nameArabic: "الخروج", chapters: 40 },
  { usfm: "LEV", bookNumber: 3, name: "Leviticus", nameArabic: "اللاويين", chapters: 27 },
  { usfm: "NUM", bookNumber: 4, name: "Numbers", nameArabic: "العدد", chapters: 36 },
  { usfm: "DEU", bookNumber: 5, name: "Deuteronomy", nameArabic: "التثنية", chapters: 34 },
  { usfm: "JOS", bookNumber: 6, name: "Joshua", nameArabic: "يشوع", chapters: 24 },
  { usfm: "JDG", bookNumber: 7, name: "Judges", nameArabic: "القضاة", chapters: 21 },
  { usfm: "RUT", bookNumber: 8, name: "Ruth", nameArabic: "راعوث", chapters: 4 },
  { usfm: "1SA", bookNumber: 9, name: "1 Samuel", nameArabic: "صموئيل الأول", chapters: 31 },
  { usfm: "2SA", bookNumber: 10, name: "2 Samuel", nameArabic: "صموئيل الثاني", chapters: 24 },
  { usfm: "1KI", bookNumber: 11, name: "1 Kings", nameArabic: "الملوك الأول", chapters: 22 },
  { usfm: "2KI", bookNumber: 12, name: "2 Kings", nameArabic: "الملوك الثاني", chapters: 25 },
  { usfm: "1CH", bookNumber: 13, name: "1 Chronicles", nameArabic: "أخبار الأيام الأول", chapters: 29 },
  { usfm: "2CH", bookNumber: 14, name: "2 Chronicles", nameArabic: "أخبار الأيام الثاني", chapters: 36 },
  { usfm: "EZR", bookNumber: 15, name: "Ezra", nameArabic: "عزرا", chapters: 10 },
  { usfm: "NEH", bookNumber: 16, name: "Nehemiah", nameArabic: "نحميا", chapters: 13 },
  { usfm: "EST", bookNumber: 17, name: "Esther", nameArabic: "أستير", chapters: 10 },
  { usfm: "JOB", bookNumber: 18, name: "Job", nameArabic: "أيوب", chapters: 42 },
  { usfm: "PSA", bookNumber: 19, name: "Psalms", nameArabic: "المزامير", chapters: 150 },
  { usfm: "PRO", bookNumber: 20, name: "Proverbs", nameArabic: "الأمثال", chapters: 31 },
  { usfm: "ECC", bookNumber: 21, name: "Ecclesiastes", nameArabic: "الجامعة", chapters: 12 },
  { usfm: "SNG", bookNumber: 22, name: "Song of Solomon", nameArabic: "نشيد الأنشاد", chapters: 8 },
  { usfm: "ISA", bookNumber: 23, name: "Isaiah", nameArabic: "إشعياء", chapters: 66 },
  { usfm: "JER", bookNumber: 24, name: "Jeremiah", nameArabic: "إرميا", chapters: 52 },
  { usfm: "LAM", bookNumber: 25, name: "Lamentations", nameArabic: "مراثي إرميا", chapters: 5 },
  { usfm: "EZK", bookNumber: 26, name: "Ezekiel", nameArabic: "حزقيال", chapters: 48 },
  { usfm: "DAN", bookNumber: 27, name: "Daniel", nameArabic: "دانيال", chapters: 12 },
  { usfm: "HOS", bookNumber: 28, name: "Hosea", nameArabic: "هوشع", chapters: 14 },
  { usfm: "JOL", bookNumber: 29, name: "Joel", nameArabic: "يوئيل", chapters: 3 },
  { usfm: "AMO", bookNumber: 30, name: "Amos", nameArabic: "عاموس", chapters: 9 },
  { usfm: "OBA", bookNumber: 31, name: "Obadiah", nameArabic: "عوبديا", chapters: 1 },
  { usfm: "JON", bookNumber: 32, name: "Jonah", nameArabic: "يونان", chapters: 4 },
  { usfm: "MIC", bookNumber: 33, name: "Micah", nameArabic: "ميخا", chapters: 7 },
  { usfm: "NAM", bookNumber: 34, name: "Nahum", nameArabic: "ناحوم", chapters: 3 },
  { usfm: "HAB", bookNumber: 35, name: "Habakkuk", nameArabic: "حبقوق", chapters: 3 },
  { usfm: "ZEP", bookNumber: 36, name: "Zephaniah", nameArabic: "صفنيا", chapters: 3 },
  { usfm: "HAG", bookNumber: 37, name: "Haggai", nameArabic: "حجّي", chapters: 2 },
  { usfm: "ZEC", bookNumber: 38, name: "Zechariah", nameArabic: "زكريا", chapters: 14 },
  { usfm: "MAL", bookNumber: 39, name: "Malachi", nameArabic: "ملاخي", chapters: 4 },
];

export const NEW_TESTAMENT: BibleBook[] = [
  { usfm: "MAT", bookNumber: 40, name: "Matthew", nameArabic: "متّى", chapters: 28 },
  { usfm: "MRK", bookNumber: 41, name: "Mark", nameArabic: "مرقس", chapters: 16 },
  { usfm: "LUK", bookNumber: 42, name: "Luke", nameArabic: "لوقا", chapters: 24 },
  { usfm: "JHN", bookNumber: 43, name: "John", nameArabic: "يوحنّا", chapters: 21 },
  { usfm: "ACT", bookNumber: 44, name: "Acts", nameArabic: "أعمال الرسل", chapters: 28 },
  { usfm: "ROM", bookNumber: 45, name: "Romans", nameArabic: "رومية", chapters: 16 },
  { usfm: "1CO", bookNumber: 46, name: "1 Corinthians", nameArabic: "كورنثوس الأولى", chapters: 16 },
  { usfm: "2CO", bookNumber: 47, name: "2 Corinthians", nameArabic: "كورنثوس الثانية", chapters: 13 },
  { usfm: "GAL", bookNumber: 48, name: "Galatians", nameArabic: "غلاطية", chapters: 6 },
  { usfm: "EPH", bookNumber: 49, name: "Ephesians", nameArabic: "أفسس", chapters: 6 },
  { usfm: "PHP", bookNumber: 50, name: "Philippians", nameArabic: "فيلبي", chapters: 4 },
  { usfm: "COL", bookNumber: 51, name: "Colossians", nameArabic: "كولوسي", chapters: 4 },
  { usfm: "1TH", bookNumber: 52, name: "1 Thessalonians", nameArabic: "تسالونيكي الأولى", chapters: 5 },
  { usfm: "2TH", bookNumber: 53, name: "2 Thessalonians", nameArabic: "تسالونيكي الثانية", chapters: 3 },
  { usfm: "1TI", bookNumber: 54, name: "1 Timothy", nameArabic: "تيموثاوس الأولى", chapters: 6 },
  { usfm: "2TI", bookNumber: 55, name: "2 Timothy", nameArabic: "تيموثاوس الثانية", chapters: 4 },
  { usfm: "TIT", bookNumber: 56, name: "Titus", nameArabic: "تيطس", chapters: 3 },
  { usfm: "PHM", bookNumber: 57, name: "Philemon", nameArabic: "فليمون", chapters: 1 },
  { usfm: "HEB", bookNumber: 58, name: "Hebrews", nameArabic: "العبرانيين", chapters: 13 },
  { usfm: "JAS", bookNumber: 59, name: "James", nameArabic: "يعقوب", chapters: 5 },
  { usfm: "1PE", bookNumber: 60, name: "1 Peter", nameArabic: "بطرس الأولى", chapters: 5 },
  { usfm: "2PE", bookNumber: 61, name: "2 Peter", nameArabic: "بطرس الثانية", chapters: 3 },
  { usfm: "1JN", bookNumber: 62, name: "1 John", nameArabic: "يوحنّا الأولى", chapters: 5 },
  { usfm: "2JN", bookNumber: 63, name: "2 John", nameArabic: "يوحنّا الثانية", chapters: 1 },
  { usfm: "3JN", bookNumber: 64, name: "3 John", nameArabic: "يوحنّا الثالثة", chapters: 1 },
  { usfm: "JUD", bookNumber: 65, name: "Jude", nameArabic: "يهوذا", chapters: 1 },
  { usfm: "REV", bookNumber: 66, name: "Revelation", nameArabic: "رؤيا يوحنّا", chapters: 22 },
];

export const ALL_BOOKS: BibleBook[] = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

/**
 * Bible translations available via the Bolls.life free API.
 *
 * `code` is the translation short_name used in Bolls.life API URLs.
 * No API key is required.
 */
export interface BibleVersion {
  code: string;
  abbreviation: string;
  name: string;
  language: "ar" | "en";
}

export const ARABIC_VERSIONS: BibleVersion[] = [
  { code: "SVD", abbreviation: "SVD", name: "Smith & Van Dyke (فان دايك)", language: "ar" },
  { code: "NAV", abbreviation: "NAV", name: "New Arabic Version (الترجمة العربية الجديدة)", language: "ar" },
];

export const ENGLISH_VERSION: BibleVersion = {
  code: "ESV",
  abbreviation: "ESV",
  name: "English Standard Version",
  language: "en",
};
