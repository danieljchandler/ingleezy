import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobToWav, extractAudioForAsr } from "./audioToWav";

/**
 * Pulling the audio track out of an upload as 16 kHz mono WAV.
 *
 * Two callers, two reasons. The pronunciation scorer needs it because Azure
 * returns straight zeros for WebM/Opus — a scored-zero pronunciation looks like
 * a bad attempt rather than a format problem. The video pipeline needs it
 * because staging the raw upload hands every ASR engine tens of megabytes of
 * video track, and it kept Munsit permanently over its 9 MB sync limit in a
 * container its chunker cannot split, so it was skipped on every upload.
 *
 * 16 kHz mono is every ASR model's native rate, so nothing is discarded that
 * the providers would have kept. jsdom has no Web Audio, so decode and
 * resampling are stubbed and the encoder is what is actually exercised.
 */

const SAMPLE_RATE = 16_000;

let renderedSamples: Float32Array;

function stubAudio(options: { decodeThrows?: boolean; rendered?: Float32Array } = {}) {
  renderedSamples = options.rendered ?? new Float32Array([0, 0.5, -0.5, 1]);

  class StubAudioContext {
    decodeAudioData = vi.fn(async () => {
      if (options.decodeThrows) throw new Error("Unable to decode audio data");
      return {
        duration: renderedSamples.length / SAMPLE_RATE,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 2,
        length: renderedSamples.length,
        getChannelData: () => renderedSamples,
      };
    });
    close = vi.fn(async () => undefined);
  }

  class StubOfflineContext {
    constructor(
      public numberOfChannels: number,
      public length: number,
      public sampleRate: number,
    ) {}
    destination = {};
    createBufferSource() {
      return { buffer: null, connect: vi.fn(), start: vi.fn() };
    }
    startRendering = vi.fn(async () => ({
      getChannelData: () => renderedSamples,
      length: renderedSamples.length,
      sampleRate: this.sampleRate,
    }));
  }

  vi.stubGlobal("AudioContext", StubAudioContext);
  vi.stubGlobal("OfflineAudioContext", StubOfflineContext);
}

/** jsdom's Blob has neither `arrayBuffer()` nor a reader we can use directly. */
const anyBlob = (): Blob =>
  ({ type: "audio/webm", size: 64, arrayBuffer: async () => new ArrayBuffer(64) }) as unknown as Blob;

function readBack(blob: Blob): Promise<DataView> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new DataView(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const text = (view: DataView, offset: number) =>
  String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(offset + i)));

beforeEach(() => {
  vi.restoreAllMocks();
  stubAudio();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encoding to WAV", () => {
  it("writes a RIFF header for mono 16-bit at 16 kHz", async () => {
    const view = await readBack(await blobToWav(anyBlob()));

    expect(text(view, 0)).toBe("RIFF");
    expect(text(view, 8)).toBe("WAVE");
    expect(text(view, 12)).toBe("fmt ");
    expect(text(view, 36)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("derives the byte rate and block align from the format", async () => {
    const view = await readBack(await blobToWav(anyBlob()));

    // Wrong values here play the clip at the wrong speed rather than failing,
    // which reads to Azure as a mispronunciation.
    expect(view.getUint32(28, true)).toBe(16_000 * 2);
    expect(view.getUint16(32, true)).toBe(2);
  });

  it("sizes both length fields from the sample count", async () => {
    const blob = await blobToWav(anyBlob());
    const view = await readBack(blob);

    expect(view.getUint32(40, true)).toBe(8); // four samples, two bytes each
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(blob.size).toBe(44 + 8);
  });

  it("converts float samples to signed 16-bit", async () => {
    stubAudio({ rendered: new Float32Array([0, 0.5, -0.5]) });

    const view = await readBack(await blobToWav(anyBlob()));

    expect(view.getInt16(44, true)).toBe(0);
    // Positive scales by 0x7fff and negative by 0x8000, which is what keeps
    // full-scale negative from overflowing.
    // setInt16 truncates rather than rounding, so 0.5 * 0x7fff lands one below
    // the halfway point. Half a least-significant bit is inaudible; the point
    // is that the scaling is asymmetric on purpose.
    expect(view.getInt16(46, true)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(view.getInt16(48, true)).toBe(-0.5 * 0x8000);
  });

  it("saturates a clipped sample instead of wrapping", async () => {
    stubAudio({ rendered: new Float32Array([2, -2]) });

    const view = await readBack(await blobToWav(anyBlob()));

    // Wrapping turns the loudest instant into the quietest — an audible click
    // that a scorer reads as a consonant.
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
  });

  it("labels the blob as WAV", async () => {
    expect((await blobToWav(anyBlob())).type).toBe("audio/wav");
  });

  it("closes the decoding context", async () => {
    const close = vi.fn(async () => undefined);
    class StubAudioContext {
      decodeAudioData = vi.fn(async () => ({
        duration: 1,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        length: 4,
        getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
      }));
      close = close;
    }
    vi.stubGlobal("AudioContext", StubAudioContext);

    await blobToWav(anyBlob());

    // Browsers cap live contexts; one per recording exhausts them within a
    // pronunciation session.
    expect(close).toHaveBeenCalled();
  });

  it("lets a decode failure reach the caller", async () => {
    stubAudio({ decodeThrows: true });

    await expect(blobToWav(anyBlob())).rejects.toThrow(/decode/i);
  });
});

describe("extracting for ASR", () => {
  it("returns the WAV when there is audio in the file", async () => {
    const wav = await extractAudioForAsr(anyBlob());

    expect(wav).not.toBeNull();
    expect(wav!.type).toBe("audio/wav");
  });

  it("returns null when the browser cannot decode the container", async () => {
    stubAudio({ decodeThrows: true });

    // Not a throw: the caller falls back to uploading the original file, and
    // the pipeline's own download path takes over. Failing here would refuse
    // uploads the server could have handled.
    await expect(extractAudioForAsr(anyBlob())).resolves.toBeNull();
  });

  it("returns null for a decode that yielded only a header", async () => {
    stubAudio({ rendered: new Float32Array(0) });

    // A 44-byte WAV is a file with no audio track — a silent video, or a
    // container whose audio stream the browser skipped. Staging it would send
    // every ASR engine an empty clip and get back an empty transcript, which
    // reads downstream exactly like a clip with no speech in it.
    await expect(extractAudioForAsr(anyBlob())).resolves.toBeNull();
  });

  it("keeps a clip with even one sample in it", async () => {
    stubAudio({ rendered: new Float32Array([0.5]) });

    // The guard is on size, not on content — anything past the header counts.
    await expect(extractAudioForAsr(anyBlob())).resolves.not.toBeNull();
  });

  it("says so in the console when it gives up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubAudio({ decodeThrows: true });

    await extractAudioForAsr(anyBlob());

    // The fallback is silent from the user's side, so the log is the only
    // record that the upload was bigger than it needed to be.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Audio extraction failed"),
      expect.anything(),
    );
  });
});
