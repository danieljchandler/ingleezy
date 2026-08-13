import { useNavigate } from 'react-router-dom';
import { useAllStories } from '@/hooks/useInteractiveStories';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, ArrowLeft, BookOpen, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import hakiyaIconAsset from '@/assets/hakiya-icon.png.asset.json';
const lahjaIcon = hakiyaIconAsset.url;

const AdminStories = () => {
  const navigate = useNavigate();
  const { data: stories, isLoading } = useAllStories();
  const queryClient = useQueryClient();

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this story and all its scenes?')) return;
    const { error } = await supabase.from('interactive_stories').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete story');
    } else {
      toast.success('Story deleted');
      queryClient.invalidateQueries({ queryKey: ['interactive-stories'] });
    }
  };

  const handleTogglePublish = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'published' ? 'draft' : 'published';
    const { error } = await supabase
      .from('interactive_stories')
      .update({ status: newStatus })
      .eq('id', id);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success(newStatus === 'published' ? 'Story published!' : 'Story unpublished');
      queryClient.invalidateQueries({ queryKey: ['interactive-stories'] });
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
            <img src={lahjaIcon} alt="Hakiya" className="h-8 w-8" />
            <h1 className="text-xl font-bold font-heading">Interactive Stories</h1>
          </div>
          <Button onClick={() => navigate('/admin/stories/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Story
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {stories && stories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stories.map((story) => (
              <Card key={story.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{story.title}</CardTitle>
                    </div>
                    <Badge variant={story.status === 'published' ? 'default' : 'secondary'}>
                      {story.status}
                    </Badge>
                  </div>
                  {story.title_arabic && (
                    <p className="text-sm text-muted-foreground" dir="rtl">{story.title_arabic}</p>
                  )}
                  <CardDescription>{story.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-1.5 mb-4">
                    <Badge variant="outline">{story.dialect}</Badge>
                    <Badge variant="outline">{story.difficulty}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/admin/stories/${story.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={story.status === 'published' ? 'secondary' : 'default'}
                      onClick={() => handleTogglePublish(story.id, story.status)}
                    >
                      {story.status === 'published' ? 'Unpublish' : 'Publish'}
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
            <h2 className="text-xl font-bold mb-2">No Stories Yet</h2>
            <p className="text-muted-foreground mb-6">Create your first interactive choose-your-adventure story</p>
            <Button onClick={() => navigate('/admin/stories/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Story
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminStories;
