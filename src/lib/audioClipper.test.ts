import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioBufferToWav, clipToWav, decodeAudioFile, extractClip } from "./audioClipper";

/**
 * Cutting a transcript line's audio out of the source file.
 *
 * This is what lets a reviewer hear one line at a time while checking
 * timestamps, and what produces the per-word audio saved with vocabulary. Two
 * things matter and neither is visible from the UI: the padding, which is the
 * difference between hearing a word and hearing most of a word, and the WAV
 * header, which has to describe the interleaved payload exactly or the clip
 * plays as noise.
 *
 * jsdom has no Web Audio, so `AudioBuffer` and `OfflineAudioContext` are
 * stubbed with plain Float32Array-backed stand-ins. Sample arithmetic is the
 * subject; decoding is not.
 */

const SAMPLE_RATE = 1000;

/** A stand-in for AudioBuffer holding one Float32Array per channel. */
function makeBuffer(channels: Float32Array[], sampleRate = SAMPLE_RATE): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (index: number) => channels[index],
  } as unknown as AudioBuffer;
}

/** A ramp, so every sample is identifiable by its value. */
function ramp(length: number, from = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (from + i) / 100_000;
  return out;
}

function stubOfflineContext() {
  class StubOfflineContext {
    constructor(
      public numberOfChannels: number,
      public length: number,
      public sampleRate: number,
    ) {}
    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      return makeBuffer(channels, sampleRate);
    }
  }
  vi.stubGlobal("OfflineAudioContext", StubOfflineContext);
}

function readBack(blob: Blob): Promise<DataView> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new DataView(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const text = (view: DataView, offset: number, length = 4) =>
  String.fromCharCode(
    ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
  );

beforeEach(() => {
  vi.restoreAllMocks();
  stubOfflineContext();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extracting a clip", () => {
  it("pads a quarter second either side of the range", () => {
    // Three seconds at 1 kHz; ask for the middle second.
    const source = makeBuffer([ramp(3000)]);

    const clip = extractClip(source, 1000, 2000);

    // 250ms before and after, so 1.5 seconds at 1 kHz.
    expect(clip.length).toBe(1500);
  });

  it("takes the samples the range actually points at", () => {
    const source = makeBuffer([ramp(3000)]);

    const clip = extractClip(source, 1000, 2000);

    // Padding starts the clip at 750ms, which at 1 kHz is sample 750.
    expect(clip.getChannelData(0)[0]).toBeCloseTo(750 / 100_000, 8);
  });

  it("clamps the padding at the start of the file", () => {
    const source = makeBuffer([ramp(3000)]);

    // A line starting at 100ms cannot have 250ms of lead-in.
    const clip = extractClip(source, 100, 500);

    expect(clip.length).toBe(750);
    expect(clip.getChannelData(0)[0]).toBeCloseTo(0, 8);
  });

  it("clamps the padding at the end of the file", () => {
    const source = makeBuffer([ramp(3000)]);

    // Asking past the end would otherwise read undefined samples.
    const clip = extractClip(source, 2800, 3000);

    expect(clip.length).toBe(450);
    expect(Number.isNaN(clip.getChannelData(0).at(-1))).toBe(false);
  });

  it("keeps every channel", () => {
    const source = makeBuffer([ramp(3000), ramp(3000, 500_000)]);

    const clip = extractClip(source, 1000, 2000);

    // A stereo source clipped to mono loses whichever speaker was on the other
    // side of the mix.
    expect(clip.numberOfChannels).toBe(2);
    expect(clip.getChannelData(1)[0]).not.toBe(clip.getChannelData(0)[0]);
  });

  it("refuses a range that ends before it starts", () => {
    const source = makeBuffer([ramp(3000)]);

    // Timestamps come from ASR and are sometimes reversed; a zero-length
    // OfflineAudioContext throws in the browser with a far less useful message.
    expect(() => extractClip(source, 2000, 1000)).toThrow(/Invalid clip range/);
  });

  it("accepts a zero-length range, because the padding gives it length", () => {
    const source = makeBuffer([ramp(3000)]);

    // A word whose start and end are the same instant still yields half a
    // second of context rather than an error.
    expect(extractClip(source, 1000, 1000).length).toBe(500);
  });

  it("survives a range entirely past the end of the file", () => {
    const source = makeBuffer([ramp(1000)]);

    // The end clamps to the file duration and the start does not, so the
    // computed length goes negative and this is rejected rather than producing
    // a silent clip.
    expect(() => extractClip(source, 5000, 6000)).toThrow(/Invalid clip range/);
  });
});

describe("encoding a WAV", () => {
  it("writes a header describing the payload", async () => {
    const view = await readBack(audioBufferToWav(makeBuffer([new Float32Array(100)])));

    expect(text(view, 0)).toBe("RIFF");
    expect(text(view, 8)).toBe("WAVE");
    expect(text(view, 12)).toBe("fmt ");
    expect(text(view, 36)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("records the source sample rate and channel count", async () => {
    const buffer = makeBuffer([new Float32Array(100), new Float32Array(100)], 44_100);

    const view = await readBack(audioBufferToWav(buffer));

    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    // Byte rate and block align are derived; getting them wrong plays the clip
    // at the wrong speed rather than failing.
    expect(view.getUint32(28, true)).toBe(44_100 * 2 * 2);
    expect(view.getUint16(32, true)).toBe(4);
  });

  it("sizes both length fields from the payload", async () => {
    const blob = audioBufferToWav(makeBuffer([new Float32Array(100)]));
    const view = await readBack(blob);

    expect(view.getUint32(40, true)).toBe(200); // 100 samples, 2 bytes each
    expect(view.getUint32(4, true)).toBe(44 + 200 - 8);
    expect(blob.size).toBe(44 + 200);
  });

  it("interleaves the channels rather than concatenating them", async () => {
    const left = new Float32Array([1, 1, 1]);
    const right = new Float32Array([-1, -1, -1]);

    const view = await readBack(audioBufferToWav(makeBuffer([left, right])));

    // L R L R, not L L L R R R — concatenating plays the two channels one after
    // the other at double length.
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(32_767);
    expect(view.getInt16(50, true)).toBe(-32_768);
  });

  it("saturates rather than wrapping on a clipped sample", async () => {
    const hot = new Float32Array([2, -2, 0]);

    const view = await readBack(audioBufferToWav(makeBuffer([hot])));

    // Wrapping would turn the loudest instant into the quietest, which is the
    // click you hear on a badly encoded file.
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("labels the blob as WAV", () => {
    expect(audioBufferToWav(makeBuffer([new Float32Array(10)])).type).toBe("audio/wav");
  });
});

describe("clipping straight to a WAV", () => {
  it("produces the clip's samples, not the whole file's", async () => {
    const source = makeBuffer([ramp(3000)]);

    const blob = clipToWav(source, 1000, 2000);
    const view = await readBack(blob);

    // 1500 samples of clip at two bytes each, plus the header.
    expect(view.getUint32(40, true)).toBe(3000);
    expect(blob.size).toBe(44 + 3000);
  });
});

describe("decoding an uploaded file", () => {
  function stubContext(decode: () => Promise<unknown>) {
    const close = vi.fn(async () => undefined);
    class StubContext {
      decodeAudioData = vi.fn(decode);
      close = close;
    }
    vi.stubGlobal("AudioContext", StubContext);
    return close;
  }

  const fileOf = (type: string): File =>
    ({
      type,
      name: "upload",
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as unknown as File;

  it("returns the decoded buffer and closes its context", async () => {
    const decoded = makeBuffer([new Float32Array(10)]);
    const close = stubContext(async () => decoded);

    await expect(decodeAudioFile(fileOf("audio/wav"))).resolves.toBe(decoded);
    // Browsers cap live contexts; leaking one per upload runs a review session
    // out of them.
    expect(close).toHaveBeenCalled();
  });

  it("closes its context even when decoding fails", async () => {
    const close = stubContext(async () => {
      throw new Error("Unable to decode audio data");
    });

    await expect(decodeAudioFile(fileOf("audio/wav"))).rejects.toThrow(/decode/i);
    expect(close).toHaveBeenCalled();
  });

  it("tells a video uploader what to do about it", async () => {
    stubContext(async () => {
      throw new Error("Unable to decode audio data");
    });

    // The browser cannot demux most video containers, and "Unable to decode
    // audio data" gives an admin nothing to act on. The replacement names a
    // tool and a target format.
    await expect(decodeAudioFile(fileOf("video/mp4"))).rejects.toThrow(/VLC/);
  });

  it("passes an audio decode failure through unchanged", async () => {
    stubContext(async () => {
      throw new Error("Unable to decode audio data");
    });

    // For an audio file the original message is the accurate one — the advice
    // about exporting from VLC would be misleading.
    await expect(decodeAudioFile(fileOf("audio/x-weird"))).rejects.toThrow(
      /Unable to decode audio data/,
    );
  });
});
