import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppShell } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, BookOpen, Clock, Headphones } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStory = Database['public']['Tables']['authentic_stories']['Row'];

const usePublishedStories = (filters: { difficulty?: string; dialect?: string }) =>
  useQuery({
    queryKey: ['reading-library', filters],
    queryFn: async () => {
      let query = supabase
        .from('authentic_stories')
        .select('id, title, title_arabic, author, author_arabic, source_name, dialect, difficulty, duration_seconds, video_status, created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (filters.difficulty && filters.difficulty !== 'all') {
        query = query.eq('difficulty', filters.difficulty);
      }
      if (filters.dialect && filters.dialect !== 'all') {
        query = query.eq('dialect', filters.dialect);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Pick<AuthenticStory, 'id' | 'title' | 'title_arabic' | 'author' | 'author_arabic' | 'source_name' | 'dialect' | 'difficulty' | 'duration_seconds' | 'video_status' | 'created_at'>[];
    },
  });

const ReadingLibrary = () => {
  useDocumentTitle('Reading Library — Ingleezy');
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState('all');
  const [dialect, setDialect] = useState('all');

  const { data: stories, isLoading } = usePublishedStories({ difficulty, dialect });

  // duration_seconds is nullable in the DB, so accept null as well as undefined.
  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-heading">Reading Library</h1>
            <p className="text-sm text-muted-foreground">Authentic Arabic stories for reading & listening practice</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6">
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dialect} onValueChange={setDialect}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Dialect" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dialects</SelectItem>
              <SelectItem value="Gulf">Gulf</SelectItem>
              <SelectItem value="Egyptian">Egyptian</SelectItem>
              <SelectItem value="Yemeni">Yemeni</SelectItem>
              <SelectItem value="Levantine">Levantine</SelectItem>
              <SelectItem value="MSA">MSA</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stories Grid */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : stories && stories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stories.map((story) => (
              <Card
                key={story.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/reading-library/${story.id}`)}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-base">{story.title}</h3>
                    <Badge variant="outline" className="text-xs shrink-0 ml-2">
                      {story.difficulty}
                    </Badge>
                  </div>
                  {story.title_arabic && (
                    <p className="text-base font-arabic text-muted-foreground" dir="rtl">
                      {story.title_arabic}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {story.author && <span>{story.author}</span>}
                    {story.dialect && <Badge variant="secondary" className="text-xs">{story.dialect}</Badge>}
                    {story.video_status === 'ready' && (
                      <span className="flex items-center gap-1">
                        <Headphones className="h-3 w-3" /> Audio
                      </span>
                    )}
                    {formatDuration(story.duration_seconds) && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {formatDuration(story.duration_seconds)}
                      </span>
                    )}
                  </div>
                  {story.source_name && (
                    <p className="text-xs text-muted-foreground">Source: {story.source_name}</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <BookOpen className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">No Stories Available</h2>
            <p className="text-muted-foreground">Check back soon for authentic Arabic reading material</p>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default ReadingLibrary;
