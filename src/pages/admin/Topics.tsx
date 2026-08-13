import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopics } from '@/hooks/useTopics';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Edit, Trash2, GripVertical } from 'lucide-react';
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

const Topics = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAdminAuth();
  const { data: topics, isLoading } = useTopics();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (topicId: string) => {
      const { error } = await supabase
        .from('topics')
        .delete()
        .eq('id', topicId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
      toast({ title: 'Topic deleted successfully' });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error deleting topic',
        description: error.message,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to admin dashboard"
              onClick={() => navigate('/admin')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Manage Topics</h1>
          </div>
          {isAdmin && (
            <Button onClick={() => navigate('/admin/topics/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Add Topic
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {topics && topics.length > 0 ? (
          <div className="space-y-3">
            {topics.map((topic) => (
              <Card key={topic.id} className="flex items-center">
                <div className="p-4 cursor-move text-muted-foreground">
                  <GripVertical className="h-5 w-5" />
                </div>
                <CardContent className="flex-1 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">{topic.icon}</span>
                    <div>
                      <h3 className="font-semibold text-lg">{topic.name}</h3>
                      <p className="text-muted-foreground">{topic.name_arabic}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/admin/topics/${topic.id}/words`)}
                    >
                      Manage Words
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="icon"
                        // Icon-only, so without this the button has no
                        // accessible name at all — nothing for a screen reader
                        // to announce, and nothing for a test to address.
                        aria-label={`Edit ${topic.name}`}
                        onClick={() => navigate(`/admin/topics/${topic.id}/edit`)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${topic.name}`}
                        onClick={() => setDeleteId(topic.id)}
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
              <p className="text-muted-foreground mb-4">
                {isAdmin ? 'No topics yet. Create your first topic!' : 'No topics available.'}
              </p>
              {isAdmin && (
                <Button onClick={() => navigate('/admin/topics/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Topic
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this topic and all its vocabulary words. This action cannot be undone.
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

export default Topics;
