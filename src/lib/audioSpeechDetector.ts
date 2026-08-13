// Lightweight client-side speech-vs-music/silence detector.
// Strategy: decode audio, compute frame-level RMS + zero-crossing rate (ZCR).
// Speech tends to have moderate-to-high RMS frames with low ZCR variance,
// silence is low RMS, and music tends to have sustained high RMS with high ZCR.

export type AudioClassification = {
  hasSpeech: boolean;
  hasMusic: boolean;
  silenceRatio: number; // 0-1
  voicedRatio: number; // 0-1
  reason: 'silence' | 'music_only' | 'speech' | 'speech_with_music';
  confidence: number; // 0-1
};

async function decodeAudio(file: File | Blob): Promise<AudioBuffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctx: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
  const ctx = new Ctx();
  const buf = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close();
  return decoded;
}

export async function classifyAudio(file: File | Blob): Promise<AudioClassification> {
  const audio = await decodeAudio(file);
  const ch = audio.getChannelData(0);
  const sr = audio.sampleRate;
  const frameLen = Math.floor(sr * 0.03); // 30ms frames
  const frames = Math.floor(ch.length / frameLen);

  let silentFrames = 0;
  let voicedFrames = 0;
  let highZcrFrames = 0;
  const SILENCE_RMS = 0.01;
  const VOICED_RMS = 0.04;

  for (let f = 0; f < frames; f++) {
    let sumSq = 0;
    let zc = 0;
    let prev = ch[f * frameLen];
    for (let i = 1; i < frameLen; i++) {
      const s = ch[f * frameLen + i];
      sumSq += s * s;
      if ((s >= 0) !== (prev >= 0)) zc++;
      prev = s;
    }
    const rms = Math.sqrt(sumSq / frameLen);
    const zcr = zc / frameLen;
    if (rms < SILENCE_RMS) silentFrames++;
    else if (rms > VOICED_RMS) voicedFrames++;
    if (zcr > 0.18 && rms > VOICED_RMS) highZcrFrames++;
  }

  const total = Math.max(frames, 1);
  const silenceRatio = silentFrames / total;
  const voicedRatio = voicedFrames / total;
  const musicRatio = highZcrFrames / total;

  // Heuristics
  let reason: AudioClassification['reason'] = 'speech';
  let hasSpeech = false;
  let hasMusic = false;

  if (silenceRatio > 0.85 || voicedRatio < 0.05) {
    reason = 'silence';
    hasSpeech = false;
    hasMusic = false;
  } else if (musicRatio / Math.max(voicedRatio, 0.001) > 0.65 && voicedRatio > 0.3) {
    // sustained high-ZCR voiced frames → likely music
    reason = 'music_only';
    hasMusic = true;
    hasSpeech = false;
  } else if (musicRatio / Math.max(voicedRatio, 0.001) > 0.35) {
    reason = 'speech_with_music';
    hasSpeech = true;
    hasMusic = true;
  } else {
    reason = 'speech';
    hasSpeech = true;
  }

  const confidence = Math.min(1, Math.max(0.4, voicedRatio * 1.5));
  return { hasSpeech, hasMusic, silenceRatio, voicedRatio, reason, confidence };
}

/** Extract mono audio as a WAV Blob from a video/audio file. Useful for ASR upload. */
export async function extractAudioWav(file: File | Blob): Promise<Blob> {
  const audio = await decodeAudio(file);
  const ch = audio.getChannelData(0);
  const sr = audio.sampleRate;
  const numSamples = ch.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, ch[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
