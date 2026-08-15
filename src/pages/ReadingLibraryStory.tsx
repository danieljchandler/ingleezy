import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { TappableArabicText } from '@/components/shared/TappableArabicText';
import { AskAISentence } from '@/components/shared/AskAISentence';
import { TranslationPair } from '@/components/shared/TranslationPair';
import { MarkUnknownsProvider } from '@/contexts/MarkUnknownsContext';
import { SaveUnknownsBar } from '@/components/shared/SaveUnknownsBar';
import { Loader2, Play, Pause, SkipForward, SkipBack, BookOpen, Eye, EyeOff } from 'lucide-react';
import { IconBack } from '@/components/shared/DirectionalIcon';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStory = Database['public']['Tables']['authentic_stories']['Row'];
type AuthenticStoryLine = Database['public']['Tables']['authentic_story_lines']['Row'];

const useStory = (id: string | undefined) =>
  useQuery({
    queryKey: ['reading-library-story', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('authentic_stories')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as AuthenticStory;
    },
    enabled: Boolean(id),
  });

const useStoryLines = (storyId: string | undefined) =>
  useQuery({
    queryKey: ['reading-library-lines', storyId],
    queryFn: async () => {
      if (!storyId) return [];
      const { data, error } = await supabase
        .from('authentic_story_lines')
        .select('*')
        .eq('story_id', storyId)
        .order('line_index', { ascending: true });
      if (error) throw error;
      return data as AuthenticStoryLine[];
    },
    enabled: Boolean(storyId),
  });

type StorySegment = {
  image_url?: string;
  url?: string;
  audio_url?: string;
  arabic_beat?: string;
  narration_arabic?: string;
  duration_seconds?: number;
  index?: number;
};

const ReadingLibraryStory = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: story, isLoading: loadingStory } = useStory(id);
  const { data: lines, isLoading: loadingLines } = useStoryLines(id);

  useDocumentTitle(story?.title ? `${story.title} — Reading Library` : 'Reading Library');

  const [showDialect, setShowDialect] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const segments: StorySegment[] = Array.isArray(story?.story_video_segments)
    ? (story!.story_video_segments as unknown as StorySegment[]).filter(
        (s) => s && (s.image_url || s.url),
      )
    : [];
  const sceneImages = segments.map((s) => (s.image_url || s.url) as string);
  const heroImage = sceneImages[activeSceneIdx] ?? sceneImages[0];

  const hasAudio = lines?.some((l) => l.audio_url);

  // The line shown as a caption under the picture. Defaults to 0 so the
  // reader always sees the first phrase; updates while audio plays and via
  // prev/next controls.
  const focusedIdx = currentLineIndex >= 0 ? currentLineIndex : 0;
  const focusedLine = lines?.[focusedIdx];

  // Sync active scene image to focused line
  useEffect(() => {
    if (sceneImages.length === 0 || !lines || lines.length === 0) return;
    const idx = Math.min(
      sceneImages.length - 1,
      Math.floor((focusedIdx / lines.length) * sceneImages.length),
    );
    setActiveSceneIdx(idx);
  }, [focusedIdx, lines?.length, sceneImages.length]);

  // Auto-scroll to current line
  useEffect(() => {
    if (currentLineIndex >= 0 && lineRefs.current[currentLineIndex]) {
      lineRefs.current[currentLineIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentLineIndex]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playLine = (index: number) => {
    if (!mountedRef.current) return;
    if (!lines || !lines[index]) return;
    const line = lines[index];

    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }

    setCurrentLineIndex(index);

    if (!line.audio_url) {
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(line.audio_url);
    audioRef.current = audio;
    setIsPlaying(true);

    audio.onended = () => {
      if (!mountedRef.current) return;
      if (index + 1 < lines.length) {
        playLine(index + 1);
      } else {
        setIsPlaying(false);
      }
    };

    audio.play().catch(() => {
      if (!mountedRef.current) return;
      setIsPlaying(false);
      toast.error("تعذّر تشغيل الصوت");
    });
  };

  const handlePlayPause = () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else if (audioRef.current && currentLineIndex >= 0) {
      audioRef.current.play();
      setIsPlaying(true);
    } else {
      playLine(focusedIdx);
    }
  };

  const handleNext = () => {
    if (!lines) return;
    const next = Math.min(lines.length - 1, focusedIdx + 1);
    if (next !== focusedIdx) playLine(next);
  };

  const handlePrev = () => {
    if (!lines) return;
    const prev = Math.max(0, focusedIdx - 1);
    if (prev !== focusedIdx) playLine(prev);
  };


  if (loadingStory || loadingLines) {
    return (
      <AppShell>
        <div className="flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!story) {
    return (
      <AppShell>
        <div className="text-center py-16">
          <p>ما لقينا القصة</p>
          <Button variant="link" onClick={() => navigate('/reading-library')}>رجوع للمكتبة</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <MarkUnknownsProvider>
      <AppShell>
        <div className="container mx-auto px-4 py-4 max-w-3xl">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/reading-library')}>
              <IconBack className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-lg font-bold">{story.title}</h1>
              {story.title_arabic && (
                <p className="text-base font-arabic text-muted-foreground" dir="rtl">{story.title_arabic}</p>
              )}
            </div>
            <div className="flex gap-1">
              <Badge variant="outline">{story.difficulty}</Badge>
              <Badge variant="secondary">{story.dialect}</Badge>
            </div>
          </div>

          {/* Scene slideshow */}
          {sceneImages.length > 0 && (
            <div className="mb-4">
              <div className="relative rounded-xl overflow-hidden bg-muted aspect-video shadow-sm">
                <img
                  src={heroImage}
                  alt={`Scene ${activeSceneIdx + 1}`}
                  className="w-full h-full object-cover transition-opacity duration-500"
                />
                {sceneImages.length > 1 && (
                  <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                    {activeSceneIdx + 1} / {sceneImages.length}
                  </div>
                )}
              </div>
              {sceneImages.length > 1 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {sceneImages.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveSceneIdx(i)}
                      className={cn(
                        'shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 transition',
                        i === activeSceneIdx ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100',
                      )}
                    >
                      <img src={src} alt={`Scene ${i + 1} thumbnail`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Caption card: current phrase under the picture, with prev/next */}
          {lines && lines.length > 0 && focusedLine && (
            <Card className="p-4 mb-4 border-2 border-primary/20 shadow-sm">
              <div dir="rtl" className="text-xl leading-loose text-center min-h-[3rem]">
                <TappableArabicText
                  text={showDialect
                    ? (focusedLine.dialect_vocalized || focusedLine.dialect || focusedLine.arabic_vocalized || focusedLine.arabic)
                    : (focusedLine.arabic_vocalized || focusedLine.arabic)
                  }
                  sentenceContext={{ english: focusedLine.english ?? undefined }}
                  source="reading-library"
                />
              </div>
              {showEnglish && focusedLine.english && (
                <TranslationPair
                  variant="compact"
                  literal={(focusedLine as { english_literal?: string | null }).english_literal}
                  natural={focusedLine.english}
                  className="text-center mt-2"
                />
              )}

              <div className="flex justify-center mt-2">
                <AskAISentence
                  arabic={showDialect
                    ? (focusedLine.dialect_vocalized || focusedLine.dialect || focusedLine.arabic_vocalized || focusedLine.arabic)
                    : (focusedLine.arabic_vocalized || focusedLine.arabic)
                  }
                  english={focusedLine.english ?? undefined}
                  variant="chip"
                />
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-border">
                <Button size="icon" variant="ghost" onClick={handlePrev} disabled={focusedIdx <= 0}>
                  <SkipBack className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3">
                  {hasAudio && (
                    <Button size="icon" variant="default" onClick={handlePlayPause} className="h-11 w-11 rounded-full">
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {focusedIdx + 1} / {lines.length}
                  </span>
                </div>
                <Button size="icon" variant="ghost" onClick={handleNext} disabled={focusedIdx >= lines.length - 1}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          )}

          {/* Display toggles */}
          <Card className="p-3 mb-4">
            <div className="flex flex-wrap items-center gap-4">
              {story.body_dialect && (
                <div className="flex items-center gap-2">
                  <Switch checked={showDialect} onCheckedChange={setShowDialect} id="dialect-toggle" />
                  <Label htmlFor="dialect-toggle" className="text-sm">العامية</Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={showEnglish} onCheckedChange={setShowEnglish} id="english-toggle" />
                <Label htmlFor="english-toggle" className="text-sm">الإنجليزي</Label>
              </div>
            </div>
          </Card>


          {/* Story Lines */}
          <div className="space-y-4">
            {lines && lines.map((line, idx) => (
              <div
                key={line.id}
                ref={el => { lineRefs.current[idx] = el; }}
                className={cn(
                  'rounded-lg p-3 transition-colors cursor-pointer',
                  currentLineIndex === idx ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50',
                )}
                onClick={() => line.audio_url && playLine(idx)}
              >
                {/* Arabic text (tappable) */}
                <div dir="rtl" className="text-lg leading-relaxed">
                  <TappableArabicText
                    text={showDialect
                      ? (line.dialect_vocalized || line.dialect || line.arabic_vocalized || line.arabic)
                      : (line.arabic_vocalized || line.arabic)
                    }
                    sentenceContext={{ english: line.english ?? undefined }}
                    source="reading-library"
                  />
                </div>

                {/* English translation */}
                {showEnglish && line.english && (
                  <TranslationPair
                    variant="compact"
                    literal={(line as { english_literal?: string | null }).english_literal}
                    natural={line.english}
                    className="mt-1"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Story metadata */}
          <div className="mt-8 pt-4 border-t text-sm text-muted-foreground space-y-1">
            {story.author && <p>Author: {story.author} {story.author_arabic && `(${story.author_arabic})`}</p>}
            {story.source_name && <p>Source: {story.source_name}</p>}
            {story.license && <p>License: {story.license}</p>}
          </div>
        </div>

        <SaveUnknownsBar source="reading-library" />
      </AppShell>
    </MarkUnknownsProvider>
  );
};

export default ReadingLibraryStory;
