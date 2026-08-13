// learn-from-metric
// Admin-only. Takes a flagged feature_metrics event (warn/error/dialect leak)
// and asks the AI Brain to propose 1-3 atomic dialect rules that would have
// prevented it. Inserts proposals into `dialect_rules` as drafts for review.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { createErrorResponse } from "../_shared/errorResponse.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


const ALLOWED: Dialect[] = ["Gulf", "Egyptian", "Yemeni"];

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
    "Emit 1-3 atomic dialect rules that, if followed by content-generating LLMs, would prevent the flagged failure from recurring.",
  parameters: {
    type: "object",
    required: ["rules"],
    properties: {
      rules: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          required: ["category", "rule", "examples", "priority"],
          properties: {
            category: { type: "string" },
            rule: { type: "string" },
            examples: {
              type: "object",
              required: ["good", "bad"],
              properties: {
                good: { type: "array", items: { type: "string" } },
                bad: { type: "array", items: { type: "string" } },
              },
            },
            priority: { type: "integer", minimum: 1, maximum: 5 },
            notes: { type: "string" },
          },
        },
      },
    },
  },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return createErrorResponse(401, "Missing Authorization", corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return createErrorResponse(401, "Invalid session", corsHeaders);
    const userId = userData.user.id;

    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (isAdmin !== true) return createErrorResponse(403, "Admin role required", corsHeaders);

    const body = await req.json().catch(() => ({}));
    const {
      metric_id,
      feature,
      event,
      dialect,
      meta,
      leaks,
      message,
    }: {
      metric_id?: string;
      feature?: string;
      event?: string;
      dialect?: Dialect;
      meta?: Record<string, unknown>;
      leaks?: string[];
      message?: string;
    } = body ?? {};

    if (!dialect || !ALLOWED.includes(dialect)) {
      return createErrorResponse(400, `dialect must be one of ${ALLOWED.join(", ")}`, corsHeaders);
    }
    if (!feature || !event) {
      return createErrorResponse(400, "feature and event required", corsHeaders);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existingRules } = await admin
      .from("dialect_rules")
      .select("category, rule")
      .eq("dialect", dialect)
      .in("status", ["approved", "draft"])
      .order("priority", { ascending: false })
      .limit(120);

    const existingBlock = (existingRules ?? []).length
      ? (existingRules ?? [])
          .map((r: { category: string; rule: string }, i: number) => `  ${i + 1}. [${r.category}] ${r.rule}`)
          .join("\n")
      : "  (none yet)";

    const leakBlock = Array.isArray(leaks) && leaks.length
      ? `Detected leak tokens / problematic forms: ${leaks.slice(0, 30).join(", ")}`
      : "";

    const metaBlock = meta && Object.keys(meta).length
      ? `Raw meta:\n${JSON.stringify(meta, null, 2).slice(0, 2000)}`
      : "";

    const userPrompt = [
      `An automated metric flagged a failure in feature "${feature}" (event "${event}") for ${dialect} Arabic.`,
      message ? `Message: ${message}` : "",
      leakBlock,
      metaBlock,
      "",
      "Propose 1-3 NEW atomic prompt rules that, if added to the system prompt of our content-generating LLMs, would prevent this specific failure from recurring.",
      "Rules must be atomic, testable, dialect-specific, and backed by good/bad Arabic examples.",
      "Avoid duplicating these existing rules:",
      existingBlock,
      "",
      `Call emit_dialect_rules with your proposals. "rule" text is English; examples are Arabic script.`,
    ].filter(Boolean).join("\n");

    const brain = await askBrain<{ rules: ProposedRule[] }>({
      purpose: "learn_from_metric",
      dialect,
      strategy: "solo",
      userPrompt,
      systemPromptExtra:
        "You are a native-speaker linguistic editor. You write concrete PROMPT RULES (not explanations) that other LLMs will follow to stay authentically in this dialect.",
      tool: RULE_TOOL,
      maxTokens: 2048,
      temperature: 0.3,
    });

    const proposals = Array.isArray(brain.output?.rules) ? brain.output.rules : [];
    const rows = proposals
      .filter((p) => p && typeof p.rule === "string" && p.rule.trim().length > 0)
      .map((p) => ({
        dialect,
        category: (p.category || "from_metric").trim().slice(0, 64),
        rule: p.rule.trim().slice(0, 2000),
        examples: {
          good: Array.isArray(p.examples?.good) ? p.examples.good.slice(0, 6) : [],
          bad: Array.isArray(p.examples?.bad) ? p.examples.bad.slice(0, 6) : [],
        },
        priority: Math.max(1, Math.min(5, Math.round(Number(p.priority) || 3))),
        status: "draft",
        source: "ai_generated",
        notes: `Auto-drafted from metric ${feature}/${event}${metric_id ? ` (id=${metric_id})` : ""}${p.notes ? ` — ${p.notes}` : ""}`.slice(0, 1000),
        created_by: userId,
      }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, message: "AI returned no proposals" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await admin.from("dialect_rules").insert(rows);
    if (insErr) return createErrorResponse(500, `Insert failed: ${insErr.message}`, corsHeaders);

    // Trace event
    await admin.from("feature_metrics").insert({
      feature: "learn_from_metric",
      event: "drafted",
      dialect,
      status: "ok",
      count: rows.length,
      user_id: userId,
      meta: { source_metric_id: metric_id ?? null, source_feature: feature, source_event: event },
    });

    return new Response(JSON.stringify({ inserted: rows.length, rules: rows }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return createErrorResponse(status, (err as Error)?.message ?? "Unknown error", corsHeaders);
  }
});
