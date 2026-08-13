import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  getDialectIdentity,
  getDialectLabel,
  getDialectVocabRules,
  getDialectExamples,
} from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

function ok(body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallback(body: Record<string, unknown>, corsHeaders: Record<string, string>) {
  return ok({ fallback: true, ...body }, corsHeaders);
}

function err(status: number, message: string, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  let text = html;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

interface BollsVerse { verse: number; text: string }

/** Fetch a single chapter from Bolls.life (free, no key). Returns { n, text } pairs (text WITHOUT verse number prefix). */
async function fetchChapterRaw(
  translationCode: string,
  bookNumber: number,
  chapter: number,
): Promise<{ n: number; text: string }[]> {
  const url = `https://bolls.life/get-text/${translationCode}/${bookNumber}/${chapter}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      console.error("Bolls.life API error:", res.status, text);
      throw new Error(`Bible API returned ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response format from Bible API");
    return (data as BollsVerse[]).map((v) => ({ n: v.verse, text: stripHtml(v.text) }));
  } finally {
    clearTimeout(timeout);
  }
}

function withVerseNumbers(verses: { n: number; text: string }[]): string[] {
  return verses.map((v) => `${v.n} ${v.text}`);
}

function blankVerses(length: number): string[] {
  return Array.from({ length }, () => "");
}

/**
 * Use Lovable AI to produce a dialect rendering that cross-references both
 * the formal Arabic and the English translation for maximum accuracy.
 */
async function convertToDialect(
  arabic: { n: number; text: string }[],
  english: { n: number; text: string }[] | null,
  dialect: string,
  lovableKey: string,
): Promise<{ verses: string[]; fallback: boolean }> {
  const dialectLabel = getDialectLabel(dialect);
  const dialectIdentity = getDialectIdentity(dialect);
  const vocabRules = getDialectVocabRules(dialect);
  const examples = getDialectExamples(dialect);

  // Build paired payload, indexed by Arabic verses (source of truth for verse numbers).
  const englishByVerse = new Map<number, string>();
  if (english) for (const v of english) englishByVerse.set(v.n, v.text);

  const paired = arabic.map((v) => ({
    n: v.n,
    ar: v.text,
    en: englishByVerse.get(v.n) ?? "",
  }));

  const systemPrompt = `${dialectIdentity}

You are a careful, reverent Bible translator producing a ${dialectLabel} rendering of scripture for Arabic learners. Accuracy is critical — this is the Word of God and must not be paraphrased loosely, summarized, expanded, or invented.

YOUR METHOD (follow strictly for every verse):
1. Read the formal Arabic verse — this is the PRIMARY SOURCE for theological terms, proper nouns, and exact meaning.
2. Read the English verse — use it ONLY as a clarifier when the Arabic is archaic, ambiguous, or stylistically opaque to a modern speaker.
3. Render the verse in natural spoken ${dialectLabel} exactly as a native speaker would say it conversationally to another adult — clear, faithful, and complete.

HARD RULES:
- Preserve EVERY clause and concept present in the Arabic. Never drop content. Never add content that isn't in either source.
- Keep proper nouns in their standard Arabic biblical form: يسوع، المسيح، الله، الرب، موسى، داود، بولس، يوحنا، الروح القدس، etc. Do NOT transliterate from English.
- Theological vocabulary stays in its standard Arabic Christian form (الخلاص، النعمة، التوبة، البركة، الإيمان، الخطية).
- Output is strict ${dialectLabel}. No MSA syntax, no cross-dialect leakage.
- Numbers, names, places, and quantities must match the Arabic exactly.
- Do not add commentary, footnotes, "i.e.", parentheses, or explanations. Just the verse.
- Each verse stays a single self-contained verse. Do not merge or split verses.

${vocabRules}

DIALECT EXAMPLES:
${examples}

OUTPUT: Call the \`return_dialect_verses\` function with one entry per input verse, preserving the verse number \`n\` exactly.`;

  const userPrompt = `Render the following ${arabic.length} verses into ${dialectLabel}. For each verse, the Arabic is the primary source and the English is the meaning-check.

${JSON.stringify(paired, null, 2)}`;

  const tools = [
    {
      type: "function",
      function: {
        name: "return_dialect_verses",
        description: `Return the ${dialectLabel} rendering for each verse.`,
        parameters: {
          type: "object",
          properties: {
            verses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  n: { type: "number", description: "Verse number, must match input." },
                  text: { type: "string", description: `Verse text in ${dialectLabel}, without the verse number prefix.` },
                },
                required: ["n", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["verses"],
          additionalProperties: false,
        },
      },
    },
  ];

  const arabicWithNumbers = withVerseNumbers(arabic);

  async function callModel(model: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools,
            tool_choice: { type: "function", function: { name: "return_dialect_verses" } },
            temperature: 0.3,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`AI gateway error (${model}):`, response.status, errorText);
        if (response.status === 402) {
          throw Object.assign(new Error("Not enough AI credits."), { status: 402 });
        }
        if (response.status === 429) {
          throw Object.assign(new Error("Rate limit exceeded. Try again later."), { status: 429 });
        }
        return null; // signal soft-failure to allow fallback model
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      const argsRaw = toolCall?.function?.arguments;
      if (!argsRaw) {
        console.error(`No tool call in response (${model})`, JSON.stringify(data).slice(0, 500));
        return null;
      }
      const parsed = JSON.parse(argsRaw) as { verses: { n: number; text: string }[] };
      if (!Array.isArray(parsed.verses)) return null;
      return parsed.verses;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        console.error(`AI conversion timed out (${model})`);
        return null;
      }
      if (typeof (e as Record<string, unknown>)?.status === "number") throw e;
      console.error(`AI conversion failed (${model}):`, e);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Primary: Gemini 2.5 Pro for translation accuracy. Fallback: Flash preview.
  let result = await callModel("google/gemini-2.5-pro");
  if (!result) result = await callModel("google/gemini-3-flash-preview");

  if (!result) {
    return { verses: arabicWithNumbers, fallback: true };
  }

  // Re-attach verse numbers, ordered to match Arabic input.
  const byN = new Map<number, string>();
  for (const v of result) {
    if (typeof v?.n === "number" && typeof v?.text === "string") {
      byN.set(v.n, v.text.trim());
    }
  }

  let missing = 0;
  const verses = arabic.map((v) => {
    const text = byN.get(v.n);
    if (!text) {
      missing += 1;
      return `${v.n} ${v.text}`;
    }
    return `${v.n} ${text}`;
  });

  // If too many verses were missed, treat as fallback so UI can flag it.
  const fallbackUsed = missing > Math.max(1, Math.floor(arabic.length * 0.1));
  return { verses, fallback: fallbackUsed };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return err(401, "Authentication required", corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err(401, "Invalid or expired token", corsHeaders);

    const { data: canAccessBible, error: accessError } = await supabase.rpc("user_has_bible_access", {
      _user_id: user.id,
    });
    if (accessError || !canAccessBible) {
      return err(403, "You do not have access to the Bible reading feature.", corsHeaders);
    }

    // ── Parse body ───────────────────────────────────────────────────────
    const {
      arabicVersion,
      englishVersion = "ESV",
      bookNumber,
      bookUsfm,
      chapter,
      dialect = "Gulf",
    } = await req.json();

    if (!arabicVersion || !bookNumber || !chapter) {
      return err(400, "arabicVersion, bookNumber, and chapter are required.", corsHeaders);
    }

    // ── Fetch Arabic + English in parallel BEFORE running dialect conversion,
    //    so the AI can cross-reference both sources.
    const [arabicResult, englishResult] = await Promise.allSettled([
      fetchChapterRaw(arabicVersion, bookNumber, chapter),
      fetchChapterRaw(englishVersion, bookNumber, chapter),
    ]);

    if (arabicResult.status === "rejected") {
      console.error("Arabic Bible fetch failed:", arabicResult.reason);
      return fallback({
        error: "Bible text is temporarily unavailable. Please try again.",
      }, corsHeaders);
    }

    const arabicRaw = arabicResult.value;
    const englishRaw =
      englishResult.status === "fulfilled" ? englishResult.value : null;

    if (englishResult.status === "rejected") {
      console.error("English Bible fetch failed:", englishResult.reason);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const dialectPayload = LOVABLE_API_KEY
      ? await convertToDialect(arabicRaw, englishRaw, dialect, LOVABLE_API_KEY)
      : { verses: withVerseNumbers(arabicRaw), fallback: true };

    const arabicVerses = withVerseNumbers(arabicRaw);
    const englishVerses = englishRaw
      ? withVerseNumbers(englishRaw)
      : blankVerses(arabicRaw.length);

    const dialectVerses = Array.from({ length: arabicRaw.length }, (_, index) => {
      const verse = dialectPayload.verses[index];
      return typeof verse === "string" ? verse : arabicVerses[index] ?? "";
    });

    const fallbackUsed =
      englishResult.status === "rejected" || dialectPayload.fallback === true;

    return ok({
      arabicVerses,
      englishVerses,
      dialectVerses,
      bookUsfm: bookUsfm || "",
      chapter,
      dialect,
      fallback: fallbackUsed,
    }, corsHeaders);
  } catch (error) {
    console.error("bible-passage error:", error);
    const status =
      typeof (error as Record<string, unknown>)?.status === "number"
        ? ((error as Record<string, unknown>).status as number)
        : 500;

    if (status >= 500) {
      // Without the headers this response reached the browser un-CORSed, so a
      // recoverable upstream 5xx surfaced to the client as a network error
      // rather than the fallback payload it was meant to deliver.
      return fallback({
        error: error instanceof Error ? error.message : "Unknown error",
      }, corsHeaders);
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
