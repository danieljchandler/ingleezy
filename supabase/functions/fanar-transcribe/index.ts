import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const FANAR_STT_TIMEOUT_MS = 2 * 60 * 1000;
// Fanar quotas: Fanar-Aura-STT-1 20/day, Fanar-Aura-STT-LF-1 10/day.
// Each is metered separately in fanar_usage with headroom under the API caps.
const STT_DAILY_LIMIT = 18;
const STT_LF_DAILY_LIMIT = 8;
// STT-1 is documented for clips up to ~20-30s; route bigger uploads (~0.5 MB
// ≈ 30s of 128 kbps MP3) to the long-form model.
const LONG_FORM_BYTES = 0.5 * 1024 * 1024;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'fanar-transcribe', 30, corsHeaders);
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

    const FANAR_API_KEY = Deno.env.get("FANAR_API_KEY")?.trim();
    if (!FANAR_API_KEY) {
      console.error("FANAR_API_KEY is not configured");
      return new Response(
        JSON.stringify({ text: null, fanarUsed: false, fanarAvailable: false, reason: "api_key_not_configured", budgetRemaining: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get audio file from request
    let audioFile: File | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { audioUrl } = body;

      if (!audioUrl) {
        return new Response(
          JSON.stringify({ error: "audioUrl is required for JSON requests" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`fanar-transcribe: fetching audio from URL: ${audioUrl.substring(0, 100)}...`);

      const audioResponse = await fetch(audioUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': new URL(audioUrl).origin + '/',
          'Accept': '*/*',
        },
      });
      if (!audioResponse.ok) {
        console.error(`fanar-transcribe: failed to fetch audio: ${audioResponse.status}`);
        return new Response(
          JSON.stringify({ error: "Failed to fetch audio from URL", status: audioResponse.status }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const audioBlob = await audioResponse.blob();
      audioFile = new File([audioBlob], "audio.mp3", { type: audioBlob.type || "audio/mpeg" });
    } else {
      const formData = await req.formData();
      audioFile = formData.get("audio") as File;
    }

    if (!audioFile) {
      return new Response(
        JSON.stringify({ error: "No audio file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fileSizeMB = (audioFile.size / (1024 * 1024)).toFixed(2);

    // Route to the model matching the clip length, then check that model's
    // separate daily budget.
    const isLongForm = audioFile.size > LONG_FORM_BYTES;
    const sttModel = isLongForm ? "Fanar-Aura-STT-LF-1" : "Fanar-Aura-STT-1";
    const usageEndpoint = isLongForm ? "stt-lf" : "stt";
    const dailyLimit = isLongForm ? STT_LF_DAILY_LIMIT : STT_DAILY_LIMIT;
    console.log(`fanar-transcribe: processing ${audioFile.name}, size: ${fileSizeMB} MB, type: ${audioFile.type}, model: ${sttModel}`);

    const today = new Date().toISOString().slice(0, 10);
    const { count, error: countError } = await supabaseService
      .from('fanar_usage')
      .select('*', { count: 'exact', head: true })
      .eq('endpoint', usageEndpoint)
      .gte('created_at', `${today}T00:00:00Z`);

    if (countError) {
      console.warn("Failed to check fanar_usage budget:", countError.message);
    }

    const usedToday = count ?? 0;
    const budgetRemaining = Math.max(0, dailyLimit - usedToday);

    if (usedToday >= dailyLimit) {
      console.log(`fanar-transcribe: daily ${usageEndpoint} budget exhausted (${usedToday}/${dailyLimit})`);
      return new Response(
        JSON.stringify({ text: null, fanarUsed: false, fanarAvailable: false, reason: "daily_limit_reached", budgetRemaining: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Fanar STT API
    const apiFormData = new FormData();
    apiFormData.append("file", audioFile);
    apiFormData.append("model", sttModel);
    apiFormData.append("response_format", "json");
    apiFormData.append("language", "ar");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FANAR_STT_TIMEOUT_MS);

    const startTime = Date.now();
    const response = await fetch("https://api.fanar.qa/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FANAR_API_KEY}`,
      },
      body: apiFormData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`fanar-transcribe: Fanar responded in ${elapsedSec}s with status ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`fanar-transcribe: Fanar API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ text: null, fanarUsed: false, fanarAvailable: true, reason: `api_error_${response.status}`, budgetRemaining }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const transcription = await response.json();
    const text = transcription.text || null;
    console.log(`fanar-transcribe: transcript length: ${text?.length || 0} characters`);

    // Log usage to fanar_usage table
    try {
      await supabaseService.from('fanar_usage').insert({
        endpoint: usageEndpoint,
        user_id: user.id,
      });
    } catch (logErr) {
      console.warn("fanar-transcribe: failed to log fanar_usage:", logErr instanceof Error ? logErr.message : String(logErr));
    }

    return new Response(
      JSON.stringify({ text, fanarUsed: true, fanarAvailable: true, budgetRemaining: budgetRemaining - 1 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("fanar-transcribe error:", error);
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "Fanar STT request timed out.";
      } else {
        errorMessage = error.message;
      }
    }
    return new Response(
      JSON.stringify({ text: null, fanarUsed: false, fanarAvailable: true, reason: errorMessage, budgetRemaining: -1 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
