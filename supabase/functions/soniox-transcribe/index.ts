import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { SONIOX_MODEL, buildSonioxContext, type DialectModule } from "../_shared/asrConfig.ts";


const SONIOX_BASE = "https://api.soniox.com/v1";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 4 * 60 * 1000; // 4 minutes max polling

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'soniox-transcribe', 30, corsHeaders);
  if (cap.limited) return cap.response;

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");
    if (!SONIOX_API_KEY) {
      console.error("SONIOX_API_KEY is not configured");
      return new Response(
        JSON.stringify({ text: null, sonioxUsed: false, reason: "api_key_not_configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = {
      Authorization: `Bearer ${SONIOX_API_KEY}`,
    };
    const jsonHeaders = {
      ...headers,
      "Content-Type": "application/json",
    };

    // Determine input mode: audioUrl (JSON) or file upload (FormData)
    const contentType = req.headers.get("content-type") || "";
    let fileId: string | null = null;
    let audioUrl: string | null = null;
    let includeTranslation = false;
    let dialect: DialectModule = "Gulf";

    const parseDialect = (raw: unknown): DialectModule =>
      raw === "Egyptian" || raw === "Yemeni" ? raw : "Gulf";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      audioUrl = body.audioUrl || null;
      includeTranslation = body.includeTranslation === true;
      dialect = parseDialect(body.dialect);

      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl is required for JSON requests" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // FormData upload — upload to Soniox Files API
      const formData = await req.formData();
      const audioFile = (formData.get("audio") || formData.get("file")) as File;
      includeTranslation = formData.get("includeTranslation") === "true";
      dialect = parseDialect(formData.get("dialect"));

      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);
      console.log(`soniox-transcribe: uploading ${audioFile.name} (${fileSizeMB} MB) to Soniox Files API`);

      const uploadForm = new FormData();
      uploadForm.append("file", audioFile);

      const uploadResp = await fetch(`${SONIOX_BASE}/files`, {
        method: "POST",
        headers,
        body: uploadForm,
      });

      if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        console.error(`soniox-transcribe: file upload failed: ${uploadResp.status} — ${errText}`);
        return new Response(
          JSON.stringify({ text: null, sonioxUsed: false, reason: `file_upload_error_${uploadResp.status}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const uploadData = await uploadResp.json();
      fileId = uploadData.id;
      console.log(`soniox-transcribe: file uploaded, id=${fileId}`);
    }

    // Helper: create transcription and poll to completion.
    // Model pinned to v5 (v4 retired 2026-06-30). language_hints includes "en"
    // because this corpus is heavily Arabic-English code-switched — the old
    // ["ar"] + strict combination suppressed English tokens. context biases
    // recognition toward the dialect's vocabulary.
    async function createAndPoll(withTranslation: boolean, withContext = true): Promise<{ ok: boolean; transcriptionId?: string; error?: string }> {
      const body: Record<string, unknown> = {
        model: SONIOX_MODEL,
        language_hints: ["ar", "en"],
        enable_speaker_diarization: true,
        ...(withContext ? { context: buildSonioxContext(dialect) } : {}),
      };

      if (fileId) body.file_id = fileId;
      else if (audioUrl) body.audio_url = audioUrl;

      if (withTranslation) {
        body.translation = { type: "one_way", target_language: "en" };
      }

      console.log(`soniox-transcribe: creating transcription (translation=${withTranslation})...`);

      const createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });

      if (!createResp.ok) {
        const errText = await createResp.text();
        console.error(`soniox-transcribe: create failed: ${createResp.status} — ${errText}`);
        return { ok: false, error: `create_error_${createResp.status}: ${errText}` };
      }

      const transcription = await createResp.json();
      const tId = transcription.id;
      console.log(`soniox-transcribe: transcription created, id=${tId}, status=${transcription.status}`);

      let status = transcription.status;
      let lastPollData = transcription;

      while (status !== "completed" && status !== "error") {
        if (Date.now() - startTime > MAX_POLL_MS) {
          console.error(`soniox-transcribe: polling timed out after ${MAX_POLL_MS / 1000}s`);
          return { ok: false, error: "polling_timeout" };
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const pollResp = await fetch(`${SONIOX_BASE}/transcriptions/${tId}`, { headers });
        if (!pollResp.ok) {
          console.warn(`soniox-transcribe: poll error ${pollResp.status}`);
          await pollResp.text(); // consume body
          continue;
        }
        lastPollData = await pollResp.json();
        status = lastPollData.status;
      }

      if (status === "error") {
        console.error(`soniox-transcribe: transcription failed. Full error response:`, JSON.stringify(lastPollData));
        return { ok: false, transcriptionId: tId, error: `transcription_error: ${lastPollData.error_message || lastPollData.error || JSON.stringify(lastPollData)}` };
      }

      return { ok: true, transcriptionId: tId };
    }

    const startTime = Date.now();

    // Attempt with translation if requested; retry without on failure, then
    // once more without the context/diarization extras so a schema rejection
    // can never take the whole leg down.
    let result = await createAndPoll(includeTranslation);

    if (!result.ok && includeTranslation) {
      console.warn(`soniox-transcribe: failed with translation enabled, retrying without translation. Error: ${result.error}`);
      result = await createAndPoll(false);
    }
    if (!result.ok) {
      console.warn(`soniox-transcribe: retrying with minimal request body. Error: ${result.error}`);
      result = await createAndPoll(false, false);
    }

    if (!result.ok) {
      console.error(`soniox-transcribe: final failure — ${result.error}`);
      return new Response(
        JSON.stringify({ text: null, sonioxUsed: false, reason: result.error || "transcription_error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcriptionId = result.transcriptionId!;

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`soniox-transcribe: transcription completed in ${elapsedSec}s`);

    // Get the transcript with tokens
    const transcriptResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcriptionId}/transcript`, {
      headers,
    });

    if (!transcriptResp.ok) {
      const errText = await transcriptResp.text();
      console.error(`soniox-transcribe: get transcript failed: ${transcriptResp.status} — ${errText}`);
      return new Response(
        JSON.stringify({ text: null, sonioxUsed: false, reason: `transcript_fetch_error_${transcriptResp.status}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcriptData = await transcriptResp.json();
    const text = transcriptData.text || "";
    const tokens = transcriptData.tokens || [];

    // Build word-level array matching Deepgram's format: { text, start, end }
    // Soniox tokens are sub-word; merge consecutive tokens into words
    const words: Array<{ text: string; start: number; end: number }> = [];
    let currentWord = "";
    let wordStart = 0;
    let wordEnd = 0;

    for (const token of tokens) {
      // Soniox tokens with text starting without space are continuations
      const tokenText: string = token.text ?? "";
      if (tokenText === "" || tokenText === " ") {
        if (currentWord) {
          words.push({ text: currentWord, start: wordStart / 1000, end: wordEnd / 1000 });
          currentWord = "";
        }
        continue;
      }

      if (tokenText.startsWith(" ") || !currentWord) {
        // New word
        if (currentWord) {
          words.push({ text: currentWord, start: wordStart / 1000, end: Math.max(wordEnd, wordStart) / 1000 });
        }
        currentWord = tokenText.trimStart();
        wordStart = token.start_ms ?? 0;
        // Some Soniox tokens omit end_ms on the first sub-word of a phrase.
        // Falling through to 0 collapses word timing — keep the token's own
        // start_ms as a safe lower bound (same fix as the pipeline copy).
        wordEnd = token.end_ms ?? token.start_ms ?? 0;
      } else {
        // Continuation of current word
        currentWord += tokenText;
        wordEnd = token.end_ms ?? token.start_ms ?? wordEnd;
      }
    }
    if (currentWord) {
      words.push({ text: currentWord, start: wordStart / 1000, end: Math.max(wordEnd, wordStart) / 1000 });
    }

    console.log(`soniox-transcribe: ${text.length} chars, ${words.length} words`);

    // Extract translation if available
    let translationText: string | null = null;
    if (includeTranslation && transcriptData.translation_text) {
      translationText = transcriptData.translation_text;
    }

    // Clean up uploaded file if we uploaded one
    if (fileId) {
      fetch(`${SONIOX_BASE}/files/${fileId}`, { method: "DELETE", headers }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        text,
        words,
        sonioxUsed: true,
        ...(translationText ? { translationText } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("soniox-transcribe error:", error);
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return new Response(
      JSON.stringify({ text: null, sonioxUsed: false, reason: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
