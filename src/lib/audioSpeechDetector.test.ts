import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAudio, extractAudioWav } from "./audioSpeechDetector";

/**
 * The client-side "is there actually speech in this?" check.
 *
 * This runs before an upload is sent for transcription, and its job is to stop
 * a learner spending an ASR call — and a minute of waiting — on a silent clip
 * or a music video. Getting it wrong in one direction wastes the call; in the
 * other it refuses a perfectly good recording, which is worse because there is
 * no override.
 *
 * The decision is made from two frame-level statistics: RMS (loudness) and
 * zero-crossing rate. Speech is loud with low crossing rates; a pure tone is
 * loud with a crossing rate set by its frequency; silence is quiet. So the
 * tests synthesise signals with known properties rather than shipping audio
 * fixtures, which keeps the thresholds legible.
 *
 * `decodeAudioData` is stubbed to hand back those samples directly — jsdom has
 * no audio decoder, and decoding is not what is under test.
 */

const SAMPLE_RATE = 16_000;

/** Hand `decodeAudioData` a buffer built from these samples. */
function stubDecoder(samples: Float32Array, sampleRate = SAMPLE_RATE) {
  class StubContext {
    sampleRate = sampleRate;
    decodeAudioData = vi.fn(async () => ({
      sampleRate,
      length: samples.length,
      duration: samples.length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => samples,
    }));
    close = vi.fn(async () => undefined);
  }
  vi.stubGlobal("AudioContext", StubContext);
}

/**
 * A blob whose bytes are never read — the decoder stub ignores them.
 *
 * jsdom's `Blob` has no `arrayBuffer()`, so the minimum the module actually
 * calls is supplied directly rather than polyfilling the whole class.
 */
const anyBlob = (): Blob =>
  ({
    type: "audio/wav",
    size: 16,
    arrayBuffer: async () => new ArrayBuffer(16),
  }) as unknown as Blob;

const seconds = (n: number) => n * SAMPLE_RATE;

/**
 * Read a Blob's bytes.
 *
 * jsdom's Blob has no `arrayBuffer()` either, so the produced WAV is read back
 * through FileReader — the same path a browser upload would take.
 */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Silence, or near enough: below the 0.01 RMS floor. */
function quiet(length: number): Float32Array {
  return new Float32Array(length);
}

/**
 * A sine at `hz`.
 *
 * Zero crossings scale with frequency, so a high tone reads as "music" to the
 * detector and a low one reads as voiced speech. That is the whole heuristic.
 */
function tone(length: number, hz: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recognising silence", () => {
  it("calls a silent clip silence", async () => {
    stubDecoder(quiet(seconds(3)));

    const result = await classifyAudio(anyBlob());

    expect(result.reason).toBe("silence");
    expect(result.hasSpeech).toBe(false);
    expect(result.hasMusic).toBe(false);
    expect(result.silenceRatio).toBeGreaterThan(0.85);
  });

  it("calls a clip that is almost all silence silence", async () => {
    // A tenth of a second of sound in three seconds — a bumped microphone.
    stubDecoder(concat(quiet(seconds(2.9)), tone(seconds(0.1), 200)));

    const result = await classifyAudio(anyBlob());

    expect(result.reason).toBe("silence");
  });

  it("calls a clip too quiet to hear silence even when it is not digital zero", async () => {
    // Amplitude 0.005 is above zero but below the 0.01 RMS floor: room tone
    // from a mic that was never unmuted.
    stubDecoder(tone(seconds(3), 200, 0.005));

    const result = await classifyAudio(anyBlob());

    expect(result.reason).toBe("silence");
    expect(result.hasSpeech).toBe(false);
  });
});

describe("recognising speech", () => {
  it("calls a sustained low-frequency signal speech", async () => {
    // 150 Hz is around a male speaking fundamental: loud frames, few zero
    // crossings.
    stubDecoder(tone(seconds(3), 150));

    const result = await classifyAudio(anyBlob());

    expect(result.reason).toBe("speech");
    expect(result.hasSpeech).toBe(true);
    expect(result.hasMusic).toBe(false);
  });

  it("still finds speech through pauses", async () => {
    // Real speech is not continuous — a sentence, a breath, a sentence.
    stubDecoder(
      concat(tone(seconds(1), 150), quiet(seconds(0.5)), tone(seconds(1), 180), quiet(seconds(0.5))),
    );

    const result = await classifyAudio(anyBlob());

    expect(result.hasSpeech).toBe(true);
    expect(result.reason).not.toBe("silence");
  });

  it("reports how much of the clip was voiced", async () => {
    stubDecoder(concat(tone(seconds(2), 150), quiet(seconds(2))));

    const result = await classifyAudio(anyBlob());

    // Half sound, half silence — the ratios are what a caller shows the user
    // when it refuses an upload.
    expect(result.voicedRatio).toBeGreaterThan(0.4);
    expect(result.voicedRatio).toBeLessThan(0.6);
    expect(result.silenceRatio).toBeGreaterThan(0.4);
  });
});

describe("recognising music", () => {
  it("calls a sustained high-frequency signal music", async () => {
    // Above the ~0.18 crossings-per-sample threshold at this sample rate, and
    // loud throughout: a synth pad, not a voice.
    stubDecoder(tone(seconds(3), 3000));

    const result = await classifyAudio(anyBlob());

    expect(result.reason).toBe("music_only");
    expect(result.hasMusic).toBe(true);
    expect(result.hasSpeech).toBe(false);
  });

  it("finds speech under a backing track", async () => {
    // Enough high-ZCR frames to notice, not enough to drown the voice out.
    stubDecoder(concat(tone(seconds(2), 150), tone(seconds(1.2), 3000)));

    const result = await classifyAudio(anyBlob());

    // Half of the point of the detector: a music video with narration over it
    // is still worth transcribing, so it must not be refused as music.
    expect(result.hasSpeech).toBe(true);
    expect(result.hasMusic).toBe(true);
    expect(result.reason).toBe("speech_with_music");
  });
});

describe("the confidence score", () => {
  it("never drops below the floor, even on silence", async () => {
    stubDecoder(quiet(seconds(3)));

    const result = await classifyAudio(anyBlob());

    // Pinned. Confidence is `voicedRatio * 1.5` clamped to [0.4, 1], so a
    // completely silent clip is reported at 0.4 rather than 0. A caller
    // rendering it as a percentage shows "40% confident" about a file with
    // nothing in it — the floor makes the number unusable as a quality signal.
    expect(result.confidence).toBe(0.4);
  });

  it("saturates at one well before the clip is all speech", async () => {
    stubDecoder(tone(seconds(3), 150));

    const result = await classifyAudio(anyBlob());

    // The multiplier means anything past two-thirds voiced reports as fully
    // confident, so the top of the range carries no information either.
    expect(result.confidence).toBe(1);
  });
});

describe("edge cases", () => {
  it("does not divide by zero on a clip shorter than one frame", async () => {
    stubDecoder(quiet(100));

    const result = await classifyAudio(anyBlob());

    expect(Number.isNaN(result.silenceRatio)).toBe(false);
    expect(Number.isNaN(result.voicedRatio)).toBe(false);
  });

  it("closes the audio context it opened", async () => {
    const close = vi.fn(async () => undefined);
    class StubContext {
      sampleRate = SAMPLE_RATE;
      decodeAudioData = vi.fn(async () => ({
        sampleRate: SAMPLE_RATE,
        length: seconds(1),
        duration: 1,
        numberOfChannels: 1,
        getChannelData: () => tone(seconds(1), 150),
      }));
      close = close;
    }
    vi.stubGlobal("AudioContext", StubContext);

    await classifyAudio(anyBlob());

    // Browsers cap live contexts; leaking one per classified file runs a
    // transcribe session out of them.
    expect(close).toHaveBeenCalled();
  });

  it("lets a decode failure reach the caller", async () => {
    class StubContext {
      sampleRate = SAMPLE_RATE;
      decodeAudioData = vi.fn(async () => {
        throw new Error("Unable to decode audio data");
      });
      close = vi.fn();
    }
    vi.stubGlobal("AudioContext", StubContext);

    // A container the browser cannot open is a different situation from a
    // silent one, and the caller has to be able to tell them apart.
    await expect(classifyAudio(anyBlob())).rejects.toThrow(/decode/i);
  });
});

describe("extracting a WAV for upload", () => {
  it("writes a mono 16-bit header matching the source rate", async () => {
    stubDecoder(tone(seconds(1), 150), 44_100);

    const wav = await extractAudioWav(anyBlob());
    const view = new DataView(await bytesOf(wav));
    const text = (offset: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, offset, 4));

    expect(wav.type).toBe("audio/wav");
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("sizes the payload from the sample count", async () => {
    const samples = seconds(0.5);
    stubDecoder(tone(samples, 150));

    const wav = await extractAudioWav(anyBlob());
    const view = new DataView(await bytesOf(wav));

    // Two bytes a sample, plus the 44-byte header. A size field that disagrees
    // with the payload is what makes a player report a corrupt file.
    expect(view.getUint32(40, true)).toBe(samples * 2);
    expect(view.getUint32(4, true)).toBe(36 + samples * 2);
    expect(wav.size).toBe(44 + samples * 2);
  });

  it("clamps samples outside the representable range", async () => {
    const hot = new Float32Array([1.5, -1.5, 0]);
    stubDecoder(hot);

    const wav = await extractAudioWav(anyBlob());
    const view = new DataView(await bytesOf(wav));

    // A clipped recording must saturate rather than wrap, which would turn the
    // loudest moment into the quietest.
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(0);
  });
});
