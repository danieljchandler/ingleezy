import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTopic } from '@/hooks/useTopic';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { RootChip } from '@/components/vocab/RootChip';
import { Loader2, ArrowLeft, Plus, Edit, Trash2, Volume2, Upload } from 'lucide-react';
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

const Words = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminAuth();
  const { data: topic, isLoading } = useTopic(topicId);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (wordId: string) => {
      const { error } = await supabase
        .from('vocabulary_words')
        .delete()
        .eq('id', wordId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topic', topicId] });
      toast({ title: 'Word deleted successfully' });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error deleting word',
        description: error.message,
      });
    },
  });

  const playAudio = (audioUrl: string | null, wordId: string) => {
    if (!audioUrl) {
      toast({
        variant: 'destructive',
        title: 'No audio',
        description: 'This word has no audio file yet.',
      });
      return;
    }

    const audio = new Audio(audioUrl);
    setPlayingAudio(wordId);
    audio.play();
    audio.onended = () => setPlayingAudio(null);
    audio.onerror = () => {
      setPlayingAudio(null);
      toast({
        variant: 'destructive',
        title: 'Audio error',
        description: 'Could not play audio file.',
      });
    };
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p>Topic not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{topic.icon}</span>
              <div>
                <h1 className="text-xl font-bold">{topic.name}</h1>
                <p className="text-sm text-muted-foreground">{topic.name_arabic}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/admin/topics/${topicId}/words/bulk`)}>
              <Upload className="h-4 w-4 mr-2" />
              Bulk Import
            </Button>
            <Button onClick={() => navigate(`/admin/topics/${topicId}/words/new`)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Word
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {topic.words && topic.words.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topic.words.map((word) => (
              <Card key={word.id} className="overflow-hidden">
                {/* Image */}
                <div className={`aspect-square bg-gradient-to-br ${topic.gradient} flex items-center justify-center`}>
                  {word.image_url ? (
                    <img
                      src={word.image_url}
                      alt={word.word_english}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-6xl opacity-50">📷</span>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-bold text-xl" dir="rtl">{word.word_arabic}</p>
                      <p className="text-muted-foreground">{word.word_english}</p>
                      <RootChip root={word.word_family} className="mt-1" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={playingAudio === word.id ? 'animate-pulse text-primary' : ''}
                      onClick={() => playAudio(word.audio_url, word.id)}
                    >
                      <Volume2 className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/admin/topics/${topicId}/words/${word.id}/edit`)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(word.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <span className="text-6xl mb-4 block">📝</span>
              <p className="text-muted-foreground mb-4">No vocabulary words yet. Add your first word!</p>
              <Button onClick={() => navigate(`/admin/topics/${topicId}/words/new`)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Word
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Word?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this vocabulary word. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Words;
