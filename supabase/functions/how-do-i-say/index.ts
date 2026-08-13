// how-do-i-say — "how do I say this in English?" for Arabic speakers.
// The learner types a phrase (dialect, Fusha, or rough English), a scenario,
// or a pasted conversation, and gets 2-4 natural ENGLISH ways to say it —
// each with a dialect-Arabic gloss and an Arabic-script phonetic rendering
// (the mirror of the Latin transliteration the Arabic app gave English
// speakers). Council strategy in english-target mode: the interference
// rulebook steers phrasing and the usage notes toward what Arabic speakers
// actually need told.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


interface Translation {
  english: string;
  arabic: string;
  /** The English pronounced in Arabic letters ("ثانك يو"), readable aloud immediately. */
  phonetic_ar: string;
  context: string;
  naturalness: number;
  isPreferred: boolean;
}

interface VocabItem {
  english: string;
  arabic: string;
}

interface BrainOutput {
  inputMode: "translation" | "scenario" | "conversation";
  detectedContext: string;
  situationSummary?: string;
  translations: Translation[];
  vocabulary?: VocabItem[];
  usageNotes_ar?: string;
}

function buildExtras(dialect: Dialect): string {
  const dialectLabel = getDialectLabel(dialect);
  return `You are an expert English teacher for native ${dialectLabel} speakers.

The user may provide one of three input types (their input may be Arabic, English, or a mix). Detect which it is:
1. TRANSLATION — a word or phrase they want to say in English (e.g. "أنا تعبان", "شكراً بس بطريقة ثانية").
2. SCENARIO — a situation description (e.g. "أنا في مطعم وأبي الفاتورة").
3. CONVERSATION — a pasted chat where they want an English reply.

Based on the detected type:
- TRANSLATION → 2-4 natural spoken-English ways to say it.
- SCENARIO → 2-4 things to say in that situation, ordered most→least appropriate.
- CONVERSATION → analyse tone/relationship, then 2-4 natural English replies.

Rules for the emit_translation tool call:
- inputMode is exactly one of: translation | scenario | conversation.
- detectedContext is one friendly sentence in ${dialectLabel} confirming what you understood.
- situationSummary is required for SCENARIO and CONVERSATION (in ${dialectLabel}); omit for TRANSLATION.
- Provide 2-4 translations ordered most→least natural. Exactly one must have isPreferred=true.
- naturalness is 1-5 (5 = what a native speaker would actually say).
- english: contemporary SPOKEN English — contractions welcome; textbook stiffness is a defect.
- arabic: a ${dialectLabel} gloss of that English line (never Fusha).
- phonetic_ar: the English pronounced in Arabic letters (e.g. "ثانك يو" for "thank you").
- vocabulary: 3-8 most useful individual English words from the answers, each with its ${dialectLabel} meaning.
- usageNotes_ar: 2-4 practical sentences in ${dialectLabel} — register, politeness, when each phrasing fits, and any Arabic-transfer trap to avoid.`;
}

const TOOL_PARAMETERS = {
  type: "object",
  properties: {
    inputMode: { type: "string", enum: ["translation", "scenario", "conversation"] },
    detectedContext: { type: "string" },
    situationSummary: { type: "string" },
    translations: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          english: { type: "string" },
          arabic: { type: "string" },
          phonetic_ar: { type: "string" },
          context: { type: "string" },
          naturalness: { type: "number", minimum: 1, maximum: 5 },
          isPreferred: { type: "boolean" },
        },
        required: ["english", "arabic", "phonetic_ar", "naturalness", "isPreferred"],
      },
    },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          english: { type: "string" },
          arabic: { type: "string" },
        },
        required: ["english", "arabic"],
      },
    },
    usageNotes_ar: { type: "string" },
  },
  required: ["inputMode", "detectedContext", "translations"],
} as const;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "how-do-i-say", 20, corsHeaders);
  if (cap.limited) return cap.response;

  const authHeader = req.headers.get("Authorization");

  try {
    // Resolve caller identity (anonymous allowed).
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await supabaseAuth.auth.getUser();
      userId = user?.id ?? null;
    }

    const body = await req.json();
    const { phrase, dialect: requestDialect } = body;
    const dialect: Dialect =
      requestDialect === "Egyptian" ? "Egyptian" :
      requestDialect === "Yemeni" ? "Yemeni" : "Gulf";

    if (!phrase || typeof phrase !== "string" || phrase.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Please provide a phrase to translate" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const trimmedPhrase = phrase.trim().slice(0, 2000);
    console.log(`how-do-i-say: dialect=${dialect}, phrase="${trimmedPhrase}"`);

    const brain = await askBrain<BrainOutput>({
      purpose: "how_do_i_say",
      dialect,
      target: "english",
      // Strategy resolved by pickStrategy(purpose) → council (drafters + judge),
      // matching this function's documented multi-model consensus.
      userPrompt: trimmedPhrase,
      systemPromptExtra: buildExtras(dialect),
      maxTokens: 2048,
      temperature: 0.4,
      tool: {
        name: "emit_translation",
        description: "Emit natural English phrasings (with Arabic glosses) for the user's input.",
        parameters: TOOL_PARAMETERS as unknown as Record<string, unknown>,
      },
    });

    const parsed = brain.output;
    const translations: Translation[] = Array.isArray(parsed.translations)
      ? parsed.translations
          .filter((t) => t?.english && t?.arabic)
          .map((t) => ({
            english: String(t.english),
            arabic: String(t.arabic),
            phonetic_ar: String(t.phonetic_ar ?? ""),
            context: String(t.context ?? ""),
            naturalness: typeof t.naturalness === "number"
              ? Math.min(5, Math.max(1, t.naturalness))
              : 3,
            isPreferred: !!t.isPreferred,
          }))
      : [];

    if (translations.length === 0) {
      throw new Error("AI could not produce translations. Please try rephrasing.");
    }

    // Ensure exactly one preferred entry.
    if (!translations.some((t) => t.isPreferred)) {
      const best = translations.reduce(
        (a, b) => (b.naturalness > a.naturalness ? b : a),
        translations[0],
      );
      best.isPreferred = true;
    } else {
      let seen = false;
      for (const t of translations) {
        if (t.isPreferred && seen) t.isPreferred = false;
        if (t.isPreferred) seen = true;
      }
    }

    translations.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return b.naturalness - a.naturalness;
    });

    const vocabulary: VocabItem[] = Array.isArray(parsed.vocabulary)
      ? parsed.vocabulary
          .filter((v) => v?.english)
          .map((v) => ({
            english: String(v.english),
            arabic: String(v.arabic ?? ""),
          }))
      : [];

    const VALID_INPUT_MODES = new Set(["translation", "scenario", "conversation"]);
    const inputMode = VALID_INPUT_MODES.has(parsed.inputMode)
      ? parsed.inputMode
      : "translation";

    const llmUsed = brain.models.join(" + ");

    // Persist usage log (best-effort).
    try {
      const supabaseService = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabaseService.from("llm_usage_logs").insert({
        function_name: "how-do-i-say",
        llm_used: llmUsed,
        phrase: trimmedPhrase,
        user_id: userId,
      });
    } catch (logErr) {
      console.warn(
        `how-do-i-say: failed to write llm_usage_log:`,
        logErr instanceof Error ? logErr.message : String(logErr),
      );
    }

    const result = {
      phrase: trimmedPhrase,
      inputMode,
      detectedContext: parsed.detectedContext ? String(parsed.detectedContext) : undefined,
      situationSummary: parsed.situationSummary ? String(parsed.situationSummary) : undefined,
      translations,
      vocabulary,
      usageNotes_ar: parsed.usageNotes_ar ? String(parsed.usageNotes_ar) : undefined,
      llmUsed,
    };

    const preferred = translations.find((t) => t.isPreferred);
    console.log(
      `how-do-i-say: ${translations.length} translation(s) via ${llmUsed}, ` +
      `preferred="${preferred?.english ?? "none"}"`,
    );

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    if (e instanceof BrainHttpError) {
      if (e.status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits. Please add credits at Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (e.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("how-do-i-say brain error:", e.status, e.message);
    } else {
      console.error("how-do-i-say error:", e);
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
