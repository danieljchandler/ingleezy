import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Textarea } from '@/components/ui/textarea';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import { ImageUploader } from '@/components/admin/ImageUploader';
import { AudioUploader } from '@/components/admin/AudioUploader';
import { ImagePositionEditor } from '@/components/admin/ImagePositionEditor';

const WordForm = () => {
  const navigate = useNavigate();
  const { topicId, wordId } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!wordId;

  const [wordArabic, setWordArabic] = useState('');
  const [wordEnglish, setWordEnglish] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imagePosition, setImagePosition] = useState('50 50');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageInstructions, setImageInstructions] = useState('');

  const handleAiGenerate = async (forceNew = false) => {
    if (!wordEnglish.trim()) {
      toast({ variant: 'destructive', title: 'Enter English word first', description: 'The AI needs the English word to generate an image.' });
      return;
    }
    setGeneratingImage(true);
    try {
      if (!forceNew && !imageUrl && !imageInstructions.trim()) {
        const { data: existing } = await supabase
          .from('vocabulary_words')
          .select('image_url')
          .ilike('word_english', wordEnglish.trim())
          .not('image_url', 'is', null)
          .limit(1)
          .single();

        if (existing?.image_url) {
          setImageUrl(existing.image_url);
          toast({ title: 'Reused existing image', description: `Found an existing image for "${wordEnglish}".` });
          return;
        }
      }

      const storagePath = `admin/${crypto.randomUUID()}.png`;
      const { data, error } = await supabase.functions.invoke('generate-flashcard-image', {
        body: {
          word_english: wordEnglish.trim(),
          word_arabic: wordArabic.trim(),
          storage_path: storagePath,
          custom_instructions: imageInstructions.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.imageUrl) {
        setImageUrl(data.imageUrl);
        toast({ title: 'Image generated!', description: `AI created an image for "${wordEnglish}".` });
      } else {
        throw new Error(data?.error || 'No image returned');
      }
    } catch (err: any) {
      console.error('AI image generation failed:', err);
      toast({ variant: 'destructive', title: 'Generation failed', description: err.message || 'Could not generate image.' });
    } finally {
      setGeneratingImage(false);
    }
  };

  // Fetch topic info
  const { data: topic } = useQuery({
    queryKey: ['topic-info', topicId],
    queryFn: async () => {
      if (!topicId) throw new Error('Missing topicId in route');
      const { data, error } = await supabase
        .from('topics')
        .select('name, name_arabic, icon, gradient')
        .eq('id', topicId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!topicId,
  });

  // Fetch existing word if editing
  const { data: existingWord, isLoading: loadingWord } = useQuery({
    queryKey: ['word', wordId],
    queryFn: async () => {
      if (!wordId) return null;
      const { data, error } = await supabase
        .from('vocabulary_words')
        .select('*')
        .eq('id', wordId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingWord) {
      setWordArabic(existingWord.word_arabic);
      setWordEnglish(existingWord.word_english);
      setImageUrl(existingWord.image_url);
      setAudioUrl(existingWord.audio_url);
      setImagePosition(existingWord.image_position || '50 50');
    }
  }, [existingWord]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEditing) {
        const { error } = await supabase
          .from('vocabulary_words')
          .update({
            word_arabic: wordArabic,
            word_english: wordEnglish,
            image_url: imageUrl,
            audio_url: audioUrl,
            image_position: imagePosition,
          })
          .eq('id', wordId);

        if (error) throw error;
      } else {
        if (!topicId) throw new Error('Missing topicId in route');
        const { data: maxOrder } = await supabase
          .from('vocabulary_words')
          .select('display_order')
          .eq('topic_id', topicId)
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxOrder?.display_order ?? -1) + 1;

        const { error } = await supabase
          .from('vocabulary_words')
          .insert({
            topic_id: topicId,
            word_arabic: wordArabic,
            word_english: wordEnglish,
            image_url: imageUrl,
            audio_url: audioUrl,
            image_position: imagePosition,
            display_order: nextOrder,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topic', topicId] });
      toast({ title: isEditing ? 'Word updated!' : 'Word created!' });
      navigate(`/admin/topics/${topicId}/words`);
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
    if (!wordArabic.trim() || !wordEnglish.trim()) {
      toast({
        variant: 'destructive',
        title: 'Missing fields',
        description: 'Please fill in both word fields',
      });
      return;
    }
    mutation.mutate();
  };

  if (loadingWord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/topics/${topicId}/words`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{topic?.icon}</span>
            <h1 className="text-xl font-bold">{isEditing ? 'Edit Word' : 'New Word'}</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Word Details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wordArabic">Arabic Word</Label>
                  <Input
                    id="wordArabic"
                    placeholder="e.g., أحمر"
                    value={wordArabic}
                    onChange={(e) => setWordArabic(e.target.value)}
                    dir="rtl"
                    className="text-xl"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wordEnglish">English Word</Label>
                  <Input
                    id="wordEnglish"
                    placeholder="e.g., Red"
                    value={wordEnglish}
                    onChange={(e) => setWordEnglish(e.target.value)}
                    className="text-xl"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Flashcard Image</Label>
                <ImageUploader
                  currentUrl={imageUrl}
                  onUpload={setImageUrl}
                  onRemove={() => setImageUrl(null)}
                />
                <Textarea
                  placeholder="Optional: custom instructions for AI (e.g. 'show a red apple on a wooden table')"
                  value={imageInstructions}
                  onChange={(e) => setImageInstructions(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => handleAiGenerate(!!imageUrl)}
                  disabled={generatingImage}
                >
                  {generatingImage ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  ) : imageUrl ? (
                    <><Sparkles className="h-4 w-4" /> Regenerate Image</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> AI Generate Image</>
                  )}
                </Button>
              </div>

              {imageUrl && (
                <div className="space-y-2">
                  <Label>Image Position</Label>
                  <ImagePositionEditor
                    imageUrl={imageUrl}
                    position={imagePosition}
                    onPositionChange={setImagePosition}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Audio Pronunciation</Label>
                <AudioUploader
                  currentUrl={audioUrl}
                  onUpload={setAudioUrl}
                  onRemove={() => setAudioUrl(null)}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/admin/topics/${topicId}/words`)}
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
                    isEditing ? 'Update Word' : 'Create Word'
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

export default WordForm;