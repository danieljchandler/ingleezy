// Backfill "literal" word-for-word glosses onto discover_videos.transcript_lines
// for videos transcribed before literal glosses were added to the pipeline.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function generateLiterals(
  dialect: string,
  lines: Array<{ arabic: string; translation?: string }>,
): Promise<string[]> {
  const numbered = lines
    .map((l, i) => `${i + 1}. ${l.arabic}${l.translation ? ` — ${l.translation}` : ""}`)
    .join("\n");

  const prompt = `You are an Arabic (${dialect || "Gulf"}) linguistic annotator.
For each numbered line, produce a LITERAL word-for-word English gloss preserving the Arabic word order.
Literals should closely mirror the Arabic morphology (e.g. "what news-your?" for "شخبارك؟"). They may sound stiff — that is expected; they show learners how the sentence is built.

Output ONLY valid JSON: {"literals": ["gloss 1", "gloss 2", ...]}
Length MUST equal number of lines.

Lines:
${numbered}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const literals: string[] = Array.isArray(parsed.literals) ? parsed.literals : [];
  if (literals.length !== lines.length) {
    // pad or trim to match
    while (literals.length < lines.length) literals.push("");
    literals.length = lines.length;
  }
  return literals.map((l) => (typeof l === "string" ? l : ""));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 5), 20);
    const videoId: string | undefined = body.videoId;
    const force: boolean = !!body.force;

    let query = supabase
      .from("discover_videos")
      .select("id, dialect, transcript_lines")
      .not("transcript_lines", "is", null)
      .limit(limit);
    if (videoId) query = query.eq("id", videoId);

    const { data: videos, error } = await query;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const v of videos ?? []) {
      const lines = Array.isArray(v.transcript_lines) ? v.transcript_lines : [];
      if (!lines.length) {
        results.push({ id: v.id, skipped: "no lines" });
        continue;
      }
      const missing = lines.filter((l: any) => !l?.literal || String(l.literal).trim() === "");
      if (!force && missing.length === 0) {
        results.push({ id: v.id, skipped: "already has literals" });
        continue;
      }

      // Batch in chunks of 25 lines to stay within model limits
      const chunkSize = 25;
      const updated = [...lines];
      try {
        for (let i = 0; i < updated.length; i += chunkSize) {
          const chunk = updated.slice(i, i + chunkSize);
          const literals = await generateLiterals(
            v.dialect || "Gulf",
            chunk.map((l: any) => ({ arabic: String(l.arabic ?? ""), translation: l.translation })),
          );
          for (let j = 0; j < chunk.length; j++) {
            if (force || !updated[i + j]?.literal) {
              updated[i + j] = { ...updated[i + j], literal: literals[j] || "" };
            }
          }
        }

        const { error: upErr } = await supabase
          .from("discover_videos")
          .update({ transcript_lines: updated })
          .eq("id", v.id);
        if (upErr) throw upErr;

        results.push({ id: v.id, updated: updated.length });
      } catch (e) {
        results.push({ id: v.id, error: String((e as Error).message ?? e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
