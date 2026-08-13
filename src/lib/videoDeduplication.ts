import { parseVideoUrl } from "./videoEmbed";

/**
 * Generate a consistent content hash for video deduplication
 * Uses platform + video_id as the basis for the hash
 */
export async function generateContentHash(
  url: string,
  durationSeconds?: number
): Promise<string | null> {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;

  // Create a consistent string to hash
  const baseString = `${parsed.platform}:${parsed.videoId}`;
  
  // If duration is provided, include it with tolerance (±5 seconds)
  const hashInput = durationSeconds 
    ? `${baseString}:${Math.floor(durationSeconds / 5) * 5}`
    : baseString;

  // Generate SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Check if a video has been processed before
 * Returns cached transcription data if available
 */
export interface ProcessedVideo {
  id: string;
  content_hash: string;
  original_url: string;
  platform: string;
  video_id: string;
  duration_seconds: number | null;
  processed_at: string;
  transcription_data: any;
  processing_engines: string[] | null;
  source_language: string | null;
  dialect: string | null;
}

export function isCacheRecent(processedAt: string, maxAgeDays: number = 30): boolean {
  const processed = new Date(processedAt);
  const now = new Date();
  const ageInDays = (now.getTime() - processed.getTime()) / (1000 * 60 * 60 * 24);
  return ageInDays < maxAgeDays;
}
