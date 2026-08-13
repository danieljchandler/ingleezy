import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getCorsHeaders } from "../_shared/cors.ts";


const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

// Price IDs for each tier, by billing cadence.
//
// Monthly IDs are live. Annual is enabled by creating yearly prices in the
// Stripe dashboard — under the SAME two products, so check-subscription's
// product→tier mapping keeps working — and setting the price IDs as edge
// function secrets STRIPE_ANNUAL_PRICE_STANDARD / STRIPE_ANNUAL_PRICE_ALLIN.
// Until both are set, annual requests answer 400 and the pricing page keeps
// its toggle hidden (ANNUAL_BILLING_AVAILABLE in src/hooks/useSubscription.ts).
const PRICE_IDS = {
  standard: "price_1T8t8sHVAO3F9uuDOpwSh2zQ",
  allin: "price_1T8t9QHVAO3F9uuDvaRVzEg4",
};
const ANNUAL_PRICE_IDS: Record<string, string | undefined> = {
  standard: Deno.env.get("STRIPE_ANNUAL_PRICE_STANDARD") || undefined,
  allin: Deno.env.get("STRIPE_ANNUAL_PRICE_ALLIN") || undefined,
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    logStep("Function started");

    const { tier, cadence } = await req.json();
    if (!tier || !PRICE_IDS[tier as keyof typeof PRICE_IDS]) {
      throw new Error(`Invalid tier: ${tier}. Must be 'standard' or 'allin'`);
    }
    const billing = cadence === "annual" ? "annual" : "monthly";
    const priceId = billing === "annual"
      ? ANNUAL_PRICE_IDS[tier as keyof typeof PRICE_IDS]
      : PRICE_IDS[tier as keyof typeof PRICE_IDS];
    if (!priceId) {
      throw new Error(`Annual billing is not configured for tier '${tier}'`);
    }
    logStep("Tier selected", { tier, billing, priceId });

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Existing customer found", { customerId });
    }

    // Referred learners get their first month via the env-configured coupon
    // (create it in Stripe as "one month free" and set STRIPE_REFERRAL_COUPON).
    // Only while the redemption is still pending — after they convert, the
    // discount has been spent. Best-effort: a lookup failure means no
    // discount, never a failed checkout.
    let discounts: Array<{ coupon: string }> | undefined;
    const referralCoupon = Deno.env.get("STRIPE_REFERRAL_COUPON");
    if (referralCoupon) {
      try {
        const service = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } },
        );
        const { data: redemption } = await service
          .from("referral_redemptions")
          .select("status")
          .eq("referred_user_id", user.id)
          .eq("status", "pending")
          .maybeSingle();
        if (redemption) {
          discounts = [{ coupon: referralCoupon }];
          logStep("Applying referral coupon", { coupon: referralCoupon });
        }
      } catch (e) {
        logStep("Referral lookup failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }

    const origin = req.headers.get("origin") || "https://laha-arabic.lovable.app";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      discounts,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-checkout", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
