/**
 * persist-word-audio
 *
 * Caches a synthesised pronunciation onto a shared curriculum word.
 *
 * The personal deck can do this from the client: a learner owns their
 * `user_vocabulary` rows, so useAzureTTS's `persist` callback uploads the blob
 * and stamps `word_audio_url` directly (see MyWordsReview). `vocabulary_words`
 * is admin/recorder-write only (migration 20260704051941), so the same trick
 * can't work for the curriculum deck — which meant the new audio-first card
 * would re-synthesise the same word on every single review, for every learner.
 *
 * So the write happens here, under the service role. This is not a privilege
 * escalation dressed up as a cache: the only thing a caller can do is attach
 * audio to a word that already exists, only when that word has none, and the
 * audio must be of the word's own text (we synthesise it here rather than
 * accepting an uploaded blob, so a caller can't attach arbitrary audio to a
 * shared row).
 *
 * Body: { wordId: string, dialect?: string }
 * Response: { audioUrl: string, cached: boolean }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "flashcard-audio";

const EN_VOICE = "en-US-JennyNeural";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Generous cap: the whole point is that each word is synthesised once ever,
  // so a learner should never approach this in normal use.
  const cap = await enforceDailyCap(req, "persist-word-audio", 200, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { wordId, dialect } = await req.json();
    if (!wordId || typeof wordId !== "string") {
      return new Response(JSON.stringify({ error: "wordId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: word, error: wordErr } = await admin
      .from("vocabulary_words")
      .select("id, word_english, audio_url, dialect_module")
      .eq("id", wordId)
      .maybeSingle();

    if (wordErr) throw wordErr;
    if (!word) {
      return new Response(JSON.stringify({ error: "word not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already cached — another learner (or an earlier session) got there first.
    if (word.audio_url) {
      return new Response(JSON.stringify({ audioUrl: word.audio_url, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Synthesise here rather than accepting a client-uploaded blob: the row is
    // shared across every learner, so its audio must provably be this word.
    // azure-tts gates on its own daily cap, which resolves a *user* from the
    // Authorization header. A service-role key has no user, so passing it here
    // made every call fail 401 auth_required → tts_failed. Forward the caller's
    // token instead: they're already past this function's own cap check.
    const callerAuth = req.headers.get("Authorization") ?? "";
    const ttsRes = await fetch(`${SUPABASE_URL}/functions/v1/azure-tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(callerAuth ? { Authorization: callerAuth } : {}),
        apikey: SERVICE_ROLE,
      },
      body: JSON.stringify({
        // The card's audio is the ENGLISH target word (the thing being
        // learned); dialect voices only apply to Arabic scaffold audio.
        text: word.word_english,
        voice: EN_VOICE,
      }),
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      console.error("persist-word-audio: TTS failed", ttsRes.status, detail.slice(0, 200));
      return new Response(JSON.stringify({ error: "tts_failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audio = new Uint8Array(await ttsRes.arrayBuffer());
    const path = `curriculum/word-${wordId}.mp3`;

    const { error: uploadErr } = await admin.storage
      .from(BUCKET)
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path);
    const audioUrl = urlData.publicUrl;

    // Only fill an empty slot — never overwrite a recording an admin uploaded.
    const { error: updateErr } = await admin
      .from("vocabulary_words")
      .update({ audio_url: audioUrl })
      .eq("id", wordId)
      .is("audio_url", null);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ audioUrl, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("persist-word-audio error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
