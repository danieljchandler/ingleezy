// Shared coverage planner: returns avoid / reinforce / next_up concept lists
// for a generation request, scoped by dialect + CEFR.
//
// Used by curriculum-chat (and any other generator) to keep AI output
// non-repetitive and aligned with spaced reinforcement.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ConceptLite {
  id: string;
  kind: string;
  key: string;
  display_arabic: string | null;
  display_english: string | null;
  cefr_level: string | null;
}

export interface CoveragePlan {
  avoid: ConceptLite[];      // recently introduced; do not reuse as new
  reinforce: ConceptLite[];  // due for re-exposure or cohort-weak
  next_up: ConceptLite[];    // candidate concepts to introduce
  // Strings ready to drop into a prompt.
  promptBlock: string;
}

const REINFORCE_INTERVAL_DAYS = 7;   // re-expose if last seen >7d ago
const AVOID_RECENT_DAYS = 14;        // do not reintroduce if seen <14d
const MAX_PER_LIST = 25;

export async function planCoverage(opts: {
  dialect: string;
  cefr?: string | null;
  stageId?: string | null;
  contentType: string;
  userId?: string | null;        // when present, personalize reinforcement
  serviceClient?: SupabaseClient;
}): Promise<CoveragePlan> {
  const supabase =
    opts.serviceClient ??
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

  const dialect = opts.dialect || "Gulf";
  const cefr = opts.cefr ?? null;

  // 1. All concepts in scope
  let q = supabase
    .from("curriculum_concepts")
    .select("id, kind, key, display_arabic, display_english, cefr_level, first_introduced_at")
    .eq("dialect", dialect);
  if (cefr) q = q.eq("cefr_level", cefr);
  const { data: concepts } = await q.limit(500);
  const all = concepts ?? [];

  // 2. Recent links — what was published recently
  const sinceAvoid = new Date(Date.now() - AVOID_RECENT_DAYS * 86400_000).toISOString();
  const { data: recentLinks } = await supabase
    .from("content_concept_links")
    .select("concept_id, created_at, role")
    .gte("created_at", sinceAvoid)
    .limit(1000);
  const recentByConcept = new Map<string, string>();
  (recentLinks ?? []).forEach((l: any) => {
    if (!recentByConcept.has(l.concept_id)) recentByConcept.set(l.concept_id, l.created_at);
  });

  const reinforceCutoff = Date.now() - REINFORCE_INTERVAL_DAYS * 86400_000;

  // 3. Per-user mastery (optional)
  const dueConceptIds = new Set<string>();
  if (opts.userId) {
    const { data: mastery } = await supabase
      .from("user_concept_mastery")
      .select("concept_id, next_due_at, strength")
      .eq("user_id", opts.userId)
      .lte("next_due_at", new Date().toISOString())
      .limit(200);
    (mastery ?? []).forEach((m: any) => dueConceptIds.add(m.concept_id));
  }

  const avoid: ConceptLite[] = [];
  const reinforce: ConceptLite[] = [];
  const next_up: ConceptLite[] = [];

  for (const c of all) {
    const recent = recentByConcept.get(c.id);
    const recentMs = recent ? Date.parse(recent) : 0;
    const lite: ConceptLite = {
      id: c.id,
      kind: c.kind,
      key: c.key,
      display_arabic: c.display_arabic,
      display_english: c.display_english,
      cefr_level: c.cefr_level,
    };
    if (opts.userId && dueConceptIds.has(c.id)) {
      reinforce.push(lite);
    } else if (recent && recentMs > reinforceCutoff) {
      avoid.push(lite);
    } else if (recent) {
      reinforce.push(lite);
    } else {
      next_up.push(lite);
    }
  }

  const trim = (arr: ConceptLite[]) => arr.slice(0, MAX_PER_LIST);
  const _avoid = trim(avoid);
  const _reinf = trim(reinforce);
  const _next = trim(next_up);

  const fmt = (c: ConceptLite) =>
    `${c.display_arabic ?? c.key}${c.display_english ? ` (${c.display_english})` : ""}`;

  const lines: string[] = [];
  lines.push("=== COVERAGE PLAN — IMPORTANT ===");
  lines.push(
    "The platform tracks every concept already taught. Use these lists to keep content cohesive and progressive.",
  );
  if (_avoid.length) {
    lines.push(`\nDO NOT REINTRODUCE these recently-taught items as new vocabulary (they may appear naturally in sentences, but should not be the focus):`);
    lines.push(_avoid.map(fmt).join(", "));
  }
  if (_reinf.length) {
    lines.push(`\nWHEN POSSIBLE, REINFORCE these items in fresh contexts (new sentences, new questions, new scenes — do NOT just repeat the same card):`);
    lines.push(_reinf.map(fmt).join(", "));
  }
  if (_next.length) {
    lines.push(`\nPRIORITISE introducing concepts NOT yet in the curriculum for this dialect/CEFR. Aim for roughly 70% new + 20% reinforcement + 10% creative surprise.`);
  } else if (all.length === 0) {
    lines.push(`\nNo concepts have been taught yet for ${dialect} ${cefr ?? ""}. You are setting the foundation — pick high-frequency, level-appropriate items.`);
  }
  lines.push("\n=== END COVERAGE PLAN ===");

  return {
    avoid: _avoid,
    reinforce: _reinf,
    next_up: _next,
    promptBlock: lines.join("\n"),
  };
}
