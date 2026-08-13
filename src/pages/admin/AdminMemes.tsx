import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Laugh, Loader2, Trash2, Edit, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useDialect } from '@/contexts/DialectContext';

interface MemeVideo {
  id: string;
  title: string;
  title_arabic: string | null;
  dialect: string;
  platform: string;
  thumbnail_url: string | null;
  published: boolean;
  transcription_status: string | null;
  created_at: string;
}

const AdminMemes = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const [memes, setMemes] = useState<MemeVideo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase
      .from('discover_videos' as any) as any)
      .select('id, title, title_arabic, dialect, platform, thumbnail_url, published, transcription_status, created_at')
      .eq('is_meme', true)
      .eq('dialect', activeDialect)
      .order('created_at', { ascending: false });
    if (error) toast.error('Failed to load memes', { description: error.message });
    setMemes((data ?? []) as MemeVideo[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeDialect]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this meme?')) return;
    const { error } = await (supabase.from('discover_videos' as any) as any).delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    load();
  };

  return (
    <div className="container mx-auto max-w-5xl p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Laugh className="h-7 w-7 text-primary" /> Memes ({activeDialect})
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste a TikTok/YouTube link or upload a video. Memes are displayed like Discover videos with synced transcripts.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/videos/new?meme=1')} className="gap-2">
          <Plus className="h-4 w-4" /> New Meme
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : memes.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          No memes yet. Click "New Meme" to start.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {memes.map((m) => (
            <Card key={m.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div
                className="aspect-video bg-muted relative cursor-pointer"
                onClick={() => navigate(`/admin/videos/${m.id}/edit?meme=1`)}
              >
                {m.thumbnail_url ? (
                  <img src={m.thumbnail_url} alt={m.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Laugh className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute top-2 left-2 flex gap-1">
                  <Badge variant={m.published ? 'default' : 'outline'}>
                    {m.published ? 'published' : 'draft'}
                  </Badge>
                  {m.transcription_status && m.transcription_status !== 'completed' && (
                    <Badge variant="outline">{m.transcription_status}</Badge>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <div className="font-medium text-sm truncate">{m.title || 'Untitled meme'}</div>
                {m.title_arabic && (
                  <div className="text-xs text-muted-foreground truncate" dir="rtl">{m.title_arabic}</div>
                )}
                <div className="flex gap-1 flex-wrap text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] py-0">{m.platform}</Badge>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => navigate(`/admin/videos/${m.id}/edit?meme=1`)}>
                    <Edit className="h-3 w-3" /> Edit
                  </Button>
                  {m.published && (
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => navigate(`/discover/${m.id}`)}>
                      <Eye className="h-3 w-3" /> View
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminMemes;
