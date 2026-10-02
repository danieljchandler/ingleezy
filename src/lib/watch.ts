import type { TranscriptLine } from "@/types/transcript";

/**
 * What the Watch screen (`/discover/:videoId`) shows, kept out of the page so
 * it can be tested without a video player.
 */

/** One transcript line as the screen shows it. */
export interface LineView {
  /** The line as spoken: the big text, and the words a learner can tap. */
  spoken: string;
  spokenLang: "en" | "ar";
  /** The support line under it, in the other language. Empty when there is none. */
  support: string;
}

/**
 * Two kinds of video share the page, and they store their lines the opposite
 * way round. On this app's own English uploads `english` is the line as spoken
 * and `arabic` is the dialect scaffold. On videos bridged from Hakiya the
 * speech is Arabic: `arabic` is what was said and `translation` its English.
 *
 * The page used to render `arabic` as the spoken line on both, so an English
 * video showed only its Arabic scaffold and the English being studied never
 * appeared at all.
 */
export function lineView(line: TranscriptLine): LineView {
  const english = line.english?.trim();
  if (english) return { spoken: english, spokenLang: "en", support: line.arabic?.trim() ?? "" };
  return { spoken: line.arabic?.trim() ?? "", spokenLang: "ar", support: line.translation?.trim() ?? "" };
}

/** `m:ss` for a position in milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The speeds one button steps through. Slower comes first because that is what
 * a learner reaches for; 1.25× is there for the clip they already know.
 */
export const SPEEDS = [1, 0.75, 0.5, 1.25] as const;

/** The speed after `current`. Anything off the list goes back to normal. */
export function nextSpeed(current: number): number {
  const i = SPEEDS.indexOf(current as (typeof SPEEDS)[number]);
  return i < 0 ? 1 : SPEEDS[(i + 1) % SPEEDS.length];
}

const DIALECT_AR: Record<string, string> = {
  Gulf: "خليجي",
  Egyptian: "مصري",
  Yemeni: "يمني",
  MSA: "فصحى",
  Levantine: "شامي",
  Maghrebi: "مغاربي",
};

const DIFFICULTY_AR: Record<string, string> = {
  Beginner: "مبتدئ",
  Intermediate: "متوسط",
  Advanced: "متقدم",
  Expert: "خبير",
};

/** The dialect's Arabic name, or the stored value when it has none. */
export function dialectName(dialect: string | null | undefined): string {
  if (!dialect) return "";
  return DIALECT_AR[dialect] ?? dialect;
}

/**
 * The video's level: its CEFR band when it has one (kept in Latin, as learners
 * see it everywhere else), otherwise the difficulty in Arabic.
 */
export function videoLevel(video: { cefr_level?: string | null; difficulty?: string | null }): string {
  const cefr = video.cefr_level?.trim();
  if (cefr) return cefr.toUpperCase();
  if (!video.difficulty) return "";
  return DIFFICULTY_AR[video.difficulty] ?? video.difficulty;
}

/**
 * The name of the switch that shows the support line: on an English video it
 * is the learner's dialect ("الترجمة بالخليجي"), on an Arabic one the English.
 */
export function supportLabel(dialect: string | null | undefined, spokenLang: "en" | "ar"): string {
  if (spokenLang === "ar") return "الترجمة بالإنجليزي";
  const known = dialect ? DIALECT_AR[dialect] : undefined;
  return known ? `الترجمة بال${known}` : "الترجمة";
}

/** Whether `text` contains Arabic letters (so it must not be set as an English island). */
export function hasArabic(text: string | null | undefined): boolean {
  return /[\u0600-\u06FF]/.test(text ?? "");
}

/** How far past a line's end still counts as playing over it, not a jump. */
const OVERRUN_MS = 1500;
/** How far before a line's start counts as a jump back to an earlier one. */
const RUNBACK_MS = 500;

/** What "pause after each line" does on one tick of a playing clip. */
export type LineStop = { kind: "none" } | { kind: "pause" } | { kind: "follow"; index: number };

/**
 * One tick of "pause after each line" (وقفة بعد السطر).
 *
 * - Playing over the current line's end stops the clip there.
 * - Playing on after that stop — the learner pressed play — moves to the line
 *   now playing, so the next stop is at the end of that one. Before this, the
 *   mode stopped again at once, and the only way on was the mode's own skip
 *   buttons.
 * - A jump away from the line (a scrub either way) follows to the line at the
 *   new position without stopping.
 *
 * `follow` with index -1 means the clip is past its last line: play on.
 */
export function lineStopStep(args: {
  nowMs: number;
  startMs: number | null;
  endMs: number | null;
  /** Whether this mode stopped the clip at `endMs` and it has not moved since. */
  stoppedAtEnd: boolean;
  lines: ReadonlyArray<{ startMs?: number; endMs?: number }>;
}): LineStop {
  const { nowMs, startMs, endMs, stoppedAtEnd, lines } = args;
  const lineAt = () => lines.findIndex((l) => typeof l.endMs === "number" && nowMs < l.endMs);

  if (endMs == null) {
    const index = lineAt();
    return index >= 0 ? { kind: "follow", index } : { kind: "none" };
  }
  if (nowMs >= endMs) {
    if (!stoppedAtEnd && nowMs < endMs + OVERRUN_MS) return { kind: "pause" };
    return { kind: "follow", index: lineAt() };
  }
  if (startMs != null && nowMs < startMs - RUNBACK_MS) return { kind: "follow", index: lineAt() };
  return { kind: "none" };
}
