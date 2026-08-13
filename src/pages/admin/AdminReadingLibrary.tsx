import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useStorySuggestions, useGenerateStoryText, type StorySuggestion } from '@/hooks/useStorySuggestions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, ArrowLeft, BookOpen, Pencil, Trash2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type AuthenticStory = Database['public']['Tables']['authentic_stories']['Row'];

const useAuthenticStories = () =>
  useQuery({
    queryKey: ['authentic-stories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('authentic_stories')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

const statusColor = (status: string) => {
  switch (status) {
    case 'published': return 'default';
    case 'content_approved': return 'secondary';
    case 'video_preview': return 'outline';
    default: return 'secondary';
  }
};

const videoStatusLabel = (vs: string) => {
  switch (vs) {
    case 'none': return null;
    case 'preview_generated': return '🎧 Preview';
    case 'generating': return '⏳ Generating';
    case 'ready': return '✅ Audio Ready';
    case 'failed': return '❌ Failed';
    default: return vs;
  }
};

const AdminReadingLibrary = () => {
  const navigate = useNavigate();
  const { data: stories, isLoading } = useAuthenticStories();
  const queryClient = useQueryClient();
  const [suggestDialogOpen, setSuggestDialogOpen] = useState(false);
  const [suggestDialect, setSuggestDialect] = useState('Gulf');
  const [suggestDifficulty, setSuggestDifficulty] = useState('intermediate');
  const [suggestions, setSuggestions] = useState<StorySuggestion[]>([]);
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null);
  const suggestMutation = useStorySuggestions();
  const generateTextMutation = useGenerateStoryText();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this authentic story?')) return;
    const { error } = await supabase.from('authentic_stories').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete story');
    } else {
      toast.success('Story deleted');
      queryClient.invalidateQueries({ queryKey: ['authentic-stories'] });
    }
  };

  const handleSuggest = async () => {
    try {
      const results = await suggestMutation.mutateAsync({
        dialect: suggestDialect,
        difficulty: suggestDifficulty,
      });
      setSuggestions(results);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get suggestions';
      toast.error(message);
    }
  };

  const handleSelectSuggestion = async (suggestion: StorySuggestion, idx: number) => {
    setCreatingIdx(idx);
    try {
      // 1. Expand the suggestion into full Arabic story text (the missing "link").
      const { body_arabic, author, author_arabic } = await generateTextMutation.mutateAsync({
        suggestion,
        dialect: suggestDialect,
        difficulty: suggestDifficulty,
      });

      // 2. Import it straight away — no manual copy/paste required.
      const resp = await supabase.functions.invoke('import-authentic-story', {
        body: {
          title: suggestion.title,
          title_arabic: suggestion.title_arabic,
          author: author || undefined,
          author_arabic: author_arabic || undefined,
          source_name: suggestion.source_type.replace('_', ' '),
          license: 'public_domain',
          body_arabic,
          dialect: suggestDialect,
          difficulty: suggestDifficulty,
        },
      });
      if (resp.error) throw new Error(resp.error.message);
      const storyId = resp.data?.story?.id;
      if (!storyId) throw new Error('Story was created but no ID was returned');

      toast.success('Story created!');
      queryClient.invalidateQueries({ queryKey: ['authentic-stories'] });
      setSuggestDialogOpen(false);
      setSuggestions([]);
      navigate(`/admin/reading-library/${storyId}/edit`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create story';
      toast.error(message);
    } finally {
      setCreatingIdx(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold font-heading">Reading Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setSuggestDialogOpen(true)}>
              <Sparkles className="h-4 w-4 mr-2" />
              Suggest Stories
            </Button>
            <Button onClick={() => navigate('/admin/reading-library/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Import Story
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {stories && stories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stories.map((story: AuthenticStory) => (
              <Card key={story.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{story.title}</CardTitle>
                    <Badge variant={statusColor(story.status)}>
                      {story.status}
                    </Badge>
                  </div>
                  {story.title_arabic && (
                    <p className="text-base text-muted-foreground font-arabic" dir="rtl">{story.title_arabic}</p>
                  )}
                  {story.author && (
                    <CardDescription>{story.author}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <Badge variant="outline">{story.dialect || 'MSA'}</Badge>
                    <Badge variant="outline">{story.difficulty}</Badge>
                    {story.source_name && <Badge variant="outline">{story.source_name}</Badge>}
                    {videoStatusLabel(story.video_status) && (
                      <Badge variant="outline">{videoStatusLabel(story.video_status)}</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/admin/reading-library/${story.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(story.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <BookOpen className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">No Authentic Stories Yet</h2>
            <p className="text-muted-foreground mb-6">Import public domain Arabic literature for reading practice</p>
            <Button onClick={() => navigate('/admin/reading-library/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Import Story
            </Button>
          </div>
        )}
      </main>

      {/* AI Story Suggestions Dialog */}
      <Dialog open={suggestDialogOpen} onOpenChange={(open) => { setSuggestDialogOpen(open); if (!open) setSuggestions([]); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Story Suggestions
            </DialogTitle>
            <DialogDescription>
              Let AI find authentic Arabic stories for your reading library. It checks existing stories to avoid duplicates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Filters */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Dialect</Label>
                <Select value={suggestDialect} onValueChange={setSuggestDialect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Gulf', 'Egyptian', 'Levantine', 'MSA'].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={suggestDifficulty} onValueChange={setSuggestDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['beginner', 'intermediate', 'advanced'].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={handleSuggest} disabled={suggestMutation.isPending} className="w-full">
              {suggestMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Finding stories...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {suggestions.length > 0 ? 'Get New Suggestions' : 'Find Stories'}
                </>
              )}
            </Button>

            {/* Suggestions list */}
            {suggestions.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground font-medium">Tap a story to create it instantly:</p>
                {suggestions.map((suggestion, idx) => (
                  <Card
                    key={idx}
                    className={`transition-colors ${creatingIdx === null ? 'cursor-pointer hover:border-primary/50' : 'cursor-not-allowed opacity-60'}`}
                    onClick={() => creatingIdx === null && handleSelectSuggestion(suggestion, idx)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{suggestion.title}</CardTitle>
                          <p className="text-sm text-muted-foreground font-arabic" dir="rtl">{suggestion.title_arabic}</p>
                        </div>
                        <Badge variant="outline">{suggestion.source_type.replace('_', ' ')}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground mb-2">{suggestion.description}</p>
                      <p className="text-sm text-muted-foreground font-arabic mb-3" dir="rtl">{suggestion.description_arabic}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{suggestion.estimated_length}</Badge>
                        {suggestion.themes.map((theme) => (
                          <Badge key={theme} variant="outline" className="text-xs">{theme}</Badge>
                        ))}
                      </div>
                      {creatingIdx === idx && (
                        <div className="flex items-center gap-2 mt-3 text-sm text-primary">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Writing story &amp; creating...
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminReadingLibrary;
