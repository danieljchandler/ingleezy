// Generate (or fetch) the user's personalized ~200-word daily story.
// Uses up to ~15 mature SRS words from their My Words deck + 5 NEW words
// for the active dialect. Cached per (user, date, dialect) in
// `daily_vocab_stories`.
//
// The generation itself lives in _shared/dailyStory.ts so the nightly
// pregenerate-daily batch builds byte-identical stories; this file owns only
// the learner-facing policy: the daily cap, authentication, and the cache.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  DailyStoryError,
  existingStory,
  generateDailyStoryFor,
  todayUtc,
  type DailyStoryDb,
} from "../_shared/dailyStory.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Free-tier daily cap
  const cap = await enforceDailyCap(req, "generate-daily-story", 5, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dialect: string = (body?.dialect as string) || "Gulf";
    const force: boolean = !!body?.force;
    const today = todayUtc();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE) as unknown as DailyStoryDb;

    // Return cached if exists & not forced — this is where the nightly
    // pre-generated story is served from, making the usual open instant.
    if (!force) {
      const existing = await existingStory(admin, user.id, dialect, today);
      if (existing) {
        return new Response(JSON.stringify({ story: existing, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let saved: Record<string, unknown>;
    try {
      saved = await generateDailyStoryFor(admin, user.id, dialect, today);
    } catch (e) {
      if (e instanceof DailyStoryError) {
        // Same wire shapes as before the extraction: the client and the edge
        // tests key on these exact error codes and statuses.
        const payload =
          e.code === "empty_story"
            ? { error: e.code, raw: e.message }
            : { error: e.code, detail: e.message };
        return new Response(JSON.stringify(payload), {
          status: e.code === "save_failed" ? 500 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    return new Response(JSON.stringify({ story: saved, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-daily-story unexpected", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
