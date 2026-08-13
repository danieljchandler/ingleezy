// dialect-compare — reference tool showing how a word/phrase differs across the
// major Arabic dialect families. Unlike the single-dialect learning functions
// this DELIBERATELY produces MSA and several dialects side by side, so it does
// NOT run through the single-dialect Brain / MSA-leak guard. Accuracy comes from
// a low temperature and a structured tool-call (no brittle markdown-fence
// parsing), with strict validation of the returned shape.

import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

interface DialectVariant {
  dialect: string;
  country: string;
  word: string;
  transliteration: string;
  pronunciation_notes?: string;
  usage_context?: string;
  formality?: string;
}

interface DialectComparison {
  word_arabic: string;
  word_english: string;
  dialects: DialectVariant[];
  cultural_notes?: string;
  common_root?: string;
}

// The five families the UI knows how to render (colours + flags). Keep this in
// sync with dialectColors / dialectFlags in src/pages/DialectCompare.tsx.
const EXPECTED_DIALECTS = [
  "Gulf Arabic",
  "Egyptian Arabic",
  "Levantine Arabic",
  "Yemeni Arabic",
  "Modern Standard Arabic (MSA)",
];

const TOOL_PARAMETERS = {
  type: "object",
  properties: {
    word_arabic: { type: "string", description: "The word/phrase in Arabic script" },
    word_english: { type: "string", description: "The English meaning" },
    common_root: { type: "string", description: "The Arabic triliteral root if applicable, e.g. ك-ت-ب" },
    cultural_notes: { type: "string", description: "How/where the variants differ in real use" },
    dialects: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          dialect: {
            type: "string",
            enum: EXPECTED_DIALECTS,
          },
          country: { type: "string", description: "Where this variant is used" },
          word: { type: "string", description: "The word/phrase in Arabic script for this variant" },
          transliteration: { type: "string", description: "Latin-letter phonetic transliteration" },
          pronunciation_notes: { type: "string" },
          usage_context: { type: "string" },
          formality: { type: "string", enum: ["formal", "casual", "slang"] },
        },
        required: ["dialect", "country", "word", "transliteration"],
      },
    },
  },
  required: ["word_arabic", "word_english", "dialects"],
} as const;

function validateComparison(value: unknown): DialectComparison | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.word_arabic !== "string" || typeof v.word_english !== "string") return null;
  if (!Array.isArray(v.dialects)) return null;

  const dialects: DialectVariant[] = [];
  for (const raw of v.dialects) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    if (typeof d.dialect !== "string" || typeof d.word !== "string") continue;
    dialects.push({
      dialect: d.dialect,
      country: typeof d.country === "string" ? d.country : "",
      word: d.word,
      transliteration: typeof d.transliteration === "string" ? d.transliteration : "",
      pronunciation_notes: typeof d.pronunciation_notes === "string" ? d.pronunciation_notes : undefined,
      usage_context: typeof d.usage_context === "string" ? d.usage_context : undefined,
      formality: typeof d.formality === "string" ? d.formality : undefined,
    });
  }
  if (dialects.length === 0) return null;

  return {
    word_arabic: v.word_arabic,
    word_english: v.word_english,
    dialects,
    cultural_notes: typeof v.cultural_notes === "string" ? v.cultural_notes : undefined,
    common_root: typeof v.common_root === "string" ? v.common_root : undefined,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "dialect-compare", 25, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { word, source_dialect = "Gulf" } = await req.json();

    if (!word || typeof word !== "string") {
      return new Response(
        JSON.stringify({ error: "Word or phrase required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an expert in Arabic dialects. Your task is to show how a single word or phrase differs across the major Arabic varieties.

Always cover these five varieties, in this order:
1. Gulf Arabic (Khaliji — UAE/Saudi/Kuwait/Qatar/Bahrain/Oman)
2. Egyptian Arabic (مصري)
3. Levantine Arabic (Syrian/Lebanese/Palestinian/Jordanian)
4. Yemeni Arabic (يمني)
5. Modern Standard Arabic (MSA / فصحى)

For each variety give: the authentic word/phrase in Arabic script (the REAL dialectal form actually used by native speakers — do NOT just repeat the MSA form for the colloquial dialects), a Latin-letter transliteration, brief pronunciation notes when they differ meaningfully, the usage context, and a formality level (formal, casual, or slang).

Also give a one-paragraph note on the cultural/usage differences and the shared Arabic root if one applies.

Be precise and authentic. Return the result ONLY by calling the emit_comparison function.`;

    const userPrompt = `Compare how "${word}" is expressed across Gulf, Egyptian, Levantine, Yemeni Arabic, and MSA. The learner's own dialect is ${source_dialect}, so make the ${source_dialect} row especially accurate.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FLASH,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        tools: [
          {
            type: "function",
            function: {
              name: "emit_comparison",
              description: "Return the cross-dialect comparison.",
              parameters: TOOL_PARAMETERS,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_comparison" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn("dialect-compare gateway error:", response.status, errText.slice(0, 200));
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted — please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("AI model failed for dialect comparison");
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const toolArgs = message?.tool_calls?.[0]?.function?.arguments;

    // Prefer the structured tool call; fall back to salvaging JSON from content.
    let parsed: unknown = null;
    if (typeof toolArgs === "string" && toolArgs.trim()) {
      try { parsed = JSON.parse(toolArgs); } catch { /* fall through */ }
    }
    if (parsed === null) {
      const content = typeof message?.content === "string" ? message.content : "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
    }

    const comparison = validateComparison(parsed);
    if (!comparison) {
      console.error("dialect-compare: unusable AI response", JSON.stringify(parsed)?.slice(0, 300));
      return new Response(
        JSON.stringify({ error: "Couldn't build a reliable comparison — please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ comparison }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Dialect compare error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
