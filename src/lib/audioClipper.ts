/**
 * Client-side audio clipping using Web Audio API.
 * Extracts segments from an audio file by timestamp range,
 * adds padding, and returns WAV blobs.
 */

const PADDING_MS = 250; // 250ms padding before and after

/**
 * Decode an audio File into an AudioBuffer
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();
    return audioBuffer;
  } catch (err) {
    await audioContext.close();
    if (file.type.startsWith("video/")) {
      throw new Error(
        "Could not extract audio from this video file. Try opening the video in a tool like VLC and exporting it as MP3 or M4A, then upload that instead."
      );
    }
    throw err;
  }
}

/**
 * Extract a clip from an AudioBuffer by timestamp range (in milliseconds).
 * Adds PADDING_MS before and after.
 */
export function extractClip(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  // Apply padding, clamped to buffer bounds
  const paddedStartSec = Math.max(0, (startMs - PADDING_MS) / 1000);
  const paddedEndSec = Math.min(buffer.duration, (endMs + PADDING_MS) / 1000);

  const startSample = Math.floor(paddedStartSec * sampleRate);
  const endSample = Math.ceil(paddedEndSec * sampleRate);
  const length = endSample - startSample;

  if (length <= 0) {
    throw new Error(`Invalid clip range: ${startMs}-${endMs}ms`);
  }

  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  const clipBuffer = offlineCtx.createBuffer(channels, length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const sourceData = buffer.getChannelData(ch);
    const targetData = clipBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      targetData[i] = sourceData[startSample + i] ?? 0;
    }
  }

  return clipBuffer;
}

/**
 * Encode an AudioBuffer to a WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;

  // Interleave channels
  const length = buffer.length * numChannels;
  const interleaved = new Float32Array(length);
  
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      interleaved[i * numChannels + ch] = channelData[i];
    }
  }

  // Convert to 16-bit PCM
  const dataLength = length * bytesPerSample;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // PCM data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Extract a clip and return it as a WAV Blob
 */
export function clipToWav(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number
): Blob {
  const clip = extractClip(buffer, startMs, endMs);
  return audioBufferToWav(clip);
}
