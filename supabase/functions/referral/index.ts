// Learner referrals (D4): every learner owns one shareable code; a new
// account redeems one code, once, inside its first 30 days. Rewards are
// Stripe-side and conversion-gated (see the referrals migration) — this
// function only manages codes and redemptions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";

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

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// No 0/O/1/I — codes get read aloud and typed from phone screens.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** New accounts only: an old account "redeeming" a friend's code is farming. */
const MAX_ACCOUNT_AGE_DAYS = 30;

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
    const action = body.action === "redeem" ? "redeem" : "get";

    if (action === "get") {
      // Ensure the learner has a code (one generator, service-role writes).
      let { data: codeRow } = await admin()
        .from("referral_codes")
        .select("code")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!codeRow) {
        for (let attempt = 0; attempt < 3 && !codeRow; attempt++) {
          const candidate = generateCode();
          const { error: insertErr } = await admin()
            .from("referral_codes")
            .insert([{ user_id: user.id, code: candidate }] as unknown as never);
          if (!insertErr) {
            codeRow = { code: candidate };
          } else if (!/duplicate|unique/i.test(insertErr.message)) {
            return json({ error: insertErr.message }, 500, corsHeaders);
          }
          // A code collision (1-in-31^8 per try) just re-rolls; a user_id
          // conflict means a concurrent get already made ours — re-read.
          if (!codeRow) {
            const { data: reread } = await admin()
              .from("referral_codes")
              .select("code")
              .eq("user_id", user.id)
              .maybeSingle();
            if (reread) codeRow = reread as { code: string };
          }
        }
        if (!codeRow) return json({ error: "could not create a code" }, 500, corsHeaders);
      }

      const { data: redemptions } = await admin()
        .from("referral_redemptions")
        .select("status")
        .eq("referrer_id", user.id);
      const counts = { pending: 0, converted: 0, rewarded: 0 };
      for (const r of (redemptions ?? []) as Array<{ status: keyof typeof counts }>) {
        if (r.status in counts) counts[r.status]++;
      }

      const { data: myRedemption } = await admin()
        .from("referral_redemptions")
        .select("status")
        .eq("referred_user_id", user.id)
        .maybeSingle();

      return json(
        {
          code: (codeRow as { code: string }).code,
          referrals: counts,
          redeemed: !!myRedemption,
          // The referred-side discount only exists once the coupon does; the
          // UI words the offer accordingly.
          rewards_enabled: !!Deno.env.get("STRIPE_REFERRAL_COUPON"),
        },
        200,
        corsHeaders,
      );
    }

    // ── redeem ──────────────────────────────────────────────────────────────
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return json({ error: "code is required" }, 400, corsHeaders);

    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    const ageDays = (Date.now() - createdAt) / 86_400_000;
    if (!createdAt || ageDays > MAX_ACCOUNT_AGE_DAYS) {
      return json(
        { error: "new_accounts_only", message: "Referral codes can only be used within your first month." },
        400,
        corsHeaders,
      );
    }

    const { data: owner } = await admin()
      .from("referral_codes")
      .select("user_id")
      .eq("code", code)
      .maybeSingle();
    if (!owner) {
      return json({ error: "unknown_code", message: "That code doesn't exist." }, 404, corsHeaders);
    }
    const referrerId = (owner as { user_id: string }).user_id;
    if (referrerId === user.id) {
      return json({ error: "own_code", message: "That's your own code." }, 400, corsHeaders);
    }

    const { error: redeemErr } = await admin()
      .from("referral_redemptions")
      .insert([{ referrer_id: referrerId, referred_user_id: user.id }] as unknown as never);
    if (redeemErr) {
      if (/duplicate|unique/i.test(redeemErr.message)) {
        return json(
          { error: "already_redeemed", message: "This account has already used a referral code." },
          409,
          corsHeaders,
        );
      }
      return json({ error: redeemErr.message }, 500, corsHeaders);
    }

    return json({ ok: true }, 200, corsHeaders);
  } catch (e) {
    console.error("[referral] error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500, corsHeaders);
  }
});
