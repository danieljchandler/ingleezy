// What the learner has been consuming lately: watched videos, stories, listen
// episodes. The learner profile covers what they *know*; this covers what
// they've *seen*, so the assistant can say "the video you watched yesterday"
// and mean it. Kept separate from learnerProfile.ts so its six existing
// callers stay untouched.
//
// Cost: three bounded queries plus one title lookup, in parallel. Never
// throws — any failure renders as "" and the prompt simply omits the block.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Row = Record<string, unknown>;

const VIDEO_LIMIT = 5;
const STORY_LIMIT = 3;
const EPISODE_LIMIT = 3;
/** Hard ceiling on the rendered block so it can't crowd the prompt. */
const BLOCK_MAX_CHARS = 600;

/**
 * One short "RECENT CONTENT" paragraph for systemPromptExtra, or "" when the
 * learner has no history (or any query fails).
 */
export async function contentHistoryBlock(opts: {
  userId: string | null | undefined;
  supabase?: ReturnType<typeof adminClient>;
}): Promise<string> {
  const { userId } = opts;
  if (!userId) return "";

  try {
    const supabase = opts.supabase ?? adminClient();

    const [viewsRes, storiesRes, playsRes] = await Promise.all([
      supabase
        .from("video_views")
        .select("video_id, watched_at, completed")
        .eq("user_id", userId)
        .order("watched_at", { ascending: false })
        .limit(VIDEO_LIMIT),
      supabase
        .from("story_progress")
        .select("story_id, completed, started_at, interactive_stories(title)")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(STORY_LIMIT),
      supabase
        .from("listen_episode_plays")
        .select("episode_id, completed, updated_at, listen_episodes(title)")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(EPISODE_LIMIT),
    ]);

    const views = (viewsRes.data ?? []) as Row[];
    let videoTitles: string[] = [];
    if (views.length > 0) {
      const ids = views.map((v) => v.video_id).filter(Boolean);
      const { data: videos } = await supabase
        .from("discover_videos")
        .select("id, title, cefr_level")
        .in("id", ids);
      const byId = new Map(((videos ?? []) as Row[]).map((v) => [v.id, v]));
      videoTitles = views
        .map((v) => {
          const video = byId.get(v.video_id);
          if (!video) return null;
          const level = video.cefr_level ? ` (${video.cefr_level})` : "";
          return `${video.title}${level}${v.completed ? "" : " — unfinished"}`;
        })
        .filter((t): t is string => !!t);
    }

    const storyTitles = ((storiesRes.data ?? []) as Row[])
      .map((s) => (s.interactive_stories as Row | null)?.title)
      .filter((t): t is string => typeof t === "string");

    const episodeTitles = ((playsRes.data ?? []) as Row[])
      .map((p) => (p.listen_episodes as Row | null)?.title)
      .filter((t): t is string => typeof t === "string");

    const parts: string[] = [];
    if (videoTitles.length) parts.push(`videos watched: ${videoTitles.join("; ")}`);
    if (storyTitles.length) parts.push(`stories: ${storyTitles.join("; ")}`);
    if (episodeTitles.length) parts.push(`listening episodes: ${episodeTitles.join("; ")}`);

    if (parts.length === 0) return "";

    const block = `RECENT CONTENT (what this learner has been watching/reading in the app): ${parts.join(". ")}.`;
    return block.length > BLOCK_MAX_CHARS ? `${block.slice(0, BLOCK_MAX_CHARS)}…` : block;
  } catch (err) {
    console.error("contentHistoryBlock failed (continuing without):", err);
    return "";
  }
}
