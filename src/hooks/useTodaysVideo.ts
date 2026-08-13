import { useMemo } from "react";
import { useDialect } from "@/contexts/DialectContext";
import { useUserLevel } from "./useUserLevel";
import { useDiscoverVideos, difficultyWindow, type DiscoverVideo } from "./useDiscoverVideos";
import { DIALECT_MODULE_VALUES, type Dialect } from "@/config";

/**
 * The one clip the home page leads with.
 *
 * Watching native video is the thing this app is for, so the home page opens
 * with a single clip rather than a browse list — one decision, already made for
 * the learner. Two rules shape which clip that is:
 *
 * 1. It is dialect-first. A Gulf learner gets Gulf.
 * 2. It is never empty when the library is not. A dialect we have not filmed
 *    much of yet, or a level window with nothing in it, must not blank the
 *    card — the learner would just see a home page with no video on it and
 *    conclude the feature does not exist. Each filter falls back to the wider
 *    pool instead of returning nothing.
 *
 * The pool is ordered newest-first by created_at, so the lead clip is the most
 * recently uploaded and published one.
 */

const sameDifficulty = (a: string | null | undefined, b: string) =>
  (a ?? "").toLowerCase() === b.toLowerCase();

export interface TodaysVideo {
  /** The clip to lead with, or null when the library has nothing published. */
  video: DiscoverVideo | null;
  /** True when the active dialect had nothing and this came from another one. */
  isFromAnotherDialect: boolean;
  isLoading: boolean;
}

export function useTodaysVideo(): TodaysVideo {
  const { activeDialect } = useDialect();
  const { placementLevel } = useUserLevel();

  const inDialect = useDiscoverVideos({ dialect: activeDialect });
  const dialectIsEmpty = inDialect.isSuccess && (inDialect.data?.length ?? 0) === 0;
  // Only asked for once the dialect-scoped read has come back empty, so the
  // common case stays a single request.
  const anyDialect = useDiscoverVideos(undefined, { enabled: dialectIsEmpty });

  const pool = useMemo(
    () => (inDialect.data?.length ? inDialect.data : (anyDialect.data ?? [])),
    [inDialect.data, anyDialect.data],
  );

  const video = useMemo(() => {
    if (pool.length === 0) return null;

    // Difficulty is written by hand in a few places and arrives in both cases,
    // so it is compared case-insensitively rather than filtered server-side —
    // an `in.()` on "Beginner" silently drops every row stored as "beginner",
    // which reads as an empty library.
    const window = difficultyWindow(placementLevel);
    const atLevel = window
      ? pool.filter((v) => window.some((d) => sameDifficulty(v.difficulty, d)))
      : pool;
    const candidates = atLevel.length > 0 ? atLevel : pool;

    // The pool is already ordered newest-first by created_at (see
    // useDiscoverVideos), so the first candidate is the most recently
    // uploaded and published clip — lead with that rather than rotating.
    return candidates[0];
  }, [pool, placementLevel]);

  // A Gulf-module video can be tagged with the specific country the AI
  // detected (Saudi, Kuwaiti, ...) rather than the bare "Gulf" module name,
  // so this has to check module membership rather than raw string equality —
  // otherwise every country-tagged Gulf clip would misreport as borrowed from
  // another dialect even though it came back from the dialect-scoped query.
  const moduleValues = DIALECT_MODULE_VALUES[activeDialect as Dialect];
  const isFromAnotherDialect = !!video && !(moduleValues?.includes(video.dialect) ?? video.dialect === activeDialect);

  return {
    video,
    isFromAnotherDialect,
    isLoading: inDialect.isLoading || (dialectIsEmpty && anyDialect.isLoading),
  };
}
