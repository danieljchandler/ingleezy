import { getCorsHeaders } from '../_shared/cors.ts';
import { enforceDailyCap } from '../_shared/usageCap.ts';

const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');

const GULF_REGIONS = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];

// Search queries that surface Gulf Arabic Shorts (rotated per fetch)
const SEARCH_QUERIES = [
  'شورتس',        // "shorts" in Arabic
  'يوميات',       // daily vlogs
  'مضحك',         // funny
  'طبخ عربي',     // Arabic cooking
  'كوميديا',      // comedy
  'سعودي',        // Saudi
  'إماراتي',      // Emirati
  'كويتي',        // Kuwaiti
  'خليجي',        // Gulf / Khaleeji
  'تحدي',         // challenge
];

const QURAN_KEYWORDS = [
  'قرآن', 'تلاوة', 'سورة', 'آية', 'حفص', 'ورش', 'ختمة', 'مصحف', 'تجويد',
  'القرآن', 'الكريم', 'ختم', 'حفظ القرآن', 'قارئ',
  'quran', 'recitation', 'tilawah', 'surah', 'ayah', 'hafiz', 'tajweed',
];

const GAMING_KEYWORDS = [
  'ألعاب', 'لعبة', 'جيمنج', 'بلايستيشن', 'ببجي', 'فورت نايت', 'ماين كرافت',
  'جيمر', 'فري فاير', 'كلاش', 'gaming', 'gameplay', 'gamer', 'fortnite',
  'pubg', 'ps5', 'xbox', 'minecraft', 'free fire', 'warzone', 'roblox', 'valorant',
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

const MAX_PER_REGION = 8;

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
    console.log('Starting discovery of trending Gulf Arabic YouTube Shorts...');

    // Pick 2 random search queries per fetch to vary results
    const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    const queries = shuffled.slice(0, 2);
    console.log('Search queries:', queries);

    // For each region, search with each query in parallel
    const tasks: Promise<{ region: string; candidates: VideoCandidate[] }>[] = [];

    for (const region of GULF_REGIONS) {
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

    for (const region of GULF_REGIONS) {
      const bucket = regionBuckets[region] ?? [];
      bucket.sort((a, b) => b.trending_score - a.trending_score);
      const kept = bucket.slice(0, MAX_PER_REGION);
      allCandidates.push(...kept);
      regionSummary[region] = kept.length;
      console.log(`Region ${region}: ${kept.length} videos kept from ${bucket.length} found`);
    }

    console.log(`Total: ${allCandidates.length} Gulf Arabic Shorts candidates`);

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
    `&relevanceLanguage=ar` +
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

    // Must have Arabic in title or description
    if (!/[\u0600-\u06FF]/.test(title) && !/[\u0600-\u06FF]/.test(description)) continue;

    // Exclude Quran/religious and gaming
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

function isExcluded(title: string, description: string, categoryId?: string): boolean {
  if (categoryId === '20') return true; // Gaming category
  const text = (title + ' ' + description).toLowerCase();
  return (
    QURAN_KEYWORDS.some((kw) => text.includes(kw.toLowerCase())) ||
    GAMING_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))
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
    music: ['موسيقى', 'أغنية', 'مطرب', 'music', 'song', 'كليب'],
    comedy: ['كوميديا', 'مضحك', 'نكتة', 'comedy', 'funny', 'ضحك'],
    sports: ['رياضة', 'كرة', 'مباراة', 'sports', 'football', 'دوري'],
    news: ['أخبار', 'خبر', 'news', 'breaking'],
    food: ['طعام', 'طبخ', 'وصفة', 'food', 'cooking', 'recipe', 'أكل', 'شيف'],
    travel: ['سفر', 'سياحة', 'travel', 'tourism', 'رحلة'],
    beauty: ['مكياج', 'makeup', 'skincare', 'جمال', 'beauty'],
    lifestyle: ['حياة', 'يوميات', 'lifestyle', 'vlog', 'روتين'],
    kids: ['أطفال', 'kids', 'children', 'كرتون'],
    tech: ['تقنية', 'tech', 'technology', 'آيفون', 'مراجعة'],
    education: ['تعليم', 'درس', 'education', 'lesson', 'شرح', 'تعلم'],
  };

  for (const [topic, keywords] of Object.entries(topics)) {
    if (keywords.some((kw) => text.includes(kw))) return topic;
  }
  return 'general';
}
