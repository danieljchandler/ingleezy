// process-approved-video — v2: accept anon-key bearer + early logging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  SONIOX_MODEL,
  buildSonioxContext,
  looksTruncated,
  munsitModel as resolveMunsitModel,
  munsitFallbackModel,
  type AsrWord,
  type AsrLegResult,
} from "../_shared/asrConfig.ts";
import {
  asrUpload,
  containerLabel,
  extractAacFromMp4,
  joinAdtsFrames,
  planAsrPayloads,
} from "../_shared/audioChunk.ts";


const ASR_TIMEOUT_MS = 5 * 60 * 1000;

// Munsit's sync /audio/transcribe has no async/polling counterpart and silently
// returns an empty transcript above ~10 MB, so anything larger has to be split
// on real frame boundaries and stitched back together. 9 MB leaves margin.
// Container handling lives in _shared/audioChunk.ts — see planAsrPayloads.
const MUNSIT_MAX_BYTES = 9 * 1024 * 1024;

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ── Shapes crossing the pipeline ──────────────────────────────────────────────
// These are deliberately loose: every one of them arrives as decoded JSON from
// a database row, an external API, or a sibling edge function, and the pipeline
// reads a handful of fields while passing the rest through untouched. The index
// signature is what makes "pass the rest through" type-safe — naming only the
// fields we actually read keeps the checker useful where it matters without
// pretending we know the full schema.

type Json = Record<string, unknown>;

/** A transcript line in flight, before it is persisted. */
interface PipelineLine extends Json {
  id?: string;
  arabic?: string;
  translation?: string;
  tokens?: unknown;
  startMs?: number;
  endMs?: number;
}

/** One on-screen text segment from extract-visual-context. */
interface OnScreenSegment extends Json {
  text?: string;
  translation?: string;
  startSeconds?: number;
  endSeconds?: number;
  confidence?: string;
}

/** The `<id>.visual.json` blob stored beside a meme video. */
interface VisualResult extends Json {
  onScreenTextSegments?: OnScreenSegment[];
  sceneContext?: string;
  culturalContext?: string;
}

/** The `discover_videos` row this run is processing. */
interface VideoRow extends Json {
  source_url?: string | null;
  dialect?: string | null;
  title?: string | null;
  title_arabic?: string | null;
  is_meme?: boolean | null;
  duration_seconds?: number | null;
}

/**
 * Service-role Supabase client. Generated schema types aren't available to the
 * Deno functions, so this is the untyped-`Database` client — table reads come
 * back loosely typed and are narrowed at the point of use.
 *
 * Not `ReturnType<typeof createClient>`: that instantiates the schema generics
 * from their *defaults* rather than from the call, which collapses every
 * `.from(...).update(...)` argument to `never`.
 */
type Supabase = SupabaseClient;

/** The body analyze-gulf-arabic returns when it answers before the gateway times out. */
interface AnalyzeResponse {
  success?: boolean;
  result?: {
    lines?: PipelineLine[];
    vocabulary?: unknown[];
    grammarPoints?: unknown[];
    culturalContext?: string | null;
    dialect?: string | null;
    difficulty?: string | null;
    title?: string | null;
    titleArabic?: string | null;
  };
}

/** The columns re-read from `discover_videos` after analyze-gulf-arabic runs. */
interface RefreshedRow extends Json {
  transcription_status?: string | null;
  transcript_lines?: unknown;
  cultural_context?: string | null;
  title?: string | null;
  title_arabic?: string | null;
}

/**
 * Supabase's Edge Runtime exposes `waitUntil` for work that has to outlive the
 * HTTP response. It is absent anywhere else this code might run, so it is
 * looked up through a typed accessor rather than declared as a global — the
 * optional call is the whole point.
 */
type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil?(task: Promise<unknown>): void } };
const edgeRuntime = () => (globalThis as unknown as EdgeRuntimeGlobal).EdgeRuntime;

/** A word with timings, as returned by an ASR engine before normalisation. */
interface RawAsrWord extends Json {
  text?: string;
  word?: string;
  type?: string;
  speaker_id?: string | number;
  start?: number | string;
  end?: number | string;
  start_ms?: number;
  end_ms?: number;
  startMs?: number;
  endMs?: number;
}

function stripArabicDiacritics(text: string): string {
  return text.replace(/[\u064B-\u065F\u0670]/g, "");
}

function normalizeComparableText(text: string): string {
  return stripArabicDiacritics(String(text ?? ""))
    .toLowerCase()
    .replace(/[\s\u0640]+/g, "")
    .replace(/[،؟.!:؛…\-—–"'()[\]{}«»]/g, "")
    .trim();
}

function normalizeLooseText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\u0640]+/g, "")
    .replace(/[،؟.!:؛…\-—–"'()[\]{}«»]/g, "")
    .trim();
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function tokenizeOnScreenText(text: string) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((surface, index) => ({ id: `screen-tok-${generateId()}-${index}`, surface }));
}

function mergeOnScreenTextLines(
  rawLines: PipelineLine[],
  onScreenSegments: OnScreenSegment[],
): PipelineLine[] {
  if (!Array.isArray(rawLines)) return [];
  if (!Array.isArray(onScreenSegments) || onScreenSegments.length === 0) return rawLines;

  const merged = [...rawLines];
  const existingNormalized = new Set(
    merged
      .map((line) => normalizeComparableText(line?.arabic ?? ""))
      .filter((value) => value.length > 0),
  );

  for (const [idx, segment] of onScreenSegments.entries()) {
    const text = String(segment?.text ?? "").trim();
    if (!text) continue;

    const normalized = hasArabic(text) ? normalizeComparableText(text) : normalizeLooseText(text);
    if (!normalized) continue;

    const alreadyPresent = [...existingNormalized].some((existing) => {
      const existingKey = hasArabic(text) ? existing : normalizeLooseText(existing);
      return (
        existingKey === normalized ||
        (normalized.length >= 4 && existingKey.includes(normalized)) ||
        (existingKey.length >= 4 && normalized.includes(existingKey))
      );
    });
    if (alreadyPresent) continue;

    existingNormalized.add(normalized);
    const startMs = Math.max(0, Math.round(Number(segment?.startSeconds ?? 0) * 1000));
    const endMs = Math.max(startMs + 500, Math.round(Number(segment?.endSeconds ?? segment?.startSeconds ?? 0) * 1000));
    merged.push({
      id: `screen-line-${generateId()}-${idx}`,
      arabic: text,
      translation: String(segment?.translation ?? "").trim(),
      startMs,
      endMs,
      source: "on_screen",
      needs_review: segment?.confidence === "low",
      tokens: tokenizeOnScreenText(text),
    });
  }

  return merged.sort((a, b) => Number(a?.startMs ?? 0) - Number(b?.startMs ?? 0));
}

function buildVisualContextText(visualResult: VisualResult | null | undefined): string | null {
  if (!visualResult) return null;
  const segs: OnScreenSegment[] = Array.isArray(visualResult?.onScreenTextSegments)
    ? visualResult.onScreenTextSegments
    : [];
  const onScreenSummary = segs
    .map((s) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` — ${s.translation}` : ""}`)
    .join("\n");
  return [
    onScreenSummary ? `On-screen text:\n${onScreenSummary}` : "",
    visualResult?.sceneContext ? `Scene: ${visualResult.sceneContext}` : "",
    visualResult?.culturalContext ? `Cultural context: ${visualResult.culturalContext}` : "",
  ].filter(Boolean).join("\n\n") || null;
}

function combineContext(primary?: string | null, visual?: string | null): string | null {
  const parts = [visual, primary].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return [...new Set(parts)].join("\n\n");
}

function buildMemeReviewContext(
  onScreenSegments: OnScreenSegment[],
  visualContext?: string | null,
): string | null {
  if (Array.isArray(onScreenSegments) && onScreenSegments.length > 0) return visualContext ?? null;
  return combineContext(
    visualContext ?? null,
    "Meme review warning: no readable on-screen text was extracted from the sampled video frames. Do not rely on inferred cultural context until an admin reviews the source video.",
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}


function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id || null;
    }

    if (host === "youtube.com") {
      const direct = parsed.searchParams.get("v");
      if (direct) return direct;

      const pathMatch = parsed.pathname.match(/^\/(shorts|live|embed)\/([a-zA-Z0-9_-]{11})/);
      if (pathMatch?.[2]) return pathMatch[2];
    }

    return null;
  } catch {
    return null;
  }
}

// ── Background pipeline ────────────────────────────────────────────────────
// Runs entirely decoupled from the HTTP request lifecycle so that req.signal
// (fired by the platform when the request connection closes) cannot abort it.
async function runPipeline(
  videoId: string,
  video: VideoRow,
  supabase: Supabase,
  authHeader: string,
  projectUrl: string,
): Promise<void> {
  // `.wav` first: the admin upload form extracts the audio track client-side and
  // stages it as WAV, so when both exist the extracted audio is the better input
  // (smaller, already 16 kHz mono). The other extensions cover URL-sourced
  // downloads and uploads whose container the browser couldn't decode.
  const storagePaths = [
    `${videoId}.wav`, `${videoId}.mp4`, `${videoId}.m4a`, `${videoId}.webm`,
    `${videoId}.mp3`, `${videoId}.opus`,
  ];

  try {
    console.log(`[pipeline] Starting for video ${videoId}: ${video.source_url}`);

    // ── Step 1: Get audio ──────────────────────────────────────────
    console.log("[pipeline] Step 1: Getting audio...");

    let audioBytes: ArrayBuffer | null = null;
    let audioContentType = "audio/mp4";
    let downloadDuration: number | null = null;

    // Check staged storage first
    for (const path of storagePaths) {
      const { data: fileData, error: fileErr } = await supabase.storage
        .from("video-audio")
        .download(path);
      if (!fileErr && fileData) {
        console.log(`[pipeline] Found audio in storage: video-audio/${path}`);
        audioBytes = await fileData.arrayBuffer();
        audioContentType = fileData.type ||
          (path.endsWith(".mp3") ? "audio/mpeg"
            : path.endsWith(".wav") ? "audio/wav"
            : "audio/mp4");
        break;
      }
    }

    // Fallback 1: reuse already extracted audio from `audio` bucket
    if (!audioBytes) {
      const extractedVideoId = extractYouTubeVideoId(video.source_url || "");
      let candidatePath: string | null = null;

      if (extractedVideoId) {
        const { data: byVideoId } = await supabase
          .from("audio_files")
          .select("storage_path")
          .eq("status", "ready")
          .eq("video_id", extractedVideoId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        candidatePath = byVideoId?.storage_path ?? null;
      }

      if (!candidatePath) {
        const { data: bySourceUrl } = await supabase
          .from("audio_files")
          .select("storage_path")
          .eq("status", "ready")
          .eq("source_url", video.source_url)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        candidatePath = bySourceUrl?.storage_path ?? null;
      }

      if (candidatePath) {
        const { data: extractedAudio, error: extractedAudioErr } = await supabase.storage
          .from("audio")
          .download(candidatePath);

        if (!extractedAudioErr && extractedAudio) {
          console.log(`[pipeline] Reusing extracted audio: audio/${candidatePath}`);
          audioBytes = await extractedAudio.arrayBuffer();
          audioContentType = extractedAudio.type || (candidatePath.endsWith(".opus") ? "audio/ogg; codecs=opus" : "audio/mp4");
        } else {
          console.warn(`[pipeline] Failed to load audio/${candidatePath}: ${extractedAudioErr?.message ?? "unknown error"}`);
        }
      }
    }

    // Fallback 2: download-media handles every source, YouTube included.
    // (A RunPod extraction worker used to sit in front of this for YouTube; it
    // no longer works and has been removed. download-media is now the only
    // acquisition path after the storage-cache lookup above.)
    if (!audioBytes) {
      console.log("[pipeline] No storage audio found, downloading from URL...");
      const downloadResp = await fetch(`${projectUrl}/functions/v1/download-media`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.source_url }),
      });

      if (!downloadResp.ok) {
        const errBody = await downloadResp.text();
        throw new Error(`Download failed (${downloadResp.status}): ${errBody}`);
      }

      const downloadData = await downloadResp.json();

      if (downloadData.cached && downloadData.transcriptionData) {
        console.log("[pipeline] Cache hit — using existing transcription data");
        const cached = downloadData.transcriptionData;
        await supabase.from("discover_videos").update({
          transcript_lines: cached.lines || [],
          vocabulary: cached.vocabulary || [],
          grammar_points: cached.grammarPoints || [],
          cultural_context: cached.culturalContext || null,
          dialect: cached.dialect || "Gulf",
          difficulty: cached.difficulty || "Intermediate",
          transcription_status: "completed",
          transcription_error: null,
        }).eq("id", videoId);
        return;
      }

      if (!downloadData.audioBase64) {
        throw new Error("No audio data received. Try uploading the audio file manually.");
      }

      const binaryStr = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      audioBytes = bytes.buffer;
      audioContentType = downloadData.contentType || "audio/mp4";

      if (downloadData.duration) downloadDuration = Math.round(downloadData.duration);
    }

    const fileSizeMB = (audioBytes.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[pipeline] Audio ready: ${fileSizeMB} MB`);

    if (downloadDuration) {
      await supabase.from("discover_videos").update({ duration_seconds: downloadDuration }).eq("id", videoId);
    }

    // ── Step 2: Call ASR APIs directly (no sub-edge-functions) ────
    console.log("[pipeline] Step 2: Transcribing with all engines directly...");

    // Resolve dialect module for routing prompts + Azure locale.
    // discover_videos.dialect can be a country (Saudi/Kuwaiti/UAE/...) or a module name.
    const rawDialect = (video.dialect ?? "Gulf") as string;
    const dialectModule: "Gulf" | "Egyptian" | "Yemeni" =
      rawDialect === "Egyptian" ? "Egyptian" :
      rawDialect === "Yemeni" ? "Yemeni" :
      "Gulf";
    console.log(`[pipeline] dialectModule=${dialectModule} (from video.dialect=${rawDialect})`);

    // Each engine returns { text, words?, latencyMs, ... }. `words` is in
    // Deepgram-compatible shape: { text, start, end } in seconds. We capture
    // native word/token timings from Soniox + Munsit so alignment doesn't
    // depend on Deepgram's English-tuned Arabic word boundaries.

    // --- ElevenLabs Scribe v2 ---
    // Replaces the Deepgram nova-3 leg. Deepgram is a generalist that was being
    // called with language=ar (which disables its code-switch path) and whose
    // Arabic word boundaries were never trusted for alignment anyway. Scribe v2
    // leads the Artificial Analysis WER leaderboard and benchmarks best on
    // Egyptian/Saudi Arabic-English code-switching — the exact shape of this
    // corpus — and runs on the ElevenLabs key the app already holds for TTS.
    const scribePromise: Promise<AsrLegResult> = (async () => {
      const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")?.trim();
      if (!ELEVENLABS_API_KEY) { console.warn("[pipeline] Scribe: no API key"); return { text: null, words: [], latencyMs: 0 }; }

      const t0 = Date.now();
      try {
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        fd.append("model_id", Deno.env.get("ELEVENLABS_STT_MODEL")?.trim() || "scribe_v2");
        fd.append("language_code", "ar");
        fd.append("diarize", "true");
        fd.append("timestamps_granularity", "word");

        const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: { "xi-api-key": ELEVENLABS_API_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`); }
        const data = await resp.json();
        const text: string = data?.text ?? "";
        // Scribe emits spacing/audio-event entries alongside words — keep words only.
        const words: AsrWord[] = ((data?.words ?? []) as RawAsrWord[])
          .filter((w) => (w.type ?? "word") === "word" && (w.text ?? "").trim())
          .map((w) => ({
            text: String(w.text ?? ""),
            start: Number(w.start ?? 0),
            end: Number(w.end ?? 0),
            ...(w.speaker_id ? { speaker: String(w.speaker_id) } : {}),
          }));
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Scribe: ${text.length} chars, ${words.length} words, ${latencyMs}ms`);
        return { text, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Scribe failed:", e);
        return { text: "", words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Cohere Transcribe Arabic (pilot; text-only, no word timestamps) ---
    // Frontier open Arabic ASR released 2026-07: lowest average WER across
    // MSA/Egyptian/Gulf/Levantine/Maghrebi of the open models, built for
    // Arabic-English code-switching. Runs only when COHERE_API_KEY is set, so
    // it can be piloted against the existing Azure leg before any cutover.
    const coherePromise: Promise<AsrLegResult> = (async () => {
      const COHERE_API_KEY = Deno.env.get("COHERE_API_KEY")?.trim();
      if (!COHERE_API_KEY) return { text: null, latencyMs: 0 };

      const t0 = Date.now();
      try {
        // FIELD ORDER IS LOAD-BEARING. FormData serialises parts in insertion
        // order, and Cohere streams the multipart body — it rejects the request
        // with HTTP 400 ("all form fields (model, language) must appear before
        // the file part") if the audio arrives before the config it needs to
        // decode with. Keep `file` last. The other ASR legs are not affected;
        // they buffer the whole body and accept any order.
        const fd = new FormData();
        fd.append("model", Deno.env.get("COHERE_STT_MODEL")?.trim() || "cohere-transcribe-arabic-07-2026");
        fd.append("language", "ar");
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));

        const resp = await fetch("https://api.cohere.com/v2/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${COHERE_API_KEY}` },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`); }
        const data = await resp.json();
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Cohere: ${data.text?.length || 0} chars, ${latencyMs}ms`);
        return { text: data.text || null, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Cohere failed:", e);
        return { text: null, latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Fanar (text-only, no word timestamps) ---
    const fanarPromise: Promise<AsrLegResult> = (async () => {
      const FANAR_API_KEY = Deno.env.get("FANAR_API_KEY")?.trim();
      if (!FANAR_API_KEY) { console.warn("[pipeline] Fanar: no API key"); return { text: null, latencyMs: 0 }; }

      // Fanar-Aura-STT-1 is documented for clips up to ~20-30s only; video
      // audio virtually always exceeds that, so route anything bigger than
      // ~30s worth of MP3 (~0.5 MB at 128 kbps) to the long-form model.
      // Quotas differ (STT-1: 20/day, STT-LF-1: 10/day), so each is metered
      // separately in fanar_usage — previously this inline call bypassed the
      // budget entirely, silently draining the quota the Transcribe page
      // depends on.
      const isLongForm = audioBytes!.byteLength > 0.5 * 1024 * 1024;
      const sttModel = isLongForm ? "Fanar-Aura-STT-LF-1" : "Fanar-Aura-STT-1";
      const usageEndpoint = isLongForm ? "stt-lf" : "stt";
      const dailyLimit = isLongForm ? 8 : 18; // headroom under 10/20 API limits

      try {
        const today = new Date().toISOString().slice(0, 10);
        const { count } = await supabase
          .from("fanar_usage")
          .select("*", { count: "exact", head: true })
          .eq("endpoint", usageEndpoint)
          .gte("created_at", `${today}T00:00:00Z`);
        if ((count ?? 0) >= dailyLimit) {
          console.warn(`[pipeline] Fanar: daily ${usageEndpoint} budget exhausted (${count}/${dailyLimit}) — skipping`);
          return { text: null, latencyMs: 0, error: "daily_budget_exhausted" };
        }
      } catch (e) {
        console.warn("[pipeline] Fanar: budget check failed (continuing):", e instanceof Error ? e.message : String(e));
      }

      const t0 = Date.now();
      try {
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        fd.append("model", sttModel);
        fd.append("response_format", "json");
        fd.append("language", "ar");

        const resp = await fetch("https://api.fanar.qa/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${FANAR_API_KEY}` },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t}`); }
        const data = await resp.json();
        supabase.from("fanar_usage").insert({ endpoint: usageEndpoint }).then(
          () => {},
          (e: unknown) => console.warn("[pipeline] Fanar: usage log failed:", String(e)),
        );
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Fanar (${sttModel}): ${data.text?.length || 0} chars, ${latencyMs}ms`);
        return { text: data.text || null, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Fanar failed:", e);
        return { text: null, latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Soniox: capture sub-word tokens, merge into word-level array ---
    const sonioxPromise: Promise<AsrLegResult> = (async () => {
      const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");
      if (!SONIOX_API_KEY) { console.warn("[pipeline] Soniox: no API key"); return { text: null, sonioxUsed: false, words: [], latencyMs: 0 }; }

      const SONIOX_BASE = "https://api.soniox.com/v1";
      const sHeaders = { Authorization: `Bearer ${SONIOX_API_KEY}` };

      const t0 = Date.now();
      try {
        // Upload file
        const fd = new FormData();
        fd.append("file", new File([audioBytes!], "audio.mp3", { type: audioContentType }));
        const uploadResp = await fetch(`${SONIOX_BASE}/files`, { method: "POST", headers: sHeaders, body: fd });
        if (!uploadResp.ok) { const t = await uploadResp.text(); throw new Error(`Upload ${uploadResp.status}: ${t}`); }
        const { id: fileId } = await uploadResp.json();

        // Create transcription with translation.
        // - Model pinned to v5 (v4 retired 2026-06-30, was silently rerouting).
        // - language_hints includes "en": this corpus is heavily code-switched,
        //   and the old ["ar"] + strict combination suppressed English tokens.
        // - context biases recognition toward dialect vocabulary + video topic.
        const createBody: Record<string, unknown> = {
          model: SONIOX_MODEL, file_id: fileId, language_hints: ["ar", "en"],
          enable_speaker_diarization: true,
          context: buildSonioxContext(dialectModule, video.title),
          translation: { type: "one_way", target_language: "en" },
        };
        let createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
          method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody),
        });
        // Retry without translation if it fails
        if (!createResp.ok) {
          await createResp.text();
          delete createBody.translation;
          createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
            method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody),
          });
        }
        // Last resort: strip the v5 extras (context/diarization) so a schema
        // rejection can never take the whole Soniox leg down.
        if (!createResp.ok) {
          await createResp.text();
          delete createBody.context;
          delete createBody.enable_speaker_diarization;
          createResp = await fetch(`${SONIOX_BASE}/transcriptions`, {
            method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" }, body: JSON.stringify(createBody),
          });
        }
        if (!createResp.ok) { const t = await createResp.text(); throw new Error(`Create ${createResp.status}: ${t}`); }
        const transcription = await createResp.json();

        // Poll
        let status = transcription.status;
        const startPoll = Date.now();
        while (status !== "completed" && status !== "error") {
          if (Date.now() - startPoll > 4 * 60 * 1000) throw new Error("Soniox polling timeout");
          await new Promise(r => setTimeout(r, 2000));
          const pollResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcription.id}`, { headers: sHeaders });
          if (!pollResp.ok) { await pollResp.text(); continue; }
          const pd = await pollResp.json();
          status = pd.status;
        }
        if (status === "error") throw new Error("Soniox transcription error");

        // Get transcript
        const tResp = await fetch(`${SONIOX_BASE}/transcriptions/${transcription.id}/transcript`, { headers: sHeaders });
        if (!tResp.ok) throw new Error(`Transcript fetch ${tResp.status}`);
        const tData = await tResp.json();

        // Cleanup
        fetch(`${SONIOX_BASE}/files/${fileId}`, { method: "DELETE", headers: sHeaders }).catch(() => {});

        // Merge sub-word tokens into word-level array compatible with Deepgram
        // shape (+ speaker when diarization returned one). Also average token
        // confidence — the merge step downstream can weight engines by it
        // instead of the char-length heuristic alone.
        interface SonioxToken {
          text?: string;
          start_ms?: number;
          end_ms?: number;
          speaker?: string | number | null;
          confidence?: number;
        }
        const tokens: SonioxToken[] = Array.isArray(tData.tokens) ? tData.tokens : [];
        const words: AsrWord[] = [];
        let curr = "";
        let wStart = 0;
        let wEnd = 0;
        let wSpeaker: string | undefined;
        let confSum = 0;
        let confCount = 0;
        const pushCurr = () => {
          if (!curr) return;
          words.push({
            text: curr, start: wStart / 1000, end: Math.max(wEnd, wStart) / 1000,
            ...(wSpeaker !== undefined ? { speaker: wSpeaker } : {}),
          });
          curr = "";
        };
        for (const tk of tokens) {
          if (typeof tk.confidence === "number") { confSum += tk.confidence; confCount++; }
          const txt: string = tk.text ?? "";
          if (txt === "" || txt === " ") { pushCurr(); continue; }
          if (txt.startsWith(" ") || !curr) {
            pushCurr();
            curr = txt.trimStart();
            wStart = tk.start_ms ?? 0;
            // Some Soniox tokens omit end_ms on the first sub-word of a phrase.
            // Falling through to 0 here collapsed word timing — keep the
            // token's own start_ms as a safe lower bound.
            wEnd = tk.end_ms ?? tk.start_ms ?? 0;
            wSpeaker = tk.speaker !== undefined && tk.speaker !== null ? String(tk.speaker) : undefined;
          } else {
            curr += txt;
            wEnd = tk.end_ms ?? tk.start_ms ?? wEnd;
          }
        }
        pushCurr();
        const avgConfidence = confCount > 0 ? confSum / confCount : null;

        const latencyMs = Date.now() - t0;
        console.log(
          `[pipeline] Soniox: ${tData.text?.length || 0} chars, ${words.length} words, ` +
            `avg_conf=${avgConfidence?.toFixed(3) ?? "n/a"}, ${latencyMs}ms`,
        );
        return { text: tData.text || null, sonioxUsed: true, translationText: tData.translation_text || null, words, avgConfidence, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Soniox failed:", e);
        return { text: null, sonioxUsed: false, words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();

    // --- Munsit (Arabic-native; sync endpoint only — chunk MP3s for long audio) ---
    // The model defaults to `munsit-en-ar`: the bare `munsit` model is degraded
    // upstream and answers 200 with a handful of characters for any payload —
    // even a synthetic sine tone — which is where the 0/7/187-char legs on the
    // last four uploads came from. On the very same bytes `munsit-en-ar`
    // returned 1048 chars against Soniox's 1179. MUNSIT_ASR_MODEL still
    // overrides this without a redeploy, and an empty/truncated answer is
    // retried on the other model below.
    let munsitModel = resolveMunsitModel();

    const munsitPromise: Promise<AsrLegResult> = (async () => {
      const MUNSIT_API_KEY = Deno.env.get("MUNSIT_API_KEY")?.trim();
      if (!MUNSIT_API_KEY) { console.warn("[pipeline] Munsit: no API key"); return { text: null, words: [], latencyMs: 0 }; }

      const audioU8 = new Uint8Array(audioBytes!);
      const sizeMB = audioU8.byteLength / (1024 * 1024);
      const t0 = Date.now();

      const callOnce = async (
        // Plain-buffer backed, so it can go straight into a File — see the
        // note on AudioChunk.bytes.
        payload: Uint8Array<ArrayBuffer>,
        label: string,
      ): Promise<{ text: string; words: AsrWord[] }> => {
        const fd = new FormData();
        // Name the part after the container the bytes actually are. Munsit
        // dispatches on the file extension, so the old hardcoded `audio.mp3`
        // handed MP4/AAC audio (what TikTok and YouTube downloads are) to an
        // MP3 decoder — a 200 response with an empty `data.transcription`,
        // which reads downstream exactly like a silent clip.
        const upload = asrUpload(payload, audioContentType);
        fd.append("file", new File([payload], upload.filename, { type: upload.mimeType }));
        fd.append("model", munsitModel);
        const resp = await fetch("https://api.munsit.com/api/v1/audio/transcribe", {
          method: "POST",
          headers: { "x-api-key": MUNSIT_API_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
        const raw = await resp.json();
        // Munsit returns { statusCode, data: { transcription, attributes: { timestampsRaw: [...] } } }.
        // Older/alt shapes may put fields at the root — fall back to that.
        const body = raw?.data ?? raw ?? {};
        const attrs = body?.attributes ?? {};
        const text = ((body.transcription ?? body.text ?? raw.transcription ?? raw.text) as string | undefined) || "";
        const words: AsrWord[] = [];
        const pushWord = (w: RawAsrWord | null | undefined) => {
          if (!w) return;
          const txt = (w.word ?? w.text ?? "").toString();
          if (!txt) return;
          let s = Number(w.start ?? w.start_ms ?? w.startMs ?? 0);
          let e = Number(w.end ?? w.end_ms ?? w.endMs ?? 0);
          if (s > 1000 || e > 1000) { s /= 1000; e /= 1000; }
          words.push({ text: txt, start: s, end: e });
        };
        const timestampsArr =
          (Array.isArray(attrs.timestampsRaw) && attrs.timestampsRaw) ||
          (Array.isArray(attrs.timestamps) && attrs.timestamps) ||
          (Array.isArray(body.timestamps) && body.timestamps) ||
          (Array.isArray(body.words) && body.words) ||
          (Array.isArray(raw.timestamps) && raw.timestamps) ||
          (Array.isArray(raw.words) && raw.words) ||
          null;
        if (timestampsArr) {
          timestampsArr.forEach(pushWord);
        } else {
          const segs = body.segments ?? raw.segments;
          if (Array.isArray(segs)) {
            for (const seg of segs) if (Array.isArray(seg.words)) seg.words.forEach(pushWord);
          }
        }
        if (!text) {
          console.warn(`[pipeline] Munsit ${label}: empty transcription — raw keys=${Object.keys(raw ?? {}).join(",")} data keys=${Object.keys(body ?? {}).join(",")}`);
        }

        console.log(`[pipeline] Munsit ${label}: ${text.length} chars, ${words.length} words`);
        return { text, words };
      };

      /** Run the whole plan-then-send sequence over one payload. */
      const transcribe = async (
        payload: Uint8Array<ArrayBuffer>,
        contentType: string,
        source: string,
      ): Promise<{ text: string; words: AsrWord[]; skipReason?: string }> => {
        const plan = planAsrPayloads(payload, contentType, MUNSIT_MAX_BYTES, 60);
        if (plan.skipReason) {
          console.warn(
            `[pipeline] Munsit: skipping ${source} — ${(payload.byteLength / (1024 * 1024)).toFixed(2)} MB ` +
            `${contentType} (${plan.strategy}): ${plan.skipReason}`,
          );
          return { text: "", words: [], skipReason: plan.skipReason };
        }

        if (plan.strategy === "single") {
          return await callOnce(payload, source);
        }

        const chunks = plan.chunks;
        console.log(
          `[pipeline] Munsit: ${source} → ${chunks.length} chunks via ${plan.strategy} (~60s each)`,
        );
        const parts = await mapWithConcurrency(chunks, 3, async (c, i) => {
          try {
            const r = await callOnce(
              c.bytes,
              `${source} chunk ${i + 1}/${chunks.length} (@${c.offsetSec.toFixed(1)}s, ${(c.bytes.byteLength / 1024).toFixed(0)} KB)`,
            );
            return { ...r, offsetSec: c.offsetSec };
          } catch (e) {
            console.warn(`[pipeline] Munsit chunk ${i + 1} failed:`, e);
            return { text: "", words: [], offsetSec: c.offsetSec };
          }
        });
        return {
          text: parts.map(p => p.text.trim()).filter(Boolean).join(" "),
          words: parts.flatMap(p =>
            p.words.map(w => ({ text: w.text, start: w.start + p.offsetSec, end: w.end + p.offsetSec })),
          ),
        };
      };

      try {
        // Send the audio track on its own whenever we can isolate it.
        //
        // download-media hands back the source MP4 whole, video track included.
        // Every other engine in the fan-out demuxes that happily; Munsit does
        // not, and answers 200 with a near-empty transcription instead of an
        // error — 0 chars before the upload was named for its real container,
        // 7 chars after, on a clip where five other engines got 200-440. So the
        // demux is the primary path now rather than a retry: an audio-only ADTS
        // stream is what an audio endpoint should have been receiving all along,
        // and it costs one in-memory pass with no re-encode.
        const aacTrack = containerLabel(audioU8, audioContentType) === "mp4"
          ? extractAacFromMp4(audioU8)
          : null;
        const audioOnly = aacTrack
          ? {
              bytes: joinAdtsFrames(aacTrack),
              durationSec: aacTrack.durations.reduce((a, b) => a + b, 0),
            }
          : null;
        if (aacTrack && !audioOnly) {
          console.warn("[pipeline] Munsit: MP4 has no demuxable AAC track — sending the container as-is");
        }

        const durationSec = audioOnly?.durationSec ?? downloadDuration ?? 0;
        const primary = audioOnly
          ? { bytes: audioOnly.bytes, contentType: "audio/aac", source: "audio-only" }
          : { bytes: audioU8, contentType: audioContentType, source: "container" };

        let out = await transcribe(primary.bytes, primary.contentType, primary.source);

        // A short answer from an engine that accepted the payload is the shape
        // this failure has always taken, so fall back to the other container
        // rather than trusting it.
        if (audioOnly && looksTruncated(out.text, durationSec)) {
          console.warn(
            `[pipeline] Munsit: ${out.text.length} chars for ${durationSec.toFixed(1)}s of audio ` +
            `looks truncated — retrying with the original container`,
          );
          const alt = await transcribe(audioU8, audioContentType, "container-retry");
          if (alt.text.length > out.text.length) out = alt;
        }

        // Still nothing usable? The other Munsit model is the one variable that
        // has actually explained this failure before — one is degraded while the
        // other transcribes the same bytes in full — so swap and try once more.
        if (looksTruncated(out.text, durationSec) || !out.text) {
          const swapped = munsitFallbackModel(munsitModel);
          console.warn(
            `[pipeline] Munsit: ${out.text.length} chars from ${munsitModel} — retrying on ${swapped}`,
          );
          const before = munsitModel;
          munsitModel = swapped;
          const alt = await transcribe(primary.bytes, primary.contentType, `model-retry:${swapped}`);
          if (alt.text.length > out.text.length) out = alt;
          else munsitModel = before;
        }

        const latencyMs = Date.now() - t0;
        const { text, words } = out;
        console.log(
          `[pipeline] Munsit: ${text.length} chars, ${words.length} words, ${latencyMs}ms ` +
          `(sent ${primary.source}, ${durationSec ? `${durationSec.toFixed(1)}s` : "duration unknown"})`,
        );

        // An empty or truncated transcript is a failure with a cause, not an
        // absence. Reported bare it lands in engines_used.asr as `chars: 7` with
        // no error — a quiet success no audit can distinguish from a real one.
        if (!text) {
          return {
            text: null, words: [], latencyMs,
            error: `empty-transcription (sent ${primary.source}, container=${containerLabel(audioU8, audioContentType)}${out.skipReason ? `, ${out.skipReason}` : ""})`,
          };
        }
        if (looksTruncated(text, durationSec)) {
          // Keep the text — it is still the engine's best answer and the merge
          // step weights by length — but do not let it pass as healthy.
          return {
            text, words, latencyMs,
            error: `short-transcription (${text.length} chars for ${durationSec.toFixed(1)}s, sent ${primary.source})`,
          };
        }
        return { text, words, latencyMs };
      } catch (e) {
        console.warn("[pipeline] Munsit failed:", e);
        return { text: null, words: [], latencyMs: Date.now() - t0, error: String(e) };
      }
    })();


    // --- Azure Speech (locale-routed by dialect module) ---
    // Every return path carries `error` and `latencyMs`. This leg used to drop
    // its exception on the floor (bare `{ text: null }`), which is the one way
    // an engine can fail without the reason reaching `engines_used.asr` — the
    // row showed `ok:false, chars:0` and nothing else. `_shared/asrConfig.ts`
    // documents `error` as the contract every leg reports failure through.
    const azurePromise: Promise<AsrLegResult> = (async () => {
      const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY")?.trim();
      // Prefer an explicitly configured endpoint, matching azure-pronunciation's
      // getSttEndpoint() and azure-tts. A deployment on an Azure AI multi-service
      // resource sets AZURE_SPEECH_ENDPOINT and may leave the region unset, in
      // which case building the URL from the region alone fails or 404s.
      const AZURE_SPEECH_ENDPOINT = Deno.env.get("AZURE_SPEECH_ENDPOINT")?.trim();
      const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION")?.trim();
      const locale =
        dialectModule === "Egyptian" ? "ar-EG" :
        dialectModule === "Yemeni" ? "ar-YE" :
        "ar-SA";

      if (!AZURE_SPEECH_KEY || (!AZURE_SPEECH_ENDPOINT && !AZURE_SPEECH_REGION)) {
        console.warn("[pipeline] Azure: not configured (need AZURE_SPEECH_KEY + endpoint or region)");
        return { text: null, latencyMs: 0, locale, error: "not_configured" };
      }

      const base = AZURE_SPEECH_ENDPOINT
        ? AZURE_SPEECH_ENDPOINT.replace(/\/$/, "")
        : `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com`;

      const t0 = Date.now();
      try {
        const definition = { locales: [locale], profanityFilterMode: "None" };
        const fd = new FormData();
        fd.append("audio", new Blob([audioBytes!], { type: audioContentType }), "audio");
        fd.append("definition", JSON.stringify(definition));
        const url = `${base}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY },
          body: fd,
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        });
        if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
        const data = await resp.json();
        const text =
          (data.combinedPhrases?.[0]?.text as string | undefined) ??
          (((data.phrases ?? []) as { text?: string }[]).map((p) => p.text).filter(Boolean).join(" ") as string) ??
          "";
        const latencyMs = Date.now() - t0;
        console.log(`[pipeline] Azure (${locale}): ${text.length} chars, ${latencyMs}ms`);
        // A 200 with no speech is a different problem from a failed request —
        // say so, rather than letting it look identical to a network error.
        return text
          ? { text, latencyMs, locale }
          : { text: null, latencyMs, locale, error: "empty_transcript" };
      } catch (e) {
        console.warn("[pipeline] Azure failed:", e);
        return { text: null, latencyMs: Date.now() - t0, locale, error: String(e) };
      }
    })();

    const [scribeResult, fanarResult, sonioxResult, munsitResult, azureResult, cohereResult] = await Promise.all([
      scribePromise, fanarPromise, sonioxPromise, munsitPromise, azurePromise, coherePromise,
    ]);

    const scribeText = scribeResult?.text || "";
    const fanarText = fanarResult?.text || "";
    const sonioxText = sonioxResult?.sonioxUsed ? (sonioxResult.text || "") : "";
    const munsitText = munsitResult?.text || "";
    const azureText = azureResult?.text || "";
    const cohereText = cohereResult?.text || "";

    const engines: string[] = [];
    if (scribeText) engines.push("Scribe");
    if (fanarText) engines.push("Fanar");
    if (sonioxText) engines.push("Soniox");
    if (munsitText) engines.push("Munsit");
    if (azureText) engines.push("Azure");
    if (cohereText) engines.push("Cohere");

    if (engines.length === 0) throw new Error("All transcription engines failed");

    console.log(`[pipeline] Got transcriptions from: ${engines.join(", ")}`);

    // ── Quality-weighted primary text picker ────────────────────────────
    // Earlier code used a hardcoded waterfall (Munsit||Soniox||Fanar||…)
    // which meant a 3-char Munsit response could beat a full Soniox one.
    // Instead: of the Arabic-aware engines (Munsit/Soniox/Fanar), compute
    // the median char length, drop anything < 50% of median, then take the
    // longest of the survivors. Engine priority is the tie-breaker.
    // Scribe joins the Arabic-aware candidate set: unlike Deepgram (a generalist
    // whose Arabic word boundaries were never trusted for alignment) it is a
    // top-ranked Arabic/code-switching engine with usable word timings.
    type EngineName = "Munsit" | "Soniox" | "Scribe" | "Cohere" | "Fanar" | "Azure";
    type ArabicCandidate = { name: EngineName; text: string; words: AsrWord[] };
    const arabicCandidates: ArabicCandidate[] = ([
      { name: "Munsit", text: munsitText, words: munsitResult?.words ?? [] },
      { name: "Soniox", text: sonioxText, words: sonioxResult?.words ?? [] },
      { name: "Scribe", text: scribeText, words: scribeResult?.words ?? [] },
      { name: "Cohere", text: cohereText, words: [] }, // Cohere returns text only
      { name: "Fanar",  text: fanarText,  words: [] }, // Fanar has no word timings
    ] as ArabicCandidate[]).filter(c => (c.text || "").trim().length > 0);

    const PRIORITY: EngineName[] = ["Munsit", "Soniox", "Scribe", "Cohere", "Fanar", "Azure"];
    function pickPrimary(): { name: EngineName; text: string; words: AsrWord[] } {
      if (arabicCandidates.length === 0) {
        // Nothing Arabic-aware produced text — Azure is all that's left.
        return { name: "Azure", text: azureText, words: [] };
      }
      const lens = arabicCandidates.map(c => c.text.length).sort((a, b) => a - b);
      const median = lens[Math.floor(lens.length / 2)];
      const valid = arabicCandidates.filter(c => c.text.length >= 0.5 * median);
      // Longest first, priority as tie-breaker
      valid.sort((a, b) => {
        if (b.text.length !== a.text.length) return b.text.length - a.text.length;
        return PRIORITY.indexOf(a.name) - PRIORITY.indexOf(b.name);
      });
      return valid[0];
    }

    const primary = pickPrimary();
    const primaryText = primary.text;
    const primaryEngine: EngineName = primary.name;
    console.log(`[pipeline] Primary text: ${primaryEngine} (${primaryText.length} chars). Arabic candidates: ${arabicCandidates.map(c => `${c.name}=${c.text.length}`).join(", ")}`);

    // Pick alignment word source: primary engine's own words if available,
    // else Munsit/Soniox words, else Scribe, else empty (proportional fallback).
    const alignmentWords =
      primary.words.length > 0 ? primary.words :
      (sonioxResult?.words?.length ? sonioxResult.words :
       (munsitResult?.words?.length ? munsitResult.words :
        (scribeResult?.words ?? [])));
    const alignmentSource: EngineName =
      primary.words.length > 0 ? primaryEngine :
      (sonioxResult?.words?.length ? "Soniox" :
       (munsitResult?.words?.length ? "Munsit" : "Scribe"));
    console.log(`[pipeline] Alignment words: ${alignmentSource} (${alignmentWords.length} words)`);
    const relativeWords = alignmentWords;

    // ── Persist ASR provenance ──────────────────────────────────────────
    // engines_used.asr: per-engine outcome (chars/latency/model/errors) so
    // engine failures — like Munsit's oversize-non-MP3 skip — are visible in
    // the DB instead of only in function logs, and so future engine swaps can
    // be A/B'd against stored history. analyze-gulf-arabic merges its
    // translation + dialect_signals keys into the same JSONB via read-merge.
    try {
      const trimErr = (e: unknown) => ({ error: String(e).slice(0, 200) });
      const asrProvenance = {
        munsit: {
          ok: !!munsitText, chars: munsitText.length, model: munsitModel,
          latency_ms: munsitResult?.latencyMs ?? 0,
          ...(munsitResult?.error ? trimErr(munsitResult.error) : {}),
        },
        soniox: {
          ok: !!sonioxText, chars: sonioxText.length, model: SONIOX_MODEL,
          latency_ms: sonioxResult?.latencyMs ?? 0,
          ...(typeof sonioxResult?.avgConfidence === "number"
            ? { avg_confidence: Number(sonioxResult.avgConfidence.toFixed(3)) }
            : {}),
          ...(sonioxResult?.error ? trimErr(sonioxResult.error) : {}),
        },
        fanar: {
          ok: !!fanarText, chars: fanarText.length,
          latency_ms: fanarResult?.latencyMs ?? 0,
          ...(fanarResult?.error ? trimErr(fanarResult.error) : {}),
        },
        scribe: {
          ok: !!scribeText, chars: scribeText.length,
          latency_ms: scribeResult?.latencyMs ?? 0,
          ...(scribeResult?.error ? trimErr(scribeResult.error) : {}),
        },
        azure: {
          ok: !!azureText, chars: azureText.length,
          latency_ms: azureResult?.latencyMs ?? 0,
          ...(azureResult?.locale ? { locale: azureResult.locale } : {}),
          ...(azureResult?.error ? trimErr(azureResult.error) : {}),
        },
        cohere: {
          ok: !!cohereText, chars: cohereText.length,
          latency_ms: cohereResult?.latencyMs ?? 0,
          ...(cohereResult?.error ? trimErr(cohereResult.error) : {}),
        },
        primary: primaryEngine,
        alignment_source: alignmentSource,
      };
      const { data: exRow } = await supabase
        .from("discover_videos").select("engines_used").eq("id", videoId).single();
      const existing = (exRow?.engines_used && typeof exRow.engines_used === "object")
        ? exRow.engines_used as Record<string, unknown>
        : {};
      await supabase.from("discover_videos")
        .update({ engines_used: { ...existing, asr: asrProvenance } })
        .eq("id", videoId);
    } catch (e) {
      console.warn("[pipeline] Failed to persist ASR provenance (non-fatal):", e instanceof Error ? e.message : String(e));
    }


    // ── Step 3: Analyze via analyze-gulf-arabic ──────────────────
    // Pass videoId so analyze-gulf-arabic persists results directly to DB,
    // making the pipeline resilient to Supabase gateway ~150s timeouts.
    // Send the QUALITY-PICKED primary text as `transcript`; everything else
    // goes through as alternates for the LLM merge step.
    console.log("[pipeline] Step 3: Analyzing transcript...");

    // Meme videos: load on-screen text analysis the admin form pre-extracted
    // (frames -> extract-visual-context -> stored as <id>.visual.json).
    let visualContextSummary: string | null = null;
    let visualCulturalContext: string | null = null;
    let onScreenTextLines: OnScreenSegment[] = [];
    let visualContextLoaded = false;
    if (video.is_meme) {
      try {
        const { data: visualBlob } = await supabase.storage
          .from("video-audio")
          .download(`${videoId}.visual.json`);
        if (visualBlob) {
          visualContextLoaded = true;
          const visualText = await visualBlob.text();
          const visualResult = JSON.parse(visualText) as VisualResult;
          const segs: OnScreenSegment[] = Array.isArray(visualResult?.onScreenTextSegments)
            ? visualResult.onScreenTextSegments
            : [];
          onScreenTextLines = segs;
          visualCulturalContext = buildVisualContextText(visualResult);
          if (segs.length > 0) {
            const onScreenSummary = segs.map((s) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` (${s.translation})` : ""}`).join("\n");
            visualContextSummary = `MEME — on-screen text segments:\n${onScreenSummary}\n\nScene: ${visualResult?.sceneContext ?? ""}`.trim();
            console.log(`[pipeline] Meme: ${segs.length} on-screen text segments loaded`);
          } else {
            console.warn("[pipeline] Meme: visual context loaded; no on-screen text detected — result will be flagged for review");
          }
        } else {
          console.warn(`[pipeline] Meme: no visual context file found for ${videoId}; processing audio only`);
        }
      } catch (e) {
        console.warn("[pipeline] Meme visual context load failed (non-fatal):", e instanceof Error ? e.message : String(e));
      }

      if (!visualContextLoaded) {
        throw new Error("Meme screen-text extraction is missing. Upload the original video file so the Meme Analyzer can read text on screen before transcription.");
      }
    }

    // Generate a signed URL for the staged audio so analyze-gulf-arabic
    // can pass it to Tier 1 (Gemini) as native multimodal input.
    let audioRef: string | null = null;
    try {
      for (const path of storagePaths) {
        const { data: signed } = await supabase.storage
          .from("video-audio")
          .createSignedUrl(path, 60 * 30); // 30 min
        if (signed?.signedUrl) { audioRef = signed.signedUrl; break; }
      }
    } catch (e) {
      console.warn("[pipeline] Signed URL failed (non-fatal):", e);
    }

    const analyzeBody: Record<string, unknown> = {
      transcript: primaryText,
      primaryEngine,
      videoId,
      dialectModule,
      isMeme: !!video.is_meme,
    };
    if (audioRef) analyzeBody.audioRef = audioRef;
    if (visualContextSummary) analyzeBody.visualContext = visualContextSummary;
    if (onScreenTextLines.length > 0) analyzeBody.onScreenTextSegments = onScreenTextLines;
    if (fanarText) analyzeBody.fanarTranscript = fanarText;
    if (sonioxText) analyzeBody.sonioxTranscript = sonioxText;
    if (munsitText) analyzeBody.munsitTranscript = munsitText;
    if (azureText) analyzeBody.azureTranscript = azureText;
    if (scribeText) analyzeBody.scribeTranscript = scribeText;
    if (cohereText) analyzeBody.cohereTranscript = cohereText;
    const sonioxTranslation = sonioxResult?.translationText;
    if (sonioxTranslation) analyzeBody.sonioxTranslation = sonioxTranslation;

    // Fire the analysis — it saves results directly to DB via videoId.
    // We still try to read the response, but a 504 is non-fatal now.
    let analyzeData: AnalyzeResponse | null = null;
    try {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const internalAuth = serviceRoleKey ? `Bearer ${serviceRoleKey}` : authHeader;
      const analyzeResp = await fetch(`${projectUrl}/functions/v1/analyze-gulf-arabic`, {
        method: "POST",
        headers: { Authorization: internalAuth, "Content-Type": "application/json" },
        body: JSON.stringify(analyzeBody),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });

      if (analyzeResp.ok) {
        analyzeData = await analyzeResp.json();
      } else {
        const errText = await analyzeResp.text().catch(() => "");
        console.warn(`[pipeline] analyze-gulf-arabic HTTP ${analyzeResp.status}: ${errText.slice(0, 200)}`);
      }
    } catch (fetchErr) {
      console.warn("[pipeline] analyze-gulf-arabic fetch error (checking DB for direct-persist):", fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
    }

    // Check if analyze-gulf-arabic persisted results directly (status = 'analysis_complete')
    const { data: refreshed } = await supabase.from("discover_videos")
      .select("transcription_status, transcript_lines, vocabulary, grammar_points, cultural_context, dialect, difficulty, title, title_arabic")
      .eq("id", videoId)
      .single();

    // Align merged-Arabic lines to the source audio timeline.
    //
    // The naive approach (walking Deepgram word indices) breaks badly because:
    //   - the AI merger rewrites/normalizes Arabic, so word counts no longer
    //     match the ASR token stream;
    //   - Deepgram often returns FAR fewer Arabic words than Soniox/Munsit
    //     (English-tuned segmentation), so later lines end up with
    //     undefined timestamps.
    //
    // Instead, take the total speech span from the most reliable timestamped
    // source available and proportionally allocate to each line by character
    // length. This keeps line audio in roughly the right place even when the
    // merged text and the timestamped ASR diverge.
    const alignLinesToAudio = (rawLines: PipelineLine[]): PipelineLine[] => {
      if (!Array.isArray(rawLines) || rawLines.length === 0) return rawLines;

      // Total audio duration in ms — the most reliable upper bound.
      const audioDurationMs =
        ((downloadDuration && downloadDuration > 0 ? downloadDuration : 0) * 1000) ||
        ((video.duration_seconds && video.duration_seconds > 0 ? video.duration_seconds : 0) * 1000) ||
        0;

      // Scan all alignment words for true min start / max end. Some ASRs
      // (notably Soniox) drop end_ms on the final token of a phrase, which
      // previously collapsed the entire span to a single instant — every
      // line ended up with startMs == endMs == first word offset.
      let spanStartMs = Number.POSITIVE_INFINITY;
      let spanEndMs = 0;
      for (const w of relativeWords) {
        const s = Number(w?.start ?? 0) * 1000;
        const e = Number(w?.end ?? 0) * 1000;
        if (s > 0 && s < spanStartMs) spanStartMs = s;
        if (e > spanEndMs) spanEndMs = e;
        if (s > spanEndMs) spanEndMs = s; // start-only tokens still extend span
      }
      if (!Number.isFinite(spanStartMs)) spanStartMs = 0;

      // Degenerate span (missing or single-point word times) → fall back
      // to full audio duration so line audio still plays in roughly the
      // right place.
      if (spanEndMs - spanStartMs < 500) {
        if (audioDurationMs > 0) {
          spanStartMs = 0;
          spanEndMs = audioDurationMs;
        } else {
          spanStartMs = 0;
          spanEndMs = Math.max(spanEndMs, rawLines.length * 2000);
        }
      }

      const totalSpan = Math.max(1, spanEndMs - spanStartMs);

      const lens = rawLines.map((l) => {
        const txt = String(l?.arabic ?? "").replace(/\s+/g, "");
        return Math.max(1, txt.length);
      });
      const totalLen = lens.reduce((a, b) => a + b, 0);

      let cursor = spanStartMs;
      return rawLines.map((line, i) => {
        const share = (lens[i] / totalLen) * totalSpan;
        const startMs = Math.round(cursor);
        const endMs = Math.round(cursor + share);
        cursor += share;
        return { ...line, startMs, endMs };
      });
    };

    if (refreshed?.transcription_status === "analysis_complete") {
      console.log("[pipeline] Results persisted directly by analyze-gulf-arabic");

      const lines = mergeOnScreenTextLines(
        alignLinesToAudio((refreshed.transcript_lines as PipelineLine[]) || []),
        onScreenTextLines,
      );

      const title = refreshed.title || video.title;
      const titleArabic = refreshed.title_arabic || video.title_arabic;

      // Finalize: add timestamps and mark completed
      const { error: finalErr } = await supabase.from("discover_videos").update({
        title, title_arabic: titleArabic,
        transcript_lines: lines,
        cultural_context: video.is_meme
          ? buildMemeReviewContext(onScreenTextLines, combineContext(refreshed.cultural_context as string | null, visualCulturalContext))
          : combineContext(refreshed.cultural_context as string | null, visualCulturalContext),
        transcription_error: video.is_meme && onScreenTextLines.length === 0
          ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
          : null,
        transcription_status: "completed",
      }).eq("id", videoId);

      if (finalErr) throw new Error(`Failed to finalize results: ${finalErr.message}`);
    } else if (analyzeData?.success && analyzeData.result) {
      // Fallback: HTTP response arrived before gateway timeout.
      // `result` is required here, not just `success`: a success envelope with
      // no payload used to walk straight into `result.lines` and throw. Falling
      // through to the polling branch instead is what we'd want anyway — the
      // analysis may still be writing directly to the row.
      const result = analyzeData.result;

      const lines = mergeOnScreenTextLines(
        alignLinesToAudio(result.lines || []),
        onScreenTextLines,
      );

      const sanitizedLines = lines.map((line) => ({
        ...line,
        tokens: Array.isArray(line.tokens) ? line.tokens
          : String(line.arabic ?? "").split(/\s+/).filter(Boolean)
              .map((w: string, wi: number) => ({ id: `tok-${line.id ?? wi}-${wi}`, surface: w })),
      }));

      let title = video.title;
      if ((!title || title === "Untitled Video") && result.title) title = result.title;
      let titleArabic = video.title_arabic;
      if (!titleArabic && result.titleArabic) titleArabic = result.titleArabic;

      // Auto-generate a concise title via Lovable AI if still missing/placeholder
      if (!title || title === "Untitled Video" || !titleArabic) {
        try {
          const sampleLines = sanitizedLines.slice(0, 6).map((l) =>
            `${l.arabic ?? ""}${l.translation ? " — " + l.translation : ""}`
          ).join("\n");
          const lovableKey = Deno.env.get("LOVABLE_API_KEY");
          if (lovableKey && sampleLines.trim()) {
            const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  { role: "system", content: 'Return ONLY JSON: {"title": string (English, ≤8 words, no quotes), "titleArabic": string (Arabic, ≤8 words)}. Title should describe the video content based on the transcript snippet.' },
                  { role: "user", content: sampleLines },
                ],
              }),
            });
            if (aiResp.ok) {
              const j = await aiResp.json();
              const raw = j?.choices?.[0]?.message?.content ?? "";
              const m = raw.match(/\{[\s\S]*\}/);
              if (m) {
                const parsed = JSON.parse(m[0]);
                if ((!title || title === "Untitled Video") && parsed.title) title = String(parsed.title).slice(0, 80);
                if (!titleArabic && parsed.titleArabic) titleArabic = String(parsed.titleArabic).slice(0, 80);
              }
            }
          }
        } catch (e) {
          console.warn("[pipeline] Auto title generation failed (non-fatal):", e);
        }
        // Deterministic fallback from first line
        const first = sanitizedLines[0];
        if ((!title || title === "Untitled Video") && first?.translation) title = String(first.translation).slice(0, 80);
        if (!titleArabic && first?.arabic) titleArabic = String(first.arabic).slice(0, 80);
      }

      const { error: updateError } = await supabase.from("discover_videos").update({
        title, title_arabic: titleArabic,
        transcript_lines: sanitizedLines,
        vocabulary: result.vocabulary || [],
        grammar_points: result.grammarPoints || [],
        cultural_context: video.is_meme
          ? buildMemeReviewContext(onScreenTextLines, combineContext(result.culturalContext || null, visualCulturalContext))
          : combineContext(result.culturalContext || null, visualCulturalContext),
        dialect: result.dialect || "Gulf",
        difficulty: result.difficulty || "Intermediate",
        transcription_status: "completed",
        transcription_error: video.is_meme && onScreenTextLines.length === 0
          ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
          : null,
      }).eq("id", videoId);

      if (updateError) throw new Error(`Failed to save results: ${updateError.message}`);
    } else {
      // Neither direct-persist nor HTTP response succeeded — poll DB for
      // late-arriving analyze-gulf-arabic completion.
      //
      // analyze-gulf-arabic can genuinely take up to ~3.5 minutes (ensemble
      // of Claude + Qwen + Gemini + Fanar + gloss enrichment + diacritization).
      // The 150s Supabase edge-function idle timeout can drop the HTTP
      // response, but the function keeps running and persists directly.
      // Poll for up to 4 minutes (24 * 10s) so we catch that late-arriving write.
      console.log("[pipeline] No HTTP result — polling for late analyze-gulf-arabic persist (up to 4 min)...");
      let landed = false;
      let retryFull: RefreshedRow | null = null;
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise(r => setTimeout(r, 10_000));
        const { data: retry } = await supabase.from("discover_videos")
          .select("transcription_status, transcript_lines, cultural_context, title, title_arabic")
          .eq("id", videoId)
          .single();
        if (retry?.transcription_status === "analysis_complete") {
          retryFull = retry;
          landed = true;
          console.log(`[pipeline] analyze results landed after ${(attempt + 1) * 10}s`);
          break;
        }
      }

      if (landed && retryFull) {
        const retryLines = mergeOnScreenTextLines(
          alignLinesToAudio((retryFull?.transcript_lines as PipelineLine[]) || []),
          onScreenTextLines,
        );

        await supabase.from("discover_videos").update({
          transcript_lines: retryLines,
          cultural_context: video.is_meme
            ? buildMemeReviewContext(onScreenTextLines, combineContext(retryFull?.cultural_context as string | null, visualCulturalContext))
            : combineContext(retryFull?.cultural_context as string | null, visualCulturalContext),
          transcription_status: "completed",
          transcription_error: video.is_meme && onScreenTextLines.length === 0
            ? "Meme screen-text extraction found no readable on-screen text; review manually before publishing."
            : null,
        }).eq("id", videoId);
      } else {
        throw new Error("Analysis did not complete — no HTTP response and no direct-persist results found after 4 min");
      }
    }


    // NOTE: Intentionally keep staged audio in `video-audio/` so the Discover
    // player can stream it for subtitle sync (TikTok hidden-audio playback).
    // Previously we removed `storagePaths` here to save storage, but that
    // broke automatic sync for completed videos.

    // Auto-tag difficulty (CEFR + WPM + rare-word ratio) once transcript is ready.
    //
    // Awaited, not fire-and-forget. This is the last step of a pipeline that is
    // itself running inside the outer `waitUntil`, and registering a *second*
    // waitUntil from a task that is about to settle does not reliably extend the
    // isolate's life — rate-video-cefr was observed booting and shutting down
    // with no log output of its own, which is what a mid-flight teardown looks
    // like. Awaiting keeps it inside the window that is already being held open.
    //
    // Authorization uses the service-role key for the same reason the analyze
    // call does: `authHeader` is whatever the original caller sent, which may be
    // an anon key with no rights to this function.
    try {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const rateResp = await fetch(`${projectUrl}/functions/v1/rate-video-cefr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: serviceRoleKey ? `Bearer ${serviceRoleKey}` : authHeader,
        },
        body: JSON.stringify({ videoId }),
        // A hung rating must not hold the pipeline open indefinitely; the
        // transcript is already persisted by this point either way.
        signal: AbortSignal.timeout(90_000),
      });
      if (!rateResp.ok) {
        console.warn(`[pipeline] auto-rate failed: ${rateResp.status} ${await rateResp.text().catch(() => "")}`);
      } else {
        console.log(`[pipeline] auto-rate completed for ${videoId}`);
      }
    } catch (e) {
      console.warn("[pipeline] auto-rate error (non-fatal):", e instanceof Error ? e.message : String(e));
    }

    console.log(`[pipeline] Completed for video ${videoId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[pipeline] Failed for video ${videoId}:`, errorMsg);

    await supabase.from("discover_videos").update({
      transcription_status: "failed",
      transcription_error: errorMsg,
    }).eq("id", videoId);
  }
}

// ── HTTP handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  console.log(`[handler] ${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  console.log(`[handler] auth header present: ${!!authHeader}`);
  if (!authHeader?.startsWith("Bearer ")) {
    console.error("[handler] Missing/invalid Authorization header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const token = authHeader.slice("Bearer ".length).trim();
  const isInternalServiceCall = token === serviceRoleKey;
  // The admin form sends the publishable/anon key directly. Accept both the
  // legacy anon JWT and the new sb_publishable_... key as valid public bearers
  // — `verify_jwt = false` already means anyone can hit this endpoint.
  const isAnonKey = token === anonKey;
  const isPublishableKey = publishableKey.length > 0 && token === publishableKey;
  const looksLikePublishable = token.startsWith("sb_publishable_");
  const isPublicKey = isAnonKey || isPublishableKey || looksLikePublishable;
  console.log(`[handler] isInternalServiceCall=${isInternalServiceCall} isAnonKey=${isAnonKey} isPublishableKey=${isPublishableKey} looksLikePublishable=${looksLikePublishable}`);

  if (!isInternalServiceCall && !isPublicKey) {
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      anonKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      console.error("[handler] auth.getUser failed:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[handler] authenticated user ${user.id}`);
  }

  let body: { videoId?: string } | null = null;
  try {
    body = await req.json();
  } catch (e) {
    console.error("[handler] JSON parse failed:", e);
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const { videoId } = body ?? {};
  console.log(`[handler] videoId=${videoId}`);
  if (!videoId) {
    return new Response(
      JSON.stringify({ error: "videoId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: video, error: fetchErr } = await supabase
    .from("discover_videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (fetchErr || !video) {
    return new Response(
      JSON.stringify({ error: "Video not found", details: fetchErr?.message }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase
    .from("discover_videos")
    .update({ transcription_status: "processing", transcription_error: null })
    .eq("id", videoId);

  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  // Always use service-role key for inter-function calls so the pipeline
  // keeps working even after the original user JWT expires mid-run.
  const pipelineAuth = `Bearer ${serviceRoleKey}`;

  // Launch the pipeline as a background task that is fully decoupled from this
  // HTTP request. When the response is returned below, req.signal fires (the
  // platform considers the request done), but runPipeline() continues running
  // inside waitUntil and cannot be aborted by req.signal.
  const pipeline = runPipeline(videoId, video, supabase, pipelineAuth, projectUrl);

  try {
    edgeRuntime()?.waitUntil?.(pipeline);
  } catch {
    // Fallback: keep the promise alive as a detached task
    pipeline.catch((err: unknown) => console.error("[pipeline] Unhandled background error:", err));
  }

  return new Response(
    JSON.stringify({ success: true, message: "Processing started" }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
