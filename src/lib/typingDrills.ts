/**
 * The English spelling trainer's drill logic (written production, C3) —
 * replaces the Arabic-keyboard drill this used to be.
 *
 * The old drill existed because Arabic script needs a mapped keyboard: a
 * learner has to be shown which physical key types ذ before they can type
 * it. English doesn't have that problem — every learner reaching this page
 * already has a QWERTY keyboard and already knows where its keys are, since
 * they type English URLs, app names and search terms daily. What English
 * *does* have that Arabic mostly doesn't is unpredictable spelling: the same
 * sound written several ways (/iː/ is "ee", "ea", "e", "y"...), which is the
 * whole reason `src/data/englishSounds.ts` exists. So this drill teaches
 * spelling, not key placement: type the word you hear, drawn from the
 * sounds introduced so far in the English Sounds journey — the same four
 * stages its checkpoints use, so a learner who has met a sound has also
 * typed it.
 *
 * Pure module: the stage grouping, the drill builder and the scoring are all
 * data-in data-out, tested in src/lib/typingDrills.test.ts. Rendering lives
 * in the WritingPractice page.
 */
import { ENGLISH_SOUNDS, CHECKPOINT_INDICES, type EnglishSound } from "@/data/englishSounds";

export interface SpellingStage {
  /** 0..3, mirroring the English Sounds journey's four checkpoints. */
  index: number;
  title: string;
  sounds: EnglishSound[];
}

/** The journey's four checkpoint groups: sounds 0-6, 7-13, 14-20, 21-27. */
export const SPELLING_STAGES: SpellingStage[] = CHECKPOINT_INDICES.map((end, i) => {
  const start = i === 0 ? 0 : CHECKPOINT_INDICES[i - 1] + 1;
  const sounds = ENGLISH_SOUNDS.slice(start, end + 1);
  return {
    index: i,
    title: `${sounds[0].ipa} – ${sounds[sounds.length - 1].ipa}`,
    sounds,
  };
});

export interface DrillItem {
  /** Lowercased, what the learner must match. */
  target: string;
  /** The word as written normally, shown once the item is done. */
  display: string;
  /** Arabic gloss. */
  ar: string;
}

/**
 * The drill for one stage: every example word from this stage's sounds,
 * deduplicated (several sounds can share an example — "bag" is both /b/'s
 * example and final_devoicing's). Deterministic order — same stage, same
 * drill — so a learner can retry a run and progress is comparable.
 */
export function buildDrill(stageIndex: number): DrillItem[] {
  const stage = SPELLING_STAGES[stageIndex];
  if (!stage) return [];

  const seen = new Set<string>();
  const items: DrillItem[] = [];
  for (const sound of stage.sounds) {
    for (const example of sound.examples) {
      const target = example.en.toLowerCase();
      if (seen.has(target)) continue;
      seen.add(target);
      items.push({ target, display: example.en, ar: example.ar });
    }
  }
  return items;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface DrillScore {
  typed: number;
  errors: number;
  /** 0-100, whole number. 100 with nothing typed yet. */
  accuracy: number;
}

export function scoreDrill(typed: number, errors: number): DrillScore {
  const accuracy = typed === 0 ? 100 : Math.round(((typed - Math.min(errors, typed)) / typed) * 100);
  return { typed, errors, accuracy };
}

/** Case-insensitive character match — the drill cares about spelling, not shift-key discipline. */
export function keystrokeMatches(typedChar: string, expectedChar: string): boolean {
  return typedChar.toLowerCase() === expectedChar.toLowerCase();
}
