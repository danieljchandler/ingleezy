import { supabase } from "@/integrations/supabase/client";

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i;
const AUDIO_EXT = /\.(mp3|m4a|ogg|oga|wav|flac|aac|opus|webm)$/i;

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  webm: "audio/webm",
};

export type MediaKind = "image" | "audio";

export function classifyMedia(filename: string): MediaKind | null {
  if (IMAGE_EXT.test(filename)) return "image";
  if (AUDIO_EXT.test(filename)) return "audio";
  return null;
}

function bucketFor(kind: MediaKind): string {
  return kind === "image" ? "flashcard-images" : "flashcard-audio";
}

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_MAP[ext] || "application/octet-stream";
}

function safeName(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "bin";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now();
  return `${id}.${ext}`;
}

/**
 * Upload an Anki media file to the appropriate Supabase bucket. Returns the
 * public URL or null if upload failed.
 */
export async function uploadAnkiMedia(
  userId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<{ url: string; kind: MediaKind } | null> {
  const kind = classifyMedia(filename);
  if (!kind) return null;

  const bucket = bucketFor(kind);
  const path = `anki-import/${userId}/${safeName(filename)}`;
  const contentType = mimeFor(filename);

  const blob = new Blob([bytes as BlobPart], { type: contentType });

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType, upsert: false });
  if (error) {
    console.warn("[anki] media upload failed", filename, error.message);
    return null;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, kind };
}

/** Upload many media files with bounded concurrency. */
export async function uploadAnkiMediaBatch(
  userId: string,
  files: Array<{ filename: string; bytes: Uint8Array }>,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, { url: string; kind: MediaKind }>> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const out = new Map<string, { url: string; kind: MediaKind }>();
  let i = 0;
  let done = 0;

  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx];
      const res = await uploadAnkiMedia(userId, f.filename, f.bytes);
      if (res) out.set(f.filename, res);
      done++;
      options.onProgress?.(done, files.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}
