import { describe, expect, it } from "vitest";
import { dtwAverageDistance, fft, mfccFrames, similarityFromSamples } from "./acousticSimilarity";

const SR = 16000;

/** A pure sine tone. */
function tone(freq: number, durationSec: number): Float32Array {
  const n = Math.floor(durationSec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.6 * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

/**
 * A speech-like signal: a sequence of tone "syllables". Steady tones are
 * degenerate under cepstral normalisation, so we vary the spectrum over time
 * the way real speech does.
 */
function utterance(freqs: number[], segDur = 0.12): Float32Array {
  const parts = freqs.map((f) => tone(f, segDur));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Deterministic pseudo-noise (seeded LCG). */
function noise(length: number, seed = 12345): Float32Array {
  const out = new Float32Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return out;
}

function addNoise(sig: Float32Array, amount: number, seed = 999): Float32Array {
  const nz = noise(sig.length, seed);
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] + amount * nz[i];
  return out;
}

describe("fft", () => {
  it("puts a pure cosine's energy in the expected bin (or its real-spectrum mirror)", () => {
    const N = 16;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * 2 * i) / N);
    fft(re, im);
    const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    const peak = mag.indexOf(Math.max(...mag));
    // Real input → energy at bin 2 and its conjugate mirror N-2.
    expect([2, N - 2]).toContain(peak);
  });
});

describe("mfccFrames", () => {
  it("produces frames of 13 coefficients", () => {
    const frames = mfccFrames(utterance([300, 600, 400]));
    expect(frames.length).toBeGreaterThan(10);
    expect(frames[0]).toHaveLength(13);
  });

  it("returns no frames for audio shorter than one frame", () => {
    expect(mfccFrames(new Float32Array(100))).toHaveLength(0);
  });
});

describe("dtwAverageDistance", () => {
  it("is zero for identical frame sequences", () => {
    const frames = mfccFrames(utterance([300, 600, 400]));
    expect(dtwAverageDistance(frames, frames)).toBeCloseTo(0, 6);
  });
});

describe("similarityFromSamples", () => {
  it("scores an identical clip at 100", () => {
    const a = utterance([300, 700, 450, 900, 500]);
    expect(similarityFromSamples(a, a)).toBe(100);
  });

  it("scores a noisy copy higher than a different utterance", () => {
    const a = utterance([300, 700, 450, 900, 500]);
    const aNoisy = addNoise(a, 0.08);
    const b = utterance([1100, 250, 1500, 300, 1200]); // different "word"
    const simSame = similarityFromSamples(a, aNoisy);
    const simDiff = similarityFromSamples(a, b);
    expect(simSame).toBeGreaterThan(simDiff);
    expect(simSame).toBeGreaterThan(60);
  });

  it("returns a value within 0..100", () => {
    const s = similarityFromSamples(utterance([200, 500]), noise(SR * 0.3 | 0) as unknown as Float32Array);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
