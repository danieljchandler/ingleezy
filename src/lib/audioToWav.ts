/**
 * Pull the audio track out of an uploaded media file as a 16 kHz mono WAV,
 * ready for the ASR pipeline.
 *
 * The video pipeline treats whatever is staged in the `video-audio` bucket as
 * its audio input. Uploading the raw video meant handing every ASR engine tens
 * of megabytes that are almost entirely video track — and it put Munsit, the
 * most-trusted Arabic engine, permanently over its 9 MB sync-endpoint limit in
 * a container its MP3 chunker can't split, so it was skipped on every upload.
 *
 * 16 kHz mono is every ASR model's native sample rate, so nothing is lost that
 * the providers wouldn't have discarded on their own. A 90-second clip goes
 * from roughly 10 MB of mp4 to under 3 MB of WAV.
 *
 * Returns `null` if the browser can't decode the container, so callers can fall
 * back to uploading the original file rather than failing the upload.
 */
export async function extractAudioForAsr(file: Blob): Promise<Blob | null> {
  try {
    const wav = await blobToWav(file);
    // A decode that yields only a WAV header means no audio track was found.
    // Treat it as a failure rather than staging a silent file.
    return wav.size > 44 ? wav : null;
  } catch (e) {
    console.warn("Audio extraction failed, will upload the original file:", e);
    return null;
  }
}

/**
 * Convert any audio Blob (e.g. WebM/Opus from MediaRecorder) to a 16-bit
 * PCM WAV at 16 kHz mono — the format Azure Speech Services handles best
 * for pronunciation assessment.
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Down-mix to mono
  const numberOfChannels = 1;
  const sampleRate = 16000;

  // Resample to 16 kHz using an OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(
    numberOfChannels,
    Math.ceil(audioBuffer.duration * sampleRate),
    sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const pcmData = renderedBuffer.getChannelData(0);

  // Encode as 16-bit PCM WAV
  const wavBuffer = encodeWav(pcmData, sampleRate);

  await audioCtx.close();

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt  sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float32 [-1,1] to int16
  let offset = headerSize;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
