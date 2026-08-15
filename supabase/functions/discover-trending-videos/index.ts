/**
 * discover-trending-videos — find English Shorts worth turning into lessons.
 *
 * Flipped from Hakiya, where this crawled the six Gulf states for Arabic
 * Shorts. It now crawls the US and the UK, which is where the English an
 * Arabic speaker is actually trying to understand gets spoken: films, media,
 * work calls, and the internet.
 *
 * Two regions rather than six, so the per-region keep is raised to hold the
 * batch size an admin review session expects.
 *
 * The queries are chosen for one property — people TALKING. A Short with no
 * speech is worthless to a listening pipeline however well it trends, which is
 * also why the exclusions changed shape: Hakiya excluded Quran recitation,
 * which has no English analogue, and the equivalent noise here is the enormous
 * category of Shorts with no spoken word in them at all (music, ASMR,
 * "satisfying", no-talking compilations). Gaming stays excluded for the reason
 * it always was: gameplay commentary is jargon-dense and half-intelligible
 * even to natives.
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { enforceDailyCap } from '../_shared/usageCap.ts';

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');

/**
 * Where the English comes from. Two regions, deliberately: US and UK are the
 * accents an Arabic speaker meets in media and at work, and splitting the
 * crawl further would thin each bucket without adding a variety of English
 * that matters at this stage. Adding a region is adding a string here.
 */
const ENGLISH_REGIONS = ['US', 'GB'];

/**
 * Search queries that surface English Shorts with actual speech in them
 * (rotated per fetch). Every one of these is a format where somebody talks to
 * camera or to another person — which is the whole point, since the transcript
 * is the product.
 */
const SEARCH_QUERIES = [
  'street interview',
  'day in my life',
  'storytime',
  'podcast clip',
  'explained in 60 seconds',
  'how to',
  'reaction',
  'vlog',
  'british slang',
  'american slang',
  'small talk',
  'job interview tips',
];

/**
 * Shorts with no spoken English in them.
 *
 * This is the slot Hakiya used for Quran recitation — content that trends
 * hugely and teaches the target language nothing. English has no single
 * equivalent, but it has a large one in aggregate: music, ASMR, and the
 * "satisfying"/"no talking" genres, none of which carry a sentence anyone
 * could learn from.
 */
const NO_SPEECH_KEYWORDS = [
  'no talking', 'asmr', 'satisfying', 'oddly satisfying', 'lyrics', 'lyric video',
  'official music video', 'official video', 'audio only', 'full song', 'cover song',
  'instrumental', 'sleep sounds', 'white noise', 'relaxing music', 'study music',
  'slowed reverb', 'nightcore', 'edit audio',
];

const GAMING_KEYWORDS = [
  'gaming', 'gameplay', 'gamer', 'fortnite', 'pubg', 'ps5', 'xbox', 'minecraft',
  'free fire', 'warzone', 'roblox', 'valorant', 'speedrun', 'no commentary',
  'let\'s play', 'twitch', 'clutch', 'ranked', 'loadout',
];

interface VideoCandidate {
  video_id: string;
  platform: string;
  url: string;
  title: string;
  creator_name: string;
  creator_handle: string;
  thumbnail_url: string | null;
  view_count: number;
  trending_score: number;
  detected_topic: string;
  region_code: string;
  duration_seconds: number | null;
  discovered_at: string;
}

/** Two regions instead of six, so each keeps more to leave the batch the same size. */
const MAX_PER_REGION = 12;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Admin-only in the UI, and it drives the paid YouTube Data API. Require a
  // signed-in user (admins bypass the cap) so it can't be triggered anonymously.
  const cap = await enforceDailyCap(req, 'discover-trending-videos', 100, corsHeaders);
  if (cap.limited) return cap.response;

  if (!YOUTUBE_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'YouTube API key not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('Starting discovery of trending English YouTube Shorts...');

    // Pick 2 random search queries per fetch to vary results
    const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    const queries = shuffled.slice(0, 2);
    console.log('Search queries:', queries);

    // For each region, search with each query in parallel
    const tasks: Promise<{ region: string; candidates: VideoCandidate[] }>[] = [];

    for (const region of ENGLISH_REGIONS) {
      for (const query of queries) {
        tasks.push(searchShorts(region, query));
      }
    }

    const settled = await Promise.allSettled(tasks);

    // Collect and dedup
    const seenVideoIds = new Set<string>();
    const regionBuckets: Record<string, VideoCandidate[]> = {};

    for (const s of settled) {
      if (s.status === 'rejected') {
        console.error('Search failed:', s.reason);
        continue;
      }
      const { region, candidates } = s.value;
      if (!regionBuckets[region]) regionBuckets[region] = [];

      for (const c of candidates) {
        if (seenVideoIds.has(c.video_id)) continue;
        seenVideoIds.add(c.video_id);
        regionBuckets[region].push(c);
      }
    }

    // Sort each region by trending score, take top N
    const allCandidates: VideoCandidate[] = [];
    const regionSummary: Record<string, number> = {};

    for (const region of ENGLISH_REGIONS) {
      const bucket = regionBuckets[region] ?? [];
      bucket.sort((a, b) => b.trending_score - a.trending_score);
      const kept = bucket.slice(0, MAX_PER_REGION);
      allCandidates.push(...kept);
      regionSummary[region] = kept.length;
      console.log(`Region ${region}: ${kept.length} videos kept from ${bucket.length} found`);
    }

    console.log(`Total: ${allCandidates.length} English Shorts candidates`);

    return new Response(
      JSON.stringify({
        success: true,
        candidates_found: allCandidates.length,
        candidates: allCandidates,
        region_summary: regionSummary,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error in discover-trending-videos:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function searchShorts(
  region: string,
  query: string
): Promise<{ region: string; candidates: VideoCandidate[] }> {
  // Step 1: Search for short videos
  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet` +
    `&type=video` +
    `&videoDuration=short` +
    `&order=viewCount` +
    `&regionCode=${region}` +
    `&relevanceLanguage=en` +
    `&q=${encodeURIComponent(query)}` +
    `&maxResults=25` +
    `&publishedAfter=${getRecentDate()}` +
    `&key=${YOUTUBE_API_KEY}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    const text = await searchRes.text();
    throw new Error(`YouTube search API ${searchRes.status} for ${region}/${query}: ${text}`);
  }

  const searchData = await searchRes.json();
  const items = searchData.items ?? [];

  if (items.length === 0) {
    return { region, candidates: [] };
  }

  // Step 2: Get video details (statistics + contentDetails) for the found IDs
  const videoIds = items.map((i: any) => i.id.videoId).filter(Boolean);
  if (videoIds.length === 0) return { region, candidates: [] };

  const detailsUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,statistics,contentDetails` +
    `&id=${videoIds.join(',')}` +
    `&key=${YOUTUBE_API_KEY}`;

  const detailsRes = await fetch(detailsUrl);
  if (!detailsRes.ok) {
    const text = await detailsRes.text();
    throw new Error(`YouTube videos API ${detailsRes.status}: ${text}`);
  }

  const detailsData = await detailsRes.json();
  const videos = detailsData.items ?? [];

  const candidates: VideoCandidate[] = [];

  for (const video of videos) {
    const title = video.snippet.title;
    const description = video.snippet.description ?? '';

    // Must be an English-language listing. Region and relevanceLanguage are
    // hints rather than guarantees — a US regionCode returns plenty of Spanish
    // and Hindi Shorts — so the title has to carry Latin script and must not be
    // mostly another one.
    if (!hasEnglishText(title)) continue;

    // Exclude the no-speech genres and gaming
    if (isExcluded(title, description, video.snippet.categoryId)) continue;

    const durationSeconds = parseDuration(video.contentDetails?.duration);
    // Shorts should be ≤ 180s (YouTube expanded Shorts to 3 min)
    if (durationSeconds <= 0 || durationSeconds > 180) continue;

    const viewCount = parseInt(video.statistics?.viewCount ?? '0', 10);
    const likeCount = parseInt(video.statistics?.likeCount ?? '0', 10);
    const commentCount = parseInt(video.statistics?.commentCount ?? '0', 10);

    // Minimum view threshold
    if (viewCount < 1000) continue;

    const likeRatio = viewCount > 0 ? (likeCount / viewCount) * 100 : 0;
    const trendingScore = Math.floor(
      (viewCount / 10000) * 40 +
      likeRatio * 30 +
      (commentCount / 1000) * 30
    );

    candidates.push({
      video_id: video.id,
      platform: 'youtube',
      url: `https://www.youtube.com/shorts/${video.id}`,
      title,
      creator_name: video.snippet.channelTitle,
      creator_handle: video.snippet.channelId,
      thumbnail_url:
        video.snippet.thumbnails.high?.url ??
        video.snippet.thumbnails.medium?.url ??
        null,
      view_count: viewCount,
      trending_score: trendingScore,
      detected_topic: detectTopic(title, description),
      region_code: region,
      duration_seconds: durationSeconds > 0 ? durationSeconds : null,
      discovered_at: new Date().toISOString(),
    });
  }

  return { region, candidates };
}

function getRecentDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14); // Last 2 weeks
  return d.toISOString();
}

/**
 * Is this listing plausibly in English?
 *
 * `regionCode=US` and `relevanceLanguage=en` are ranking hints, not filters —
 * a US crawl returns plenty of Spanish and Hindi Shorts. The title is checked
 * rather than the description because a description is often boilerplate,
 * hashtags and links in whatever language the uploader's template is in.
 *
 * The test is proportional, not "contains a Latin letter": a title like
 * "أفضل vlog" would pass a contains-check while being a video nobody is
 * speaking English in.
 */
function hasEnglishText(title: string): boolean {
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0) return false;
  const latin = letters.replace(/[^A-Za-z]/g, '').length;
  return latin / letters.length >= 0.6;
}

function isExcluded(title: string, description: string, categoryId?: string): boolean {
  if (categoryId === '20') return true; // Gaming category
  if (categoryId === '10') return true; // Music category — sung, not spoken
  const text = (title + ' ' + description).toLowerCase();
  return (
    NO_SPEECH_KEYWORDS.some((kw) => text.includes(kw)) ||
    GAMING_KEYWORDS.some((kw) => text.includes(kw))
  );
}

function parseDuration(iso?: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    (parseInt(match[1] ?? '0', 10) * 3600) +
    (parseInt(match[2] ?? '0', 10) * 60) +
    parseInt(match[3] ?? '0', 10)
  );
}

function detectTopic(title: string, description: string): string {
  const text = (title + ' ' + description).toLowerCase();
  const topics: Record<string, string[]> = {
    comedy: ['comedy', 'funny', 'joke', 'standup', 'stand-up', 'prank'],
    sports: ['sports', 'football', 'soccer', 'nba', 'premier league', 'match'],
    news: ['news', 'breaking', 'headline', 'reporter'],
    food: ['food', 'cooking', 'recipe', 'chef', 'restaurant', 'baking', 'taste test'],
    travel: ['travel', 'tourism', 'trip', 'airport', 'flight', 'backpacking'],
    beauty: ['makeup', 'skincare', 'beauty', 'grwm', 'get ready with me'],
    lifestyle: ['lifestyle', 'vlog', 'routine', 'day in my life', 'storytime'],
    kids: ['kids', 'children', 'cartoon', 'toddler'],
    // No bare 'ai': it is a substring of "explained", "said" and "email", and
    // matched them all before this list was ever exercised.
    tech: ['tech', 'technology', 'iphone', 'review', 'gadget', 'chatgpt', 'smartphone'],
    // The one an English-learning app cares about most: clips that are already
    // teaching the language, from slang explainers to pronunciation drills.
    // No bare 'tips' — "makeup tips" and "travel tips" are not lessons.
    education: ['education', 'lesson', 'explained', 'learn', 'slang', 'grammar', 'pronunciation'],
    // 'job interview' rather than 'interview': a street interview is a vox pop,
    // and it is one of the queries this crawler runs.
    work: ['job interview', 'career', 'workplace', 'meeting', 'salary', 'boss', 'resume'],
  };

  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some((kw) => text.includes(kw))) return topic;
  }
  return 'general';
}
