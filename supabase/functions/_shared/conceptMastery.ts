// Write side of `user_concept_mastery` — the table the curriculum-concepts
// migration created and nothing has ever populated.
//
// See conceptMasteryCore.ts for why this matters and for the ladder itself.
// This half does the IO: resolve (or create) the concept, read the learner's
// current row, fold the outcomes in, write it back.
//
// Concepts are keyed on the *category* a drill was requested for
// ("negation", "verb-conjugation"), not on the free-text `grammar_point` the
// model returns per question. The category is a fixed, six-item taxonomy the
// learner actually picks from, so it makes a stable ladder and a surface the UI
// can show. Keying on generated prose would mint a new concept row for every
// paraphrase the model produced and measure nothing.
//
// extract-concepts now canonicalises its own grammar keys onto that same
// taxonomy (_shared/grammarTaxonomy.ts), so content tagged with a grammar point
// and a learner's drill mastery land on one concept row and can finally be
// joined — which is the whole reason the concept graph exists.
//
// Everything here is best-effort and never throws: recording mastery must not
// be able to fail the request the learner is waiting on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  applyOutcomes,
  INITIAL_MASTERY,
  STRENGTH_LADDER,
  type MasteryState,
  type MasteryStrength,
} from "./conceptMasteryCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Cap per request — a drill is five questions; this is generous headroom. */
const MAX_OUTCOMES = 40;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface ConceptRef {
  kind: "vocab" | "grammar" | "theme" | "scenario" | "phrase";
  /** Stable identifier, unique per (kind, dialect). Lower-cased by this module. */
  key: string;
  /** Human-readable gloss, used only when the concept is created here. */
  label?: string;
  dialect?: string;
  cefrLevel?: string | null;
}

function isStrength(v: unknown): v is MasteryStrength {
  return typeof v === "string" && (STRENGTH_LADDER as readonly string[]).includes(v);
}

/**
 * Find the concept, creating it if this is the first time anyone has been
 * measured against it.
 *
 * Deliberately not an upsert: `curriculum_concepts` rows may have been curated
 * by an admin or enriched by extract-concepts, and an upsert here would
 * overwrite their gloss and CEFR level with whatever the drill happened to
 * pass. Insert-if-missing keeps this a writer of last resort. The conflict path
 * covers the race where two requests create the same concept at once.
 */
async function resolveConceptId(
  supa: ReturnType<typeof adminClient>,
  ref: ConceptRef,
): Promise<string | null> {
  const key = ref.key.trim().toLowerCase();
  if (!key) return null;
  const dialect = ref.dialect || "Gulf";

  const existing = await supa
    .from("curriculum_concepts")
    .select("id")
    .eq("kind", ref.kind)
    .eq("key", key)
    .eq("dialect", dialect)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;

  const inserted = await supa
    .from("curriculum_concepts")
    .insert({
      kind: ref.kind,
      key,
      display_english: ref.label ?? null,
      dialect,
      cefr_level: ref.cefrLevel ?? null,
    })
    .select("id")
    .maybeSingle();
  if (inserted.data?.id) return inserted.data.id as string;

  // Lost the race (or the insert failed) — read it back rather than dropping
  // the learner's answers on the floor.
  const retry = await supa
    .from("curriculum_concepts")
    .select("id")
    .eq("kind", ref.kind)
    .eq("key", key)
    .eq("dialect", dialect)
    .maybeSingle();
  return (retry.data?.id as string | undefined) ?? null;
}

/**
 * Fold a sequence of right/wrong answers into one concept's mastery row.
 *
 * Returns the concept id on success, null if nothing was recorded. Never
 * throws.
 */
export async function recordConceptOutcomes(
  userId: string | null | undefined,
  ref: ConceptRef,
  outcomes: boolean[],
): Promise<string | null> {
  if (!userId || outcomes.length === 0) return null;

  try {
    const supa = adminClient();
    const conceptId = await resolveConceptId(supa, ref);
    if (!conceptId) return null;

    const { data: row } = await supa
      .from("user_concept_mastery")
      .select("exposures, correct, incorrect, ease, strength")
      .eq("user_id", userId)
      .eq("concept_id", conceptId)
      .maybeSingle();

    const prev: MasteryState = row
      ? {
        exposures: Number(row.exposures) || 0,
        correct: Number(row.correct) || 0,
        incorrect: Number(row.incorrect) || 0,
        ease: Number(row.ease) || INITIAL_MASTERY.ease,
        strength: isStrength(row.strength) ? row.strength : "new",
      }
      : INITIAL_MASTERY;

    const next = applyOutcomes(prev, outcomes.slice(0, MAX_OUTCOMES));
    if (!next) return null;

    const { error } = await supa
      .from("user_concept_mastery")
      .upsert({ user_id: userId, concept_id: conceptId, ...next }, {
        onConflict: "user_id,concept_id",
      });
    if (error) {
      console.warn("[conceptMastery] upsert failed:", error.message);
      return null;
    }
    return conceptId;
  } catch (e) {
    console.warn("[conceptMastery] threw:", e);
    return null;
  }
}
