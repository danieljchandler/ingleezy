// vet-corpus-sentences
// Admin-only. Judges rows in dialect_corpus_sentences as suitable (or not) to
// be mined for dialect rules, and writes the verdict back.
//
// Why a model and not a word list: the pool is the Lisan Yemeni corpus, scraped
// wartime Twitter. Keyword filtering was measured against this exact sample and
// does not work — 38% of the sentences its own stop-list marked non-political
// still hit an extended slur list, and hand-reading the survivors still turns up
// factional slurs, sectarian labels and obscenity. `keyword_flagged` is kept as
// a cost optimisation (skip the obvious rejects) and is not the gate.
//
// Resumable by design: one invocation judges up to `limit` rows and reports how
// many remain, because the Brain's task budget is 90s and the platform has its
// own wall clock. Re-invoke until `remaining` is 0. Same shape as
// backfill-literal-translations.
//
// Nothing here enables anything. buildCorpus reads `vetted = true`, which no
// row has until this runs — and even then the corpusExampleGuard still bounds
// what a mined rule may quote.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  reconcileVerdicts,
  verdictCoverage,
} from "../_shared/corpusVettingCore.ts";

const ALLOWED_DIALECTS: Dialect[] = ["Gulf", "Egyptian", "Yemeni"];

// Kept well under the Brain's 90s task budget so a slow batch cannot strand the
// whole invocation with nothing written back.
const WALL_CLOCK_MS = 55_000;

interface Verdict {
  i: number;
  ok: boolean;
  reason: string;
}

const VET_TOOL = {
  name: "emit_verdicts",
  description:
    "Judge each numbered sentence. Return exactly one verdict per input index.",
  parameters: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          required: ["i", "ok", "reason"],
          properties: {
            i: { type: "integer", description: "The sentence's index as given." },
            ok: {
              type: "boolean",
              description: "true if the sentence is safe to use as a linguistic sample.",
            },
            reason: {
              type: "string",
              description:
                "Six words or fewer. For a rejection, name the category (e.g. 'factional slur', 'war reporting', 'obscenity').",
            },
          },
        },
      },
    },
    required: ["verdicts"],
  },
};

// The rubric carries the whole decision, so it names what to catch rather than
// gesturing at "inappropriate". The accept list matters as much as the reject
// list: over-screening would strip the cultural vocabulary that makes the
// dialect worth teaching, and those words sit in the seeded rulebook's own
// cultural_references row.
const RUBRIC = `You are screening raw social-media sentences that will be used ONLY as
linguistic samples — a language-learning system will read them to infer dialect grammar
and vocabulary. They are never shown to learners.

Mark ok=false if the sentence contains ANY of:
  - political or factional content: parties, militias, leaders, governments, war, the
    Yemeni conflict, or the groups involved in it
  - factional or sectarian labels and slurs
  - insults, personal attacks, profanity, obscenity, or sexual content
  - violence, death, weapons, casualties
  - drugs (note: qat/القات is a normal social custom in Yemen, NOT a drug reference)
  - identifiable private individuals, phone numbers, addresses

Mark ok=true for ordinary everyday speech: family, food, weather, work, travel, study,
jokes, complaints about traffic, religious pleasantries, greetings. Informal register,
typos and dialect spelling are all fine — that is what makes them useful.

Ordinary Yemeni cultural vocabulary is ALWAYS acceptable and must not be rejected:
قات، مقيل، مفرج، جنبية، سلتة، بنت الصحن، فوطة، صنعاء، عدن، تعز.

When uncertain, mark ok=false. The pool is large; discarding a usable sentence costs
nothing, and letting a bad one through puts it in front of a content generator.`;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const { data: isAdminData, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr || isAdminData !== true) return json(403, { error: "Admin role required" });

    const body = await req.json().catch(() => ({}));
    const dialect = (body.dialect ?? "Yemeni") as Dialect;
    if (!ALLOWED_DIALECTS.includes(dialect)) {
      return json(400, { error: `dialect must be one of ${ALLOWED_DIALECTS.join(", ")}` });
    }
    const mode = body.mode === "auto_reject" ? "auto_reject" : "vet";
    const limit = Math.max(1, Math.min(1000, Number(body.limit) || 200));
    const batchSize = Math.max(5, Math.min(60, Number(body.batchSize) || 40));
    // Off by default so a normal run only pays for sentences the cheap pre-pass
    // did not already condemn. Turn it on to re-judge those and recover the
    // pre-pass's false positives — it has them, which is why it is not the gate.
    const includeFlagged = body.includeFlagged === true;

    const admin = createClient(supabaseUrl, serviceKey);

    if (mode === "auto_reject") {
      const { data, error } = await admin
        .from("dialect_corpus_sentences")
        .update({
          vetted: false,
          vet_reason: "keyword pre-pass",
          vetted_at: new Date().toISOString(),
        })
        .eq("dialect", dialect)
        .eq("keyword_flagged", true)
        .is("vetted", null)
        .select("id");
      if (error) return json(500, { error: `Auto-reject failed: ${error.message}` });
      return json(200, { mode, dialect, rejected: data?.length ?? 0 });
    }

    let q = admin
      .from("dialect_corpus_sentences")
      .select("id, text")
      .eq("dialect", dialect)
      .is("vetted", null)
      .limit(limit);
    if (!includeFlagged) q = q.eq("keyword_flagged", false);

    const { data: pending, error: pendErr } = await q;
    if (pendErr) return json(500, { error: `Fetch failed: ${pendErr.message}` });
    if (!pending?.length) {
      return json(200, { mode, dialect, judged: 0, remaining: 0, note: "nothing left to vet" });
    }

    const started = Date.now();
    let accepted = 0;
    let rejected = 0;
    let judged = 0;
    let batches = 0;
    const failures: string[] = [];

    for (let offset = 0; offset < pending.length; offset += batchSize) {
      if (Date.now() - started > WALL_CLOCK_MS) break;
      const batch = pending.slice(offset, offset + batchSize);
      batches += 1;

      const numbered = batch
        .map((r, i) => `${i}. ${String(r.text).replace(/\s+/g, " ").trim()}`)
        .join("\n");

      let verdicts: Verdict[] = [];
      try {
        const result = await askBrain<{ verdicts: Verdict[] }>({
          purpose: "utility", // → 'solo' via pickStrategy: one model, no council
          dialect,
          strategy: "solo",
          skipRepair: true, // classification output has nothing to repair
          models: [MODEL_IDS.GEMINI_FAST],
          systemPromptExtra: RUBRIC,
          userPrompt:
            `Judge each sentence. Return one verdict per index, ${batch.length} in total.\n\n${numbered}`,
          tool: VET_TOOL,
          maxTokens: 2048,
          temperature: 0,
        });
        verdicts = Array.isArray(result.output?.verdicts) ? result.output.verdicts : [];
      } catch (e) {
        failures.push((e as Error)?.message?.slice(0, 200) ?? "unknown");
        continue; // leave the batch NULL; a later run picks it up
      }

      // Fail-closed: anything short of an affirmative pass is a rejection.
      // See _shared/corpusVettingCore.ts.
      const decisions = reconcileVerdicts(batch.length, verdicts);
      const coverage = verdictCoverage(batch.length, decisions);
      if (coverage < 1) {
        failures.push(
          `batch at offset ${offset}: model answered ${Math.round(coverage * 100)}% of ${batch.length}`,
        );
      }

      const updates = decisions.map((d) => ({
        id: batch[d.index].id,
        vetted: d.vetted,
        reason: d.reason,
      }));

      for (const u of updates) {
        const { error } = await admin
          .from("dialect_corpus_sentences")
          .update({
            vetted: u.vetted,
            vet_reason: u.reason,
            vetted_at: new Date().toISOString(),
          })
          .eq("id", u.id);
        if (error) {
          failures.push(error.message.slice(0, 200));
          continue;
        }
        judged += 1;
        if (u.vetted) accepted += 1;
        else rejected += 1;
      }
    }

    let remainingQuery = admin
      .from("dialect_corpus_sentences")
      .select("id", { count: "exact", head: true })
      .eq("dialect", dialect)
      .is("vetted", null);
    if (!includeFlagged) remainingQuery = remainingQuery.eq("keyword_flagged", false);
    const { count: remaining } = await remainingQuery;

    return json(200, {
      mode,
      dialect,
      judged,
      accepted,
      rejected,
      batches,
      remaining: remaining ?? null,
      elapsed_ms: Date.now() - started,
      failures: failures.length ? failures.slice(0, 5) : undefined,
      note:
        remaining && remaining > 0
          ? "Re-invoke to continue; this run stopped on its wall-clock budget."
          : "Pool fully judged. Spot-check accepted rows before pointing buildCorpus at vetted = true.",
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    return new Response(
      JSON.stringify({ error: (err as Error)?.message ?? "Unknown error" }),
      { status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
