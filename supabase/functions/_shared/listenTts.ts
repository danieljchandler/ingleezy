// Shared TTS helpers for the Listen feature.
// - Gulf episodes → Munsit (WAV, multiple Gulf voices).
// - Egyptian episodes → ElevenLabs native Egyptian voices, else Azure Neural TTS (MP3).
// - Yemeni episodes → Azure Neural TTS using real ar-YE-* Yemeni voices (MP3).

const MUNSIT_BASE = "https://api.munsit.com/api/v1";
const GULF_DIALECTS = new Set([
  "najdi", "emirati", "khaleeji", "gulf",
  "saudi", "kuwaiti", "qatari", "bahraini", "omani",
]);

export type Provider = "munsit" | "azure" | "elevenlabs";

export interface ProviderPlan {
  provider: Provider;
  ext: "wav" | "mp3";
  contentType: "audio/wav" | "audio/mpeg";
  // For Munsit: ordered list of distinct Gulf voice_ids + modelId.
  munsitVoices?: string[];
  munsitModelId?: string;
  // For Azure: full neural voice list.
  azureVoices?: string[];
  // For ElevenLabs: ordered list of voice IDs (alternated by speaker slot).
  elevenLabsVoices?: string[];
  elevenLabsModelId?: string;
}

// English voices for the flipped (english-target) episodes: ElevenLabs
// premade voices — global, stable IDs available to every workspace. Two
// contrasting voices cover host_a/host_b alternation; Azure en-US neural
// voices are the no-ElevenLabs fallback.
const ELEVENLABS_ENGLISH_VOICES = [
  "21m00Tcm4TlvDq8ikWAM", // Rachel — calm, conversational (female, en-US)
  "TxGEqnHWrfWFTfGW9XjX", // Josh — warm, natural (male, en-US)
  "EXAVITQu4vr4xnSDxMaL", // Bella — bright (female, en-US)
];

const AZURE_ENGLISH_VOICES = [
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-US-AriaNeural",
];

// Native Egyptian Arabic voices from the workspace library.
const ELEVENLABS_EGYPTIAN_VOICES = [
  "6aXW46RTUz6Y2lkBGQ1a", // Farida — Lively and Radiant (female, ar-EG)
  "rMheqEfwsIJckq2yCdb5", // Ahmed Yahia (male, ar-EG)
  "ckGEQg6YnSVooU5uDRsF", // Tarek — Pleasant and Professional (male, ar-EG)
];

const AZURE_VOICE_MAP: Record<string, string[]> = {
  Egyptian: ["ar-EG-ShakirNeural", "ar-EG-SalmaNeural"],
  Yemeni: ["ar-YE-MaryamNeural", "ar-YE-SalehNeural"],
  Gulf: ["ar-AE-HamdanNeural", "ar-AE-FatimaNeural", "ar-SA-HamedNeural", "ar-SA-ZariyahNeural"],
};

let cachedMunsit: { voices: string[]; modelId: string } | null = null;

async function pickMunsitModelId(apiKey: string): Promise<string | null> {
  const override = Deno.env.get("MUNSIT_TTS_MODEL_ID")?.trim();
  if (override) return override;
  try {
    const resp = await fetch(`${MUNSIT_BASE}/models`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const models = await resp.json() as Array<{ model_id: string }>;
    if (!Array.isArray(models) || models.length === 0) return null;
    const v1 = models.find((m) => /v1/i.test(m.model_id));
    const mini = models.find((m) => /mini/i.test(m.model_id));
    return (v1 ?? mini ?? models[0]).model_id;
  } catch {
    return null;
  }
}

async function loadMunsitGulfVoices(apiKey: string): Promise<{ voices: string[]; modelId: string } | null> {
  if (cachedMunsit) return cachedMunsit;
  const [voicesResp, modelId] = await Promise.all([
    fetch(`${MUNSIT_BASE}/voices`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null),
    pickMunsitModelId(apiKey),
  ]);
  if (!modelId || !voicesResp || !voicesResp.ok) return null;
  const all = await voicesResp.json() as Array<{
    voice_id: string;
    name?: string;
    gender?: string;
    dialect?: string[];
  }>;
  if (!Array.isArray(all) || all.length === 0) return null;

  const gulf = all.filter((v) =>
    Array.isArray(v.dialect) &&
    v.dialect.some((d) => GULF_DIALECTS.has(d.toLowerCase()))
  );

  // Story narration uses male Gulf voices only (user preference).
  const males = gulf.filter((v) => (v.gender ?? "").toLowerCase() === "male");
  const fallback = males.length > 0
    ? males.map((v) => v.voice_id)
    : (gulf.length > 0 ? gulf.map((v) => v.voice_id) : all.slice(0, 4).map((v) => v.voice_id));
  const voices = fallback.slice(0, 4);
  if (voices.length === 0) return null;

  cachedMunsit = { voices, modelId };
  console.log(`listenTts: cached ${voices.length} Munsit Gulf voices (model=${modelId})`);
  return cachedMunsit;
}

/**
 * The plan for ENGLISH episode audio — the default for everything the
 * flipped generate-listen-script produces. `planProvider(dialect)` below
 * remains for Arabic content (e.g. scaffold-line audio, legacy episodes).
 */
export function planEnglishProvider(): ProviderPlan {
  if (Deno.env.get("ELEVENLABS_API_KEY")) {
    return {
      provider: "elevenlabs",
      ext: "mp3",
      contentType: "audio/mpeg",
      elevenLabsVoices: ELEVENLABS_ENGLISH_VOICES,
      elevenLabsModelId: elevenLabsModel(),
    };
  }
  return {
    provider: "azure",
    ext: "mp3",
    contentType: "audio/mpeg",
    azureVoices: AZURE_ENGLISH_VOICES,
  };
}

export async function planProvider(dialect: string): Promise<ProviderPlan> {
  const munsitKey = Deno.env.get("MUNSIT_API_KEY");
  if (dialect === "Gulf" && munsitKey) {
    const m = await loadMunsitGulfVoices(munsitKey);
    if (m) {
      return {
        provider: "munsit",
        ext: "wav",
        contentType: "audio/wav",
        munsitVoices: m.voices,
        munsitModelId: m.modelId,
      };
    }
    console.warn(`listenTts: Munsit unavailable for ${dialect}, falling back to Azure`);
  }

  if (dialect === "Egyptian" && Deno.env.get("ELEVENLABS_API_KEY")) {
    return {
      provider: "elevenlabs",
      ext: "mp3",
      contentType: "audio/mpeg",
      elevenLabsVoices: ELEVENLABS_EGYPTIAN_VOICES,
      elevenLabsModelId: elevenLabsModel(),
    };
  }


  return {
    provider: "azure",
    ext: "mp3",
    contentType: "audio/mpeg",
    azureVoices: AZURE_VOICE_MAP[dialect] ?? AZURE_VOICE_MAP.Gulf,
  };
}

export function pickVoiceSlot(role: string, index: number): number {
  const r = (role || "").toLowerCase();
  if (r.includes("host_b") || r === "guest" || r === "character") return 1;
  // Narrator uses the same primary voice slot the podcast host uses — that
  // voice is proven to sound natural on long-form narration. Slot 2 previously
  // picked a more energetic voice that sounded like shouting on stories.
  if (r === "narrator") return 0;
  if (r === "speaker") return 0;
  return index % 2;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function synthesizeAzure(text: string, voice: string): Promise<Uint8Array> {
  const key = Deno.env.get("AZURE_SPEECH_KEY");
  if (!key) throw new Error("AZURE_SPEECH_KEY missing");
  const endpoint = Deno.env.get("AZURE_SPEECH_ENDPOINT");
  const region = Deno.env.get("AZURE_SPEECH_REGION") ?? "eastus";
  const url = endpoint
    ? `${endpoint.replace(/\/$/, "")}/tts/cognitiveservices/v1`
    : `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "lahja-listen",
    },
    body: ssml,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Azure TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export async function synthesizeMunsit(
  text: string,
  voiceId: string,
  modelId: string,
  opts: { stability?: number; speed?: number } = {},
): Promise<Uint8Array> {
  const key = Deno.env.get("MUNSIT_API_KEY");
  if (!key) throw new Error("MUNSIT_API_KEY missing");
  const resp = await fetch(`${MUNSIT_BASE}/text-to-speech/${encodeURIComponent(modelId)}`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      // Higher stability → calmer, less "shouty" delivery. Podcast dialogue
      // sounds fine at 0.6; long narration benefits from 0.75+.
      stability: typeof opts.stability === "number" ? opts.stability : 0.6,
      speed: typeof opts.speed === "number" ? opts.speed : 1.0,
      streaming: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Munsit TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

// Model override knob for A/B-ing eleven_v3 (better dialect handling incl.
// Egyptian) against the current default without a redeploy.
export function elevenLabsModel(): string {
  return Deno.env.get("ELEVENLABS_TTS_MODEL")?.trim() || "eleven_multilingual_v2";
}

export interface ElevenLabsOpts {
  stability?: number;
  style?: number;
  // Prosody conditioning: pass the surrounding lines so multi-line narration
  // flows naturally across line boundaries instead of restarting intonation.
  previousText?: string;
  nextText?: string;
}

export async function synthesizeElevenLabs(
  text: string,
  voiceId: string,
  modelId: string,
  opts: ElevenLabsOpts = {},
): Promise<Uint8Array> {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY missing");
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        ...(opts.previousText ? { previous_text: opts.previousText.slice(-600) } : {}),
        ...(opts.nextText ? { next_text: opts.nextText.slice(0, 600) } : {}),
        voice_settings: {
          stability: opts.stability ?? 0.4,
          similarity_boost: 0.8,
          style: opts.style ?? 0.5,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export async function synthesizeLine(
  text: string,
  role: string,
  index: number,
  plan: ProviderPlan,
  // Optional prosody conditioning (ElevenLabs only): surrounding lines of the
  // same narration so intonation carries across line boundaries.
  neighbors: { previousText?: string; nextText?: string } = {},
): Promise<Uint8Array> {
  if (plan.provider === "munsit") {
    const voices = plan.munsitVoices!;
    const slot = pickVoiceSlot(role, index) % voices.length;
    // Narration → higher stability so it doesn't sound like shouting.
    const stability = (role || "").toLowerCase() === "narrator" ? 0.8 : 0.6;
    return synthesizeMunsit(text, voices[slot], plan.munsitModelId!, { stability });
  }
  if (plan.provider === "elevenlabs") {
    const voices = plan.elevenLabsVoices!;
    const slot = pickVoiceSlot(role, index) % voices.length;
    return synthesizeElevenLabs(text, voices[slot], plan.elevenLabsModelId ?? elevenLabsModel(), neighbors);
  }
  const voices = plan.azureVoices!;
  const slot = pickVoiceSlot(role, index) % voices.length;
  return synthesizeAzure(text, voices[slot]);
}

// ---- WAV concatenation (strip RIFF headers from clips 2..N, rewrite sizes) ----
// Assumes all clips share the same PCM format (true for one Munsit model run).
export function concatWav(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 0) return new Uint8Array();
  if (clips.length === 1) return clips[0];

  // Parse the first clip to find 'data' chunk offset and format chunk.
  const first = clips[0];
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  // RIFF header: "RIFF" <size:4> "WAVE"
  if (
    String.fromCharCode(first[0], first[1], first[2], first[3]) !== "RIFF" ||
    String.fromCharCode(first[8], first[9], first[10], first[11]) !== "WAVE"
  ) {
    // Not a parseable WAV — fall back to naive byte concat.
    return concatBytes(clips);
  }

  // Walk chunks to locate 'data'.
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= first.length) {
    const id = String.fromCharCode(first[offset], first[offset+1], first[offset+2], first[offset+3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) return concatBytes(clips);

  const header = first.slice(0, dataOffset); // RIFF + fmt + ... + "data"<size>
  const firstData = first.slice(dataOffset, dataOffset + dataSize);

  // Extract data payloads from subsequent clips.
  const tails: Uint8Array[] = [firstData];
  let totalData = firstData.length;
  for (let c = 1; c < clips.length; c++) {
    const clip = clips[c];
    if (clip.length < 12) continue;
    if (String.fromCharCode(clip[0], clip[1], clip[2], clip[3]) !== "RIFF") {
      tails.push(clip);
      totalData += clip.length;
      continue;
    }
    const cv = new DataView(clip.buffer, clip.byteOffset, clip.byteLength);
    let off = 12;
    while (off + 8 <= clip.length) {
      const id = String.fromCharCode(clip[off], clip[off+1], clip[off+2], clip[off+3]);
      const sz = cv.getUint32(off + 4, true);
      if (id === "data") {
        const payload = clip.slice(off + 8, off + 8 + sz);
        tails.push(payload);
        totalData += payload.length;
        break;
      }
      off += 8 + sz + (sz % 2);
    }
  }

  // Build output: header (rewritten sizes) + concatenated data
  const out = new Uint8Array(header.length + totalData);
  out.set(header, 0);
  // Update RIFF size = file_size - 8
  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.length - 8, true);
  // Update data chunk size (last 4 bytes of header are the data size)
  outView.setUint32(header.length - 4, totalData, true);
  let p = header.length;
  for (const t of tails) {
    out.set(t, p);
    p += t.length;
  }
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function concatForPlan(parts: Uint8Array[], plan: ProviderPlan): Uint8Array {
  return plan.ext === "wav" ? concatWav(parts) : concatBytes(parts);
}

// Rough duration estimates per provider.
export function estimateSeconds(bytes: number, plan: ProviderPlan): number {
  if (plan.provider === "munsit") {
    // Munsit typically returns 22.05 kHz mono 16-bit PCM ≈ 44100 B/s.
    return Math.max(0, Math.round((bytes - 44) / 44100));
  }
  if (plan.provider === "elevenlabs") {
    // ElevenLabs MP3 at 128 kbps CBR.
    return Math.round((bytes * 8) / 128000);
  }
  // Azure 48 kbps CBR MP3
  return Math.round((bytes * 8) / 48000);
}
