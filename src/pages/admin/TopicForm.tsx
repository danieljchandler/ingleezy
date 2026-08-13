import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft } from 'lucide-react';

const GRADIENT_OPTIONS = [
  { value: 'bg-gradient-green', label: 'Desert Green' },
  { value: 'bg-gradient-sand', label: 'Warm Sand' },
  { value: 'bg-gradient-olive', label: 'Olive Green' },
  { value: 'bg-gradient-indigo', label: 'Muted Indigo' },
  { value: 'bg-gradient-red', label: 'Desert Red' },
  { value: 'bg-gradient-charcoal', label: 'Charcoal' },
];

const ICON_OPTIONS = ['🎨', '🐾', '🏠', '🔧', '🍎', '🌿', '📚', '⭐', '🎵', '🚗', '👕', '🔢', '✏️', '🎮'];

const TopicForm = () => {
  const navigate = useNavigate();
  const { topicId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!topicId;

  const [name, setName] = useState('');
  const [nameArabic, setNameArabic] = useState('');
  const [icon, setIcon] = useState('📚');
  const [gradient, setGradient] = useState('bg-gradient-green');

  // Fetch existing topic if editing
  const { data: existingTopic, isLoading: loadingTopic } = useQuery({
    queryKey: ['topic', topicId],
    queryFn: async () => {
      if (!topicId) return null;
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .eq('id', topicId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingTopic) {
      setName(existingTopic.name);
      setNameArabic(existingTopic.name_arabic);
      setIcon(existingTopic.icon);
      setGradient(existingTopic.gradient);
    }
  }, [existingTopic]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEditing) {
        const { error } = await supabase
          .from('topics')
          .update({
            name,
            name_arabic: nameArabic,
            icon,
            gradient,
          })
          .eq('id', topicId);

        if (error) throw error;
      } else {
        // Get max display_order
        const { data: maxOrder } = await supabase
          .from('topics')
          .select('display_order')
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxOrder?.display_order ?? -1) + 1;

        const { error } = await supabase
          .from('topics')
          .insert({
            name,
            name_arabic: nameArabic,
            icon,
            gradient,
            display_order: nextOrder,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics'] });
      toast({ title: isEditing ? 'Topic updated!' : 'Topic created!' });
      navigate('/admin/topics');
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !nameArabic.trim()) {
      toast({
        variant: 'destructive',
        title: 'Missing fields',
        description: 'Please fill in both name fields',
      });
      return;
    }
    mutation.mutate();
  };

  if (loadingTopic) {
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
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/topics')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">{isEditing ? 'Edit Topic' : 'New Topic'}</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Topic Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Preview */}
              <div className="flex justify-center">
                <div className={`${gradient} rounded-3xl p-6 shadow-lg`}>
                  <span className="text-5xl">{icon}</span>
                </div>
              </div>

              {/* Name fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">English Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Colors"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nameArabic">Arabic Name</Label>
                  <Input
                    id="nameArabic"
                    placeholder="e.g., ألوان"
                    value={nameArabic}
                    onChange={(e) => setNameArabic(e.target.value)}
                    dir="rtl"
                    required
                  />
                </div>
              </div>

              {/* Icon selection */}
              <div className="space-y-2">
                <Label>Icon</Label>
                <div className="flex flex-wrap gap-2">
                  {ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      className={`text-3xl p-2 rounded-lg transition-all ${
                        icon === opt
                          ? 'bg-primary/20 ring-2 ring-primary'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => setIcon(opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gradient selection */}
              <div className="space-y-2">
                <Label>Color Theme</Label>
                <div className="grid grid-cols-4 gap-2">
                  {GRADIENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`h-12 rounded-lg ${opt.value} transition-all ${
                        gradient === opt.value
                          ? 'ring-2 ring-primary ring-offset-2'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                      onClick={() => setGradient(opt.value)}
                      title={opt.label}
                    />
                  ))}
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/admin/topics')}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    isEditing ? 'Update Topic' : 'Create Topic'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default TopicForm;
