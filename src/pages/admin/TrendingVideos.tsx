import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { parseVideoUrl, getYouTubeThumbnail } from '@/lib/videoEmbed';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  Eye,
  Trash2,
} from 'lucide-react';

interface TrendingCandidate {
  id: string;
  video_id: string;
  platform: string;
  url: string;
  title: string;
  creator_name: string;
  creator_handle: string | null;
  thumbnail_url: string | null;
  view_count: number | null;
  trending_score: number | null;
  detected_topic: string | null;
  discovered_at: string | null;
  processed: boolean | null;
  rejected: boolean | null;
  rejection_reason: string | null;
  region_code: string | null;
  duration_seconds: number | null;
  dismissed: boolean | null;
}

const REGION_LABELS: Record<string, { flag: string; name: string }> = {
  SA: { flag: '🇸🇦', name: 'Saudi Arabia' },
  AE: { flag: '🇦🇪', name: 'UAE' },
  KW: { flag: '🇰🇼', name: 'Kuwait' },
  QA: { flag: '🇶🇦', name: 'Qatar' },
  BH: { flag: '🇧🇭', name: 'Bahrain' },
  OM: { flag: '🇴🇲', name: 'Oman' },
};

const GULF_REGION_CODES = Object.keys(REGION_LABELS);

const TOPIC_COLORS: Record<string, string> = {
  music: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  comedy: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  sports: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  news: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  food: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  travel: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  beauty: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  lifestyle: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  kids: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
  tech: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  education: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  general: 'bg-muted text-muted-foreground',
};


type FilterTab = 'new' | 'approved' | 'rejected' | 'all';

const TrendingVideos = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('new');
  const [searchParams, setSearchParams] = useSearchParams();
  const regionFilter = searchParams.get('region') ?? 'all';
  const setRegionFilter = (value: string) =>
    setSearchParams(value === 'all' ? {} : { region: value }, { replace: true });

  const { data: candidates, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['trending-candidates', filter],
    queryFn: async () => {
      let query = supabase
        .from('trending_video_candidates')
        .select('*')
        .eq('dismissed', false)
        .order('trending_score', { ascending: false });

      if (filter === 'new') {
        query = query.eq('processed', false).eq('rejected', false);
      } else if (filter === 'approved') {
        query = query.eq('processed', true);
      } else if (filter === 'rejected') {
        query = query.eq('rejected', true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TrendingCandidate[];
    },
  });

  const filteredCandidates = regionFilter === 'all'
    ? candidates
    : candidates?.filter((c) => c.region_code === regionFilter);

  const fetchTrending = useMutation({
    mutationFn: async () => {
      // Step 1: fetch candidates from YouTube via the edge function
      const { data, error } = await supabase.functions.invoke('discover-trending-videos');
      if (error) throw error;

      // Map to only the columns that exist in the table (prevents TS errors and unknown-field rejections)
      type CandidateRow = {
        platform: string;
        video_id: string;
        url: string;
        title: string;
        creator_name: string;
        creator_handle: string | null;
        thumbnail_url: string | null;
        view_count: number | null;
        trending_score: number | null;
        detected_topic: string | null;
        region_code: string | null;
        duration_seconds: number | null;
      };
      const rows: CandidateRow[] = (data?.candidates ?? []).map((c: Record<string, unknown>) => ({
        platform: c.platform as string,
        video_id: c.video_id as string,
        url: c.url as string,
        title: c.title as string,
        creator_name: c.creator_name as string,
        creator_handle: (c.creator_handle as string | null) ?? null,
        thumbnail_url: (c.thumbnail_url as string | null) ?? null,
        view_count: (c.view_count as number | null) ?? null,
        trending_score: (c.trending_score as number | null) ?? null,
        detected_topic: (c.detected_topic as string | null) ?? null,
        region_code: (c.region_code as string | null) ?? null,
        duration_seconds: (c.duration_seconds as number | null) ?? null,
      }));

      // Step 2: save to DB — only INSERT new video IDs, never overwrite existing records.
      // ignoreDuplicates ensures rejected/dismissed videos are not resurrected on re-fetch.
      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from('trending_video_candidates')
          .upsert(rows as any, { onConflict: 'platform,video_id', ignoreDuplicates: true });
        if (upsertError) throw upsertError;
      }

      return data;
    },
    onSuccess: (data) => {
      const summary = data?.region_summary
        ? Object.entries(data.region_summary as Record<string, number>)
            .map(([code, count]) => `${REGION_LABELS[code]?.flag ?? code} ${count}`)
            .join('  ')
        : '';
      toast({
        title: `Found ${data?.candidates_found ?? 0} new candidates`,
        description: summary || undefined,
      });
      qc.invalidateQueries({ queryKey: ['trending-candidates'] });
    },
    onError: (err: any) => {
      const detail = err?.message ?? 'Unknown error';
      toast({ variant: 'destructive', title: 'Fetch failed', description: detail });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (candidate: TrendingCandidate) => {
      if (!user) throw new Error('Not authenticated');

      // Parse URL to get embed URL and thumbnail
      const parsed = parseVideoUrl(candidate.url);
      const embedUrl = parsed?.embedUrl || candidate.url;
      const platform = parsed?.platform || candidate.platform || 'youtube';
      const thumbnailUrl = parsed?.platform === 'youtube'
        ? getYouTubeThumbnail(parsed.videoId)
        : candidate.thumbnail_url || '';

      // 1. Create discover_videos record with pending transcription status
      const { data: newVideo, error: insertErr } = await (supabase
        .from('discover_videos' as any) as any)
        .insert({
          title: candidate.title,
          source_url: candidate.url,
          platform,
          embed_url: embedUrl,
          thumbnail_url: thumbnailUrl,
          duration_seconds: candidate.duration_seconds,
          dialect: 'Gulf',
          difficulty: 'Intermediate',
          published: false,
          created_by: user.id,
          transcription_status: 'pending',
          trending_candidate_id: candidate.id,
        })
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      // 2. Mark the trending candidate as processed
      const { error: updateErr } = await supabase
        .from('trending_video_candidates')
        .update({ processed: true })
        .eq('id', candidate.id);
      if (updateErr) throw updateErr;

      // 3. Queue ingestion/transcription pipeline.
      // YouTube used to be queued through a RunPod extraction worker; that
      // worker has been removed and process-approved-video now acquires audio
      // for every platform via download-media.
      supabase.functions.invoke('process-approved-video', {
        body: { videoId: newVideo.id },
      }).catch((err) => {
        console.error('Failed to trigger processing pipeline:', err);
      });

      return { videoId: newVideo.id, title: candidate.title };
    },
    onSuccess: (result) => {
      toast({
        title: 'Video approved',
        description: `"${result.title}" — transcription pipeline started in background`,
      });
      qc.invalidateQueries({ queryKey: ['trending-candidates'] });
      qc.invalidateQueries({ queryKey: ['admin-discover-videos'] });
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Approve failed',
        description: err?.message ?? 'Unknown error',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('trending_video_candidates')
        .update({ rejected: true, rejection_reason: 'manually_rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Video rejected' });
      qc.invalidateQueries({ queryKey: ['trending-candidates'] });
    },
  });

  const deleteMutation = useMutation({
    // Soft-delete: mark as dismissed rather than physically removing the row.
    // Keeping the row means the video_id stays in the unique index, so future
    // "Fetch Trending" calls cannot re-insert the same video as a new candidate.
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('trending_video_candidates')
        .update({ dismissed: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Video dismissed — won\'t appear again' });
      qc.invalidateQueries({ queryKey: ['trending-candidates'] });
    },
  });

  const formatViews = (count: number | null) => {
    if (!count) return '—';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
  };


  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'new', label: 'New' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold font-heading flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Trending Videos
                </h1>
                <p className="text-sm text-muted-foreground">
                  Discover and curate trending Gulf Arabic YouTube videos
                </p>
              </div>
            </div>
            <Button
              onClick={() => fetchTrending.mutate()}
              disabled={fetchTrending.isPending}
            >
              {fetchTrending.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Fetch Trending
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Status filter tabs */}
        <div className="flex gap-2 mb-3">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={filter === tab.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Region filter */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <Button
            size="sm"
            variant={regionFilter === 'all' ? 'secondary' : 'ghost'}
            onClick={() => setRegionFilter('all')}
          >
            All Regions
          </Button>
          {GULF_REGION_CODES.map((code) => (
            <Button
              key={code}
              size="sm"
              variant={regionFilter === code ? 'secondary' : 'ghost'}
              onClick={() => setRegionFilter(code)}
            >
              {REGION_LABELS[code].flag} {REGION_LABELS[code].name}
            </Button>
          ))}
        </div>


        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              <p className="text-lg font-medium">Failed to load candidates</p>
              <pre className="text-xs mt-2 text-left bg-muted rounded p-3 overflow-auto max-h-40">
                {queryError instanceof Error
                  ? queryError.message
                  : (queryError as any)?.message ?? (queryError as any)?.code ?? 'See browser console for details'}
              </pre>
            </CardContent>
          </Card>
        ) : !filteredCandidates?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No candidates found</p>
              <p className="text-sm mt-1">
                Click "Fetch Trending" to discover new Gulf Arabic videos from YouTube.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCandidates.map((c) => (
              <Card key={c.id} className="overflow-hidden hover:shadow-md transition-shadow">
                {/* Thumbnail */}
                {c.thumbnail_url && (
                  <div className="relative aspect-video bg-muted">
                    <img
                      src={c.thumbnail_url}
                      alt={c.title}
                      className="w-full h-full object-cover"
                    />
                    {c.trending_score && (
                      <Badge className="absolute top-2 right-2 bg-primary/90">
                        Score: {c.trending_score.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                )}

                <CardContent className="p-4 space-y-3">
                  {/* Title */}
                  <h3 className="font-semibold text-sm line-clamp-2 leading-tight" dir="auto">
                    {c.title}
                  </h3>

                  {/* Meta row */}
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span className="font-medium">{c.creator_name}</span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {formatViews(c.view_count)}
                    </span>
                    {c.region_code && REGION_LABELS[c.region_code] && (
                      <span title={REGION_LABELS[c.region_code].name}>
                        {REGION_LABELS[c.region_code].flag} {REGION_LABELS[c.region_code].name}
                      </span>
                    )}
                    {c.detected_topic && (
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${TOPIC_COLORS[c.detected_topic] || TOPIC_COLORS.general}`}
                      >
                        {c.detected_topic}
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {!c.processed && !c.rejected && (
                      <>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => approveMutation.mutate(c)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => rejectMutation.mutate(c.id)}
                          disabled={rejectMutation.isPending}
                        >
                          <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      asChild
                    >
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default TrendingVideos;
