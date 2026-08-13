/** Strip Arabic tashkil/diacritics for dedupe keys. */
export function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/g, "")
    .replace(/\u0640/g, "") // tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip Anki HTML and special tokens, keep media filenames. */
export function stripAnkiHtml(html: string): {
  text: string;
  imageRefs: string[];
  audioRefs: string[];
} {
  if (!html) return { text: "", imageRefs: [], audioRefs: [] };

  const imageRefs: string[] = [];
  const audioRefs: string[] = [];

  let s = html;

  // <img src="foo.jpg"> or <img src='foo.jpg'>
  s = s.replace(/<img[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_m, src) => {
    imageRefs.push(decodeURIComponent(src));
    return " ";
  });

  // [sound:foo.mp3]
  s = s.replace(/\[sound:([^\]]+)\]/gi, (_m, src) => {
    audioRefs.push(decodeURIComponent(src));
    return " ";
  });

  // <br>, </p>, </div> -> space
  s = s.replace(/<\s*br\s*\/?>/gi, " ");
  s = s.replace(/<\/(p|div|li|tr)>/gi, " ");

  // Drop all remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  // HTML entities
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  s = s.replace(/\s+/g, " ").trim();

  return { text: s, imageRefs, audioRefs };
}

/** Guess if a string is primarily Arabic. */
export function isArabic(s: string): boolean {
  if (!s) return false;
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic >= 1 && arabic >= s.replace(/\s/g, "").length * 0.3;
}
