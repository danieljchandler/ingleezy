/**
 * useShadowQueue — pulls eligible native-speaker clips for Shadow Mode.
 *
 * Sources (read-only, no new tables):
 *   1. discover_videos.transcript_lines  — YouTube clips played via IFrame API
 *   2. saved_transcriptions.lines        — user-owned uploads with audio_url
 *
 * Eligibility:
 *   - Duration between 1.2s and 6s
 *   - Arabic text length ≥ 2 tokens
 *   - Matches active dialect module when possible
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect, type DialectModule } from "@/contexts/DialectContext";

export type ShadowClipSource = "youtube" | "audio";

export interface ShadowClip {
  id: string;
  source: ShadowClipSource;
  /** YouTube video id (when source === "youtube") */
  youtubeId?: string;
  /** Direct audio URL (when source === "audio") */
  audioUrl?: string;
  text: string;
  translation?: string;
  startSec: number;
  endSec: number;
  dialect: string;
  /** BCP-47 locale for Azure assessment */
  locale: string;
  /** Display title for the source */
  sourceTitle: string;
}

interface RawLine {
  id?: string;
  arabic?: string;
  text?: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
  tokens?: unknown[];
}

export const DIALECT_LOCALE: Record<string, string> = {
  Gulf: "ar-SA",
  Saudi: "ar-SA",
  Kuwaiti: "ar-KW",
  UAE: "ar-AE",
  Bahraini: "ar-BH",
  Qatari: "ar-QA",
  Omani: "ar-OM",
  Egyptian: "ar-EG",
  Yemeni: "ar-SA",
  Levantine: "ar-JO",
  MSA: "ar-SA",
};

const GULF_DIALECTS = new Set(["Gulf", "Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani"]);

function dialectMatches(clipDialect: string, active: DialectModule): boolean {
  if (active === "Gulf") return GULF_DIALECTS.has(clipDialect);
  return clipDialect === active;
}

export function extractYouTubeId(embedUrl: string | null, sourceUrl: string | null): string | null {
  for (const raw of [embedUrl, sourceUrl]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./, "");
      if (host === "youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0];
        if (id) return id;
      }
      if (host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com")) {
        const queryId = url.searchParams.get("v");
        if (queryId) return queryId;
        const parts = url.pathname.split("/").filter(Boolean);
        const markerIndex = parts.findIndex((p) => ["embed", "shorts", "live"].includes(p));
        if (markerIndex >= 0 && parts[markerIndex + 1]) return parts[markerIndex + 1];
      }
    } catch {
      const m = raw.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|live\/|watch\?(?:.*&)?v=)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
      if (m) return m[1];
    }
  }
  return null;
}

function eligibleLine(line: RawLine): boolean {
  const text = (line.arabic || line.text || "").trim();
  if (!text || text.split(/\s+/).length < 2) return false;
  const start = (line.startMs ?? 0) / 1000;
  const end = (line.endMs ?? 0) / 1000;
  const dur = end - start;
  return dur >= 1.2 && dur <= 6;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useShadowQueue(maxClips = 20) {
  const { activeDialect } = useDialect();
  const [clips, setClips] = useState<ShadowClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const collected: ShadowClip[] = [];

      // 1. Discover YouTube videos
      const { data: videos } = await supabase
        .from("discover_videos")
        .select("id, title, dialect, platform, embed_url, source_url, transcript_lines")
        .eq("published", true)
        .eq("platform", "youtube")
        .limit(40);

      for (const v of videos ?? []) {
        if (!dialectMatches(v.dialect, activeDialect)) continue;
        const ytId = extractYouTubeId(v.embed_url, v.source_url);
        if (!ytId) continue;
        const lines = (v.transcript_lines as RawLine[]) ?? [];
        for (const line of lines) {
          if (!eligibleLine(line)) continue;
          collected.push({
            id: `yt-${v.id}-${line.id ?? `${line.startMs}`}`,
            source: "youtube",
            youtubeId: ytId,
            text: (line.arabic || line.text || "").trim(),
            translation: line.translation,
            startSec: (line.startMs ?? 0) / 1000,
            endSec: (line.endMs ?? 0) / 1000,
            dialect: v.dialect,
            locale: DIALECT_LOCALE[v.dialect] ?? "ar-SA",
            sourceTitle: v.title,
          });
        }
      }

      // 2. Saved transcriptions (user's own audio uploads)
      const { data: saved } = await supabase
        .from("saved_transcriptions")
        .select("id, title, dialect, audio_url, lines")
        .not("audio_url", "is", null)
        .limit(20);

      for (const s of saved ?? []) {
        if (!s.audio_url) continue;
        const sd = s.dialect ?? "Gulf";
        if (!dialectMatches(sd, activeDialect)) continue;
        const lines = (s.lines as RawLine[]) ?? [];
        for (const line of lines) {
          if (!eligibleLine(line)) continue;
          collected.push({
            id: `sv-${s.id}-${line.id ?? `${line.startMs}`}`,
            source: "audio",
            audioUrl: s.audio_url,
            text: (line.arabic || line.text || "").trim(),
            translation: line.translation,
            startSec: (line.startMs ?? 0) / 1000,
            endSec: (line.endMs ?? 0) / 1000,
            dialect: sd,
            locale: DIALECT_LOCALE[sd] ?? "ar-SA",
            sourceTitle: s.title,
          });
        }
      }

      setClips(shuffle(collected).slice(0, maxClips));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeDialect, maxClips]);

  useEffect(() => {
    load();
  }, [load]);

  return { clips, loading, error, refresh: load };
}
