// Paid native feedback (D2): credits in, corrections out.
//
// Actions:
//   status    balance + my requests + whether purchasing is configured
//   submit    spend one credit, queue the writing for a native speaker
//   purchase  Stripe checkout (one-off payment) for a credit pack
//   confirm   verify a completed checkout session and grant its credits once
//
// The reviewer side needs nothing new: submissions land in
// dialect_native_reviews as source 'paid_feedback' — the queue reviewers
// already work in the admin dialect-rules tab — and the settle trigger
// mirrors their answer back to the learner (or refunds on dismissal).
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { normalizeDialect } from "../_shared/transcriptDiffCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Credits per pack; the pack's price lives in Stripe on the env price id. */
const CREDITS_PER_PACK = 5;

let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function balanceOf(userId: string): Promise<number> {
  const { data, error } = await admin()
    .from("native_feedback_credits")
    .select("delta")
    .eq("user_id", userId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return ((data ?? []) as Array<{ delta: number }>).reduce((sum, row) => sum + row.delta, 0);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return json({ error: "auth_required" }, 401, corsHeaders);
    const { data: userData, error: userErr } = await admin().auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user?.id) return json({ error: "auth_required" }, 401, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "status";
    const priceId = Deno.env.get("STRIPE_FEEDBACK_PACK_PRICE");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (action === "status") {
      const [balance, { data: requests }] = await Promise.all([
        balanceOf(user.id),
        admin()
          .from("native_feedback_requests")
          .select("id, dialect, text, status, response_text, reviewer_notes, created_at, answered_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      return json(
        {
          balance,
          requests: requests ?? [],
          credits_per_pack: CREDITS_PER_PACK,
          purchase_enabled: !!(priceId && stripeKey),
        },
        200,
        corsHeaders,
      );
    }

    if (action === "submit") {
      const dialect = normalizeDialect(body.dialect);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!dialect) return json({ error: "unrecognized dialect" }, 400, corsHeaders);
      if (text.length < 20 || text.length > 2000) {
        return json(
          { error: "bad_length", message: "Write between 20 and 2000 characters." },
          400,
          corsHeaders,
        );
      }
      const balance = await balanceOf(user.id);
      if (balance < 1) {
        return json(
          { error: "no_credits", message: "You're out of feedback credits." },
          402,
          corsHeaders,
        );
      }

      const { data: request, error: requestErr } = await admin()
        .from("native_feedback_requests")
        .insert([{ user_id: user.id, dialect, kind: "writing", text }] as unknown as never)
        .select("id")
        .single();
      if (requestErr || !request) {
        return json({ error: requestErr?.message ?? "could not create request" }, 500, corsHeaders);
      }
      const requestId = (request as { id: string }).id;

      // Spend the credit only after the request exists; a failure between the
      // two leaves the learner a free question, never a paid nothing.
      const { error: spendErr } = await admin()
        .from("native_feedback_credits")
        .insert([{ user_id: user.id, delta: -1, reason: "submit" }] as unknown as never);
      if (spendErr) console.warn("[native-feedback] spend failed:", spendErr.message);

      const { error: reviewErr } = await admin().from("dialect_native_reviews").insert([
        {
          dialect,
          content_type: "paid_feedback",
          original_text: text,
          status: "pending",
          source: "user_report",
          source_function: "native-feedback",
          metadata: { feedback_request_id: requestId, requested_by: user.id, paid: true },
        },
      ] as unknown as never);
      if (reviewErr) console.warn("[native-feedback] review enqueue failed:", reviewErr.message);

      return json({ ok: true, id: requestId, balance: balance - 1 }, 200, corsHeaders);
    }

    if (action === "purchase") {
      if (!priceId || !stripeKey) {
        return json(
          { error: "not_configured", message: "Credit packs aren't available yet." },
          400,
          corsHeaders,
        );
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const origin = req.headers.get("origin") || "https://hakiya.app";
      const session = await stripe.checkout.sessions.create({
        customer_email: user.email ?? undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "payment",
        metadata: { user_id: user.id, credits: String(CREDITS_PER_PACK) },
        success_url: `${origin}/native-feedback?purchase={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/native-feedback`,
      });
      return json({ url: session.url }, 200, corsHeaders);
    }

    if (action === "confirm") {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!sessionId || !stripeKey) return json({ error: "bad_request" }, 400, corsHeaders);
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid" || session.metadata?.user_id !== user.id) {
        return json({ error: "not_paid" }, 400, corsHeaders);
      }
      const credits = Number(session.metadata?.credits) || CREDITS_PER_PACK;
      // The unique stripe_session_id makes the grant exactly-once: a reloaded
      // success page re-confirms harmlessly.
      const { error: grantErr } = await admin()
        .from("native_feedback_credits")
        .insert([
          { user_id: user.id, delta: credits, reason: "purchase", stripe_session_id: sessionId },
        ] as unknown as never);
      if (grantErr && !/duplicate|unique/i.test(grantErr.message)) {
        return json({ error: grantErr.message }, 500, corsHeaders);
      }
      return json({ ok: true, balance: await balanceOf(user.id) }, 200, corsHeaders);
    }

    return json({ error: "unknown action" }, 400, corsHeaders);
  } catch (e) {
    console.error("[native-feedback] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
