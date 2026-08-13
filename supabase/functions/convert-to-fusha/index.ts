// Dialect → Modern Standard Arabic (فصحى), on demand, for lines that have no
// stored `fusha`.
//
// Everything analysed after the Fusha pass landed in `analyze-gulf-arabic`
// carries the row already. This exists for everything analysed before it: the
// learner's saved transcriptions and the whole Discover library, which would
// otherwise show an empty Fusha toggle forever. The page asks for the lines it
// is showing, not the whole transcript, so an old video costs one call for the
// part someone actually reads.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { alignFushaLines, buildFushaSystemPrompt } from "../_shared/fushaBridge.ts";

/** Kept in step with the analyzer's own batching: long enough to be worth a call, short enough to finish. */
const MAX_LINES = 40;

function dialectLabel(dialect: string): string {
  if (dialect === "Egyptian") return "Egyptian Arabic (مصري)";
  if (dialect === "Yemeni") return "Yemeni Arabic (يمني)";
  return "Gulf Arabic (Khaliji)";
}

function routeFor(model: string): { url: string; key: string | undefined } {
  return /^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai)\//.test(model)
    ? { url: "https://openrouter.ai/api/v1/chat/completions", key: Deno.env.get("OPENROUTER_API_KEY") }
    : { url: "https://ai.gateway.lovable.dev/v1/chat/completions", key: Deno.env.get("LOVABLE_API_KEY") };
}

async function convert(model: string, systemPrompt: string, numbered: string): Promise<unknown | null> {
  const { url, key } = routeFor(model);
  if (!key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: numbered },
        ],
        max_tokens: 8192,
        temperature: 0.1,
      }),
    });
    if (!response.ok) {
      console.warn(`[convert-to-fusha] ${model} ${response.status}`);
      return null;
    }
    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content) return null;
    // Models wrap JSON in a fence often enough that stripping it is cheaper
    // than a retry.
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      console.warn(`[convert-to-fusha] ${model} returned unparseable content`);
      return null;
    }
  } catch (e) {
    console.warn(`[convert-to-fusha] ${model} failed:`, e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cap = await enforceDailyCap(req, "convert-to-fusha", 40, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const rawLines: unknown = body?.lines;
    const dialect = typeof body?.dialect === "string" ? body.dialect : "Gulf";

    const lines = Array.isArray(rawLines)
      ? rawLines.map((l) => (typeof l === "string" ? l.trim() : "")).filter((l) => l.length > 0)
      : [];

    if (lines.length === 0) {
      return new Response(JSON.stringify({ error: "Missing lines" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lines.length > MAX_LINES) {
      // Truncating instead would answer a different question than the one
      // asked, and the caller aligns the result by index.
      return new Response(
        JSON.stringify({ error: "too_many_lines", message: `Send at most ${MAX_LINES} lines per call.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = buildFushaSystemPrompt(dialectLabel(dialect));
    const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");

    // Claude first, Gemini as fallback — same order as the analyzer's pass, so
    // a line converted here reads like a line converted there.
    for (const model of [MODEL_IDS.CLAUDE, MODEL_IDS.GEMINI_FLASH]) {
      const parsed = await convert(model, systemPrompt, numbered);
      if (!parsed) continue;
      const fusha = alignFushaLines(parsed, lines.length);
      if (fusha.some((f) => f.length > 0)) {
        return new Response(JSON.stringify({ fusha, model }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn(`[convert-to-fusha] ${model} produced no usable Arabic for ${lines.length} lines`);
    }

    // Both models are gone or neither answered in Arabic. An empty array here
    // would look like "these lines are already Fusha", which is a lie.
    return new Response(
      JSON.stringify({ error: "fusha_unavailable", message: "Fusha conversion is temporarily unavailable." }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("convert-to-fusha error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
