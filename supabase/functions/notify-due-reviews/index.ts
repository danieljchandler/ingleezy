/**
 * notify-due-reviews
 *
 * Sends a web push to learners who have cards waiting, or a streak about to
 * lapse. Intended to be run on a schedule (hourly is enough — each learner is
 * only eligible inside their own local evening window).
 *
 * This is the server-side counterpart to src/hooks/useSmartNotifications.ts,
 * which computes the same signals but only while the app is open — so it can
 * only ever remind the person who is already looking at it.
 *
 * Requires two edge-function secrets, which are NOT in the repo:
 *   VAPID_PUBLIC_KEY   — must match the client's VITE_VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT      — optional, a mailto: or https: contact URL
 * Generate a pair once with `npx web-push generate-vapid-keys`.
 *
 * Invoke with the service-role key (a scheduled job) or as an admin.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Namespace import, not a default one: web-push is CJS and its bundled types
// declare only named exports, so `import webpush from` failed to typecheck.
// esm.sh serves both shapes at runtime (verified: setVapidDetails and
// sendNotification are functions on the namespace), so the call sites below are
// unaffected.
import * as webpush from "https://esm.sh/web-push@3.6.7";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://ingleezy.app";

/**
 * Only notify inside this local-hour window. A reminder that arrives at 3am is
 * how an app gets its notifications switched off permanently.
 */
const LOCAL_HOUR_START = 17;
const LOCAL_HOUR_END = 21;

/** Never notify the same subscription more than once in this many hours. */
const MIN_HOURS_BETWEEN = 20;

/** Below this, a nudge is noise rather than a useful prompt. */
const MIN_DUE_CARDS = 5;

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string | null;
  last_sent_at: string | null;
}

/** The learner's current local hour, from the IANA zone their browser reported. */
function localHour(timezone: string | null): number | null {
  if (!timezone) return null;
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    // An unrecognised zone shouldn't silently become "always send".
    return null;
  }
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 3_600_000;
}

/**
 * Only the scheduler (service role) or an admin may run this.
 *
 * Without a guard anyone who knows the URL could trigger a send round — not a
 * data leak (the response is just counts), but it would let a stranger push
 * notifications to every subscribed learner, which is exactly how an app gets
 * its notifications switched off.
 */
async function isAuthorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;

  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return false;
    const { data: role } = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!role;
  } catch {
    return false;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorised(req))) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // Fail loudly rather than reporting a successful run that sent nothing.
    return new Response(
      JSON.stringify({ error: "VAPID keys not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { dryRun = false } = await req.json().catch(() => ({}));

    const { data: subs, error: subsErr } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, timezone, last_sent_at")
      .is("disabled_at", null);
    if (subsErr) throw subsErr;

    const nowIso = new Date().toISOString();
    let considered = 0;
    let sent = 0;
    let retired = 0;

    for (const sub of (subs ?? []) as SubscriptionRow[]) {
      const hour = localHour(sub.timezone);
      if (hour === null || hour < LOCAL_HOUR_START || hour > LOCAL_HOUR_END) continue;
      if (hoursSince(sub.last_sent_at) < MIN_HOURS_BETWEEN) continue;

      considered++;

      // Cards due across the curriculum deck, in both directions.
      const { count: curriculumDue } = await admin
        .from("word_reviews")
        .select("id", { count: "exact", head: true })
        .eq("user_id", sub.user_id)
        .lte("next_review_at", nowIso);

      const { count: productionDue } = await admin
        .from("word_reviews")
        .select("id", { count: "exact", head: true })
        .eq("user_id", sub.user_id)
        .not("production_next_review_at", "is", null)
        .lte("production_next_review_at", nowIso);

      const { count: personalDue } = await admin
        .from("user_vocabulary")
        .select("id", { count: "exact", head: true })
        .eq("user_id", sub.user_id)
        .lte("next_review_at", nowIso);

      const total = (curriculumDue ?? 0) + (productionDue ?? 0) + (personalDue ?? 0);
      if (total < MIN_DUE_CARDS) continue;

      if (dryRun) {
        sent++;
        continue;
      }

      const payload = JSON.stringify({
        title: "Your cards are waiting",
        body: `${total} card${total === 1 ? "" : "s"} due — a few minutes keeps the streak.`,
        url: "/review",
        tag: "ingleezy-due",
      });

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        sent++;
        await admin
          .from("push_subscriptions")
          .update({ last_sent_at: nowIso })
          .eq("id", sub.id);
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        // 404/410 mean the browser dropped the subscription — retire it rather
        // than retrying forever, but keep the row so a re-subscribe revives it.
        if (status === 404 || status === 410) {
          retired++;
          await admin
            .from("push_subscriptions")
            .update({ disabled_at: nowIso })
            .eq("id", sub.id);
        } else {
          console.warn("push send failed", status, (err as Error)?.message);
        }
      }
    }

    return new Response(
      JSON.stringify({ considered, sent, retired, dryRun }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("notify-due-reviews error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
