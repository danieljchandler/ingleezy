import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

interface FeedRequest {
  limit?: number;
  exclude_ids?: string[];
  seed?: number;
}

interface FeedItem {
  video_id: string;
  score: number;
  comprehension: number; // 0..1
  reason: string;
  bucket: "match" | "stretch" | "comfort" | "fresh";
}

// discover_videos.dialect can hold the specific Gulf country the AI detected
// (Saudi, Kuwaiti, UAE, Bahraini, Qatari, Omani) instead of the bare "Gulf"
// module name — Egyptian and Yemeni are always stored as their module name.
// Matching only the literal module string would silently drop every
// country-tagged Gulf clip from a Gulf learner's feed.
const GULF_DIALECT_VALUES = ["Gulf", "Saudi", "Kuwaiti", "UAE", "Bahraini", "Qatari", "Omani"];
function dialectModuleValues(activeDialect: string): string[] {
  return activeDialect === "Gulf" ? GULF_DIALECT_VALUES : [activeDialect];
}
function dialectMatchesModule(videoDialect: string, activeDialect: string): boolean {
  return activeDialect === "Gulf" ? GULF_DIALECT_VALUES.includes(videoDialect) : videoDialect === activeDialect;
}

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DIFF_TO_CEFR: Record<string, string> = {
  Beginner: "A1",
  Intermediate: "B1",
  Advanced: "B2",
  Expert: "C1",
};

function normLemma(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    // strip Arabic diacritics
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    // unify alef forms
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function extractLemmas(vocabulary: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(vocabulary)) return out;
  for (const entry of vocabulary) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const n = normLemma(entry);
      if (n) out.add(n);
      continue;
    }
    if (typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const cand = (e.word_arabic ?? e.arabic ?? e.lemma ?? e.word) as string | undefined;
      if (typeof cand === "string") {
        const n = normLemma(cand);
        if (n) out.add(n);
      }
    }
  }
  return out;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const body: FeedRequest = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
    const excludeIds = new Set((body.exclude_ids ?? []).filter(Boolean));
    const seed = body.seed ?? Math.floor(Date.now() / (15 * 60 * 1000));
    const rng = mulberry32(seed);

    // --- Load user context in parallel
    const [profileRes, vocabRes, viewsRes, likesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "preferred_dialect, placement_level, placement_level_gulf, placement_level_egyptian, placement_level_yemeni",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("user_vocabulary")
        .select("word_arabic, dialect")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("video_views")
        .select("video_id, completed, watched_at")
        .eq("user_id", userId)
        .order("watched_at", { ascending: false })
        .limit(500),
      supabase
        .from("video_likes" as any)
        .select("video_id")
        .eq("user_id", userId)
        .limit(200),
    ]);

    const profile = profileRes.data ?? null;
    const activeDialect: string = (profile?.preferred_dialect as string) || "Gulf";
    const cefr =
      (profile?.[`placement_level_${activeDialect.toLowerCase()}` as keyof typeof profile] as
        | string
        | null) ||
      (profile?.placement_level as string | null) ||
      null;

    const knownLemmas = new Set<string>();
    for (const r of vocabRes.data ?? []) {
      const n = normLemma((r as any).word_arabic ?? "");
      if (n) knownLemmas.add(n);
    }

    const viewedMap = new Map<string, { completed: boolean; watchedAt: number }>();
    for (const v of viewsRes.data ?? []) {
      viewedMap.set((v as any).video_id, {
        completed: !!(v as any).completed,
        watchedAt: new Date((v as any).watched_at).getTime(),
      });
    }

    const likedSet = new Set<string>(
      ((likesRes.data ?? []) as Array<{ video_id: string }>).map((l) => l.video_id),
    );

    // Cold-start: tiny vocab + no level -> trending fallback
    const isColdStart = knownLemmas.size < 20 && !cefr;

    // --- Candidate pool: last 180d, published, dialect = active or MSA
    const sinceIso = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
    const { data: candidates, error: candErr } = await supabase
      .from("discover_videos")
      .select(
        "id, dialect, difficulty, cefr_level, created_at, vocabulary, title",
      )
      .eq("published", true)
      .gte("created_at", sinceIso)
      .in("dialect", [...dialectModuleValues(activeDialect), "MSA"])
      .order("created_at", { ascending: false })
      .limit(300);


    if (candErr) throw candErr;

    const now = Date.now();
    const fourteenDaysAgo = now - 14 * 24 * 3600 * 1000;
    const cefrIdx = cefr ? CEFR_ORDER.indexOf(cefr) : -1;

    const scored: FeedItem[] = [];
    for (const v of candidates ?? []) {
      const vid = (v as any).id as string;
      if (excludeIds.has(vid)) continue;

      const seen = viewedMap.get(vid);
      if (seen?.completed && seen.watchedAt > fourteenDaysAgo && !likedSet.has(vid)) {
        continue; // hard filter
      }

      const lemmas = extractLemmas((v as any).vocabulary);
      const total = lemmas.size;
      let known = 0;
      for (const l of lemmas) if (knownLemmas.has(l)) known++;
      const overlap = total > 0 ? known / total : 0;

      // Sweet spot 0.80..0.95 -> 1.0, falls off either side
      let vocabScore = 0;
      if (total === 0) {
        vocabScore = 0.3;
      } else if (overlap >= 0.8 && overlap <= 0.95) {
        vocabScore = 1.0;
      } else if (overlap > 0.95) {
        vocabScore = 0.7 - (overlap - 0.95) * 2; // too easy
      } else {
        vocabScore = overlap / 0.8;
      }
      vocabScore = Math.max(0, Math.min(1, vocabScore));

      // CEFR match — prefer the accurate cefr_level set by rate-video-cefr,
      // fall back to the coarse difficulty bucket for legacy rows.
      const vCefr =
        ((v as any).cefr_level as string) ||
        DIFF_TO_CEFR[(v as any).difficulty as string] ||
        "B1";

      const vIdx = CEFR_ORDER.indexOf(vCefr);
      let cefrScore = 0.5;
      if (cefrIdx >= 0 && vIdx >= 0) {
        const diff = Math.abs(vIdx - cefrIdx);
        cefrScore = diff === 0 ? 1.0 : diff === 1 ? 0.6 : diff === 2 ? 0.25 : 0.05;
      }

      // Dialect
      const dialectScore = dialectMatchesModule((v as any).dialect, activeDialect) ? 1.0 : 0.5;

      // Freshness (decay over 30d)
      const ageDays = (now - new Date((v as any).created_at).getTime()) / (24 * 3600 * 1000);
      const freshScore = Math.max(0, 1 - ageDays / 30);

      // Engagement: liked = boost, otherwise neutral
      const engagementScore = likedSet.has(vid) ? 1.0 : 0.5;

      // Novelty
      let noveltyScore = 1.0;
      if (seen) {
        const daysSince = (now - seen.watchedAt) / (24 * 3600 * 1000);
        noveltyScore = Math.min(1, daysSince / 30);
      }

      const score = isColdStart
        ? 0.5 * freshScore + 0.3 * dialectScore + 0.2 * engagementScore
        : 0.35 * vocabScore +
          0.20 * cefrScore +
          0.15 * dialectScore +
          0.10 * freshScore +
          0.10 * engagementScore +
          0.10 * noveltyScore;

      // Determine reason chip
      let reason = "مختار لك";
      let bucket: FeedItem["bucket"] = "match";
      if (likedSet.has(vid)) {
        reason = "لأنك أعجبت به";
      } else if (overlap >= 0.8 && overlap <= 0.95 && total >= 5) {
        reason = `تعرف ${Math.round(overlap * 100)}% من كلماته`;
      } else if (overlap > 0.95 && total >= 5) {
        reason = "مراجعة سهلة";
        bucket = "comfort";
      } else if (overlap >= 0.5 && overlap < 0.8) {
        reason = "وسّع مفرداتك";
        bucket = "stretch";
      } else if (cefrIdx >= 0 && vIdx === cefrIdx) {
        reason = `يناسب مستواك ${vCefr}`;
      } else if (ageDays < 7) {
        reason = `جديد في ${(v as any).dialect}`;
        bucket = "fresh";
      }

      scored.push({
        video_id: vid,
        score,
        comprehension: total > 0 ? overlap : 0.5,
        reason,
        bucket,
      });
    }

    // Sort high → low with seeded jitter inside small score bands
    scored.sort((a, b) => {
      const band = Math.floor(b.score * 20) - Math.floor(a.score * 20);
      if (band !== 0) return band;
      return rng() - 0.5;
    });

    // Ensure variety: take top N, then guarantee a stretch + comfort in top 10 if available
    const top = scored.slice(0, limit);
    const ensureBucket = (bucket: FeedItem["bucket"]) => {
      if (top.some((t) => t.bucket === bucket)) return;
      const found = scored.find((s) => s.bucket === bucket && !top.includes(s));
      if (found && top.length >= 6) top.splice(Math.min(8, top.length - 1), 0, found);
    };
    if (!isColdStart) {
      ensureBucket("stretch");
      ensureBucket("comfort");
    }

    return new Response(
      JSON.stringify({
        items: top.slice(0, limit),
        cold_start: isColdStart,
        seed,
        active_dialect: activeDialect,
        cefr,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("discover-feed error", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
