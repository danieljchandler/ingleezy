import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStoryScenes, type StoryScene } from '@/hooks/useInteractiveStories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, Plus, Trash2, Save, Loader2, GripVertical, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

interface SceneForm {
  id?: string;
  scene_order: number;
  narrative_arabic: string;
  narrative_english: string;
  narrative_literal?: string;
  vocabulary: { word_arabic: string; word_english: string }[];
  choices: { text_arabic: string; text_english: string; next_scene_order: number }[];
  is_ending: boolean;
  ending_message: string;
  ending_message_arabic: string;
}

const emptyScene = (order: number): SceneForm => ({
  scene_order: order,
  narrative_arabic: '',
  narrative_english: '',
  narrative_literal: '',
  vocabulary: [],
  choices: [],
  is_ending: false,
  ending_message: '',
  ending_message_arabic: '',
});

const AdminStoryForm = () => {
  const navigate = useNavigate();
  const { storyId } = useParams();
  const { user } = useAuth();
  const isEdit = !!storyId;

  const [title, setTitle] = useState('');
  const [titleArabic, setTitleArabic] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionArabic, setDescriptionArabic] = useState('');
  const [dialect, setDialect] = useState('Gulf');
  const [difficulty, setDifficulty] = useState('Beginner');
  const [scenes, setScenes] = useState<SceneForm[]>([emptyScene(0)]);
  const [saving, setSaving] = useState(false);

  // AI generation state
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGuidance, setAiGuidance] = useState('');
  const [aiSceneCount, setAiSceneCount] = useState(5);
  const [generating, setGenerating] = useState(false);

  const { data: existingScenes } = useStoryScenes(storyId);

  // Load existing story
  useEffect(() => {
    if (!storyId) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('interactive_stories')
        .select('*')
        .eq('id', storyId)
        .single();
      if (data && !error) {
        setTitle(data.title);
        setTitleArabic(data.title_arabic);
        setDescription(data.description);
        setDescriptionArabic(data.description_arabic);
        setDialect(data.dialect);
        setDifficulty(data.difficulty);
      }
    };
    load();
  }, [storyId]);

  // Load existing scenes
  useEffect(() => {
    if (existingScenes && existingScenes.length > 0) {
      setScenes(
        existingScenes.map((s) => ({
          id: s.id,
          scene_order: s.scene_order,
          narrative_arabic: s.narrative_arabic,
          narrative_english: s.narrative_english,
          narrative_literal: (s as { narrative_literal?: string }).narrative_literal ?? '',
          vocabulary: s.vocabulary,
          choices: s.choices,
          is_ending: s.is_ending,
          ending_message: s.ending_message || '',
          ending_message_arabic: s.ending_message_arabic || '',
        }))
      );
    }
  }, [existingScenes]);

  const updateScene = (idx: number, patch: Partial<SceneForm>) => {
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addScene = () => {
    setScenes((prev) => [...prev, emptyScene(prev.length)]);
  };

  const removeScene = (idx: number) => {
    if (scenes.length <= 1) return;
    setScenes((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, scene_order: i })));
  };

  const addChoice = (sceneIdx: number) => {
    updateScene(sceneIdx, {
      choices: [...scenes[sceneIdx].choices, { text_arabic: '', text_english: '', next_scene_order: 0 }],
    });
  };

  const updateChoice = (sceneIdx: number, choiceIdx: number, patch: Partial<{ text_arabic: string; text_english: string; next_scene_order: number }>) => {
    const newChoices = scenes[sceneIdx].choices.map((c, i) => (i === choiceIdx ? { ...c, ...patch } : c));
    updateScene(sceneIdx, { choices: newChoices });
  };

  const removeChoice = (sceneIdx: number, choiceIdx: number) => {
    updateScene(sceneIdx, { choices: scenes[sceneIdx].choices.filter((_, i) => i !== choiceIdx) });
  };

  const addVocab = (sceneIdx: number) => {
    updateScene(sceneIdx, {
      vocabulary: [...scenes[sceneIdx].vocabulary, { word_arabic: '', word_english: '' }],
    });
  };

  const updateVocab = (sceneIdx: number, vocabIdx: number, patch: Partial<{ word_arabic: string; word_english: string }>) => {
    const newVocab = scenes[sceneIdx].vocabulary.map((v, i) => (i === vocabIdx ? { ...v, ...patch } : v));
    updateScene(sceneIdx, { vocabulary: newVocab });
  };

  const removeVocab = (sceneIdx: number, vocabIdx: number) => {
    updateScene(sceneIdx, { vocabulary: scenes[sceneIdx].vocabulary.filter((_, i) => i !== vocabIdx) });
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please describe the story topic');
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-story', {
        body: {
          prompt: aiPrompt.trim(),
          dialect,
          difficulty,
          sceneCount: aiSceneCount,
          guidance: aiGuidance.trim() || undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const generated = data?.story;
      if (!generated) throw new Error('No story returned from AI');

      // Apply generated content to form
      if (generated.title) setTitle(generated.title);
      if (generated.title_arabic) setTitleArabic(generated.title_arabic);
      if (generated.description) setDescription(generated.description);
      if (generated.description_arabic) setDescriptionArabic(generated.description_arabic);

      if (Array.isArray(generated.scenes) && generated.scenes.length > 0) {
        setScenes(
          generated.scenes.map((s: SceneForm) => ({
            scene_order: s.scene_order ?? 0,
            narrative_arabic: s.narrative_arabic ?? '',
            narrative_english: s.narrative_english ?? '',
            narrative_literal: s.narrative_literal ?? '',
            vocabulary: Array.isArray(s.vocabulary) ? s.vocabulary : [],
            choices: Array.isArray(s.choices) ? s.choices : [],
            is_ending: s.is_ending ?? false,
            ending_message: s.ending_message ?? '',
            ending_message_arabic: s.ending_message_arabic ?? '',
          }))
        );
      }

      setAiDialogOpen(false);
      toast.success('Story generated! Review and edit before saving.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate story';
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setSaving(true);
    try {
      let sid = storyId;

      if (isEdit) {
        const { error } = await supabase
          .from('interactive_stories')
          .update({ title, title_arabic: titleArabic, description, description_arabic: descriptionArabic, dialect, difficulty })
          .eq('id', storyId!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('interactive_stories')
          .insert({ title, title_arabic: titleArabic, description, description_arabic: descriptionArabic, dialect, difficulty, created_by: user.id })
          .select()
          .single();
        if (error) throw error;
        sid = data.id;
      }

      // Delete old scenes then insert new ones
      if (isEdit) {
        await supabase.from('story_scenes').delete().eq('story_id', sid!);
      }

      const scenesToInsert = scenes.map((s) => ({
        story_id: sid!,
        scene_order: s.scene_order,
        narrative_arabic: s.narrative_arabic,
        narrative_english: s.narrative_english,
        narrative_literal: s.narrative_literal || null,
        vocabulary: s.vocabulary,
        choices: s.choices,
        is_ending: s.is_ending,
        ending_message: s.ending_message || null,
        ending_message_arabic: s.ending_message_arabic || null,
      }));

      const { error: scenesError } = await supabase.from('story_scenes').insert(scenesToInsert);
      if (scenesError) throw scenesError;

      toast.success(isEdit ? 'Story updated!' : 'Story created!');
      navigate('/admin/stories');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save story');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/stories')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <img src="/brand/ingleezy-icon.svg" alt="Ingleezy" className="h-8 w-8" />
            <h1 className="text-xl font-bold font-heading">{isEdit ? 'Edit Story' : 'New Story'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setAiDialogOpen(true)} disabled={saving}>
              <Wand2 className="h-4 w-4 mr-2" />
              Generate with AI
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Story
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Story metadata */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Story Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Title (English)</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="At the Coffee Shop" />
              </div>
              <div>
                <Label>Title (Arabic)</Label>
                <Input value={titleArabic} onChange={(e) => setTitleArabic(e.target.value)} placeholder="في المقهى" dir="rtl" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Description (English)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Practice ordering at a Gulf coffee shop" rows={2} />
              </div>
              <div>
                <Label>Description (Arabic)</Label>
                <Textarea value={descriptionArabic} onChange={(e) => setDescriptionArabic(e.target.value)} placeholder="تدرب على الطلب في مقهى خليجي" dir="rtl" rows={2} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Dialect</Label>
                <Select value={dialect} onValueChange={setDialect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* The dialect names the learner's Arabic — the scaffold
                        language — so the list matches the app's dialects. */}
                    {['Gulf', 'Egyptian', 'Yemeni'].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Beginner', 'Intermediate', 'Advanced'].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scenes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold font-heading">Scenes ({scenes.length})</h2>
            <Button variant="outline" size="sm" onClick={addScene}>
              <Plus className="h-4 w-4 mr-1" /> Add Scene
            </Button>
          </div>

          {scenes.map((scene, sIdx) => (
            <Card key={sIdx} className="border-l-4 border-l-primary/40">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Scene {sIdx}</CardTitle>
                    {scene.is_ending && <Badge variant="secondary">Ending</Badge>}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeScene(sIdx)} disabled={scenes.length <= 1}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Narrative — the English is the story; the Arabic its scaffold */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Narrative (English)</Label>
                    <Textarea
                      value={scene.narrative_english}
                      onChange={(e) => updateScene(sIdx, { narrative_english: e.target.value })}
                      placeholder="You entered the café and saw..."
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Narrative (Arabic scaffold)</Label>
                    <Textarea
                      value={scene.narrative_arabic}
                      onChange={(e) => updateScene(sIdx, { narrative_arabic: e.target.value })}
                      placeholder="دخلت المقهى وشفت..."
                      dir="rtl"
                      rows={3}
                    />
                  </div>
                </div>
                <div>
                  <Label>Narrative (Literal — Arabic in English word order)</Label>
                  <Textarea
                    value={scene.narrative_literal ?? ''}
                    onChange={(e) => updateScene(sIdx, { narrative_literal: e.target.value })}
                    placeholder="أنا دخلت الـ مقهى و شفت..."
                    dir="rtl"
                    rows={2}
                  />
                </div>

                {/* Is Ending toggle */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={scene.is_ending}
                    onCheckedChange={(checked) => updateScene(sIdx, { is_ending: checked })}
                  />
                  <Label>This is an ending scene</Label>
                </div>

                {scene.is_ending ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Ending Message (English)</Label>
                      <Input
                        value={scene.ending_message}
                        onChange={(e) => updateScene(sIdx, { ending_message: e.target.value })}
                        placeholder="Congratulations! You ordered successfully."
                      />
                    </div>
                    <div>
                      <Label>Ending Message (Arabic)</Label>
                      <Input
                        value={scene.ending_message_arabic}
                        onChange={(e) => updateScene(sIdx, { ending_message_arabic: e.target.value })}
                        placeholder="مبروك! طلبت بنجاح"
                        dir="rtl"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Choices */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-semibold">Choices</Label>
                        <Button variant="ghost" size="sm" onClick={() => addChoice(sIdx)}>
                          <Plus className="h-3 w-3 mr-1" /> Add Choice
                        </Button>
                      </div>
                      {scene.choices.length === 0 && (
                        <p className="text-xs text-muted-foreground">No choices yet. Add choices to branch the story.</p>
                      )}
                      <div className="space-y-2">
                        {scene.choices.map((choice, cIdx) => (
                          <div key={cIdx} className="flex items-start gap-2 bg-muted/50 rounded-lg p-3">
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                              <Input
                                placeholder="English text"
                                value={choice.text_english}
                                onChange={(e) => updateChoice(sIdx, cIdx, { text_english: e.target.value })}
                                className="text-sm"
                              />
                              <Input
                                placeholder="Arabic text"
                                value={choice.text_arabic}
                                onChange={(e) => updateChoice(sIdx, cIdx, { text_arabic: e.target.value })}
                                dir="rtl"
                                className="text-sm"
                              />
                              <div className="flex items-center gap-2">
                                <Label className="text-xs whitespace-nowrap">→ Scene</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={choice.next_scene_order}
                                  onChange={(e) => updateChoice(sIdx, cIdx, { next_scene_order: parseInt(e.target.value) || 0 })}
                                  className="text-sm w-20"
                                />
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeChoice(sIdx, cIdx)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Vocabulary */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Key Vocabulary</Label>
                    <Button variant="ghost" size="sm" onClick={() => addVocab(sIdx)}>
                      <Plus className="h-3 w-3 mr-1" /> Add Word
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {scene.vocabulary.map((v, vIdx) => (
                      <div key={vIdx} className="flex items-center gap-1 bg-primary/10 rounded-full pl-3 pr-1 py-1">
                        <Input
                          value={v.word_english}
                          onChange={(e) => updateVocab(sIdx, vIdx, { word_english: e.target.value })}
                          className="h-6 w-24 border-0 bg-transparent text-sm p-0"
                          placeholder="English"
                        />
                        <span className="text-muted-foreground text-xs">/</span>
                        <Input
                          value={v.word_arabic}
                          onChange={(e) => updateVocab(sIdx, vIdx, { word_arabic: e.target.value })}
                          className="h-6 w-24 border-0 bg-transparent text-sm p-0"
                          dir="rtl"
                          placeholder="عربي"
                        />
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeVocab(sIdx, vIdx)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      {/* AI Generation Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generate Story with AI
            </DialogTitle>
            <DialogDescription>
              Describe your story idea and the AI will create a complete interactive story with scenes, choices, and vocabulary. You can edit everything after generation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="ai-prompt">Story Topic / Scenario *</Label>
              <Textarea
                id="ai-prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Ordering food at a restaurant abroad, a job interview in English, checking in at the airport, asking for directions in a new city..."
                rows={3}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="ai-guidance">Additional Guidance (optional)</Label>
              <Textarea
                id="ai-guidance"
                value={aiGuidance}
                onChange={(e) => setAiGuidance(e.target.value)}
                placeholder="e.g. Include vocabulary about numbers and prices. Make one path lead to a misunderstanding. Focus on polite requests..."
                rows={2}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="flex items-center justify-between mb-2">
                <span>Number of Scenes</span>
                <Badge variant="secondary">{aiSceneCount} scenes</Badge>
              </Label>
              <Slider
                min={3}
                max={10}
                step={1}
                value={[aiSceneCount]}
                onValueChange={([val]) => setAiSceneCount(val)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>3 (short)</span>
                <span>6 (medium)</span>
                <span>10 (long)</span>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Using current settings:</p>
              <ul className="space-y-0.5">
                <li>Dialect: <span className="font-medium text-foreground">{dialect}</span></li>
                <li>Difficulty: <span className="font-medium text-foreground">{difficulty}</span></li>
              </ul>
              <p className="mt-2 text-xs">To change these, close this dialog and update the Story Details first.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAiDialogOpen(false)} disabled={generating}>
                Cancel
              </Button>
              <Button onClick={handleAiGenerate} disabled={generating || !aiPrompt.trim()}>
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Story
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminStoryForm;
