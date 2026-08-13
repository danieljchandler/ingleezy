import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayableJingleAudio, createPlayableJingleAudioFromUrl } from "./jingleAudio";

/**
 * Turning whatever the jingle generator returned into something a browser will
 * play.
 *
 * The generator's answer has arrived in five different shapes over time —
 * base64 in a JSON envelope, a Blob, an ArrayBuffer, a typed-array view, and a
 * binary string — and the declared MIME type has been wrong often enough that
 * this module sniffs the bytes instead of trusting it. A wrong container label
 * does not fail loudly: `<audio>` simply refuses to play and the learner sees a
 * dead control.
 *
 * The corruption check exists for a real incident. An earlier generation
 * returned raw audio bytes through a JSON transport, which coerced them through
 * UTF-8 and replaced every unmappable byte with U+FFFD — producing a file full
 * of `ef bf bd` that plays as white noise. Those clips are still in the
 * database, so the check has to keep catching them.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

const toBase64 = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data));

/** A minimal RIFF/WAVE header. */
const WAV = bytes(
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, // WAVE
  0x66, 0x6d, 0x74, 0x20, // fmt
);

/** An MP3 with an ID3 tag on the front, which is how most encoders write one. */
const MP3_ID3 = bytes(0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00);

/** A bare MPEG frame header: sync bits, MPEG-1 Layer III, valid bitrate. */
const MP3_FRAME = bytes(0xff, 0xfb, 0x90, 0x00, 0x00, 0x00);

const OGG = bytes(0x4f, 0x67, 0x67, 0x53, 0x00, 0x02);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00);
const MP4 = bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20);

/** Enough U+FFFD sequences to trip the corruption guard. */
const corrupted = (count: number) => {
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) out.set([0xef, 0xbf, 0xbd], i * 3);
  return out;
};

/**
 * A Blob stand-in.
 *
 * jsdom's Blob has no `arrayBuffer()`, and the module branches on
 * `instanceof Blob`, so the prototype has to be right as well as the method.
 */
function blobOf(data: Uint8Array, type = ""): Blob {
  const blob = new Blob([data as unknown as BlobPart], { type });
  Object.defineProperty(blob, "arrayBuffer", {
    configurable: true,
    value: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  });
  return blob;
}

/** Read a produced Blob back, since jsdom will not do it for us either. */
function readBack(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the base64 envelope", () => {
  it("decodes the audio and keeps the extension it was told", async () => {
    const result = await createPlayableJingleAudio({
      audioBase64: toBase64(WAV),
      mimeType: "audio/wav",
      extension: "wav",
    });

    expect(result.mimeType).toBe("audio/wav");
    expect(result.extension).toBe("wav");
    expect(await readBack(result.blob)).toEqual(WAV);
  });

  it("sniffs the real format when the envelope lies about it", async () => {
    // The generator has declared mpeg for PCM more than once. Believing it
    // gives `<audio>` a WAV labelled as MP3, which simply will not play.
    const result = await createPlayableJingleAudio({
      audioBase64: toBase64(WAV),
      mimeType: "audio/mpeg",
    });

    expect(result.mimeType).toBe("audio/wav");
    expect(result.extension).toBe("wav");
  });

  it("derives an extension when the envelope omits one", async () => {
    const result = await createPlayableJingleAudio({
      audioBase64: toBase64(MP3_ID3),
      mimeType: "audio/mpeg",
    });

    expect(result.extension).toBe("mp3");
  });
});

describe("sniffing the container", () => {
  const cases: Array<[string, Uint8Array, string, string]> = [
    ["a RIFF/WAVE header", WAV, "audio/wav", "wav"],
    ["an ID3-tagged MP3", MP3_ID3, "audio/mpeg", "mp3"],
    ["a bare MPEG frame", MP3_FRAME, "audio/mpeg", "mp3"],
    ["an Ogg page", OGG, "audio/ogg", "ogg"],
    ["a Matroska/WebM header", WEBM, "audio/webm", "webm"],
    ["an MP4 ftyp box", MP4, "audio/mp4", "m4a"],
  ];

  for (const [label, data, mime, extension] of cases) {
    it(`recognises ${label}`, async () => {
      const result = await createPlayableJingleAudio(blobOf(data));

      expect(result.mimeType).toBe(mime);
      expect(result.extension).toBe(extension);
    });
  }

  it("falls back to the declared type when the bytes say nothing", async () => {
    const result = await createPlayableJingleAudio(blobOf(bytes(1, 2, 3, 4), "audio/flac"));

    expect(result.mimeType).toBe("audio/flac");
  });

  it("strips codec parameters off a declared type", async () => {
    const result = await createPlayableJingleAudio(
      blobOf(bytes(1, 2, 3, 4), "audio/ogg; codecs=opus"),
    );

    // A type with parameters is not what `extensionForMime` or `<audio>`
    // expects to match on.
    expect(result.mimeType).toBe("audio/ogg");
    expect(result.extension).toBe("ogg");
  });

  it("refuses to pass raw PCM through as playable", async () => {
    // Headerless L16 is what the music model actually returns, and no browser
    // will play it — labelling it wav at least routes it somewhere that adds a
    // header downstream.
    const result = await createPlayableJingleAudio(
      blobOf(bytes(1, 2, 3, 4), "audio/L16;rate=48000"),
    );

    expect(result.mimeType).toBe("audio/wav");
  });

  it("ignores a declared type that is not audio at all", async () => {
    const result = await createPlayableJingleAudio(blobOf(bytes(1, 2, 3, 4), "application/json"));

    expect(result.mimeType).toBe("audio/wav");
  });

  it("does not mistake an invalid MPEG frame for an MP3", async () => {
    // Sync bits present but the bitrate nibble is the reserved 0xf — the shape
    // random bytes take when they happen to start with 0xff.
    const result = await createPlayableJingleAudio(blobOf(bytes(0xff, 0xfb, 0xf0, 0x00), ""));

    expect(result.mimeType).not.toBe("audio/mpeg");
  });
});

describe("accepting whatever shape the caller has", () => {
  it("takes an ArrayBuffer", async () => {
    const result = await createPlayableJingleAudio(WAV.buffer.slice(0));

    expect(result.mimeType).toBe("audio/wav");
  });

  it("takes a typed-array view without dragging in the rest of its buffer", async () => {
    const backing = new Uint8Array(64);
    backing.set(WAV, 16);
    const view = new Uint8Array(backing.buffer, 16, WAV.length);

    const result = await createPlayableJingleAudio(view);

    // Slicing by byteOffset and byteLength is what keeps the other 48 bytes out
    // of the clip.
    expect(result.mimeType).toBe("audio/wav");
    expect((await readBack(result.blob)).length).toBe(WAV.length);
  });

  it("takes a binary string", async () => {
    const result = await createPlayableJingleAudio(String.fromCharCode(...WAV));

    expect(result.mimeType).toBe("audio/wav");
    expect(await readBack(result.blob)).toEqual(WAV);
  });

  it("refuses anything it cannot read", async () => {
    await expect(createPlayableJingleAudio({ nope: true })).rejects.toThrow(/unreadable/i);
    await expect(createPlayableJingleAudio(null)).rejects.toThrow(/unreadable/i);
    await expect(createPlayableJingleAudio(42)).rejects.toThrow(/unreadable/i);
  });
});

describe("the corruption guard", () => {
  it("rejects a clip full of UTF-8 replacement characters", async () => {
    // The exact damage the old JSON transport did: every unmappable byte
    // rewritten as ef bf bd, which plays as white noise.
    await expect(createPlayableJingleAudio(blobOf(corrupted(50)))).rejects.toThrow(/regenerate/i);
  });

  it("rejects a corrupted base64 envelope too", async () => {
    await expect(
      createPlayableJingleAudio({ audioBase64: toBase64(corrupted(50)) }),
    ).rejects.toThrow(/regenerate/i);
  });

  it("lets a clip with a few such bytes through", async () => {
    // Twelve is the threshold. Real compressed audio can contain the sequence
    // by chance, so a stricter guard would reject working clips.
    const nearly = new Uint8Array(WAV.length + 36);
    nearly.set(WAV, 0);
    nearly.set(corrupted(12), WAV.length);

    const result = await createPlayableJingleAudio(blobOf(nearly));

    expect(result.mimeType).toBe("audio/wav");
  });
});

describe("loading from a URL", () => {
  it("fetches without caching and sniffs what came back", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => blobOf(MP3_ID3, "application/octet-stream"),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlayableJingleAudioFromUrl("https://cdn.test/jingle");

    // A regenerated jingle keeps its URL, so a cached response would play the
    // previous take.
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.test/jingle", { cache: "no-store" });
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("says so when the file cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));

    await expect(createPlayableJingleAudioFromUrl("https://cdn.test/gone")).rejects.toThrow(
      /Could not load/i,
    );
  });
});
