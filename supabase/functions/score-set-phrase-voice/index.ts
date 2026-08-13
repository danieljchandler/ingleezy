/**
 * score-set-phrase-voice
 *
 * Transcribes a short user utterance via Munsit ASR and compares against the
 * canonical phrase + accepted variants for a set_phrase. Returns similarity,
 * SM-2-style quality (0..5) and an `accepted` flag.
 *
 * Body: { audioBase64: string, mimeType?: string, phraseId: string, target: 'phrase'|'reply' }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { munsitModel, munsitFallbackModel } from "../_shared/asrConfig.ts";
import {
  recordLearnerErrorsForRequest,
  resolveLearnerErrorsForRequest,
} from "../_shared/learnerErrors.ts";


const MUNSIT_BASE = "https://api.munsit.com/api/v1";

function normalizeArabic(s: string): string {
  if (!s) return "";
  return s
    // strip tashkeel (diacritics)
    .replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, "")
    // tatweel
    .replace(/\u0640/g, "")
    // alef variants → bare alef
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    // alef maqsura → ya
    .replace(/\u0649/g, "\u064A")
    // ta marbuta → ha
    .replace(/\u0629/g, "\u0647")
    // hamza variations on waw/ya
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    // strip standalone hamza, punctuation
    .replace(/[\u0621\u060C\u061B\u061F.,!?؟،؛"'()\[\]{}«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function similarity(a: string, b: string): number {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

async function munsitCall(audioBase64: string, mimeType: string, apiKey: string, model: string): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const fd = new FormData();
  fd.append("file", new File([blob], "utterance." + (mimeType.includes("wav") ? "wav" : "webm"), { type: blob.type }));
  fd.append("model", model);

  const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: fd,
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Munsit ${resp.status}: ${t.slice(0, 200)}`);
  }
  const raw = await resp.json();
  // Munsit returns { statusCode, data: { transcription, ... } }; older/alt
  // shapes may put transcription at the root — fall back to that.
  const payload = raw?.data ?? raw ?? {};
  return ((payload.transcription ?? raw.transcription ?? "") as string).toString();
}

/**
 * Transcribe with the primary Munsit model, retrying once on the other model
 * when the first answer is empty. The bare `munsit` model went degraded
 * upstream (a few characters back for any payload), so the default is now
 * `munsit-en-ar` — the retry covers the reverse happening later.
 */
async function munsitTranscribe(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
  const primary = munsitModel();
  const first = await munsitCall(audioBase64, mimeType, apiKey, primary);
  if (first.trim()) return first;
  const fallback = munsitFallbackModel(primary);
  console.warn(`munsit: empty transcription from ${primary} — retrying with ${fallback}`);
  return await munsitCall(audioBase64, mimeType, apiKey, fallback);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { audioBase64, mimeType, phraseId, target } = await req.json();
    if (!audioBase64 || !phraseId) {
      return new Response(JSON.stringify({ error: "audioBase64 and phraseId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: phrase, error } = await supabase
      .from("set_phrases")
      .select("phrase_arabic, reply_arabic, accepted_variants, dialect")
      .eq("id", phraseId)
      .maybeSingle();
    if (error || !phrase) throw new Error("phrase not found");

    const canonical = (target === "reply" ? phrase.reply_arabic : phrase.phrase_arabic) || "";
    if (!canonical) throw new Error("no canonical text for target");

    // Take the dialect from the phrase itself rather than the request body —
    // it's authoritative, and recorded errors must land in the same bucket the
    // learner profile reads.
    const dialect = phrase.dialect || "Gulf";

    const variants: string[] = Array.isArray(phrase.accepted_variants)
      ? phrase.accepted_variants.filter((v: unknown) => typeof v === "string")
      : [];
    const candidates = [canonical, ...variants];

    const apiKey = Deno.env.get("MUNSIT_API_KEY");
    if (!apiKey) throw new Error("MUNSIT_API_KEY not configured");

    const transcript = await munsitTranscribe(audioBase64, mimeType || "audio/webm", apiKey);

    let best = 0;
    for (const c of candidates) {
      const s = similarity(transcript, c);
      if (s > best) best = s;
    }

    let quality = 1;
    if (best >= 0.9) quality = 5;
    else if (best >= 0.75) quality = 4;
    else if (best >= 0.55) quality = 3;
    else if (best >= 0.35) quality = 2;
    const accepted = best >= 0.75;

    // Record rejected attempts so the phrase resurfaces in generated practice;
    // clear the flag once it's said acceptably. Fire-and-forget.
    if (!accepted) {
      void recordLearnerErrorsForRequest(req, [{
        source: "set_phrase_voice",
        dialect,
        targetArabic: canonical,
        producedArabic: transcript,
        errorKind: "mispronunciation",
        detail: { similarity: best, quality, target: target ?? "phrase", phraseId },
      }]);
    } else {
      void resolveLearnerErrorsForRequest(req, canonical, dialect);
    }

    return new Response(
      JSON.stringify({ transcript, similarity: best, quality, accepted, canonical }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("score-set-phrase-voice error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
