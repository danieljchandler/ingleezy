export interface SRSStageBreakdown {
  new: number;
  learning: number;
  familiar: number;
  practiced: number;
  strong: number;
  mastered: number;
}

export interface SRSForecastPoint {
  date: string;
  label: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toUTCDateStartMs = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const getDateLabel = (dateMs: number, index: number): string => {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Date(dateMs).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
};

export const createEmptyStageBreakdown = (): SRSStageBreakdown => ({
  new: 0,
  learning: 0,
  familiar: 0,
  practiced: 0,
  strong: 0,
  mastered: 0,
});

/**
 * Classify a card's SRS stage from its FSRS stability (days until 90%
 * retention probability) rather than raw repetition count. Repetitions alone
 * are a poor proxy for memory strength: a lapsed card that's been rated
 * "again" many times keeps its repetition count (it isn't reset — see
 * calculateNextReview's forget branch), so a chronically-forgotten card could
 * still cross a repetition threshold and display as "mastered" while its
 * actual stability is low. Stability directly answers "how well is this
 * remembered right now," which is what a mastery display should show.
 *
 * Thresholds mirror common spaced-repetition conventions: still in the first
 * day is "learning," a week is "familiar," three weeks is "practiced," two
 * months is "strong," and beyond that is "mastered."
 */
export const getSRSStageByStability = (
  repetitions: number,
  stability: number,
): keyof SRSStageBreakdown => {
  if (repetitions <= 0) return "new";
  if (stability < 1) return "learning";
  if (stability < 7) return "familiar";
  if (stability < 21) return "practiced";
  if (stability < 60) return "strong";
  return "mastered";
};

export const buildSRSForecast = (
  reviewDates: Array<string | null | undefined>,
  now: Date = new Date(),
): SRSForecastPoint[] => {
  const startMs = toUTCDateStartMs(now);
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const dateMs = startMs + index * DAY_MS;
    return {
      date: new Date(dateMs).toISOString().split("T")[0],
      label: getDateLabel(dateMs, index),
      count: 0,
    };
  });

  reviewDates.forEach((value) => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;

    const reviewMs = toUTCDateStartMs(date);
    if (reviewMs < startMs) {
      buckets[0].count += 1;
      return;
    }

    const dayIndex = Math.floor((reviewMs - startMs) / DAY_MS);
    if (dayIndex >= 0 && dayIndex < 7) {
      buckets[dayIndex].count += 1;
    }
  });

  return buckets;
};

export const computeSRSRetentionRate = (
  reviews: Array<{ repetitions?: number | null; lapses?: number | null }>,
): number => {
  // Annotated so the accumulator isn't inferred as the (all-optional) element
  // type, which would make every running total possibly null.
  const totals = reviews.reduce<{ repetitions: number; lapses: number }>(
    (acc, review) => {
      const repetitions = Math.max(0, review.repetitions ?? 0);
      const lapses = Math.max(0, Math.min(repetitions, review.lapses ?? 0));
      acc.repetitions += repetitions;
      acc.lapses += lapses;
      return acc;
    },
    { repetitions: 0, lapses: 0 },
  );

  if (totals.repetitions === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totals.repetitions - totals.lapses) / totals.repetitions) * 100)));
};
