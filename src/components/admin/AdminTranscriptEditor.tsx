import { useMemo, useCallback, useRef } from "react";
import type { TranscriptLine, WordToken, Segment, Word } from "@/types/transcript";
import TranscriptEditor from "@/components/TranscriptEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * What the edge function actually said, rather than what supabase-js says.
 *
 * The client raises `FunctionsHttpError` with the fixed message "Edge Function
 * returned a non-2xx status code" for every non-2xx, whatever the function put
 * in the body — so a 429 over-quota, a 400 bad request and a 500 crash all
 * reached the admin as the same opaque line, and there was nothing on screen to
 * act on. The status and the response live on `error.context`; the same place
 * `showCapToastIfLimited` reads them from.
 */
async function describeFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in ctx) {
    const response = ctx as Response;
    try {
      const body = (await response.clone().json()) as { message?: string; error?: string };
      const detail = body.message || body.error;
      if (detail) return `${response.status}: ${detail}`;
    } catch {
      /* not JSON — the status is still worth more than the generic message */
    }
    return `The server returned ${response.status}.`;
  }
  return (error as { message?: string } | null)?.message ?? "Unknown error";
}

interface AdminTranscriptEditorProps {
  lines: TranscriptLine[];
  onChange: (lines: TranscriptLine[]) => void;
  audioUrl?: string;
  /**
   * The clip's dialect. Only the Arabic gloss depends on it — the segmentation
   * itself reads English — but the resegmenter defaults to Gulf without it, so
   * an Egyptian clip came back glossed in Khaleeji.
   */
  dialect?: string;
}

/**
 * Adapter that bridges TranscriptLine[] (admin data model, ms-based)
 * with TranscriptEditor's Segment[] (seconds-based).
 *
 * Token glosses are preserved via a ref map so round-tripping doesn't lose data.
 */
export function AdminTranscriptEditor({ lines, onChange, audioUrl, dialect }: AdminTranscriptEditorProps) {
  /**
   * The glosses that came in, kept per line and in order, so they survive the
   * round-trip through the editor.
   *
   * These were once keyed by `segmentId:tokenIndex:surface`, which tied every
   * gloss to a position. Deleting one word from the middle of a line renumbers
   * everything after it, so each of those words looked up a key that no longer
   * existed: the gloss was dropped and a fresh id minted, and the token came
   * back reading as brand new. Fixing a typo in the first word of a ten-word
   * line silently discarded nine hand-written glosses. A split was worse — one
   * half gets a new segment id, so none of its words could match at all.
   *
   * Order within the line is what actually carries the meaning, and it is what
   * the index was really standing in for: it is the only thing that tells the
   * two في in "في البيت في الصباح" apart. So the glosses are claimed in order
   * by surface instead, which survives a word being added or removed anywhere
   * in the line.
   *
   * Lines that have disappeared are kept on purpose — a split's original id is
   * gone, and its glosses are exactly what the two halves need.
   */
  const glossPoolRef = useRef<Map<string, WordToken[]>>(new Map());

  useMemo(() => {
    for (const line of lines) {
      glossPoolRef.current.set(line.id, [...(line.tokens ?? [])]);
    }
  }, [lines]);

  const initialSegments: Segment[] = useMemo(
    () =>
      lines.map((line) => {
        const startSec = (line.startMs ?? 0) / 1000;
        const endSec = (line.endMs ?? 0) / 1000;
        const tokens = line.tokens ?? [];
        const n = Math.max(tokens.length, 1);
        const dur = Math.max(endSec - startSec, 0);
        const step = dur / n;
        return {
          id: line.id,
          video_id: "",
          start: startSec,
          end: endSec,
          text: line.arabic,
          translation: line.translation,
          confidence: 1,
          // Distribute word timings evenly across the line so AI re-segmentation
          // (which rebuilds segment.start/end from word timings) preserves real
          // timestamps instead of collapsing to 0.
          words: tokens.map<Word>((t, i) => ({
            word: t.surface,
            start: startSec + step * i,
            end: startSec + step * (i + 1),
            confidence: 1,
          })),
        };
      }),
    [lines],
  );

  const handleSave = useCallback(
    (segments: Segment[]) => {
      // Rebuilt per save so each cached token can be claimed exactly once: two
      // occurrences of the same word must not both end up with the first one's
      // gloss.
      const claimed = new Set<WordToken>();
      const perLine = new Map<string, Map<string, WordToken[]>>();
      // The fallback for a line the editor renamed — a split gives one half a
      // fresh id, so its words have no line of their own to look in.
      const anywhere = new Map<string, WordToken[]>();

      const push = (bucket: Map<string, WordToken[]>, surface: string, token: WordToken) => {
        const queue = bucket.get(surface);
        if (queue) queue.push(token);
        else bucket.set(surface, [token]);
      };

      for (const [lineId, tokens] of glossPoolRef.current) {
        const bySurface = new Map<string, WordToken[]>();
        for (const token of tokens) {
          push(bySurface, token.surface, token);
          push(anywhere, token.surface, token);
        }
        perLine.set(lineId, bySurface);
      }

      const take = (bucket: Map<string, WordToken[]> | undefined, surface: string) => {
        const queue = bucket?.get(surface);
        while (queue?.length) {
          const token = queue.shift()!;
          if (!claimed.has(token)) return token;
        }
        return undefined;
      };

      const updated: TranscriptLine[] = segments.map((seg) => ({
        id: seg.id,
        arabic: seg.text,
        translation: seg.translation,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        tokens: seg.words.map<WordToken>((w) => {
          const cached = take(perLine.get(seg.id), w.word) ?? take(anywhere, w.word);
          if (cached) claimed.add(cached);
          return {
            id: cached?.id ?? crypto.randomUUID(),
            surface: w.word,
            standard: cached?.standard,
            gloss: cached?.gloss,
            compoundRef: cached?.compoundRef,
          };
        }),
      }));
      onChange(updated);
    },
    [onChange],
  );

  const handleAIResegment = useCallback(
    async (segments: Segment[]): Promise<Segment[] | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("ai-resegment-transcript", {
          body: { segments, dialect },
        });
        if (error) throw error;
        const proposed = (data as { segments?: Segment[] } | null)?.segments;
        if (!proposed || proposed.length === 0) {
          toast({
            title: "AI re-segmentation returned no lines",
            description: "Try again or adjust the transcript first.",
            variant: "destructive",
          });
          return null;
        }
        toast({
          title: "AI proposed a new segmentation",
          description: `Review the ${proposed.length} suggested lines and accept or reject.`,
        });
        return proposed;
      } catch (e: unknown) {
        toast({
          title: "AI re-segmentation failed",
          description: await describeFunctionError(e),
          variant: "destructive",
        });
        return null;
      }
    },
    [dialect],
  );

  return (
    <TranscriptEditor
      initialSegments={initialSegments}
      videoUrl={audioUrl}
      onSave={handleSave}
      onAIResegment={handleAIResegment}
    />
  );
}
