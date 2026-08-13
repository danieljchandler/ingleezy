// draft-dialect-rules
// Admin-only. Uses the AI Brain council to propose new candidate dialect rules
// for a given dialect + category. Existing approved rules are passed in as
// context so the council avoids duplicates and stays consistent. Proposals are
// inserted into `dialect_rules` with status='draft', source='ai_generated'
// for admin review/approval.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const ALLOWED_DIALECTS: Dialect[] = ["Gulf", "Egyptian", "Yemeni"];

interface ProposedRule {
  category: string;
  rule: string;
  examples: { good: string[]; bad: string[] };
  priority: number;
  notes?: string;
}

const RULE_TOOL = {
  name: "emit_dialect_rules",
  description:
    "Emit a set of proposed dialect rules. Each rule is a single, atomic, testable instruction for an AI generating content in this dialect.",
  parameters: {
    type: "object",
    properties: {
      rules: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          required: ["category", "rule", "examples", "priority"],
          properties: {
            category: {
              type: "string",
              description:
                "Short slug like 'vocabulary', 'pronouns', 'negation', 'verb_conjugation', 'cultural_reference', 'forbidden_msa'.",
            },
            rule: {
              type: "string",
              description:
                "One concrete instruction in English (max ~280 chars). Phrased as 'Always X' / 'Never Y' / 'When Z, use X not Y'.",
            },
            examples: {
              type: "object",
              required: ["good", "bad"],
              properties: {
                good: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "1-4 Arabic examples that follow the rule (the correct dialect form).",
                },
                bad: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "1-4 Arabic counter-examples (MSA / wrong dialect) the rule forbids.",
                },
              },
            },
            priority: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description:
                "1=nice-to-have, 3=normal, 5=critical (breaks dialect authenticity if violated).",
            },
            notes: {
              type: "string",
              description: "Optional rationale or regional caveat.",
            },
          },
        },
      },
    },
    required: ["rules"],
  },
};

function buildUserPrompt(args: {
  dialect: Dialect;
  category?: string;
  count: number;
  guidance?: string;
  existing: Array<{ category: string; rule: string }>;
  /** Flywheel gold pairs: what a model wrote → what a native made of it. */
  corrections?: Array<{ bad: string; good: string }>;
}): string {
  const { dialect, category, count, guidance, existing, corrections } = args;

  const existingBlock = existing.length
    ? existing
        .map((r, i) => `  ${i + 1}. [${r.category}] ${r.rule}`)
        .join("\n")
    : "  (none yet)";

  // Real fixes beat introspection: when the flywheel supplies corrections,
  // the panel's job shifts from "imagine failure modes" to "name the patterns
  // in these observed ones".
  const correctionsBlock = corrections?.length
    ? [
        "",
        "Recent native-speaker corrections of model output in this dialect (WRONG → CORRECTED):",
        ...corrections.map(
          (c, i) => `  ${i + 1}. ${c.bad.slice(0, 200)}  →  ${c.good.slice(0, 200)}`,
        ),
        "",
        "Derive your rules from the RECURRING PATTERNS in these corrections — what class of mistake does each fix, and what instruction would have prevented it? Do not invent failure modes the corrections don't show.",
      ].join("\n")
    : "";

  return [
    `Propose up to ${count} NEW candidate prompt rules for generating authentic ${dialect} Arabic content.`,
    category
      ? `Focus area: "${category}". Stay within this category.`
      : `Cover whichever categories have the biggest authenticity gaps (vocabulary, pronouns, negation, verb conjugation, question words, cultural references, forbidden MSA forms, etc.).`,
    guidance ? `Additional guidance from the admin: ${guidance}` : "",
    correctionsBlock,
    "",
    "Each rule must be:",
    "  - Atomic (one instruction, not a paragraph).",
    "  - Testable (an evaluator can check whether output obeys it).",
    "  - Specific to this dialect (call out the exact MSA or wrong-dialect form it replaces).",
    "  - Backed by real Arabic examples (good + bad).",
    "",
    "Existing approved rules (do NOT duplicate, do NOT contradict — only add genuinely new ones):",
    existingBlock,
    "",
    `Call the emit_dialect_rules tool with your proposals. All "rule" text is English; "examples.good" and "examples.bad" are Arabic script.`,
  ]
    .filter(Boolean)
    .join("\n");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse(401, "Missing Authorization header", corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller identity + admin role using the user's JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return createErrorResponse(401, "Invalid session", corsHeaders);
    }
    const userId = userData.user.id;

    const { data: isAdminData, error: roleErr } = await userClient.rpc(
      "has_role",
      { _user_id: userId, _role: "admin" },
    );
    if (roleErr || isAdminData !== true) {
      return createErrorResponse(403, "Admin role required", corsHeaders);
    }

    const body = await req.json().catch(() => ({}));
    const dialect = body.dialect as Dialect;
    const category: string | undefined = body.category?.trim() || undefined;
    const guidance: string | undefined = body.guidance?.trim() || undefined;
    const count = Math.max(1, Math.min(12, Number(body.count) || 5));
    const autoApprove = body.autoApprove === true;
    // source: 'flywheel_gold' grounds the panel in recent native corrections
    // instead of model introspection — the flywheel's Rulebook-mining wire.
    const fromGold = body.source === "flywheel_gold";

    if (!ALLOWED_DIALECTS.includes(dialect)) {
      return createErrorResponse(400, `dialect must be one of ${ALLOWED_DIALECTS.join(", ")}`, corsHeaders);
    }

    // Use service role to fetch existing rules (RLS would gate on admin anyway,
    // but service role keeps this consistent + lets us insert drafts below).
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: existingRules, error: existingErr } = await admin
      .from("dialect_rules")
      .select("category, rule, status")
      .eq("dialect", dialect)
      .in("status", ["approved", "draft"])
      .order("priority", { ascending: false })
      .limit(200);

    if (existingErr) {
      return createErrorResponse(500, `Failed to load existing rules: ${existingErr.message}`, corsHeaders);
    }

    let corrections: Array<{ bad: string; good: string }> | undefined;
    if (fromGold) {
      const { data: goldRows, error: goldErr } = await admin
        .from("training_examples")
        .select("machine_output, human_output")
        .eq("dialect", dialect)
        .eq("tier", "gold")
        .order("created_at", { ascending: false })
        .limit(40);
      if (goldErr) {
        return createErrorResponse(500, `Failed to load gold corrections: ${goldErr.message}`, corsHeaders);
      }
      corrections = ((goldRows ?? []) as Array<{ machine_output: string; human_output: string }>)
        .filter((r) => r.machine_output && r.human_output)
        .map((r) => ({ bad: r.machine_output, good: r.human_output }));
      if (corrections.length < 3) {
        return createErrorResponse(
          400,
          `Only ${corrections.length} gold corrections exist for ${dialect} — need at least 3 to mine patterns. Correct more reviews first, or draft without source=flywheel_gold.`,
          corsHeaders,
        );
      }
    }

    const userPrompt = buildUserPrompt({
      dialect,
      category,
      count,
      guidance,
      existing: existingRules ?? [],
      corrections,
    });

    // Long-running council strategy runs in background so the client can
    // navigate away without losing the job. We respond 202 immediately;
    // drafts land in `dialect_rules` (status='draft') when the council finishes.
    const work = (async () => {
      const startedAt = Date.now();
      try {
        const brainResult = await askBrain<{ rules: ProposedRule[] }>({
          purpose: "dialect_rule_synthesis",
          dialect,
          strategy: "council",
          userPrompt,
          systemPromptExtra:
            "You are a panel of native-speaker linguistic editors. Your job is to write PROMPT RULES that will be fed to other LLMs to keep their output authentically in this dialect. Be concrete and corpus-grounded, not abstract. Tolerate partial failures — produce what you can.",
          tool: RULE_TOOL,
          maxTokens: 4096,
          temperature: 0.4,
        });

        const proposals = Array.isArray(brainResult.output?.rules)
          ? brainResult.output.rules
          : [];

        if (proposals.length === 0) {
          console.error("[draft-dialect-rules] council returned no proposals", {
            dialect,
            raw: brainResult.raw?.slice(0, 500),
          });
          return;
        }

        const rows = proposals
          .filter((p) => p && typeof p.rule === "string" && p.rule.trim().length > 0)
          .map((p) => ({
            dialect,
            category: (p.category || category || "general").trim().slice(0, 64),
            rule: p.rule.trim().slice(0, 2000),
            examples: {
              good: Array.isArray(p.examples?.good) ? p.examples.good.slice(0, 6) : [],
              bad: Array.isArray(p.examples?.bad) ? p.examples.bad.slice(0, 6) : [],
            },
            priority: Math.max(1, Math.min(5, Math.round(Number(p.priority) || 3))),
            status: autoApprove ? "approved" : "draft",
            source: fromGold ? "flywheel_gold" : "ai_generated",
            notes: p.notes?.toString().slice(0, 1000) ?? null,
            created_by: userId,
            ...(autoApprove
              ? { approved_by: userId, approved_at: new Date().toISOString() }
              : {}),
          }));

        const { error: insertErr } = await admin
          .from("dialect_rules")
          .insert(rows);

        if (insertErr) {
          console.error("[draft-dialect-rules] insert failed:", insertErr.message);
          return;
        }

        console.log(
          `[draft-dialect-rules] ${dialect}: inserted ${rows.length} drafts in ${Date.now() - startedAt}ms`,
        );
      } catch (err) {
        console.error("[draft-dialect-rules] background job failed:", err);
      }
    })();

    // @ts-ignore - EdgeRuntime is provided by the Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    }

    return new Response(JSON.stringify({
      queued: true,
      dialect,
      category: category ?? null,
      message: "Council is drafting rules in the background. Drafts will appear in the Draft tab within ~1–3 minutes.",
    }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return createErrorResponse(status, (err as Error)?.message ?? "Unknown error", corsHeaders);
  }
});
