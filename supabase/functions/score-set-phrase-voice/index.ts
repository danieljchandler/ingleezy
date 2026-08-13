/**
 * score-set-phrase-voice
 *
 * Transcribes a short ENGLISH utterance via Deepgram and compares against the
 * canonical English phrase + accepted variants for a set_phrase. Returns
 * similarity, SM-2-style quality (0..5) and an `accepted` flag.
 *
 * Body: { audioBase64: string, mimeType?: string, phraseId: string, target: 'phrase'|'reply' }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  recordLearnerErrorsForRequest,
  resolveLearnerErrorsForRequest,
} from "../_shared/learnerErrors.ts";


const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/**
 * Fold an English utterance down to what a fair comparison needs: case,
 * punctuation and apostrophes gone, whitespace collapsed. Kept deliberately
 * dumber than a phonetic match — "I'm good thanks" vs "im good thanks" must
 * be identical, but "I'm well" staying distinct from "I'm good" is the test.
 */
function normalizeEnglish(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const na = normalizeEnglish(a);
  const nb = normalizeEnglish(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

/** Transcribe a short English utterance. Nova-3 handles accented English well;
 *  keyterm boosting nudges it toward the phrase being practised. */
async function deepgramTranscribe(
  audioBase64: string,
  mimeType: string,
  apiKey: string,
  keyterm?: string,
): Promise<string> {
  const bin = atob(audioBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    punctuate: "true",
    smart_format: "true",
  });
  if (keyterm?.trim()) params.append("keyterm", `${keyterm.trim()}:2`);

  const resp = await fetch(`${DEEPGRAM_URL}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": mimeType || "audio/webm",
    },
    body: bytes,
    signal: AbortSignal.timeout(25_000),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Deepgram ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").toString();
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
      .select("phrase_english, reply_english, accepted_variants, dialect")
      .eq("id", phraseId)
      .maybeSingle();
    if (error || !phrase) throw new Error("phrase not found");

    const canonical = (target === "reply" ? phrase.reply_english : phrase.phrase_english) || "";
    if (!canonical) throw new Error("no canonical text for target");

    // Take the dialect from the phrase itself rather than the request body —
    // it names the learner's L1 bucket, and recorded errors must land in the
    // same bucket the learner profile reads.
    const dialect = phrase.dialect || "Gulf";

    const variants: string[] = Array.isArray(phrase.accepted_variants)
      ? phrase.accepted_variants.filter((v: unknown) => typeof v === "string")
      : [];
    const candidates = [canonical, ...variants];

    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY not configured");

    const transcript = await deepgramTranscribe(
      audioBase64,
      mimeType || "audio/webm",
      apiKey,
      canonical,
    );

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
    // clear the flag once it's said acceptably. Fire-and-forget. The
    // target_arabic column carries English targets since the retarget.
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
