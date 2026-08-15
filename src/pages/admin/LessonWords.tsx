import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { RootChip } from '@/components/vocab/RootChip';
import { Loader2, ArrowLeft, Trash2, Volume2, ImagePlus, RefreshCw, Pencil, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface VocabWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url: string | null;
  audio_url: string | null;
  display_order: number;
  dialect_module: string;
  /** English word-family base form. Null until backfilled; '' means the word has none. */
  word_family?: string | null;
}

interface LessonDetail {
  id: string;
  title: string;
  title_arabic: string | null;
  icon: string;
  gradient: string;
  lesson_number: number;
  status: string;
  dialect_module: string;
}

const LessonWords = () => {
  const navigate = useNavigate();
  const { lessonId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminAuth();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [findingRoots, setFindingRoots] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<Record<string, string>>({});

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ['admin-lesson', lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lessons')
        .select('id, title, title_arabic, icon, gradient, lesson_number, status, dialect_module')
        .eq('id', lessonId!)
        .single();
      if (error) throw error;
      return data as unknown as LessonDetail;
    },
    enabled: !!lessonId,
  });

  const { data: words, isLoading: wordsLoading } = useQuery({
    queryKey: ['lesson-vocab', lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('id, word_arabic, word_english, image_url, audio_url, display_order, dialect_module, word_family')
        .eq('lesson_id', lessonId!)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as VocabWord[];
    },
    enabled: !!lessonId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (wordId: string) => {
      const { error } = await supabase.from('vocabulary_words').delete().eq('id', wordId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lesson-vocab', lessonId] });
      toast({ title: 'Word deleted' });
      setDeleteId(null);
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const generateImage = async (word: VocabWord, instructions?: string) => {
    setGeneratingIds((prev) => new Set(prev).add(word.id));
    try {
      const { data, error } = await supabase.functions.invoke('generate-flashcard-image', {
        body: {
          word_english: word.word_english,
          word_arabic: word.word_arabic,
          storage_path: `curriculum/${lessonId}/${word.id}.png`,
          ...(instructions ? { custom_instructions: instructions } : {}),
        },
      });
      if (error) throw error;
      if (data?.imageUrl) {
        // Add cache-busting param so browser loads the new image
        const cacheBustedUrl = data.imageUrl.split('?')[0] + `?t=${Date.now()}`;
        await supabase
          .from('vocabulary_words')
          .update({ image_url: cacheBustedUrl })
          .eq('id', word.id);
        queryClient.invalidateQueries({ queryKey: ['lesson-vocab', lessonId] });
      } else {
        throw new Error(data?.error || 'No image returned');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Image generation failed', description: err.message });
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(word.id);
        return next;
      });
    }
  };

  const generateAllImages = async () => {
    if (!words) return;
    const missing = words.filter((w) => !w.image_url);
    if (missing.length === 0) {
      toast({ title: 'All words already have images' });
      return;
    }
    setBulkGenerating(true);
    let success = 0;
    for (let i = 0; i < missing.length; i++) {
      toast({ title: `Generating ${i + 1}/${missing.length}...`, description: missing[i].word_english });
      await generateImage(missing[i]);
      success++;
      if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    setBulkGenerating(false);
    toast({ title: `Done! Generated ${success}/${missing.length} images` });
  };

  const playAudio = (audioUrl: string | null, wordId: string) => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    setPlayingAudio(wordId);
    audio.play();
    audio.onended = () => setPlayingAudio(null);
    audio.onerror = () => setPlayingAudio(null);
  };

  const isLoading = lessonLoading || wordsLoading;
  const missingImageCount = words?.filter((w) => !w.image_url).length ?? 0;
  /** Words nobody has looked a root up for. `''` means we looked and there is none. */
  const missingRootCount = words?.filter((w) => w.word_family === null || w.word_family === undefined).length ?? 0;

  /**
   * Look up the Arabic roots for this lesson's words.
   *
   * These rows are shared curriculum, so this is admin-only server-side too —
   * the button merely hides what the function would refuse anyway.
   */
  const findRoots = async () => {
    setFindingRoots(true);
    try {
      const { data, error } = await supabase.functions.invoke('enrich-word-roots', {
        body: { scope: 'curriculum', lessonId, dialect: lesson?.dialect_module },
      });
      if (error) throw error;
      const found = Number((data as { resolved?: number } | null)?.resolved ?? 0);
      toast({
        title: found > 0 ? `Found roots for ${found} word${found === 1 ? '' : 's'}` : 'No new roots found',
      });
      queryClient.invalidateQueries({ queryKey: ['lesson-vocab', lessonId] });
    } catch {
      toast({ title: "Couldn't look up roots", variant: 'destructive' });
    } finally {
      setFindingRoots(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p>Lesson not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/curriculum')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{lesson.icon}</span>
              <div>
                <h1 className="text-xl font-bold">{lesson.title}</h1>
                {lesson.title_arabic && (
                  <p className="text-sm text-muted-foreground font-arabic">{lesson.title_arabic}</p>
                )}
              </div>
            </div>
            <Badge variant={lesson.status === 'published' ? 'default' : 'secondary'}>
              {lesson.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && missingImageCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={bulkGenerating}
                onClick={generateAllImages}
              >
                {bulkGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ImagePlus className="h-4 w-4 mr-1" />
                )}
                Generate All Images ({missingImageCount})
              </Button>
            )}
            {isAdmin && missingRootCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={findingRoots}
                onClick={findRoots}
              >
                {findingRoots ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Find Roots ({missingRootCount})
              </Button>
            )}
            <Badge variant="outline">{lesson.dialect_module}</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {words && words.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {words.map((word) => {
              const isGenerating = generatingIds.has(word.id);
              return (
                <Card key={word.id} className="overflow-hidden">
                  <div className={`aspect-square bg-gradient-to-br ${lesson.gradient} flex items-center justify-center relative`}>
                    {isGenerating ? (
                      <Loader2 className="h-10 w-10 animate-spin text-primary-foreground" />
                    ) : word.image_url ? (
                      <>
                        <img src={word.image_url} alt={word.word_english} className="w-full h-full object-cover" />
                        {isAdmin && (
                          <div className="absolute top-2 right-2 flex gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="opacity-80 hover:opacity-100"
                              onClick={() => generateImage(word, customInstructions[word.id])}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Regen
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-6xl opacity-50">📷</span>
                        {isAdmin && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => generateImage(word, customInstructions[word.id])}
                          >
                            <ImagePlus className="h-4 w-4 mr-1" />
                            Generate Image
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4">
                    {isAdmin && (
                      <div className="mb-3">
                        <Input
                          placeholder="Describe the image you want..."
                          value={customInstructions[word.id] || ''}
                          onChange={(e) =>
                            setCustomInstructions((prev) => ({ ...prev, [word.id]: e.target.value }))
                          }
                          className="text-sm"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-bold text-xl" dir="rtl">{word.word_arabic}</p>
                        <p className="text-muted-foreground">{word.word_english}</p>
                        <RootChip root={word.word_family} className="mt-1" />
                      </div>
                      {word.audio_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={playingAudio === word.id ? 'animate-pulse text-primary' : ''}
                          onClick={() => playAudio(word.audio_url, word.id)}
                        >
                          <Volume2 className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(word.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <span className="text-6xl mb-4 block">📝</span>
              <p className="text-muted-foreground">
                No vocabulary words in this lesson yet. Use the Curriculum Builder to add words.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Word?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this vocabulary word.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LessonWords;
