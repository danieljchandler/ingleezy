// process-english-video — the English-target video pipeline.
//
// The Arabic pipeline (process-approved-video → six-engine ASR ladder →
// analyze-gulf-arabic arbitration) exists because Arabic dialect ASR is
// genuinely hard. English is the easy case: one Deepgram nova-3 pass gives
// word-level timestamps and utterance segmentation good enough to publish.
// So this pipeline is deliberately small:
//
//   1. Acquire audio — same ladder as the Arabic pipeline: staged
//      `video-audio` storage → cached `audio_files` row → download-media.
//   2. Deepgram (nova-3, en, utterances) → one transcript line per utterance
//      with startMs/endMs.
//   3. One Brain call per batch of lines generates the Arabic scaffold:
//      dialect translation + Fusha + a literal word-order gloss. The call is
//      Arabic-target, so the full dialect machinery (rulebook prompt,
//      MSA-leak scan, repair) guards the scaffold — but the leak scan reads
//      ONLY the dialect lines: the Fusha lines are deliberate MSA and would
//      light the detector up like a false-positive tree.
//   4. Persist transcript_lines and mark completed.
//
// Line shape (the mirror of Hakiya's): { english, arabic, fusha, literal,
// startMs, endMs } — `literal` is a word-for-word ARABIC gloss preserving
// ENGLISH word order, showing an Arabic speaker how the English sentence is
// built (the exact mirror of Hakiya's English-gloss-of-Arabic).
//
// Admin-only: this writes learner-facing content.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { askBrain } from "../_shared/aiBrain.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_TIMEOUT_MS = 5 * 60 * 1000;

/** Lines per scaffold Brain call — bounded so long videos stay in budget. */
const SCAFFOLD_BATCH_SIZE = 25;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

interface EnglishLine {
  id: string;
  english: string;
  arabic: string;
  fusha: string;
  literal: string;
  startMs: number;
  endMs: number;
}

interface ScaffoldLine {
  arabic: string;
  fusha: string;
  literal: string;
}

const SCAFFOLD_TOOL = {
  name: "return_scaffold",
  description: "Return the Arabic scaffold for each numbered English line.",
  parameters: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            arabic: {
              type: "string",
              description: "Natural translation in the requested Arabic dialect.",
            },
            fusha: {
              type: "string",
              description: "Translation in Modern Standard Arabic (Fusha).",
            },
            literal: {
              type: "string",
              description:
                "Word-for-word Arabic gloss PRESERVING THE ENGLISH WORD ORDER, so the learner sees how the English sentence is built. May sound stiff — that is expected.",
            },
          },
          required: ["arabic", "fusha", "literal"],
        },
      },
    },
    required: ["lines"],
  } as Record<string, unknown>,
};

function toDialect(d?: string | null): Dialect {
  if (d === "Egyptian") return "Egyptian";
  if (d === "Yemeni") return "Yemeni";
  return "Gulf";
}

interface Utterance {
  transcript?: string;
  start?: number;
  end?: number;
}

async function deepgramUtterances(audio: ArrayBuffer, contentType: string, apiKey: string): Promise<Utterance[]> {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    punctuate: "true",
    smart_format: "true",
    utterances: "true",
  });
  const resp = await fetch(`${DEEPGRAM_URL}?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
    body: audio,
    signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Deepgram ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const utterances = data?.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) return utterances as Utterance[];
  // No utterances (very short clip): fall back to the whole transcript as one line.
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  const duration = Number(data?.metadata?.duration ?? 0);
  return transcript.trim() ? [{ transcript, start: 0, end: duration }] : [];
}

/** Generate the Arabic scaffold for one batch of English lines. */
async function scaffoldBatch(englishLines: string[], dialect: Dialect): Promise<ScaffoldLine[]> {
  const numbered = englishLines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const brain = await askBrain<{ lines?: ScaffoldLine[] }>({
    purpose: "video_scaffold",
    dialect, // Arabic-target (default): the dialect machinery guards the scaffold.
    strategy: "solo",
    models: [MODEL_IDS.GEMINI_FLASH],
    userPrompt:
      `For each numbered ENGLISH line from a video, produce its Arabic scaffold for an Arabic-speaking English learner:\n` +
      `- arabic: natural ${dialect} dialect translation\n` +
      `- fusha: Modern Standard Arabic translation\n` +
      `- literal: word-for-word Arabic gloss preserving the ENGLISH word order (shows how the English is built; stiffness is expected)\n\n` +
      `Lines:\n${numbered}\n\n` +
      `Return exactly ${englishLines.length} entries via the return_scaffold tool, in order.`,
    maxTokens: 4096,
    temperature: 0.3,
    tool: SCAFFOLD_TOOL,
    // Only the dialect lines face the MSA-leak scan — the fusha lines are
    // deliberate MSA and the literal glosses are intentionally unnatural.
    arabicTextPath: (parsed) => {
      const out = parsed as { lines?: ScaffoldLine[] };
      return (out?.lines ?? []).map((l) => l?.arabic ?? "").join("\n");
    },
  });
  const lines = Array.isArray(brain.output?.lines) ? brain.output.lines : [];
  // Pad or trim so a miscounting model can't shift every later line.
  while (lines.length < englishLines.length) lines.push({ arabic: "", fusha: "", literal: "" });
  lines.length = englishLines.length;
  return lines.map((l) => ({
    arabic: typeof l?.arabic === "string" ? l.arabic : "",
    fusha: typeof l?.fusha === "string" ? l.fusha : "",
    literal: typeof l?.literal === "string" ? l.literal : "",
  }));
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = admin();
  let videoId = "";
  try {
    // ── Admin only ──────────────────────────────────────────────────────────
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return json({ error: "auth_required" }, 401, cors);
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userErr || !userId) return json({ error: "auth_required" }, 401, cors);
    const { data: roles } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (!roles?.length) return json({ error: "forbidden" }, 403, cors);

    const body = await req.json().catch(() => ({}));
    videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400, cors);

    const { data: video, error: videoErr } = await sb
      .from("discover_videos")
      .select("id, source_url, dialect")
      .eq("id", videoId)
      .maybeSingle();
    if (videoErr || !video) return json({ error: "video_not_found" }, 404, cors);

    const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY not configured");

    await sb.from("discover_videos").update({
      transcription_status: "processing",
      transcription_error: null,
    }).eq("id", videoId);

    // ── Step 1: Acquire audio (same ladder as the Arabic pipeline) ──────────
    let audioBytes: ArrayBuffer | null = null;
    let audioContentType = "audio/mp4";

    const storagePaths = [
      `${videoId}.wav`, `${videoId}.mp4`, `${videoId}.m4a`, `${videoId}.webm`,
      `${videoId}.mp3`, `${videoId}.opus`,
    ];
    for (const path of storagePaths) {
      const { data: fileData, error: fileErr } = await sb.storage.from("video-audio").download(path);
      if (!fileErr && fileData) {
        audioBytes = await fileData.arrayBuffer();
        audioContentType = fileData.type ||
          (path.endsWith(".mp3") ? "audio/mpeg" : path.endsWith(".wav") ? "audio/wav" : "audio/mp4");
        break;
      }
    }

    if (!audioBytes) {
      const projectUrl = SUPABASE_URL;
      const downloadResp = await fetch(`${projectUrl}/functions/v1/download-media`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.source_url }),
      });
      if (!downloadResp.ok) {
        const errBody = await downloadResp.text();
        throw new Error(`Download failed (${downloadResp.status}): ${errBody.slice(0, 200)}`);
      }
      const downloadData = await downloadResp.json();
      // The Arabic-era transcription cache is ignored deliberately: cached
      // `transcriptionData` is dialect-Arabic-shaped and useless here.
      if (!downloadData.audioBase64) {
        throw new Error("No audio data received. Try uploading the audio file manually.");
      }
      const bin = atob(downloadData.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      audioBytes = bytes.buffer;
      audioContentType = downloadData.contentType || "audio/mp4";
    }

    // ── Step 2: Transcribe ──────────────────────────────────────────────────
    const utterances = await deepgramUtterances(audioBytes, audioContentType, deepgramKey);
    const english = utterances
      .map((u) => ({
        text: (u.transcript ?? "").trim(),
        startMs: Math.round((u.start ?? 0) * 1000),
        endMs: Math.round((u.end ?? 0) * 1000),
      }))
      .filter((u) => u.text);
    if (english.length === 0) throw new Error("Transcription produced no speech");

    // ── Step 3: Arabic scaffold, in batches ─────────────────────────────────
    const dialect = toDialect(video.dialect);
    const scaffold: ScaffoldLine[] = [];
    for (let i = 0; i < english.length; i += SCAFFOLD_BATCH_SIZE) {
      const batch = english.slice(i, i + SCAFFOLD_BATCH_SIZE);
      scaffold.push(...await scaffoldBatch(batch.map((l) => l.text), dialect));
    }

    const lines: EnglishLine[] = english.map((l, i) => ({
      id: crypto.randomUUID().slice(0, 8),
      english: l.text,
      arabic: scaffold[i]?.arabic ?? "",
      fusha: scaffold[i]?.fusha ?? "",
      literal: scaffold[i]?.literal ?? "",
      startMs: l.startMs,
      endMs: l.endMs,
    }));

    // ── Step 4: Persist ─────────────────────────────────────────────────────
    const durationSeconds = Math.round((english.at(-1)?.endMs ?? 0) / 1000) || null;
    const { error: updateErr } = await sb.from("discover_videos").update({
      transcript_lines: lines,
      transcription_status: "completed",
      transcription_error: null,
      ...(durationSeconds ? { duration_seconds: durationSeconds } : {}),
    }).eq("id", videoId);
    if (updateErr) throw new Error(`Persist failed: ${updateErr.message}`);

    console.log(`[english-pipeline] ${videoId}: ${lines.length} lines, dialect=${dialect}`);
    return json({ success: true, lines: lines.length }, 200, cors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("process-english-video error:", msg);
    if (videoId) {
      await admin().from("discover_videos").update({
        transcription_status: "failed",
        transcription_error: msg.slice(0, 500),
      }).eq("id", videoId).then(() => {}, () => {});
    }
    return json({ error: msg }, 500, cors);
  }
});
