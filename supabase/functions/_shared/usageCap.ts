/**
 * Daily AI usage cap helper for edge functions.
 *
 * Enforces a free-tier per-(user, feature, day) limit. Paid users (active
 * row in `subscribers`) bypass the cap. Anonymous calls are rejected with 401.
 *
 * Self-contained: does not import the shared cors module so it can be dropped
 * into edge functions that already define their own corsHeaders object.
 *
 * Usage:
 *   import { enforceDailyCap } from "../_shared/usageCap.ts";
 *   const cap = await enforceDailyCap(req, "transcribe", 10, corsHeaders);
 *   if (cap.limited) return cap.response;
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface CapAllowed {
  limited: false;
  userId: string;
  count: number;
  limit: number;
}
interface CapBlocked {
  limited: true;
  response: Response;
}
export type CapResult = CapAllowed | CapBlocked;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// One client per isolate rather than one per call: every createClient here was
// building a fresh PostgREST/GoTrue stack on a path that runs before any user
// work starts.
let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await admin().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Complimentary access: the `complimentary` role hands out top-tier access
 * without a Stripe subscription (investors, partners, press). Treated exactly
 * like an All-In subscriber everywhere a paid check happens.
 */
export async function hasComplimentaryAccess(userId: string): Promise<boolean> {
  try {
    const { data } = await admin()
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "complimentary")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

async function hasActiveSubscription(userId: string): Promise<boolean> {
  if (await hasComplimentaryAccess(userId)) return true;
  try {
    const supa = admin();
    const { data } = await supa
      .from("subscribers")
      .select("subscribed, subscription_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data || data.subscribed !== true) return false;
    // The client is untyped here, so subscription_end widens to `{}` — narrow
    // it before constructing a Date.
    const endsAt = data.subscription_end as string | null | undefined;
    if (endsAt && new Date(endsAt) < new Date()) return false;
    return true;
  } catch {
    return false; // fail closed — treat as free-tier
  }
}


/**
 * The caller's user id from the request's bearer token, or null. Exported for
 * endpoints that need identity outside the cap flow (e.g. the voice usage
 * report action).
 */
export async function resolveUserId(req: Request): Promise<string | null> {
  return getUserId(req);
}

export async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const supa = admin();
    const { data } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export type SubscriptionTier = "free" | "standard" | "allin";

/**
 * The caller's paid tier, for allowances that differ between plans.
 *
 * Two deliberate fail-open choices: a paying user whose tier is unknown is
 * treated as the top tier (never newly block someone who pays because a column
 * is stale), and `subscribers.subscription_tier` may not exist on a rebuilt
 * database — that error falls back to the boolean subscription check rather
 * than reporting everyone as free… which is what hasActiveSubscription would
 * conclude anyway on a database with no subscribers table at all (a documented
 * schema-debt item in docs/testing.md).
 */
export async function getSubscriptionTier(userId: string): Promise<SubscriptionTier> {
  if (await hasComplimentaryAccess(userId)) return "allin";
  try {

    const { data, error } = await admin()
      .from("subscribers")
      .select("subscribed, subscription_end, subscription_tier")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.subscribed !== true) return "free";
    const endsAt = data.subscription_end as string | null | undefined;
    if (endsAt && new Date(endsAt) < new Date()) return "free";
    const tier = (data as { subscription_tier?: unknown }).subscription_tier;
    if (tier === "standard") return "standard";
    if (tier === "allin") return "allin";
    return "allin"; // paying, tier unknown — fail open to the higher allowance
  } catch {
    const subscribed = await hasActiveSubscription(userId);
    return subscribed ? "allin" : "free";
  }
}

/**
 * Gate a feature to active subscribers (and admins) outright — no free tier.
 *
 * Same result shape as enforceDailyCap so callers branch identically:
 * anonymous → 401 auth_required, signed-in free user → 403
 * subscription_required with an upgrade_url the client can route to.
 */
export async function requireActiveSubscription(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<CapResult> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  const [subscribed, isAdmin] = await Promise.all([
    hasActiveSubscription(userId),
    isAdminUser(userId),
  ]);
  if (subscribed || isAdmin) {
    return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
  }

  return {
    limited: true,
    response: new Response(
      JSON.stringify({
        error: "subscription_required",
        message: "Live voice for the AI assistant is available on a paid plan.",
        upgrade_url: "/pricing",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ),
  };
}

/**
 * Per-paid-tier daily limits for a feature. Without one, subscribers bypass
 * the cap entirely (the original behaviour, right for cheap features). With
 * one, each paid tier gets its own ceiling — the mechanism that lets the
 * expensive capabilities (image generation, jingles) be part of what the
 * higher tier actually buys. A tier missing from the table is unlimited.
 */
export interface TierLimits {
  standard?: number;
  allin?: number;
}

export async function enforceDailyCap(
  req: Request,
  key: string,
  limit: number,
  corsHeaders: Record<string, string>,
  tierLimits?: TierLimits,
): Promise<CapResult> {
  const userId = await getUserId(req);
  if (!userId) {
    return {
      limited: true,
      response: new Response(
        JSON.stringify({ error: "auth_required", message: "Please sign in to use this feature." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  // Both are independent lookups; `await a || await b` serialised them on the
  // critical path of every AI request for no reason.
  const [tier, isAdmin] = await Promise.all([
    tierLimits ? getSubscriptionTier(userId) : hasActiveSubscription(userId).then(
      (subscribed): SubscriptionTier => (subscribed ? "allin" : "free"),
    ),
    isAdminUser(userId),
  ]);
  if (isAdmin) {
    return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
  }

  let effectiveLimit = limit;
  if (tier !== "free") {
    const tierLimit = tierLimits?.[tier];
    if (tierLimit === undefined) {
      // No per-tier table (or this tier isn't in it): subscribers bypass.
      return { limited: false, userId, count: 0, limit: Number.POSITIVE_INFINITY };
    }
    effectiveLimit = tierLimit;
  }

  const supa = admin();
  const { data, error } = await supa.rpc("increment_usage_counter", {
    _user_id: userId,
    _key: key,
    _amount: 1,
  });

  if (error) {
    console.error(`[usageCap] increment failed for ${key}:`, error.message);
    // Don't block on counter failure.
    return { limited: false, userId, count: 0, limit: effectiveLimit };
  }

  const count = typeof data === "number" ? data : Number(data);

  if (count > effectiveLimit) {
    const message =
      tier === "free"
        ? `You've reached the free daily limit for this feature (${effectiveLimit}/day). Upgrade for unlimited access.`
        : `You've reached your plan's daily limit for this feature (${effectiveLimit}/day).` +
          (tier === "standard" ? " The All-In plan includes more." : " It resets tomorrow.");
    return {
      limited: true,
      response: new Response(
        JSON.stringify({
          error: "daily_limit_reached",
          message,
          key,
          count,
          limit: effectiveLimit,
          tier,
          upgrade_url: "/pricing",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  return { limited: false, userId, count, limit: effectiveLimit };
}
