import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getCorsHeaders } from "../_shared/cors.ts";


const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "");
    logStep("Authenticating user with token");
    
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Persist what Stripe told us into `subscribers`, which is what
    // _shared/usageCap.ts reads on every AI request. Stripe stays the source
    // of truth; this row is the cache the per-tier allowances run on — without
    // the write, subscription_tier goes stale and the tier ladder guesses.
    // Failures are logged and swallowed: an unwritable cache must not break
    // the subscription check itself.
    const persist = async (fields: {
      subscribed: boolean;
      tier: string | null;
      subscriptionEnd: string | null;
      stripeCustomerId: string | null;
    }) => {
      try {
        const { error } = await supabaseClient.from("subscribers").upsert(
          {
            email: user.email,
            user_id: user.id,
            stripe_customer_id: fields.stripeCustomerId,
            subscribed: fields.subscribed,
            subscription_tier: fields.tier,
            subscription_end: fields.subscriptionEnd,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "email" },
        );
        if (error) logStep("subscribers upsert failed", { message: error.message });
      } catch (e) {
        logStep("subscribers upsert threw", { message: e instanceof Error ? e.message : String(e) });
      }
    };

    // Complimentary access (investors, partners, press): the `complimentary`
    // role grants top-tier access without ever touching Stripe. Checked before
    // the Stripe lookup so these accounts stay unlocked even if they have no
    // customer record at all. Cached into `subscribers` like a paid row so the
    // per-tier allowances in _shared/usageCap.ts see the same picture.
    const { data: compRole } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "complimentary")
      .maybeSingle();

    if (compRole) {
      logStep("Complimentary access granted", { userId: user.id });
      await persist({ subscribed: true, tier: "allin", subscriptionEnd: null, stripeCustomerId: null });
      return new Response(
        JSON.stringify({ subscribed: true, tier: "allin", complimentary: true, subscription_end: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      logStep("No customer found, returning unsubscribed state");
      await persist({ subscribed: false, tier: null, subscriptionEnd: null, stripeCustomerId: null });
      return new Response(JSON.stringify({ subscribed: false, tier: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    const hasActiveSub = subscriptions.data.length > 0;
    let productId = null;
    let subscriptionEnd = null;
    let tier = null;

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      logStep("Active subscription found", { subscriptionId: subscription.id, endDate: subscriptionEnd });
      productId = subscription.items.data[0].price.product;
      
      // Map product ID to tier name. Annual prices must be created under
      // these same two products in Stripe — then this mapping covers both
      // cadences with no code change.
      if (productId === "prod_U77NfmTFN3mabx") {
        tier = "standard";
      } else if (productId === "prod_U77OH1rRl0YAiF") {
        tier = "allin";
      }
      logStep("Determined subscription tier", { productId, tier });
    } else {
      logStep("No active subscription found");
    }

    await persist({
      subscribed: hasActiveSub,
      tier,
      subscriptionEnd,
      stripeCustomerId: customerId,
    });

    // Referral conversion (D4): the moment a referred learner shows up with an
    // active subscription, their redemption graduates pending → converted and
    // the referrer earns a $5 customer-balance credit (a month of Standard)
    // toward their next invoice. Conversion-gated on purpose — fabricated
    // signups that never pay earn nothing. The status update claims the row
    // atomically, so concurrent checks can't double-credit; every failure here
    // is logged and swallowed.
    if (hasActiveSub) {
      try {
        const { data: claimed } = await supabaseClient
          .from("referral_redemptions")
          .update({ status: "converted", converted_at: new Date().toISOString() })
          .eq("referred_user_id", user.id)
          .eq("status", "pending")
          .select("id, referrer_id");
        const redemption = (claimed as Array<{ id: string; referrer_id: string }> | null)?.[0];
        if (redemption) {
          logStep("Referral converted", { redemptionId: redemption.id });
          const { data: referrerUser } = await supabaseClient.auth.admin.getUserById(
            redemption.referrer_id,
          );
          const referrerEmail = referrerUser?.user?.email;
          if (referrerEmail) {
            const referrerCustomers = await stripe.customers.list({ email: referrerEmail, limit: 1 });
            const referrerCustomer = referrerCustomers.data[0];
            if (referrerCustomer) {
              await stripe.customers.createBalanceTransaction(referrerCustomer.id, {
                amount: -500, // $5.00 credit toward the next invoice
                currency: "usd",
                description: "Referral reward — your invite subscribed",
              });
              await supabaseClient
                .from("referral_redemptions")
                .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
                .eq("id", redemption.id);
              logStep("Referrer credited", { customerId: referrerCustomer.id });
            } else {
              // No Stripe customer yet — the row stays 'converted' and the
              // credit can be granted when they first subscribe (visible in
              // their referral card meanwhile).
              logStep("Referrer has no Stripe customer yet", { referrerEmail });
            }
          }
        }
      } catch (e) {
        logStep("Referral conversion failed", { message: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({
      subscribed: hasActiveSub,
      tier,
      product_id: productId,
      subscription_end: subscriptionEnd
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
