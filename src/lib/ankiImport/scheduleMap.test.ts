import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapAnkiSchedule } from "./scheduleMap";
import type { ParsedAnkiCard } from "./types";

/**
 * Translating an Anki card's scheduling state into this app's SRS stages.
 *
 * This runs once per card on import, and it is the only chance to get it right:
 * nothing re-derives a card's stage afterwards, so a learner who imports a
 * ten-thousand-card deck they have been reviewing for years either keeps that
 * history or silently starts over. Mapping too aggressively is just as bad —
 * a card promoted to MATURE_21D on import will not be seen again for three
 * weeks whether or not the learner actually knows it.
 *
 * Anki's `type` is 0 new, 1 learning, 2 review, 3 relearning; `ivl` is the
 * current interval in days; `factor` is ease in permille.
 */

const aCard = (over: Partial<ParsedAnkiCard> = {}): ParsedAnkiCard =>
  ({
    tags: [],
    wordArabic: "باب",
    wordEnglish: "door",
    imageRefs: [],
    audioRefs: [],
    ankiType: 2,
    ankiIvl: 10,
    ankiReps: 12,
    ankiLapses: 0,
    ankiFactor: 2500,
    ...over,
  }) as ParsedAnkiCard;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cards that have never been studied", () => {
  it("maps a new card to NEW", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 0, ankiIvl: 0, ankiReps: 0 }));

    expect(mapped.stage).toBe("NEW");
    expect(mapped.repetitions).toBe(0);
    expect(mapped.interval_days).toBe(0);
  });

  it("treats a card with no repetitions as new whatever its type says", () => {
    // A deck edited by hand can carry a review type with zero reps; trusting
    // the type alone would schedule a card the learner has never seen weeks
    // out.
    const mapped = mapAnkiSchedule(aCard({ ankiType: 2, ankiIvl: 30, ankiReps: 0 }));

    expect(mapped.stage).toBe("NEW");
  });

  it("gives a new card the default ease rather than the deck's", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 0, ankiReps: 0, ankiFactor: 1300 }));

    // An unstudied card has no ease history worth importing.
    expect(mapped.ease_factor).toBe(2.5);
  });

  it("makes a new card due immediately", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 0, ankiReps: 0 }));

    expect(mapped.next_review_at).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("cards mid-learning", () => {
  it("maps learning and relearning to the one-day stage", () => {
    for (const ankiType of [1, 3]) {
      const mapped = mapAnkiSchedule(aCard({ ankiType, ankiReps: 3, ankiIvl: 0 }));

      // Both are cards the learner is actively failing or has just failed;
      // tomorrow is the right answer for each.
      expect(mapped.stage).toBe("LEARNING_1D");
      expect(mapped.interval_days).toBe(1);
    }
  });

  it("keeps the repetitions the card had", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 1, ankiReps: 7 }));

    expect(mapped.repetitions).toBe(7);
  });

  it("schedules it for tomorrow", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 1, ankiReps: 3 }));

    expect(mapped.next_review_at).toBe("2026-01-16T12:00:00.000Z");
  });
});

describe("cards in review", () => {
  const stageFor = (ankiIvl: number) => mapAnkiSchedule(aCard({ ankiIvl })).stage;

  it("puts a short interval in the three-day stage", () => {
    expect(stageFor(1)).toBe("LEARNING_3D");
    expect(stageFor(2)).toBe("LEARNING_3D");
  });

  it("puts a week-ish interval in the seven-day stage", () => {
    expect(stageFor(3)).toBe("REVIEWING_7D");
    expect(stageFor(6)).toBe("REVIEWING_7D");
  });

  it("puts a fortnight-ish interval in the fourteen-day stage", () => {
    expect(stageFor(7)).toBe("REVIEWING_14D");
    expect(stageFor(20)).toBe("REVIEWING_14D");
  });

  it("puts anything longer in the mature stage", () => {
    expect(stageFor(21)).toBe("MATURE_21D");
    expect(stageFor(400)).toBe("MATURE_21D");
  });

  it("keeps the card's own interval rather than the stage's nominal one", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiIvl: 45 }));

    // The stage is a label; the interval is what actually decides when the
    // card comes back, and a learner who had earned 45 days should not be
    // dropped to 21.
    expect(mapped.stage).toBe("MATURE_21D");
    expect(mapped.interval_days).toBe(45);
  });

  it("caps a very long interval at a year", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiIvl: 3650 }));

    // Anki will happily schedule a decade out. A card nobody sees for ten
    // years is not in the deck in any meaningful sense.
    expect(mapped.interval_days).toBe(365);
  });

  it("floors the repetitions by stage", () => {
    // A card with a mature interval but a suspiciously low rep count still
    // counts as reviewed, or the UI shows a mature card as barely studied.
    expect(mapAnkiSchedule(aCard({ ankiIvl: 45, ankiReps: 1 })).repetitions).toBe(5);
    expect(mapAnkiSchedule(aCard({ ankiIvl: 10, ankiReps: 1 })).repetitions).toBe(4);
    expect(mapAnkiSchedule(aCard({ ankiIvl: 5, ankiReps: 1 })).repetitions).toBe(3);
    expect(mapAnkiSchedule(aCard({ ankiIvl: 2, ankiReps: 1 })).repetitions).toBe(2);
  });

  it("schedules from the interval it kept", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiIvl: 10 }));

    expect(mapped.next_review_at).toBe("2026-01-25T12:00:00.000Z");
  });
});

describe("ease", () => {
  it("converts permille to a multiplier", () => {
    expect(mapAnkiSchedule(aCard({ ankiFactor: 2500 })).ease_factor).toBe(2.5);
    expect(mapAnkiSchedule(aCard({ ankiFactor: 1900 })).ease_factor).toBe(1.9);
  });

  it("clamps a punishing ease up to the floor", () => {
    // Anki allows lower than 1.3; below that a card effectively never grows
    // its interval again.
    expect(mapAnkiSchedule(aCard({ ankiFactor: 800 })).ease_factor).toBe(1.3);
  });

  it("clamps a runaway ease down to the ceiling", () => {
    expect(mapAnkiSchedule(aCard({ ankiFactor: 9000 })).ease_factor).toBe(3.5);
  });

  it("falls back to the default when the deck records none", () => {
    expect(mapAnkiSchedule(aCard({ ankiFactor: 0 })).ease_factor).toBe(2.5);
    expect(mapAnkiSchedule(aCard({ ankiFactor: undefined })).ease_factor).toBe(2.5);
  });
});

describe("lapses and leeches", () => {
  it("carries the lapse count across", () => {
    expect(mapAnkiSchedule(aCard({ ankiLapses: 3 })).lapses).toBe(3);
  });

  it("flags a card that has been forgotten four times", () => {
    expect(mapAnkiSchedule(aCard({ ankiLapses: 3 })).is_leech).toBe(false);
    expect(mapAnkiSchedule(aCard({ ankiLapses: 4 })).is_leech).toBe(true);
  });

  it("flags a leech even when the card is otherwise new", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiType: 0, ankiReps: 0, ankiLapses: 9 }));

    // The history says this word has never stuck; surfacing it in the leech
    // panel is the point of importing lapses at all.
    expect(mapped.stage).toBe("NEW");
    expect(mapped.is_leech).toBe(true);
  });
});

describe("decks with missing or nonsense values", () => {
  it("defaults every absent field", () => {
    const mapped = mapAnkiSchedule({
      tags: [],
      wordArabic: "باب",
      wordEnglish: "door",
      imageRefs: [],
      audioRefs: [],
    });

    // A text export carries no scheduling at all, so every card arrives like
    // this.
    expect(mapped.stage).toBe("NEW");
    expect(mapped.repetitions).toBe(0);
    expect(mapped.lapses).toBe(0);
    expect(mapped.ease_factor).toBe(2.5);
    expect(mapped.is_leech).toBe(false);
  });

  it("refuses a negative interval, rep count or lapse count", () => {
    const mapped = mapAnkiSchedule(
      aCard({ ankiType: 2, ankiIvl: -5, ankiReps: -3, ankiLapses: -1 }),
    );

    // A negative interval would schedule the card in the past forever; a
    // negative rep count would render as a negative streak.
    expect(mapped.interval_days).toBeGreaterThanOrEqual(0);
    expect(mapped.repetitions).toBeGreaterThanOrEqual(0);
    expect(mapped.lapses).toBe(0);
  });

  it("rounds a fractional interval", () => {
    expect(mapAnkiSchedule(aCard({ ankiIvl: 10.6 })).interval_days).toBe(11);
  });

  it("always produces a parseable timestamp", () => {
    const mapped = mapAnkiSchedule(aCard({ ankiIvl: 45 }));

    expect(Number.isNaN(Date.parse(mapped.next_review_at))).toBe(false);
  });
});
