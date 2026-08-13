import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logEdgeError } from "../_shared/logError.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "pronunciation-feedback", 60, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const payload = await req.json();
    const { mode } = payload;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // ── Shadow mode: coach on the gap between what the learner said and the
    //    exact words the native speaker said in this clip. ──────────────────
    let prompt: string;
    if (mode === "shadow") {
      const { referenceText, recognizedText, closeness, wordDiffs } = payload;
      if (!referenceText) {
        return new Response(JSON.stringify({ error: "referenceText is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const diffSummary = (Array.isArray(wordDiffs) ? wordDiffs : [])
        .map((d: any) => {
          if (d.status === "match") return null;
          if (d.status === "missing") return `missed "${d.ref}"`;
          if (d.status === "extra") return `added "${d.said}"`;
          if (d.status === "sub") return `said "${d.said}" instead of "${d.ref}"`;
          return null;
        })
        .filter(Boolean)
        .join("; ");

      prompt = `You are a friendly Arabic pronunciation coach. A learner is SHADOWING (repeating after) a native speaker clip.

The native speaker said: "${referenceText}"
The learner said (as heard by speech recognition): "${recognizedText || "(nothing recognised)"}"
Closeness to the native clip: ${Math.round(closeness ?? 0)}/100.
${diffSummary ? `Differences from the clip: ${diffSummary}.` : "The words matched the clip closely."}

Give exactly 2-3 short, actionable tips (one sentence each) to help them match the native clip more closely. Reference the specific Arabic words/sounds they missed or changed. Be encouraging but specific. If they matched well, give tips on rhythm/intonation. Do not repeat the score.`;
    } else {
      // ── Legacy Azure-scores mode (unchanged). ──────────────────────────────
      const { word_arabic, word_english, scores, dialect } = payload;

      if (!scores) {
        return new Response(JSON.stringify({ error: "scores is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isSingleWord = (word_arabic || "").trim().split(/\s+/).length === 1;

    // Build a concise summary of the scores for the prompt
    const wordBreakdown = (scores.words || [])
      .map((w: any) => {
        const phonemeDetail = (w.phonemes || [])
          .filter((p: any) => p.accuracy < 70)
          .map((p: any) => `${p.phoneme}(${Math.round(p.accuracy)})`)
          .join(", ");
        return `"${w.word}" accuracy=${Math.round(w.accuracy)} error=${w.errorType}${phonemeDetail ? ` weak_phonemes=[${phonemeDetail}]` : ""}`;
      })
      .join("\n");

    // Accept both Azure locale codes (ar-EG / ar-YE) and the canonical dialect
    // keys (Egyptian / Yemeni / Gulf) used elsewhere in the app.
    const d = String(dialect ?? "");
    const dialectLabel = (d === "ar-EG" || d === "Egyptian")
      ? "Egyptian Arabic"
      : (d === "ar-YE" || d === "Yemeni")
        ? "Yemeni Arabic"
        : "Gulf Arabic (Saudi/Khaliji)";

    prompt = `You are a friendly Arabic pronunciation coach specializing in ${dialectLabel}.

A learner just attempted to pronounce: "${word_arabic}"${word_english ? ` (meaning: "${word_english}")` : ""}.

Here are their Azure Speech Assessment scores:
- Overall: ${Math.round(scores.overall)}/100
- Accuracy: ${Math.round(scores.accuracy)}/100
- Fluency: ${Math.round(scores.fluency)}/100
- Completeness: ${Math.round(scores.completeness)}/100
- Recognized text: "${scores.recognizedText}"

Per-word breakdown:
${wordBreakdown || "N/A"}

${isSingleWord
  ? "This is a single word. Focus on phoneme-level feedback."
  : "This is a phrase. Include word-level and fluency feedback."}

Give exactly 2-3 short, actionable tips (one sentence each) to improve their pronunciation. Be encouraging but specific. Reference the actual Arabic words/sounds. Do not repeat the scores.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: "You are a concise Arabic pronunciation coach. Return ONLY a JSON array of tip strings, no markdown, no explanation." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_tips",
              description: "Return pronunciation coaching tips",
              parameters: {
                type: "object",
                properties: {
                  tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "2-3 short actionable pronunciation tips",
                  },
                },
                required: ["tips"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_tips" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let tips: string[] = [];

    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        tips = parsed.tips || [];
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    return new Response(JSON.stringify({ tips }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pronunciation-feedback error:", e);
    await logEdgeError("pronunciation-feedback", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
