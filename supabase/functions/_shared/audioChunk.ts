// =============================================================================
// Container detection and duration-based chunking for the ASR fan-out.
//
// Munsit has no async/polling endpoint and silently returns an empty transcript
// for payloads above ~10 MB, so oversize audio has to be split into pieces and
// stitched back together. Splitting has to happen on real frame boundaries —
// a byte-range slice of a compressed stream is not decodable.
//
// This used to live inline in process-approved-video and handled MP3 only;
// anything else that went oversize was skipped with `oversize-non-mp3`, which
// in practice meant Munsit never ran on an uploaded video at all.
//
// Supported: MP3 (frame walk), WAV (PCM slice + header rewrite), MP4/M4A
// (AAC track demuxed to ADTS). Not supported: WebM/Opus — splitting those
// safely needs a real Matroska parser, so callers get a named skip reason.
// =============================================================================

export interface AudioChunk {
  /**
   * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: the default type
   * argument is `ArrayBufferLike`, which includes `SharedArrayBuffer` and so is
   * not a `BlobPart`. Every chunk here is plain-buffer backed, and callers put
   * these straight into a `File` for a multipart upload.
   */
  bytes: Uint8Array<ArrayBuffer>;
  /** Start of this chunk within the original audio, in seconds. */
  offsetSec: number;
  /** Duration of this chunk, in seconds. */
  durSec: number;
}

// ── MP3 ──────────────────────────────────────────────────────────────────────

export function isLikelyMp3(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType && /mpeg|mp3/i.test(contentType)) return true;
  if (bytes.length < 3) return false;
  // ID3v2 tag
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  // MPEG audio frame sync (0xFFE...)
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return true;
  return false;
}

export function* iterMp3Frames(
  buf: Uint8Array,
): Generator<{ offset: number; size: number; durMs: number }> {
  let i = 0;
  // Skip ID3v2 header if present (10-byte header + synchsafe size)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 && buf.length > 10) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  const BR_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const BR_V2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const SR_V1 = [44100, 48000, 32000, 0];
  const SR_V2 = [22050, 24000, 16000, 0];
  const SR_V25 = [11025, 12000, 8000, 0];
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) { i++; continue; }
    const verBits = (buf[i + 1] >> 3) & 0x03;   // 0=2.5, 1=reserved, 2=2, 3=1
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 1=Layer III
    if (verBits === 1 || layerBits !== 1) { i++; continue; }
    const brIdx = (buf[i + 2] >> 4) & 0x0F;
    const srIdx = (buf[i + 2] >> 2) & 0x03;
    const pad = (buf[i + 2] >> 1) & 0x01;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const isV1 = verBits === 3;
    const br = (isV1 ? BR_V1L3 : BR_V2L3)[brIdx] * 1000;
    const sr = (verBits === 3 ? SR_V1 : verBits === 2 ? SR_V2 : SR_V25)[srIdx];
    const samples = isV1 ? 1152 : 576;
    const size = Math.floor((samples / 8) * br / sr) + pad;
    if (size < 4 || i + size > buf.length) { i++; continue; }
    yield { offset: i, size, durMs: (samples / sr) * 1000 };
    i += size;
  }
}

export function chunkMp3ByDuration(bytes: Uint8Array<ArrayBuffer>, targetSec: number): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  let chunkStart = -1;
  let chunkDurMs = 0;
  let cumMs = 0;
  let lastEnd = 0;
  for (const f of iterMp3Frames(bytes)) {
    if (chunkStart < 0) chunkStart = f.offset;
    chunkDurMs += f.durMs;
    lastEnd = f.offset + f.size;
    if (chunkDurMs >= targetSec * 1000) {
      chunks.push({ bytes: bytes.slice(chunkStart, lastEnd), offsetSec: cumMs / 1000, durSec: chunkDurMs / 1000 });
      cumMs += chunkDurMs;
      chunkStart = -1;
      chunkDurMs = 0;
    }
  }
  if (chunkStart >= 0 && chunkDurMs > 0) {
    chunks.push({ bytes: bytes.slice(chunkStart, lastEnd), offsetSec: cumMs / 1000, durSec: chunkDurMs / 1000 });
  }
  return chunks;
}

// ── WAV ──────────────────────────────────────────────────────────────────────

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
}

const ascii = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

export function isLikelyWav(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType && /wav|wave|x-pcm/i.test(contentType)) return true;
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
}

/** Read `fmt ` and locate `data`. Returns null for anything that isn't plain PCM. */
export function parseWavHeader(bytes: Uint8Array): WavInfo | null {
  if (!isLikelyWav(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12;
  let fmt: Omit<WavInfo, "dataOffset" | "dataLength"> | null = null;
  while (o + 8 <= bytes.length) {
    const id = ascii(bytes, o, 4);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt " && size >= 16) {
      const audioFormat = view.getUint16(body, true);
      // 1 = PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (still PCM samples).
      if (audioFormat !== 1 && audioFormat !== 0xFFFE) return null;
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt || !fmt.sampleRate || !fmt.blockAlign) return null;
      // Some encoders write a placeholder length; clamp to what's actually there.
      const dataLength = Math.min(size, bytes.length - body);
      return { ...fmt, dataOffset: body, dataLength };
    }
    // Chunks are word-aligned.
    o = body + size + (size % 2);
  }
  return null;
}

/** Build a 44-byte canonical PCM WAV header for `dataLength` bytes of samples. */
function wavHeader(info: WavInfo, dataLength: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const write = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[o + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, info.channels, true);
  view.setUint32(24, info.sampleRate, true);
  view.setUint32(28, info.sampleRate * info.blockAlign, true);
  view.setUint16(32, info.blockAlign, true);
  view.setUint16(34, info.bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);
  return header;
}

/**
 * Split PCM WAV into self-contained WAV files of roughly `targetSec` each.
 * Uncompressed samples can be cut anywhere on a block boundary, so this is just
 * a slice plus a fresh header.
 */
export function chunkWavByDuration(bytes: Uint8Array<ArrayBuffer>, targetSec: number): AudioChunk[] {
  const info = parseWavHeader(bytes);
  if (!info || targetSec <= 0) return [];
  const bytesPerSec = info.sampleRate * info.blockAlign;
  if (bytesPerSec <= 0) return [];
  // Align to a whole frame so channels never desync.
  const step = Math.max(info.blockAlign, Math.floor((targetSec * bytesPerSec) / info.blockAlign) * info.blockAlign);

  const chunks: AudioChunk[] = [];
  for (let pos = 0; pos < info.dataLength; pos += step) {
    const len = Math.min(step, info.dataLength - pos);
    if (len <= 0) break;
    const out = new Uint8Array(44 + len);
    out.set(wavHeader(info, len), 0);
    out.set(bytes.subarray(info.dataOffset + pos, info.dataOffset + pos + len), 44);
    chunks.push({ bytes: out, offsetSec: pos / bytesPerSec, durSec: len / bytesPerSec });
  }
  return chunks;
}

// ── MP4 / M4A ────────────────────────────────────────────────────────────────

export function isLikelyMp4(bytes: Uint8Array, contentType?: string): boolean {
  if (contentType && /mp4|m4a|quicktime|isom/i.test(contentType)) return true;
  // `ftyp` at offset 4 is the ISO base media file signature.
  return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
}

interface Box { type: string; start: number; end: number; body: number }

/** Iterate the boxes directly inside [from, to). */
function* iterBoxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = from;
  while (o + 8 <= to) {
    let size = view.getUint32(o, false);
    const type = ascii(b, o + 4, 4);
    let body = o + 8;
    if (size === 1) {
      if (o + 16 > to) return;
      // 64-bit largesize. Sizes beyond 2^53 aren't representable and aren't real.
      const hi = view.getUint32(o + 8, false);
      const lo = view.getUint32(o + 12, false);
      size = hi * 4294967296 + lo;
      body = o + 16;
    } else if (size === 0) {
      size = to - o; // extends to the end of the container
    }
    if (size < 8 || o + size > to) return;
    yield { type, start: o, end: o + size, body };
    o += size;
  }
}

function findBox(b: Uint8Array, from: number, to: number, type: string): Box | null {
  for (const box of iterBoxes(b, from, to)) if (box.type === type) return box;
  return null;
}

/** Walk a chain of nested box types, e.g. ["mdia", "minf", "stbl"]. */
function descend(b: Uint8Array, from: number, to: number, path: string[]): Box | null {
  let start = from;
  let end = to;
  let box: Box | null = null;
  for (const type of path) {
    box = findBox(b, start, end, type);
    if (!box) return null;
    start = box.body;
    end = box.end;
  }
  return box;
}

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350, 0, 0, 0,
];

/** The AudioSpecificConfig fields an ADTS header needs. */
interface AudioConfig { objectType: number; freqIndex: number; channels: number }

/**
 * Pull the DecoderSpecificInfo out of an `esds` box.
 * Descriptors are tag + variable-length + payload; walking them properly beats
 * scanning for the tag byte, which collides with ordinary field values.
 */
function parseEsds(b: Uint8Array, body: number, end: number): AudioConfig | null {
  let o = body + 4; // version + flags
  const readLen = (): number => {
    let len = 0;
    for (let i = 0; i < 4 && o < end; i++) {
      const byte = b[o++];
      len = (len << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return len;
  };
  while (o < end) {
    const tag = b[o++];
    const len = readLen();
    const next = o + len;
    if (tag === 0x03) {
      // ES_Descriptor: ES_ID (2) + flags (1), with optional trailing fields.
      o += 2;
      const flags = b[o++];
      if (flags & 0x80) o += 2;            // streamDependenceFlag
      if (flags & 0x40) o += 1 + b[o];     // URL_Flag: length-prefixed string
      if (flags & 0x20) o += 2;            // OCRstreamFlag
      continue;                            // descend into DecoderConfigDescriptor
    }
    if (tag === 0x04) {
      // DecoderConfigDescriptor: objectTypeIndication + streamType +
      // bufferSizeDB(3) + maxBitrate(4) + avgBitrate(4) = 13 bytes.
      o += 13;
      continue;                            // descend into DecoderSpecificInfo
    }
    if (tag === 0x05) {
      if (o + 2 > end) return null;
      const b0 = b[o], b1 = b[o + 1];
      const objectType = b0 >> 3;
      const freqIndex = ((b0 & 0x07) << 1) | (b1 >> 7);
      const channels = (b1 >> 3) & 0x0f;
      if (!objectType || freqIndex > 12 || !channels) return null;
      return { objectType, freqIndex, channels };
    }
    if (len <= 0) return null;
    o = next;
  }
  return null;
}

function adtsHeader(cfg: AudioConfig, frameLength: number): Uint8Array {
  const h = new Uint8Array(7);
  const total = frameLength + 7;
  h[0] = 0xff;
  h[1] = 0xf1; // MPEG-4, Layer 0, no CRC
  h[2] = (((cfg.objectType - 1) & 0x03) << 6) | ((cfg.freqIndex & 0x0f) << 2) | ((cfg.channels >> 2) & 0x01);
  h[3] = ((cfg.channels & 0x03) << 6) | ((total >> 11) & 0x03);
  h[4] = (total >> 3) & 0xff;
  h[5] = ((total & 0x07) << 5) | 0x1f; // buffer fullness = 0x7ff (VBR)
  h[6] = 0xfc;
  return h;
}

export interface AacTrack {
  /** One entry per AAC access unit, each already wrapped in an ADTS header. */
  frames: Uint8Array[];
  /** Duration of each frame in seconds, parallel to `frames`. */
  durations: number[];
  sampleRate: number;
  channels: number;
}

/**
 * Demux the AAC audio track out of an MP4/M4A and re-wrap each access unit in
 * an ADTS header, producing a stream that can be cut on any frame boundary.
 *
 * Returns null when there is no AAC track, or when the tables needed to locate
 * the samples are missing or inconsistent.
 */
export function extractAacFromMp4(bytes: Uint8Array): AacTrack | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (!moov) return null;

  for (const trak of iterBoxes(bytes, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;

    const hdlr = descend(bytes, trak.body, trak.end, ["mdia", "hdlr"]);
    if (!hdlr || ascii(bytes, hdlr.body + 8, 4) !== "soun") continue;

    const mdhd = descend(bytes, trak.body, trak.end, ["mdia", "mdhd"]);
    const stbl = descend(bytes, trak.body, trak.end, ["mdia", "minf", "stbl"]);
    if (!mdhd || !stbl) continue;

    const mdhdVersion = bytes[mdhd.body];
    const timescale = mdhdVersion === 1
      ? view.getUint32(mdhd.body + 4 + 16, false)
      : view.getUint32(mdhd.body + 4 + 8, false);
    if (!timescale) continue;

    // --- Decoder config, from stsd → mp4a → esds ---
    const stsd = findBox(bytes, stbl.body, stbl.end, "stsd");
    if (!stsd) continue;
    const entry = findBox(bytes, stsd.body + 8, stsd.end, "mp4a");
    if (!entry) continue;
    // Audio sample entry: 16 bytes of box+reserved, then a version-dependent
    // SoundDescription before the child boxes begin.
    const soundVersion = view.getUint16(entry.body + 8, false);
    const childStart = entry.start + 36 + (soundVersion === 1 ? 16 : 0);
    const esds = findBox(bytes, childStart, entry.end, "esds");
    if (!esds) continue;
    const cfg = parseEsds(bytes, esds.body, esds.end);
    if (!cfg) continue;

    // --- Sample tables ---
    const stszBox = findBox(bytes, stbl.body, stbl.end, "stsz");
    const stscBox = findBox(bytes, stbl.body, stbl.end, "stsc");
    const stcoBox = findBox(bytes, stbl.body, stbl.end, "stco")
      ?? findBox(bytes, stbl.body, stbl.end, "co64");
    const sttsBox = findBox(bytes, stbl.body, stbl.end, "stts");
    if (!stszBox || !stscBox || !stcoBox || !sttsBox) continue;

    // stsz: uniform size, or one entry per sample.
    const uniformSize = view.getUint32(stszBox.body + 4, false);
    const sampleCount = view.getUint32(stszBox.body + 8, false);
    if (!sampleCount) continue;
    const sizes = new Array<number>(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      sizes[i] = uniformSize || view.getUint32(stszBox.body + 12 + i * 4, false);
    }

    // stco/co64: file offset of each chunk.
    const is64 = stcoBox.type === "co64";
    const chunkCount = view.getUint32(stcoBox.body + 4, false);
    const chunkOffsets = new Array<number>(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      const at = stcoBox.body + 8 + i * (is64 ? 8 : 4);
      chunkOffsets[i] = is64
        ? view.getUint32(at, false) * 4294967296 + view.getUint32(at + 4, false)
        : view.getUint32(at, false);
    }

    // stsc: runs of chunks that share a samples-per-chunk count.
    const stscCount = view.getUint32(stscBox.body + 4, false);
    const runs: { firstChunk: number; perChunk: number }[] = [];
    for (let i = 0; i < stscCount; i++) {
      const at = stscBox.body + 8 + i * 12;
      runs.push({
        firstChunk: view.getUint32(at, false),
        perChunk: view.getUint32(at + 4, false),
      });
    }
    if (runs.length === 0) continue;

    // stts: per-sample duration, in track timescale units.
    const sttsCount = view.getUint32(sttsBox.body + 4, false);
    const deltas: number[] = [];
    for (let i = 0; i < sttsCount && deltas.length < sampleCount; i++) {
      const at = sttsBox.body + 8 + i * 8;
      const runCount = view.getUint32(at, false);
      const delta = view.getUint32(at + 4, false);
      for (let k = 0; k < runCount && deltas.length < sampleCount; k++) deltas.push(delta);
    }
    while (deltas.length < sampleCount) deltas.push(deltas[deltas.length - 1] ?? 1024);

    // Walk chunks, laying samples out contiguously from each chunk offset.
    const frames: Uint8Array[] = [];
    const durations: number[] = [];
    let sampleIdx = 0;
    for (let c = 0; c < chunkCount && sampleIdx < sampleCount; c++) {
      let perChunk = runs[runs.length - 1].perChunk;
      for (let r = 0; r < runs.length; r++) {
        const nextFirst = r + 1 < runs.length ? runs[r + 1].firstChunk : Infinity;
        if (c + 1 >= runs[r].firstChunk && c + 1 < nextFirst) { perChunk = runs[r].perChunk; break; }
      }
      let offset = chunkOffsets[c];
      for (let s = 0; s < perChunk && sampleIdx < sampleCount; s++, sampleIdx++) {
        const size = sizes[sampleIdx];
        if (offset + size > bytes.length) return null; // truncated / mis-parsed
        const frame = new Uint8Array(7 + size);
        frame.set(adtsHeader(cfg, size), 0);
        frame.set(bytes.subarray(offset, offset + size), 7);
        frames.push(frame);
        durations.push(deltas[sampleIdx] / timescale);
        offset += size;
      }
    }
    if (frames.length === 0) return null;
    return {
      frames,
      durations,
      sampleRate: AAC_SAMPLE_RATES[cfg.freqIndex] || 0,
      channels: cfg.channels,
    };
  }
  return null;
}

// ── ADTS (raw AAC) ───────────────────────────────────────────────────────────

/** Byte offset of the first frame, skipping an ID3v2 tag if one is present. */
function afterId3(bytes: Uint8Array): number {
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/**
 * ADTS and MPEG audio share an 11-bit sync word, so the two are only told apart
 * by the layer field that follows it: MP3 is Layer III (`01`), ADTS is always
 * `00`. Masking with 0xF6 tests sync + layer together — without it, every AAC
 * stream this pipeline demuxes out of an MP4 sniffs as an MP3.
 */
export function isLikelyAdts(bytes: Uint8Array): boolean {
  const o = afterId3(bytes);
  return bytes.length >= o + 2 && bytes[o] === 0xff && (bytes[o + 1] & 0xf6) === 0xf0;
}

/**
 * Walk a raw ADTS stream into per-frame slices. Each frame already carries its
 * own header, so the result can be regrouped by `chunkAdtsByDuration` without
 * any re-framing — the same shape `extractAacFromMp4` produces.
 */
export function parseAdtsTrack(bytes: Uint8Array): AacTrack | null {
  const frames: Uint8Array[] = [];
  const durations: number[] = [];
  let sampleRate = 0;
  let channels = 0;

  let i = afterId3(bytes);
  while (i + 7 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xf6) !== 0xf0) { i++; continue; }
    const freqIndex = (bytes[i + 2] >> 2) & 0x0f;
    const sr = AAC_SAMPLE_RATES[freqIndex] || 0;
    const frameLength = ((bytes[i + 3] & 0x03) << 11) | (bytes[i + 4] << 3) | ((bytes[i + 5] >> 5) & 0x07);
    if (!sr || frameLength < 7 || i + frameLength > bytes.length) { i++; continue; }
    // Each raw data block is 1024 samples; the count is stored minus one.
    const blocks = (bytes[i + 6] & 0x03) + 1;
    frames.push(bytes.subarray(i, i + frameLength));
    durations.push((1024 * blocks) / sr);
    sampleRate = sr;
    channels = ((bytes[i + 2] & 0x01) << 2) | ((bytes[i + 3] >> 6) & 0x03);
    i += frameLength;
  }

  return frames.length > 0 ? { frames, durations, sampleRate, channels } : null;
}

/** Concatenate demuxed ADTS frames back into one continuous stream. */
export function joinAdtsFrames(track: AacTrack): Uint8Array<ArrayBuffer> {
  const total = track.frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of track.frames) { out.set(f, o); o += f.length; }
  return out;
}

/** Group ADTS frames into ~`targetSec` runs. Each run is a playable AAC stream. */
export function chunkAdtsByDuration(track: AacTrack, targetSec: number): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  let bucket: Uint8Array[] = [];
  let bucketSec = 0;
  let cumSec = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const total = bucket.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const f of bucket) { out.set(f, o); o += f.length; }
    chunks.push({ bytes: out, offsetSec: cumSec, durSec: bucketSec });
    cumSec += bucketSec;
    bucket = [];
    bucketSec = 0;
  };

  for (let i = 0; i < track.frames.length; i++) {
    bucket.push(track.frames[i]);
    bucketSec += track.durations[i] ?? 0;
    if (bucketSec >= targetSec) flush();
  }
  flush();
  return chunks;
}

// ── Planner ──────────────────────────────────────────────────────────────────

export type AsrPayloadStrategy =
  | "single"
  | "mp3-chunks"
  | "wav-chunks"
  | "mp4-adts-chunks"
  | "adts-chunks";

export interface AsrPayloadPlan {
  chunks: AudioChunk[];
  strategy: AsrPayloadStrategy;
  /** Set when nothing usable could be produced. Empty `chunks` accompanies it. */
  skipReason?: string;
}

/**
 * Best-effort container name for logs and skip reasons.
 *
 * Structural magic is checked before any content-type hint. Staged audio is
 * routinely mislabelled — the pipeline defaults `audioContentType` to
 * "audio/mp4" whenever storage doesn't report one — and picking a chunker off a
 * wrong label wastes the engine on a stream it can't parse.
 */
export function containerLabel(bytes: Uint8Array, contentType?: string): string {
  if (isLikelyWav(bytes)) return "wav";
  if (isLikelyMp4(bytes)) return "mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return "ogg";
  // Before the MP3 checks: ADTS shares MPEG audio's sync word, and a
  // content-type hint of "audio/mpeg" is enough for isLikelyMp3 to claim it.
  if (isLikelyAdts(bytes)) return "adts";
  if (isLikelyMp3(bytes, contentType)) return "mp3";
  if (isLikelyWav(bytes, contentType)) return "wav";
  if (isLikelyMp4(bytes, contentType)) return "mp4";
  return contentType?.split(";")[0]?.trim() || "unknown";
}

/**
 * Decide what to send a size-limited ASR endpoint.
 *
 * Payloads within `maxBytes` go as-is. Oversize payloads are split on frame
 * boundaries when the container allows it; otherwise the caller gets a named
 * reason rather than a silent skip.
 */
export function planAsrPayloads(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string | undefined,
  maxBytes: number,
  targetChunkSec = 60,
): AsrPayloadPlan {
  if (bytes.length === 0) {
    return { chunks: [], strategy: "single", skipReason: "empty-audio" };
  }
  if (bytes.length <= maxBytes) {
    return { chunks: [{ bytes, offsetSec: 0, durSec: 0 }], strategy: "single" };
  }

  const label = containerLabel(bytes, contentType);

  if (label === "mp3") {
    const chunks = chunkMp3ByDuration(bytes, targetChunkSec);
    return chunks.length > 0
      ? { chunks, strategy: "mp3-chunks" }
      : { chunks: [], strategy: "mp3-chunks", skipReason: "mp3-chunker-found-no-frames" };
  }

  if (label === "wav") {
    const chunks = chunkWavByDuration(bytes, targetChunkSec);
    return chunks.length > 0
      ? { chunks, strategy: "wav-chunks" }
      : { chunks: [], strategy: "wav-chunks", skipReason: "wav-header-unreadable" };
  }

  if (label === "mp4") {
    const track = extractAacFromMp4(bytes);
    if (!track) {
      return { chunks: [], strategy: "mp4-adts-chunks", skipReason: "mp4-no-aac-track" };
    }
    const chunks = chunkAdtsByDuration(track, targetChunkSec);
    return chunks.length > 0
      ? { chunks, strategy: "mp4-adts-chunks" }
      : { chunks: [], strategy: "mp4-adts-chunks", skipReason: "mp4-demux-produced-no-frames" };
  }

  if (label === "adts") {
    const track = parseAdtsTrack(bytes);
    const chunks = track ? chunkAdtsByDuration(track, targetChunkSec) : [];
    return chunks.length > 0
      ? { chunks, strategy: "adts-chunks" }
      : { chunks: [], strategy: "adts-chunks", skipReason: "adts-stream-unreadable" };
  }

  return { chunks: [], strategy: "single", skipReason: `unsupported-container:${label}` };
}

// ── Upload naming ────────────────────────────────────────────────────────────

export interface AsrUpload {
  /** File name to put in the multipart part. */
  filename: string;
  /** MIME type to declare for that part. */
  mimeType: string;
  /** Container the bytes were actually sniffed as. */
  container: string;
}

const UPLOAD_BY_CONTAINER: Record<string, { ext: string; mime: string }> = {
  mp3:  { ext: "mp3",  mime: "audio/mpeg" },
  wav:  { ext: "wav",  mime: "audio/wav" },
  mp4:  { ext: "m4a",  mime: "audio/mp4" },
  adts: { ext: "aac",  mime: "audio/aac" },
  webm: { ext: "webm", mime: "audio/webm" },
  ogg:  { ext: "ogg",  mime: "audio/ogg" },
};

/**
 * Name a multipart audio part after what the bytes actually are.
 *
 * Every ASR leg used to hardcode `audio.mp3` with whatever content type storage
 * happened to report — which for TikTok/YouTube audio is an MP4/AAC payload
 * announced as an MP3. Engines that sniff the bytes shrug this off; engines that
 * dispatch on the file extension hand the container to the wrong decoder and
 * return an empty transcript with a 200, which is indistinguishable from silence.
 *
 * Falls back to the caller's declared content type for containers we can't
 * identify, rather than guessing an extension that may be wrong in a new way.
 */
export function asrUpload(
  bytes: Uint8Array,
  contentType?: string,
  stem = "audio",
): AsrUpload {
  const container = containerLabel(bytes, contentType);
  const known = UPLOAD_BY_CONTAINER[container];
  if (known) {
    return { filename: `${stem}.${known.ext}`, mimeType: known.mime, container };
  }
  return {
    filename: `${stem}.bin`,
    mimeType: contentType?.split(";")[0]?.trim() || "application/octet-stream",
    container,
  };
}
