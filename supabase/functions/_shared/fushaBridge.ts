// Canonical definition of the "fusha" line — the Modern Standard Arabic (فصحى)
// rendering of a dialect line, shared by every function that produces one so
// the conversion style stays identical everywhere a learner sees it.
//
// This is NOT a translation. The line stays Arabic; only the dialect-specific
// parts move: شلونك → كيف حالك, يبغى → يريد, ما راح أروح → لن أذهب. A learner
// who already knows Fusha reads the two rows side by side and sees exactly
// which pieces the dialect changed — which is the whole point of the row.
//
// The pure half lives here (prompt text, parsing, alignment, comparison) so
// both the edge functions and the React app can use the same rules, and the
// unit suite can test them without a network.

/** Instruction block for models asked to produce a `fusha` field per line. */
export const FUSHA_LINE_RULE = `FUSHA LINE ("fusha" field):
Rewrite the line in Modern Standard Arabic (الفصحى). This is a CONVERSION, not a translation —
the output stays in Arabic script and keeps the same meaning, register and sentence order
wherever Fusha allows it. Change only what the dialect changed:
- dialect pronouns, particles and question words (شلونك → كيف حالك، وش → ماذا، هذي → هذه)
- dialect verb morphology and prefixes (يبغى → يريد، بروح → سأذهب، ما راح أروح → لن أذهب)
- dialect vocabulary that has a Fusha equivalent (واجد → كثير، زين → جيد، حق → لِـ)
Keep proper nouns, numbers and loanwords as they are. Do not add explanation, commentary,
transliteration or English. If a line is already Fusha, return it unchanged.`;

/** JSON-schema fragment for tool-calling generators that emit a fusha field. */
export const fushaSchema = (what = "line") => ({
  type: "string",
  description:
    `Modern Standard Arabic (فصحى) rewrite of the ${what} — same meaning in Arabic script, ` +
    `dialect forms replaced with their Fusha equivalents. Never an English translation.`,
});

/** System prompt for a dedicated dialect→Fusha pass over numbered lines. */
export function buildFushaSystemPrompt(dialectLabel: string): string {
  return `You are an Arabic linguist converting ${dialectLabel} into Modern Standard Arabic (الفصحى).

You will be given numbered dialect lines. For each line produce its Fusha rendering.

${FUSHA_LINE_RULE}

Output ONLY valid JSON matching this schema:
{"fusha": ["الفصحى للسطر الأول", "..."]}

Rules:
- The array must have exactly as many items as there are numbered lines, aligned by index.
- Every item must be Arabic script. Never output English — that is the translator's job, not yours.
- Never merge, split or reorder lines. One input line produces exactly one output item.
- A line with nothing to convert (a name, a number, an interjection) is returned unchanged.

No additional text outside JSON.`;
}

/**
 * Arabic letters, and what counts as noise when comparing two renderings.
 * Diacritics differ freely between a Farasa-vocalised dialect line and a bare
 * Fusha one, so they can never be the thing that makes the rows "different".
 */
const ARABIC_LETTER = /[\u0621-\u064A\u0660-\u0669\u0671-\u06D3]/;
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const PUNCTUATION = /[-.,\u060C\u061B\u061F!:"'\u00AB\u00BB()[\]{}\u2013\u2014\u2026]/g;

/**
 * Strip diacritics, punctuation and spacing so two renderings can be compared.
 *
 * Deliberately stops there. The obvious next step — folding أ/إ/آ onto ا and
 * ى onto ي — would erase real conversions: restoring a hamza (اروح → أروح) or
 * an alif maqsura is one of the things Fusha does to a dialect spelling, and
 * folding them makes a changed line look unchanged.
 */
export function normalizeFushaCompare(text: string): string {
  return (text ?? "")
    .replace(DIACRITICS, "")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the Fusha rendering says something the dialect line did not.
 *
 * A line that is already Fusha comes back byte-identical, and rendering the
 * same sentence twice under two headings teaches nothing — callers use this to
 * label it instead.
 */
export function fushaDiffers(dialect: string, fusha?: string | null): boolean {
  if (!fusha || !fusha.trim()) return false;
  return normalizeFushaCompare(fusha) !== normalizeFushaCompare(dialect);
}

/**
 * Two things models prefix their answer with that are not part of it: the line
 * number they were given, and a heading naming what they just produced.
 */
const NUMBER_PREFIX = /^\s*\d+\s*[.)]\s*/;
const LABEL_PREFIX = /^\s*(?:الفصحى|بالفصحى|فصحى|MSA|Fusha|Fus-?ha|Standard Arabic)\s*[:：-]\s*/i;

/**
 * Clean one model-supplied Fusha rendering, or return "" if it isn't one.
 *
 * The failure that matters is a model answering in English: the row is
 * rendered RTL under a فصحى heading, so an English sentence there reads as a
 * second translation and quietly teaches the learner nothing. Anything without
 * Arabic script is dropped rather than shown.
 */
export function sanitizeFushaLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(NUMBER_PREFIX, "").replace(LABEL_PREFIX, "").trim();
  // Wrapping quotes, one layer, both the ASCII and the Arabic pair.
  const quoted = text.match(/^["'«»“”](.*)["'«»“”]$/s);
  if (quoted) text = quoted[1].trim();
  if (!ARABIC_LETTER.test(text)) return "";
  return text;
}

/**
 * Pull the fusha array out of a parsed model response and align it to the
 * lines it was asked about.
 *
 * Alignment is positional and unforgiving on purpose. A model that returns
 * nine renderings for ten lines has almost certainly merged two of them, and
 * a shifted array puts every subsequent line's Fusha under the wrong dialect
 * sentence — a mistake nobody reading it would catch. Short answers pad with
 * "" (the row simply doesn't render) rather than sliding into place.
 */
export function alignFushaLines(parsed: unknown, count: number): string[] {
  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { fusha?: unknown })?.fusha)
      ? (parsed as { fusha: unknown[] }).fusha
      : Array.isArray((parsed as { lines?: unknown })?.lines)
        ? (parsed as { lines: unknown[] }).lines
        : [];

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const item = source[i];
    // Some models answer with objects per line ({"fusha": "..."} or {"text": "..."}).
    const value =
      item && typeof item === "object" && !Array.isArray(item)
        ? ((item as Record<string, unknown>).fusha ??
           (item as Record<string, unknown>).text ??
           (item as Record<string, unknown>).arabic)
        : item;
    out.push(sanitizeFushaLine(value));
  }
  return out;
}
