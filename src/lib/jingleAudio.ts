export type JingleAudioFile = {
  blob: Blob;
  mimeType: string;
  extension: "mp3" | "wav" | "ogg" | "webm" | "m4a";
};

type GeneratedJingleAudioResponse = {
  audioBase64: string;
  mimeType?: string;
  extension?: JingleAudioFile["extension"];
};

const textAt = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const isValidMpegHeader = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length) return false;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrate = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRate = (bytes[offset + 2] >> 2) & 0x03;
  const emphasis = bytes[offset + 3] & 0x03;
  return version !== 0x01 && layer !== 0x00 && bitrate !== 0x00 && bitrate !== 0x0f && sampleRate !== 0x03 && emphasis !== 0x02;
};

const extensionForMime = (mimeType: string): JingleAudioFile["extension"] => {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "wav";
};

const detectAudioMime = (bytes: Uint8Array, declaredType = "") => {
  if (bytes.length >= 12 && textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 4) === "WAVE") {
    return "audio/wav";
  }
  if (bytes.length >= 3 && textAt(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (isValidMpegHeader(bytes, 0)) return "audio/mpeg";
  if (bytes.length >= 4 && textAt(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (bytes.length >= 12 && textAt(bytes, 4, 4) === "ftyp") return "audio/mp4";

  const cleanType = declaredType.split(";")[0].toLowerCase();
  if (cleanType.startsWith("audio/") && !/l16|pcm/.test(cleanType)) return cleanType;
  return "audio/wav";
};

const isGeneratedJingleAudioResponse = (data: unknown): data is GeneratedJingleAudioResponse =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as GeneratedJingleAudioResponse).audioBase64 === "string";

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const looksUtf8ReplacementCorrupted = (bytes: Uint8Array) => {
  const limit = Math.min(bytes.length - 2, 65536);
  let replacementCount = 0;
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) replacementCount++;
  }
  return replacementCount > 12;
};

const assertNotCorrupted = (bytes: Uint8Array) => {
  if (looksUtf8ReplacementCorrupted(bytes)) {
    throw new Error("Stored jingle audio was corrupted during an older generation. Please regenerate it.");
  }
};

export async function createPlayableJingleAudio(data: unknown): Promise<JingleAudioFile> {
  if (isGeneratedJingleAudioResponse(data)) {
    const bytes = base64ToBytes(data.audioBase64);
    assertNotCorrupted(bytes);
    const mimeType = detectAudioMime(bytes, data.mimeType || "audio/mpeg");
    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
      extension: data.extension || extensionForMime(mimeType),
    };
  }

  const declaredType = data instanceof Blob ? data.type : "";
  let buffer: ArrayBuffer;

  if (data instanceof Blob) {
    buffer = await data.arrayBuffer();
  } else if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (ArrayBuffer.isView(data)) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else if (typeof data === "string") {
    const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff);
    buffer = bytes.buffer;
  } else {
    throw new Error("Generated jingle returned an unreadable audio format");
  }

  const bytes = new Uint8Array(buffer);
  assertNotCorrupted(bytes);
  const mimeType = detectAudioMime(bytes, declaredType);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    extension: extensionForMime(mimeType),
  };
}

export async function createPlayableJingleAudioFromUrl(url: string): Promise<JingleAudioFile> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load generated jingle audio");
  return createPlayableJingleAudio(await response.blob());
}