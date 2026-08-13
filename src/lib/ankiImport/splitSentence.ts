import { isArabic } from "./normalize";

/**
 * Mirror the tutor-upload flow: keep the headword separate from any
 * example sentence. If the "word" field is actually a sentence, split it.
 */
export function splitWordAndSentence(input: {
  word?: string;
  sentence?: string;
}): { word: string; sentence?: string } {
  const word = (input.word || "").trim();
  const sentence = (input.sentence || "").trim();

  // If we already have an explicit sentence, keep them as-is.
  if (sentence) return { word, sentence };

  if (!word) return { word: "" };

  // If "word" is multi-token Arabic with terminal punctuation, treat as sentence.
  const tokens = word.split(/\s+/).filter(Boolean);
  const looksLikeSentence =
    tokens.length >= 4 ||
    /[.!?؟،]/.test(word) ||
    (tokens.length >= 3 && isArabic(word));

  if (looksLikeSentence) {
    // First content Arabic token becomes the headword.
    const head =
      tokens.find((t) => isArabic(t) && t.length >= 2) || tokens[0];
    return { word: head.replace(/[.,!?؟،:;]/g, ""), sentence: word };
  }

  return { word };
}
