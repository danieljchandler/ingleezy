import { describe, it, expect } from "vitest";
import {
  asrUpload,
  chunkAdtsByDuration,
  chunkMp3ByDuration,
  chunkWavByDuration,
  containerLabel,
  extractAacFromMp4,
  isLikelyAdts,
  isLikelyMp3,
  isLikelyMp4,
  isLikelyWav,
  joinAdtsFrames,
  parseAdtsTrack,
  parseWavHeader,
  planAsrPayloads,
} from "../../supabase/functions/_shared/audioChunk";

// ── Fixture builders ─────────────────────────────────────────────────────────

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
};
const u16 = (n: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
};
const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/**
 * MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding.
 * Frame size = floor(1152/8 * 128000 / 44100) = 417 bytes; 26.12 ms each.
 */
const MP3_FRAME_BYTES = 417;
const MP3_FRAME_MS = (1152 / 44100) * 1000;
function makeMp3(frameCount: number, withId3 = false): Uint8Array<ArrayBuffer> {
  const frames: Uint8Array[] = [];
  if (withId3) {
    // ID3v2 header, 10 bytes + a 20-byte synchsafe-sized payload.
    const id3 = new Uint8Array(30);
    id3.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20]);
    frames.push(id3);
  }
  for (let i = 0; i < frameCount; i++) {
    const f = new Uint8Array(MP3_FRAME_BYTES);
    f[0] = 0xff;
    f[1] = 0xfb;           // MPEG-1, Layer III, no CRC
    f[2] = (9 << 4) | 0;   // bitrate idx 9 (128k), samplerate idx 0 (44.1k), no pad
    f[3] = 0;
    frames.push(f);
  }
  return concat(frames);
}

/** 16 kHz mono 16-bit PCM WAV holding `samples` frames. */
function makeWav(samples: number, sampleRate = 16000, channels = 1): Uint8Array<ArrayBuffer> {
  const blockAlign = channels * 2;
  const dataLength = samples * blockAlign;
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
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);
  const body = new Uint8Array(dataLength);
  for (let i = 0; i < dataLength; i++) body[i] = i & 0xff;
  return concat([header, body]);
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const out = new Uint8Array(8 + body.length);
  out.set(u32(out.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}
const fullBox = (type: string, ...payload: Uint8Array[]) =>
  box(type, new Uint8Array(4), ...payload);

/** A descriptor: tag byte + single-byte length + payload (payload < 128 bytes). */
const desc = (tag: number, payload: Uint8Array) =>
  concat([new Uint8Array([tag, payload.length]), payload]);

const MP4_TIMESCALE = 16000;
const MP4_SAMPLE_DELTA = 1024;          // AAC access unit
const MP4_FRAME_SEC = MP4_SAMPLE_DELTA / MP4_TIMESCALE; // 0.064s

/**
 * A minimal but structurally valid MP4 with one AAC-LC audio track:
 * ftyp + moov(trak(mdia(mdhd, hdlr, minf(stbl(stsd(mp4a(esds)), stts, stsc, stsz, stco))))) + mdat.
 */
function makeMp4(frameCount: number, frameSize = 64, opts: { audioHandler?: string } = {}): Uint8Array<ArrayBuffer> {
  // AudioSpecificConfig: AAC-LC (2), freqIndex 8 (16 kHz), 1 channel.
  const asc = new Uint8Array([(2 << 3) | (8 >> 1), ((8 & 1) << 7) | (1 << 3)]);
  const dsi = desc(0x05, asc);
  const dcd = desc(0x04, concat([
    new Uint8Array([0x40, 0x15]),        // AAC, audio stream
    new Uint8Array(3),                   // bufferSizeDB
    u32(0), u32(0),                      // max/avg bitrate
    dsi,
  ]));
  const esd = desc(0x03, concat([u16(1), new Uint8Array([0]), dcd]));
  const esds = fullBox("esds", esd);

  const mp4a = box("mp4a",
    new Uint8Array(6), u16(1),           // reserved + data_reference_index
    u16(0), u16(0), u32(0),              // version, revision, vendor
    u16(1), u16(16), u16(0), u16(0),     // channels, sample size, pre_defined, reserved
    u32(MP4_TIMESCALE << 16),            // 16.16 sample rate
    esds,
  );

  const stsd = fullBox("stsd", u32(1), mp4a);
  const stts = fullBox("stts", u32(1), u32(frameCount), u32(MP4_SAMPLE_DELTA));
  // One chunk holding every sample keeps the offset table to a single entry.
  const stsc = fullBox("stsc", u32(1), u32(1), u32(frameCount), u32(1));
  const stsz = fullBox("stsz", u32(frameSize), u32(frameCount));
  const stco = fullBox("stco", u32(1), u32(0)); // patched below

  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const minf = box("minf", stbl);
  const mdhd = fullBox("mdhd", u32(0), u32(0), u32(MP4_TIMESCALE), u32(frameCount * MP4_SAMPLE_DELTA), u16(0), u16(0));
  const hdlr = fullBox("hdlr", u32(0), new Uint8Array(
    [...(opts.audioHandler ?? "soun")].map((c) => c.charCodeAt(0)),
  ), new Uint8Array(12), new Uint8Array([0]));
  const mdia = box("mdia", mdhd, hdlr, minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);

  const media = new Uint8Array(frameCount * frameSize);
  for (let i = 0; i < media.length; i++) media[i] = (i * 7) & 0xff;
  const mdat = box("mdat", media);

  const ftyp = box("ftyp", new Uint8Array([...("isom" + "\0\0\0\0" + "isom")].map((c) => c.charCodeAt(0))));
  const file = concat([ftyp, moov, mdat]);

  // Patch the chunk offset now that the layout is known: mdat's payload starts
  // 8 bytes into the mdat box.
  const mdatStart = ftyp.length + moov.length;
  // findAscii returns the position of the box *type*; the offset table sits
  // 4 bytes later (past the type) + 4 (version/flags) + 4 (entry count).
  const stcoTypePos = findAscii(file, "stco");
  new DataView(file.buffer).setUint32(stcoTypePos + 12, mdatStart + 8, false);
  return file;
}

function findAscii(buf: Uint8Array, needle: string): number {
  const codes = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + codes.length <= buf.length; i++) {
    for (let k = 0; k < codes.length; k++) if (buf[i + k] !== codes[k]) continue outer;
    return i;
  }
  return -1;
}

// ── Detection ────────────────────────────────────────────────────────────────

describe("container detection", () => {
  it("detects MP3 by content type, ID3 tag and frame sync", () => {
    expect(isLikelyMp3(new Uint8Array([0, 0, 0]), "audio/mpeg")).toBe(true);
    expect(isLikelyMp3(makeMp3(1, true))).toBe(true);
    expect(isLikelyMp3(makeMp3(1))).toBe(true);
    expect(isLikelyMp3(makeWav(10))).toBe(false);
  });

  it("detects WAV by RIFF/WAVE magic", () => {
    expect(isLikelyWav(makeWav(10))).toBe(true);
    expect(isLikelyWav(makeMp3(1))).toBe(false);
  });

  it("detects MP4 by the ftyp signature", () => {
    expect(isLikelyMp4(makeMp4(2))).toBe(true);
    expect(isLikelyMp4(makeWav(10))).toBe(false);
  });

  it("labels webm and ogg so the skip reason names them", () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    const ogg = new Uint8Array([...("OggS")].map((c) => c.charCodeAt(0)));
    expect(containerLabel(webm)).toBe("webm");
    expect(containerLabel(ogg)).toBe("ogg");
    expect(containerLabel(new Uint8Array([1, 2, 3]))).toBe("unknown");
  });

  it("trusts magic bytes over a wrong content type", () => {
    // The pipeline defaults audioContentType to "audio/mp4" when storage
    // reports none, so mislabelled staged audio is the normal case.
    expect(containerLabel(makeWav(10), "audio/mp4")).toBe("wav");
    expect(containerLabel(makeMp4(2), "audio/mpeg")).toBe("mp4");
    expect(containerLabel(makeMp3(2), "audio/mp4")).toBe("mp3");
  });

  it("falls back to the content type when there is no usable magic", () => {
    expect(containerLabel(new Uint8Array(64), "audio/mpeg")).toBe("mp3");
    expect(containerLabel(new Uint8Array(64), "audio/wav")).toBe("wav");
  });
});

// ── MP3 ──────────────────────────────────────────────────────────────────────

describe("chunkMp3ByDuration", () => {
  it("splits on frame boundaries with cumulative offsets", () => {
    const framesPerSec = 1000 / MP3_FRAME_MS; // ~38.28
    const mp3 = makeMp3(Math.round(framesPerSec * 3));
    const chunks = chunkMp3ByDuration(mp3, 1);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // Every chunk is a whole number of frames.
    for (const c of chunks) expect(c.bytes.length % MP3_FRAME_BYTES).toBe(0);
    // Offsets accumulate the preceding durations.
    let cum = 0;
    for (const c of chunks) {
      expect(c.offsetSec).toBeCloseTo(cum, 5);
      cum += c.durSec;
    }
    // No audio is lost.
    expect(chunks.reduce((n, c) => n + c.bytes.length, 0)).toBe(mp3.length);
  });

  it("skips the ID3v2 tag rather than emitting it as audio", () => {
    const chunks = chunkMp3ByDuration(makeMp3(40, true), 1);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].bytes[0]).toBe(0xff);
  });

  it("emits a single short trailing chunk", () => {
    const chunks = chunkMp3ByDuration(makeMp3(5), 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].durSec).toBeCloseTo((5 * MP3_FRAME_MS) / 1000, 3);
  });

  it("returns nothing for data with no frames", () => {
    expect(chunkMp3ByDuration(new Uint8Array(500), 1)).toEqual([]);
  });
});

// ── WAV ──────────────────────────────────────────────────────────────────────

describe("WAV parsing and chunking", () => {
  it("reads the fmt chunk and locates the data payload", () => {
    const info = parseWavHeader(makeWav(1600));
    expect(info).toMatchObject({
      sampleRate: 16000, channels: 1, bitsPerSample: 16, blockAlign: 2,
      dataOffset: 44, dataLength: 3200,
    });
  });

  it("rejects non-PCM and non-WAV input", () => {
    expect(parseWavHeader(makeMp3(1))).toBeNull();
    const compressed = makeWav(10);
    new DataView(compressed.buffer).setUint16(20, 0x0011, true); // IMA ADPCM
    expect(parseWavHeader(compressed)).toBeNull();
  });

  it("clamps a data length that overruns the buffer", () => {
    const wav = makeWav(100);
    new DataView(wav.buffer).setUint32(40, 999999, true);
    expect(parseWavHeader(wav)!.dataLength).toBe(wav.length - 44);
  });

  it("produces self-contained WAV chunks whose headers describe them", () => {
    const wav = makeWav(16000 * 3); // 3 seconds
    const chunks = chunkWavByDuration(wav, 1);
    expect(chunks).toHaveLength(3);

    for (const c of chunks) {
      const info = parseWavHeader(c.bytes)!;
      expect(info.sampleRate).toBe(16000);
      expect(info.channels).toBe(1);
      // The declared payload length matches the bytes actually present.
      expect(info.dataLength).toBe(c.bytes.length - 44);
      expect(c.durSec).toBeCloseTo(1, 5);
    }
    expect(chunks.map((c) => c.offsetSec)).toEqual([0, 1, 2]);
    // Sample data is preserved end to end.
    const rejoined = concat(chunks.map((c) => c.bytes.subarray(44)));
    expect(rejoined).toEqual(wav.subarray(44));
  });

  it("keeps chunks aligned to whole frames for stereo", () => {
    const chunks = chunkWavByDuration(makeWav(44100 * 2, 44100, 2), 1);
    for (const c of chunks) expect((c.bytes.length - 44) % 4).toBe(0);
  });

  it("returns nothing when the header is unreadable", () => {
    expect(chunkWavByDuration(new Uint8Array(100), 1)).toEqual([]);
  });
});

// ── MP4 → ADTS ───────────────────────────────────────────────────────────────

describe("extractAacFromMp4", () => {
  it("demuxes every sample and wraps it in a valid ADTS header", () => {
    const track = extractAacFromMp4(makeMp4(10, 64))!;
    expect(track).not.toBeNull();
    expect(track.frames).toHaveLength(10);
    expect(track.sampleRate).toBe(16000);
    expect(track.channels).toBe(1);

    for (const frame of track.frames) {
      expect(frame.length).toBe(7 + 64);
      // Syncword 0xFFF, MPEG-4, Layer 0, no CRC.
      expect(frame[0]).toBe(0xff);
      expect(frame[1] & 0xf6).toBe(0xf0);
      expect(frame[1] & 0x01).toBe(1);
      // Profile = objectType - 1 = 1 (AAC-LC), freqIndex 8, 1 channel.
      expect((frame[2] >> 6) & 0x03).toBe(1);
      expect((frame[2] >> 2) & 0x0f).toBe(8);
      const channels = (((frame[2] & 0x01) << 2) | ((frame[3] >> 6) & 0x03));
      expect(channels).toBe(1);
      // frame_length covers header + payload.
      const declared = ((frame[3] & 0x03) << 11) | (frame[4] << 3) | ((frame[5] >> 5) & 0x07);
      expect(declared).toBe(frame.length);
    }
  });

  it("reports per-frame duration from stts and the media timescale", () => {
    const track = extractAacFromMp4(makeMp4(4))!;
    for (const d of track.durations) expect(d).toBeCloseTo(MP4_FRAME_SEC, 6);
  });

  it("copies the real sample bytes, not zeroes", () => {
    const track = extractAacFromMp4(makeMp4(3, 16))!;
    const payload = track.frames[0].subarray(7);
    expect([...payload]).toEqual(Array.from({ length: 16 }, (_, i) => (i * 7) & 0xff));
  });

  it("returns null when there is no audio track", () => {
    expect(extractAacFromMp4(makeMp4(4, 64, { audioHandler: "vide" }))).toBeNull();
  });

  it("returns null for input that isn't an MP4", () => {
    expect(extractAacFromMp4(makeWav(100))).toBeNull();
    expect(extractAacFromMp4(new Uint8Array(0))).toBeNull();
  });
});

describe("chunkAdtsByDuration", () => {
  it("groups frames into runs of roughly the target duration", () => {
    // 0.064s per frame → ~16 frames make a second.
    const track = extractAacFromMp4(makeMp4(48, 32))!;
    const chunks = chunkAdtsByDuration(track, 1);

    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.durSec).toBeCloseTo(1.024, 3);
    expect(chunks[0].offsetSec).toBeCloseTo(0, 5);
    expect(chunks[1].offsetSec).toBeCloseTo(1.024, 3);
    // Nothing is dropped: every frame ends up in exactly one chunk.
    const total = chunks.reduce((n, c) => n + c.bytes.length, 0);
    expect(total).toBe(track.frames.reduce((n, f) => n + f.length, 0));
  });

  it("keeps a trailing partial chunk", () => {
    const track = extractAacFromMp4(makeMp4(20, 32))!;
    const chunks = chunkAdtsByDuration(track, 1);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].durSec).toBeLessThan(1);
  });

  it("starts each chunk on a frame boundary", () => {
    const chunks = chunkAdtsByDuration(extractAacFromMp4(makeMp4(40, 32))!, 1);
    for (const c of chunks) expect(c.bytes[0]).toBe(0xff);
  });
});

// ── Planner ──────────────────────────────────────────────────────────────────

describe("planAsrPayloads", () => {
  it("sends anything within the size limit as-is", () => {
    const wav = makeWav(100);
    const plan = planAsrPayloads(wav, "audio/wav", 1024 * 1024);
    expect(plan.strategy).toBe("single");
    expect(plan.skipReason).toBeUndefined();
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].bytes).toBe(wav);
  });

  it("chunks oversize MP3", () => {
    const plan = planAsrPayloads(makeMp3(200), "audio/mpeg", 1024, 1);
    expect(plan.strategy).toBe("mp3-chunks");
    expect(plan.skipReason).toBeUndefined();
    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it("chunks oversize WAV", () => {
    const plan = planAsrPayloads(makeWav(16000 * 4), "audio/wav", 1024, 1);
    expect(plan.strategy).toBe("wav-chunks");
    expect(plan.chunks).toHaveLength(4);
  });

  it("chunks oversize MP4 — the case that used to be skipped outright", () => {
    const plan = planAsrPayloads(makeMp4(64, 256), "video/mp4", 1024, 1);
    expect(plan.strategy).toBe("mp4-adts-chunks");
    expect(plan.skipReason).toBeUndefined();
    expect(plan.chunks.length).toBeGreaterThan(1);
    for (const c of plan.chunks) expect(c.bytes[0]).toBe(0xff);
  });

  it("names the container it cannot split", () => {
    const webm = new Uint8Array(2048);
    webm.set([0x1a, 0x45, 0xdf, 0xa3]);
    const plan = planAsrPayloads(webm, "audio/webm", 1024);
    expect(plan.chunks).toEqual([]);
    expect(plan.skipReason).toBe("unsupported-container:webm");
  });

  it("reports an MP4 with no usable audio track rather than skipping silently", () => {
    const videoOnly = makeMp4(64, 256, { audioHandler: "vide" });
    const plan = planAsrPayloads(videoOnly, "video/mp4", 1024);
    expect(plan.skipReason).toBe("mp4-no-aac-track");
  });

  it("reports MP3-labelled data that contains no frames", () => {
    const plan = planAsrPayloads(new Uint8Array(2048), "audio/mpeg", 1024);
    expect(plan.skipReason).toBe("mp3-chunker-found-no-frames");
  });

  it("rejects empty audio", () => {
    expect(planAsrPayloads(new Uint8Array(0), "audio/mpeg", 1024).skipReason).toBe("empty-audio");
  });

  it("chunks a raw ADTS stream", () => {
    const plan = planAsrPayloads(makeAdts(64, 256), "audio/aac", 1024, 1);
    expect(plan.strategy).toBe("adts-chunks");
    expect(plan.skipReason).toBeUndefined();
    expect(plan.chunks.length).toBeGreaterThan(1);
  });
});

// ── ADTS ─────────────────────────────────────────────────────────────────────

/** AAC-LC, 16 kHz, mono — the same configuration `makeMp4` demuxes to. */
function makeAdts(frameCount: number, payloadSize = 32): Uint8Array<ArrayBuffer> {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < frameCount; i++) {
    const total = 7 + payloadSize;
    const f = new Uint8Array(total);
    f[0] = 0xff;
    f[1] = 0xf1;                                  // MPEG-4, Layer 0, no CRC
    f[2] = ((2 - 1) << 6) | (8 << 2) | 0;         // AAC-LC, freqIndex 8, channels>>2
    f[3] = (1 << 6) | ((total >> 11) & 0x03);     // 1 channel
    f[4] = (total >> 3) & 0xff;
    f[5] = ((total & 0x07) << 5) | 0x1f;
    f[6] = 0xfc;
    for (let k = 7; k < total; k++) f[k] = (i + k) & 0xff;
    frames.push(f);
  }
  return concat(frames);
}

describe("ADTS detection and parsing", () => {
  it("tells ADTS apart from MPEG audio by the layer bits", () => {
    expect(isLikelyAdts(makeAdts(2))).toBe(true);
    // An MP3 frame shares the 11-bit sync word but sets Layer III.
    expect(isLikelyAdts(makeMp3(2))).toBe(false);
    expect(isLikelyAdts(makeWav(10))).toBe(false);
  });

  it("labels ADTS as itself even when announced as audio/mpeg", () => {
    // Demuxed AAC used to sniff as MP3 and get handed to the MP3 chunker.
    expect(containerLabel(makeAdts(4), "audio/mpeg")).toBe("adts");
  });

  it("walks frames with their durations", () => {
    const track = parseAdtsTrack(makeAdts(10, 32))!;
    expect(track.frames).toHaveLength(10);
    expect(track.sampleRate).toBe(16000);
    expect(track.channels).toBe(1);
    for (const d of track.durations) expect(d).toBeCloseTo(1024 / 16000, 6);
  });

  it("returns null for bytes that are not an ADTS stream", () => {
    expect(parseAdtsTrack(makeWav(10))).toBeNull();
    expect(parseAdtsTrack(new Uint8Array(64))).toBeNull();
  });

  it("round-trips: an MP4's AAC track joins and re-parses to the same frames", () => {
    const demuxed = extractAacFromMp4(makeMp4(12, 48))!;
    const reparsed = parseAdtsTrack(joinAdtsFrames(demuxed))!;
    expect(reparsed.frames).toHaveLength(demuxed.frames.length);
    expect(reparsed.sampleRate).toBe(demuxed.sampleRate);
    expect(reparsed.channels).toBe(demuxed.channels);
  });
});

// ── Upload naming ────────────────────────────────────────────────────────────

describe("asrUpload", () => {
  it("names each container after what the bytes actually are", () => {
    expect(asrUpload(makeMp3(2))).toMatchObject({ filename: "audio.mp3", mimeType: "audio/mpeg" });
    expect(asrUpload(makeWav(10))).toMatchObject({ filename: "audio.wav", mimeType: "audio/wav" });
    expect(asrUpload(makeMp4(2))).toMatchObject({ filename: "audio.m4a", mimeType: "audio/mp4" });
    expect(asrUpload(makeAdts(2))).toMatchObject({ filename: "audio.aac", mimeType: "audio/aac" });
  });

  it("ignores a content type that contradicts the bytes", () => {
    // This is the Munsit failure: MP4 audio announced (and named) as MP3, which
    // Munsit answered with 200 and an empty transcription.
    const upload = asrUpload(makeMp4(2), "audio/mpeg");
    expect(upload.filename).toBe("audio.m4a");
    expect(upload.mimeType).toBe("audio/mp4");
    expect(upload.container).toBe("mp4");
  });

  it("falls back to the declared type for containers it cannot identify", () => {
    const upload = asrUpload(new Uint8Array([1, 2, 3]), "audio/x-weird; codecs=zzz");
    expect(upload.filename).toBe("audio.bin");
    expect(upload.mimeType).toBe("audio/x-weird");
  });

  it("falls back to octet-stream when nothing is declared either", () => {
    expect(asrUpload(new Uint8Array([1, 2, 3]))).toMatchObject({
      filename: "audio.bin",
      mimeType: "application/octet-stream",
    });
  });

  it("honours a custom stem", () => {
    expect(asrUpload(makeMp3(2), undefined, "chunk-3").filename).toBe("chunk-3.mp3");
  });
});
