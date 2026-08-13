// Learner reports enter the flywheel here — a thumbs-down on an Ask AI reply,
// a "this phrase looks wrong" on content. Reports are NOT training data: they
// land in dialect_native_reviews as source 'user_report', and only become a
// gold training pair after a native speaker corrects them (the DB trigger on
// that table does the promotion). That indirection is what keeps the gold
// tier trustworthy — learners flag, natives decide.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

const KINDS = new Set(["assistant_message", "phrase", "content"]);
const MAX_TEXT = 2000;
const MAX_NOTE = 500;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Ten reports a day is plenty of signal from one learner; the cap is mostly
  // a spam floor for the review queue.
  const cap = await enforceDailyCap(req, "report-content", 10, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : "content";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
    const dialect = normalizeDialect(body.dialect);

    if (!text) {
      return new Response(
        JSON.stringify({ error: "text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!dialect) {
      return new Response(
        JSON.stringify({ error: "unrecognized dialect" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error } = await admin().from("dialect_native_reviews").insert([
      {
        dialect,
        content_type: kind,
        original_text: text,
        status: "pending",
        source: "user_report",
        source_function: `report-content:${kind}`,
        metadata: {
          reported_by: cap.userId,
          note: note || null,
        },
      },
    ] as unknown as never);

    if (error) {
      console.error("[report-content] insert failed:", error.message);
      return new Response(
        JSON.stringify({ error: "could not record the report" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[report-content] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
