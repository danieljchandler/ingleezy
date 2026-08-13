/**
 * record-grammar-outcome
 *
 * Persists the result of a Grammar Drills round into `user_concept_mastery`.
 *
 * Until now a drill's score was rendered on the results screen and dropped.
 * Nothing accumulated, so the app could not tell a learner which structures
 * they were weak on, could not order the category grid by need, and could not
 * tell the generators to work those structures back into content. Vocabulary
 * had a full SRS; grammar had nothing.
 *
 * Body: {
 *   category: string,          // one of the fixed drill categories
 *   categoryLabel?: string,    // gloss, used only when creating the concept
 *   dialect?: string,          // "Gulf" | "Egyptian" | "Yemeni"
 *   outcomes: boolean[],       // one per question, in the order answered
 * }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { resolveUserId } from "../_shared/learnerErrors.ts";
import { recordConceptOutcomes } from "../_shared/conceptMastery.ts";
import { GRAMMAR_CATEGORY_IDS, GRAMMAR_CATEGORY_SET } from "../_shared/grammarTaxonomy.ts";

/**
 * Still an allowlist rather than free text: the category becomes a
 * `curriculum_concepts` key, and accepting arbitrary strings would let any
 * authenticated client mint concept rows that leak into the coverage planner
 * and the admin heatmap.
 *
 * The list itself now comes from the shared taxonomy instead of a copy kept in
 * step by hand — the drill UI and extract-concepts read the same one, which is
 * what makes drill mastery and tagged content land on the same key.
 */
const CATEGORY_KEYS = GRAMMAR_CATEGORY_SET;

const DIALECTS = new Set(["Gulf", "Egyptian", "Yemeni"]);

/** A drill is five questions; this leaves room without allowing a flood. */
const MAX_OUTCOMES = 40;

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);

    const { category, categoryLabel, dialect, outcomes } = body as Record<string, unknown>;

    if (typeof category !== "string" || !CATEGORY_KEYS.has(category)) {
      return json(
        { error: `Unknown category. Expected one of: ${GRAMMAR_CATEGORY_IDS.join(", ")}` },
        400,
      );
    }

    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      return json({ error: "outcomes must be a non-empty array of booleans" }, 400);
    }
    if (!outcomes.every((o) => typeof o === "boolean")) {
      return json({ error: "outcomes must contain booleans only" }, 400);
    }

    const conceptId = await recordConceptOutcomes(
      userId,
      {
        kind: "grammar",
        key: category,
        label: typeof categoryLabel === "string" && categoryLabel.trim()
          ? categoryLabel.trim()
          : category,
        dialect: typeof dialect === "string" && DIALECTS.has(dialect) ? dialect : "Gulf",
      },
      (outcomes as boolean[]).slice(0, MAX_OUTCOMES),
    );

    // recordConceptOutcomes never throws — a null here means the write did not
    // land. Say so rather than reporting a success the learner's next drill
    // will contradict.
    if (!conceptId) return json({ recorded: 0 }, 200);

    return json({ recorded: Math.min(outcomes.length, MAX_OUTCOMES), conceptId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("record-grammar-outcome error:", msg);
    return json({ error: msg }, 500);
  }
});
