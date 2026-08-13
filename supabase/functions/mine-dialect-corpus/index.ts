// mine-dialect-corpus
// Admin-only. Samples real platform Arabic content for the given dialect,
// hands the corpus to the AI council, and asks it to identify recurring
// authentic patterns (vs MSA) that should become new prompt rules.
// Proposals land in `dialect_rules` as status='draft', source='corpus_mined'
// for admin approval through the same Dialect Rulebook UI.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  guardExamples,
  isProposalUsable,
  MAX_EXAMPLE_WORDS,
} from "../_shared/corpusExampleGuard.ts";


const ALLOWED_DIALECTS: Dialect[] = ["Gulf", "Egyptian", "Yemeni"];

interface ProposedRule {
  category: string;
  rule: string;
  examples: { good: string[]; bad: string[] };
  priority: number;
  evidence?: string;
  notes?: string;
}

const RULE_TOOL = {
  name: "emit_corpus_rules",
  description:
    "Emit prompt rules grounded in the corpus sample. Every rule MUST cite at least one good example that appeared verbatim (or near-verbatim) in the corpus.",
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
            category: { type: "string" },
            rule: {
              type: "string",
              description:
                "Atomic English instruction. Phrased as 'Always X' / 'Never Y' / 'Prefer X over Y'.",
            },
            examples: {
              type: "object",
              required: ["good", "bad"],
              properties: {
                good: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    `Arabic forms that appear in the corpus (1-4). Each MUST be a single word or a short pattern of at most ${MAX_EXAMPLE_WORDS} words — e.g. "ما عاد", not a whole sentence. Quote the pattern, not the line you found it on. Never cite political, factional or abusive wording; if the only occurrence you found is inside such a line, cite the bare pattern or omit the rule.`,
                },
                bad: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    `MSA / wrong-dialect forms the rule forbids (1-4). Single words or short patterns, at most ${MAX_EXAMPLE_WORDS} words.`,
                },
              },
            },
            priority: { type: "integer", minimum: 1, maximum: 5 },
            evidence: {
              type: "string",
              description: "Short note on how often / where this pattern shows up in the corpus.",
            },
            notes: { type: "string" },
          },
        },
      },
    },
    required: ["rules"],
  },
};

// ----- Corpus extraction helpers ---------------------------------------------

const ARABIC_RE = /[\u0600-\u06FF]/;

function pushIfArabic(out: string[], v: unknown) {
  if (typeof v !== "string") return;
  const t = v.trim();
  if (t.length >= 4 && t.length <= 400 && ARABIC_RE.test(t)) out.push(t);
}

function harvestArabic(node: unknown, out: string[], depth = 0) {
  if (depth > 6 || !node) return;
  if (typeof node === "string") {
    pushIfArabic(out, node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) harvestArabic(item, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      harvestArabic(v, out, depth + 1);
    }
  }
}

interface CorpusSnippet {
  source: string;
  text: string;
}

/**
 * Service-role client. `SupabaseClient` rather than
 * `ReturnType<typeof createClient>`: that form instantiates the schema
 * generics from their *defaults* instead of from the call, producing a type
 * the real client is not assignable to.
 */
type Admin = SupabaseClient;

async function buildCorpus(
  admin: Admin,
  dialect: Dialect,
  perSource: number,
): Promise<CorpusSnippet[]> {
  const snippets: CorpusSnippet[] = [];

  const pull = async (
    table: string,
    cols: string,
    filter: (q: any) => any,
    sourceLabel: string,
    pickArabic: (row: any) => string[],
  ) => {
    try {
      let q = admin.from(table).select(cols).limit(perSource);
      q = filter(q);
      const { data, error } = await q;
      if (error) return;
      for (const row of data ?? []) {
        for (const t of pickArabic(row)) {
          snippets.push({ source: sourceLabel, text: t });
        }
      }
    } catch (_) { /* ignore individual source failures */ }
  };

  // 1. discover_videos: transcript_lines + vocabulary
  await pull(
    "discover_videos",
    "transcript_lines, vocabulary",
    (q) => q.eq("dialect", dialect).eq("published", true),
    "discover_video",
    (r) => {
      const out: string[] = [];
      harvestArabic(r.transcript_lines, out);
      harvestArabic(r.vocabulary, out);
      return out;
    },
  );

  // 2. interactive_stories — pull arabic from full row (scenes live in related tables, skip for now)
  await pull(
    "interactive_stories",
    "title_arabic, description_arabic",
    (q) => q.eq("dialect", dialect).eq("status", "published"),
    "story",
    (r) => [r.title_arabic, r.description_arabic].filter(Boolean),
  );

  // 3. conversation_scenarios: example_exchanges
  await pull(
    "conversation_scenarios",
    "example_exchanges, title_arabic",
    (q) => q.eq("dialect", dialect).eq("status", "published"),
    "conversation",
    (r) => {
      const out: string[] = [];
      pushIfArabic(out, r.title_arabic);
      harvestArabic(r.example_exchanges, out);
      return out;
    },
  );

  // 4. daily_challenges: questions
  await pull(
    "daily_challenges",
    "questions, title_arabic",
    (q) => q.eq("dialect", dialect).eq("status", "published"),
    "daily_challenge",
    (r) => {
      const out: string[] = [];
      pushIfArabic(out, r.title_arabic);
      harvestArabic(r.questions, out);
      return out;
    },
  );

  // 5. meme_posts: audio_lines + on_screen_text + vocabulary
  await pull(
    "meme_posts",
    "audio_lines, on_screen_text, vocabulary",
    (q) => q.eq("dialect", dialect).eq("status", "published"),
    "meme",
    (r) => {
      const out: string[] = [];
      harvestArabic(r.audio_lines, out);
      harvestArabic(r.on_screen_text, out);
      harvestArabic(r.vocabulary, out);
      return out;
    },
  );

  // 6. listening_exercises: audio_text + questions
  await pull(
    "listening_exercises",
    "audio_text, questions",
    (q) => q.eq("dialect", dialect).eq("status", "published"),
    "listening",
    (r) => {
      const out: string[] = [];
      pushIfArabic(out, r.audio_text);
      harvestArabic(r.questions, out);
      return out;
    },
  );

  // Dedupe by exact text, cap total
  const seen = new Set<string>();
  const deduped: CorpusSnippet[] = [];
  for (const s of snippets) {
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    deduped.push(s);
  }
  return deduped;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildUserPrompt(args: {
  dialect: Dialect;
  count: number;
  category?: string;
  corpus: CorpusSnippet[];
  existing: Array<{ category: string; rule: string }>;
}): string {
  const { dialect, count, category, corpus, existing } = args;

  // Cap corpus token weight: ~12k chars max
  const cap = 12000;
  const sampled = shuffle(corpus);
  const lines: string[] = [];
  let used = 0;
  for (const s of sampled) {
    const line = `[${s.source}] ${s.text}`;
    if (used + line.length > cap) break;
    lines.push(line);
    used += line.length + 1;
  }

  const existingBlock = existing.length
    ? existing.map((r, i) => `  ${i + 1}. [${r.category}] ${r.rule}`).join("\n")
    : "  (none yet)";

  return [
    `You are mining a real corpus of approved ${dialect} Arabic content from a learning platform.`,
    `Identify up to ${count} recurring authentic patterns that should become PROMPT RULES so future AI generations stay in this dialect.`,
    category ? `Focus area: "${category}".` : "Choose whichever patterns recur most strongly.",
    "",
    "Each rule MUST:",
    "  - Be atomic and testable (one instruction).",
    "  - Cite Arabic examples that actually appeared in the corpus below (in examples.good).",
    "  - Explicitly name the MSA / wrong-dialect form it replaces (in examples.bad).",
    "  - Include short evidence describing how often / in what sources you saw it.",
    "",
    "Do NOT duplicate or contradict these existing approved rules:",
    existingBlock,
    "",
    `Corpus sample (${lines.length} snippets from ${dialect} content):`,
    "----- BEGIN CORPUS -----",
    lines.join("\n"),
    "----- END CORPUS -----",
    "",
    "Call the emit_corpus_rules tool with your proposals.",
  ].join("\n");
}

// ----- Handler ---------------------------------------------------------------

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Defined here rather than at module scope: corsHeaders is per-request, and
  // a module-scope helper closing over a name that only exists inside this
  // callback threw ReferenceError on every response — including the catch that
  // was meant to report it, so the function could not return at all.
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: "Invalid session" });
    const userId = userData.user.id;

    const { data: isAdminData, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr || isAdminData !== true) return json(403, { error: "Admin role required" });

    const body = await req.json().catch(() => ({}));
    const dialect = body.dialect as Dialect;
    const category: string | undefined = body.category?.trim() || undefined;
    const count = Math.max(1, Math.min(12, Number(body.count) || 6));
    const perSource = Math.max(5, Math.min(50, Number(body.perSource) || 20));

    if (!ALLOWED_DIALECTS.includes(dialect)) {
      return json(400, { error: `dialect must be one of ${ALLOWED_DIALECTS.join(", ")}` });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const [corpus, existingRulesRes] = await Promise.all([
      buildCorpus(admin, dialect, perSource),
      admin
        .from("dialect_rules")
        .select("category, rule")
        .eq("dialect", dialect)
        .in("status", ["approved", "draft"])
        .order("priority", { ascending: false })
        .limit(200),
    ]);

    if (corpus.length < 8) {
      return json(422, {
        error: "Not enough corpus material for this dialect yet. Publish more content first.",
        corpus_size: corpus.length,
      });
    }

    const userPrompt = buildUserPrompt({
      dialect,
      count,
      category,
      corpus,
      existing: existingRulesRes.data ?? [],
    });

    const brainResult = await askBrain<{ rules: ProposedRule[] }>({
      purpose: "dialect_rule_corpus_mining",
      dialect,
      strategy: "council",
      userPrompt,
      systemPromptExtra:
        "You are a corpus linguist + native dialect speaker. Ground every proposal in the supplied snippets. Do not invent vocabulary; only generalize what is actually attested.",
      tool: RULE_TOOL,
      maxTokens: 4096,
      temperature: 0.3,
    });

    const proposals = Array.isArray(brainResult.output?.rules)
      ? brainResult.output.rules
      : [];

    if (proposals.length === 0) {
      return json(502, {
        error: "Council returned no proposals",
        debug: { raw: brainResult.raw?.slice(0, 500) },
      });
    }

    // Screen every quoted example before it can reach the table. Rule examples
    // are folded into every generator prompt by dialectHelpers, so this is the
    // boundary between raw source text and learner-facing content — see
    // _shared/corpusExampleGuard.ts for why it guards output rather than input.
    const screened: Array<{ rule: string; dropped: string[] }> = [];
    const rows: Array<Record<string, unknown>> = [];

    for (const p of proposals) {
      if (!p || typeof p.rule !== "string" || !p.rule.trim()) continue;
      const guarded = guardExamples(p.examples);
      if (guarded.dropped.length) {
        screened.push({
          rule: p.rule.trim().slice(0, 120),
          dropped: guarded.dropped.map((d) => `${d.text} (${d.reason})`),
        });
      }
      // A proposal with no surviving good example is no longer grounded in the
      // corpus, which was the whole point of citing one.
      if (!isProposalUsable(guarded)) continue;
      rows.push({
        dialect,
        category: (p.category || category || "general").trim().slice(0, 64),
        rule: p.rule.trim().slice(0, 2000),
        examples: { good: guarded.good.slice(0, 6), bad: guarded.bad.slice(0, 6) },
        priority: Math.max(1, Math.min(5, Math.round(Number(p.priority) || 3))),
        status: "draft",
        source: "corpus_mined",
        notes: [p.evidence, p.notes].filter(Boolean).join(" — ").slice(0, 1000) || null,
        created_by: userId,
      });
    }

    if (rows.length === 0) {
      return json(422, {
        error:
          "Every proposal was rejected by the example guard. Check `screened` — the council is likely quoting whole lines instead of short patterns.",
        proposed: proposals.length,
        max_example_words: MAX_EXAMPLE_WORDS,
        screened,
      });
    }

    const { data: inserted, error: insertErr } = await admin
      .from("dialect_rules")
      .insert(rows)
      .select("id, category, rule, examples, priority, status, source");

    if (insertErr) return json(500, { error: `Insert failed: ${insertErr.message}` });

    return json(200, {
      dialect,
      corpus_size: corpus.length,
      sources_per_table: perSource,
      proposed: proposals.length,
      inserted: inserted?.length ?? 0,
      drafts: inserted,
      // Surfaced rather than swallowed: a run that keeps dropping examples is
      // telling you the corpus sample or the prompt needs attention.
      screened_examples: screened.length ? screened : undefined,
      rejected_proposals: proposals.length - rows.length || undefined,
      brain: {
        models: brainResult.models,
        agreementScore: brainResult.agreementScore,
        msaLeaks: brainResult.msaLeaks?.leaks?.length ?? 0,
        latencyMs: brainResult.totalLatencyMs,
      },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return json(status, { error: (err as Error)?.message ?? "Unknown error" });
  }
});
