/**
 * munsit-transcribe — Munsit Arabic ASR (https://api.munsit.com/api/v1).
 *
 * Endpoint: POST /audio/transcribe (multipart/form-data, x-api-key auth)
 * Models:   "munsit-en-ar" (default; the bare "munsit" model is degraded
 *           upstream and returns a few characters for any input)
 *
 * This is a thin wrapper exposed for ad-hoc callers / testing.  The main
 * pipeline (process-approved-video) calls the Munsit REST API directly so it
 * can run all engines in parallel without an extra hop.
 *
 * Request body (JSON):
 *   { audioBase64: string, mimeType?: string, model?: string }
 * — or —
 *   multipart/form-data with `file` (and optional `model`)
 *
 * Response: { text, duration, timestamps }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { asrUpload } from "../_shared/audioChunk.ts";
import { munsitModel, munsitFallbackModel } from "../_shared/asrConfig.ts";


const MUNSIT_BASE = "https://api.munsit.com/api/v1";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Free-tier daily cap: 10 transcriptions / user / day. Paid users bypass.
  const cap = await enforceDailyCap(req, "transcribe", 10, corsHeaders);
  if (cap.limited) return cap.response;

  const apiKey = Deno.env.get("MUNSIT_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ text: null, error: "MUNSIT_API_KEY not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    let fileBlob: Blob | null = null;
    let model = munsitModel();

    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const fd = await req.formData();
      const f = fd.get("file");
      if (f instanceof File) fileBlob = f;
      const m = fd.get("model");
      if (typeof m === "string" && m) model = m;
    } else {
      const body = await req.json();
      if (!body?.audioBase64) {
        return new Response(
          JSON.stringify({ error: "audioBase64 is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const bin = atob(body.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      fileBlob = new Blob([bytes], { type: body.mimeType || "audio/mp4" });
      if (body.model) model = body.model;
    }

    if (!fileBlob) {
      return new Response(
        JSON.stringify({ error: "no audio provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Munsit dispatches on the file extension, so the part has to be named for
    // the container the bytes actually are — a hardcoded `audio.mp3` around
    // MP4/AAC audio comes back 200 with an empty transcription.
    const payload = new Uint8Array(await fileBlob.arrayBuffer());
    const upload = asrUpload(payload, fileBlob.type);
    const fd = new FormData();
    fd.append("file", new File([payload], upload.filename, { type: upload.mimeType }));
    fd.append("model", model);

    const resp = await fetch(`${MUNSIT_BASE}/audio/transcribe`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: fd,
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error(`Munsit ASR ${resp.status}:`, t.slice(0, 300));
      return new Response(
        JSON.stringify({ text: null, error: `Munsit ${resp.status}`, detail: t.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const raw = await resp.json();
    // Munsit returns { statusCode, data: { transcription, ... } }; older/alt
    // shapes may put fields at the root — fall back to that.
    const data = raw?.data ?? raw ?? {};
    return new Response(
      JSON.stringify({
        text: data.transcription ?? raw.transcription ?? null,
        duration: data.duration ?? raw.duration ?? null,
        timestamps: data.timestamps ?? raw.timestamps ?? [],
        transcriptionId: data.transcriptionId ?? raw.transcriptionId ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("munsit-transcribe error:", msg);
    return new Response(
      JSON.stringify({ text: null, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
