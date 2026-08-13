import type { LahjaStage, ParsedAnkiCard } from "./types";

export interface MappedSchedule {
  stage: LahjaStage;
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  lapses: number;
  is_leech: boolean;
  next_review_at: string; // ISO
}

/**
 * Map an Anki card's scheduling state onto Lahja's SRS stages.
 * Anki: type 0=new, 1=learning, 2=review, 3=relearning.
 */
export function mapAnkiSchedule(card: ParsedAnkiCard): MappedSchedule {
  const type = card.ankiType ?? 0;
  const ivl = Math.max(0, Math.round(card.ankiIvl ?? 0));
  const reps = Math.max(0, card.ankiReps ?? 0);
  const lapses = Math.max(0, card.ankiLapses ?? 0);
  const easeRaw = card.ankiFactor && card.ankiFactor > 0 ? card.ankiFactor / 1000 : 2.5;
  const ease = Math.max(1.3, Math.min(easeRaw, 3.5));
  const isLeech = lapses >= 4;

  // New
  if (type === 0 || reps === 0) {
    return scheduleFor("NEW", 0, 2.5, 0, isLeech, lapses);
  }

  // Learning / relearning
  if (type === 1 || type === 3) {
    return scheduleFor("LEARNING_1D", Math.max(1, reps), ease, 1, isLeech, lapses);
  }

  // Review
  if (ivl < 3) return scheduleFor("LEARNING_3D", Math.max(2, reps), ease, Math.max(1, ivl), isLeech, lapses);
  if (ivl < 7) return scheduleFor("REVIEWING_7D", Math.max(3, reps), ease, ivl, isLeech, lapses);
  if (ivl < 21) return scheduleFor("REVIEWING_14D", Math.max(4, reps), ease, ivl, isLeech, lapses);
  return scheduleFor("MATURE_21D", Math.max(5, reps), ease, Math.min(ivl, 365), isLeech, lapses);
}

function scheduleFor(
  stage: LahjaStage,
  repetitions: number,
  ease_factor: number,
  interval_days: number,
  is_leech: boolean,
  lapses: number,
): MappedSchedule {
  const nextMs = Date.now() + interval_days * 86400000;
  return {
    stage,
    repetitions,
    interval_days,
    ease_factor,
    lapses,
    is_leech,
    next_review_at: new Date(nextMs).toISOString(),
  };
}
