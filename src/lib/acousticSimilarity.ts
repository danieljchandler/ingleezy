/**
 * acousticSimilarity — measure how close a learner's spoken take is to the
 * ACTUAL native clip's audio, rather than to a generic pronunciation model.
 *
 * Pipeline: decode both clips to mono 16 kHz → MFCC frames (with cepstral-mean
 * normalisation so different voices/mics aren't unfairly penalised) → align the
 * two frame sequences with Dynamic Time Warping → map the average per-step
 * distance to a 0–100 closeness score.
 *
 * The DSP math (`similarityFromSamples` and below) is pure and unit-testable;
 * only `acousticSimilarity` / `decodeToMono16k` touch the Web Audio API.
 */

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 400; // 25 ms @ 16 kHz
const HOP_SIZE = 160; //   10 ms @ 16 kHz
const FFT_SIZE = 512; // next pow2 ≥ FRAME_SIZE
const NUM_MEL = 26;
const NUM_CEPS = 13;
const MEL_LOW_HZ = 0;
const MEL_HIGH_HZ = 8000;
/** Distance→similarity falloff. Larger = more forgiving. Tuned empirically. */
const DIST_SCALE = 5;

/** Decode any audio Blob to a mono Float32Array at 16 kHz (browser only). */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AC();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await audioCtx.close().catch(() => {});
  }
}

/**
 * Compare two audio clips and return a 0–100 closeness score.
 * Returns null when either clip is too short to analyse.
 */
export async function acousticSimilarity(userWav: Blob, nativeWav: Blob): Promise<number | null> {
  const [a, b] = await Promise.all([decodeToMono16k(userWav), decodeToMono16k(nativeWav)]);
  if (a.length < FRAME_SIZE || b.length < FRAME_SIZE) return null;
  return similarityFromSamples(a, b);
}

// ── Pure DSP (unit-testable, no Web Audio) ────────────────────────────────

/** Full pipeline over raw mono PCM samples → 0–100 closeness. */
export function similarityFromSamples(a: Float32Array, b: Float32Array, sampleRate = SAMPLE_RATE): number {
  const fa = mfccFrames(a, sampleRate);
  const fb = mfccFrames(b, sampleRate);
  if (fa.length === 0 || fb.length === 0) return 0;
  const avgDist = dtwAverageDistance(fa, fb);
  const sim = 100 * Math.exp(-avgDist / DIST_SCALE);
  return Math.max(0, Math.min(100, Math.round(sim)));
}

/** Compute a sequence of cepstral-mean-normalised MFCC vectors. */
export function mfccFrames(samples: Float32Array, sampleRate = SAMPLE_RATE): number[][] {
  const filterbank = melFilterbank(FFT_SIZE, sampleRate, NUM_MEL, MEL_LOW_HZ, Math.min(MEL_HIGH_HZ, sampleRate / 2));
  const window = hammingWindow(FRAME_SIZE);
  const frames: number[][] = [];

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) re[i] = samples[start + i] * window[i];

    fft(re, im);

    // Power spectrum over the first half.
    const power = new Float64Array(FFT_SIZE / 2 + 1);
    for (let i = 0; i < power.length; i++) power[i] = re[i] * re[i] + im[i] * im[i];

    // Mel energies → log.
    const logMel = new Float64Array(NUM_MEL);
    for (let m = 0; m < NUM_MEL; m++) {
      let sum = 0;
      const fb = filterbank[m];
      for (let i = 0; i < fb.length; i++) sum += fb[i] * power[i];
      logMel[m] = Math.log(sum + 1e-10);
    }

    // DCT-II → cepstral coefficients.
    const ceps = new Array(NUM_CEPS).fill(0);
    for (let k = 0; k < NUM_CEPS; k++) {
      let sum = 0;
      for (let m = 0; m < NUM_MEL; m++) sum += logMel[m] * Math.cos((Math.PI * k * (m + 0.5)) / NUM_MEL);
      ceps[k] = sum;
    }
    frames.push(ceps);
  }

  cmvn(frames);
  return frames;
}

/**
 * Cepstral mean & variance normalisation: per coefficient, subtract the mean
 * and divide by the standard deviation across frames. Removes channel/speaker
 * offset AND puts every coefficient on a comparable scale, so Euclidean frame
 * distances are stable across different voices and recording conditions.
 */
function cmvn(frames: number[][]): void {
  if (frames.length === 0) return;
  const dims = frames[0].length;
  const mean = new Array(dims).fill(0);
  const M2 = new Array(dims).fill(0);
  for (const f of frames) for (let d = 0; d < dims; d++) mean[d] += f[d];
  for (let d = 0; d < dims; d++) mean[d] /= frames.length;
  for (const f of frames) for (let d = 0; d < dims; d++) M2[d] += (f[d] - mean[d]) ** 2;
  const std = M2.map((v) => Math.sqrt(v / frames.length) + 1e-8);
  for (const f of frames) for (let d = 0; d < dims; d++) f[d] = (f[d] - mean[d]) / std[d];
}

/** DTW alignment cost, normalised by path length → average per-step distance. */
export function dtwAverageDistance(a: number[][], b: number[][]): number {
  const n = a.length;
  const m = b.length;
  const INF = Infinity;
  // Rolling two-row cost matrix.
  let prev = new Float64Array(m + 1).fill(INF);
  let curr = new Float64Array(m + 1).fill(INF);
  // Track path length in parallel so we can normalise the accumulated cost.
  let prevLen = new Float64Array(m + 1).fill(0);
  let currLen = new Float64Array(m + 1).fill(0);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr[0] = INF;
    currLen[0] = 0;
    for (let j = 1; j <= m; j++) {
      const d = euclidean(a[i - 1], b[j - 1]);
      // Choose the cheapest predecessor: diagonal, up, or left.
      let best = prev[j - 1];
      let bestLen = prevLen[j - 1];
      if (prev[j] < best) {
        best = prev[j];
        bestLen = prevLen[j];
      }
      if (curr[j - 1] < best) {
        best = curr[j - 1];
        bestLen = currLen[j - 1];
      }
      curr[j] = best + d;
      currLen[j] = bestLen + 1;
    }
    [prev, curr] = [curr, prev];
    [prevLen, currLen] = [currLen, prevLen];
  }

  const total = prev[m];
  const len = prevLen[m] || 1;
  return total / len;
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function hammingWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/** Triangular mel filterbank as an array of per-filter weight vectors. */
function melFilterbank(fftSize: number, sampleRate: number, numFilters: number, lowHz: number, highHz: number): Float64Array[] {
  const bins = fftSize / 2 + 1;
  const hzToMel = (hz: number) => 1127 * Math.log(1 + hz / 700);
  const melToHz = (mel: number) => 700 * (Math.exp(mel / 1127) - 1);
  const lowMel = hzToMel(lowHz);
  const highMel = hzToMel(highHz);

  // numFilters+2 equally-spaced mel points → FFT bin indices.
  const points = new Array(numFilters + 2);
  for (let i = 0; i < points.length; i++) {
    const mel = lowMel + ((highMel - lowMel) * i) / (numFilters + 1);
    points[i] = Math.floor(((fftSize + 1) * melToHz(mel)) / sampleRate);
  }

  const filters: Float64Array[] = [];
  for (let m = 1; m <= numFilters; m++) {
    const f = new Float64Array(bins);
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];
    for (let k = left; k < center; k++) if (center !== left) f[k] = (k - left) / (center - left);
    for (let k = center; k < right; k++) if (right !== center) f[k] = (right - k) / (right - center);
    filters.push(f);
  }
  return filters;
}

/** In-place iterative radix-2 Cooley–Tukey FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
