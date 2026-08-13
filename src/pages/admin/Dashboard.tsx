import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useLessons } from '@/hooks/useLessons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogOut, BookOpen, Plus, Settings, Mic, PlayCircle, Upload, GraduationCap, Sparkles, BookMarked, TrendingUp, Image as ImageIcon, Laugh, MessageCircle, Languages, Activity, AlertTriangle, Ticket } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import ingleezyIconAsset from '@/assets/ingleezy-icon.png.asset.json';
const lahjaIcon = ingleezyIconAsset.url;
import { useDialect } from '@/contexts/DialectContext';

const Dashboard = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { user, isAdmin, isContentReviewer, isRecorder, role, signOut, loading: authLoading } = useAdminAuth();
  const { data: lessons, isLoading: lessonsLoading } = useLessons();

  // Get total word count for the active dialect
  const { data: totalWords } = useQuery({
    queryKey: ['word-count-total', activeDialect],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('vocabulary_words')
        .select('id', { count: 'exact', head: true })
        .eq('dialect_module', activeDialect);

      if (error) throw error;
      return count || 0;
    },
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login');
  };

  // The flywheel's north-star numbers: corrections banked, and minutes of
  // gold (native-corrected) audio per the improvement plan. Resilient by
  // design — on any error the card shows zeros rather than failing the page.
  const { data: flywheel } = useQuery({
    queryKey: ['flywheel-stats'],
    enabled: isAdmin,
    retry: false,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- training_examples is service-role-first and absent from the generated types
      const te = () => supabase.from('training_examples' as any) as any;
      try {
        const [{ count: total }, { count: gold }, { data: goldAudio }] = await Promise.all([
          te().select('id', { count: 'exact', head: true }),
          te().select('id', { count: 'exact', head: true }).eq('tier', 'gold'),
          te()
            .select('audio_start_ms, audio_end_ms')
            .eq('tier', 'gold')
            .not('audio_path', 'is', null)
            .limit(10000),
        ]);
        const ms = ((goldAudio ?? []) as Array<{ audio_start_ms: number | null; audio_end_ms: number | null }>)
          .reduce((sum, row) => sum + Math.max(0, (row.audio_end_ms ?? 0) - (row.audio_start_ms ?? 0)), 0);
        return { total: total ?? 0, gold: gold ?? 0, goldAudioMinutes: Math.round(ms / 60_000) };
      } catch {
        return { total: 0, gold: 0, goldAudioMinutes: 0 };
      }
    },
  });

  if (authLoading || lessonsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const wordCount = totalWords || 0;
  const lessonCount = lessons?.length || 0;
  const roleLabel = isAdmin
    ? 'Admin'
    : isContentReviewer
      ? 'Content Reviewer'
      : isRecorder
        ? 'Recorder'
        : '';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={lahjaIcon} alt="Ingleezy" className="h-10 w-10" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-heading">{roleLabel} Dashboard</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isAdmin ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent-foreground'}`}>
                  {roleLabel}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/')}>
              <BookOpen className="h-4 w-4 mr-2" />
              View App
            </Button>
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Lessons</CardDescription>
              <CardTitle className="text-4xl">{lessonCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Words</CardDescription>
              <CardTitle className="text-4xl">{wordCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Average Words/Lesson</CardDescription>
              <CardTitle className="text-4xl">
                {lessonCount ? Math.round(wordCount / lessonCount) : 0}
              </CardTitle>
            </CardHeader>
          </Card>
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Flywheel · gold audio</CardDescription>
                <CardTitle className="text-4xl">
                  {flywheel?.goldAudioMinutes ?? 0}
                  <span className="text-lg font-normal text-muted-foreground"> min</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {flywheel?.gold ?? 0} gold of {flywheel?.total ?? 0} banked corrections
                </p>
              </CardHeader>
            </Card>
          )}
        </div>

        {/* Quick Actions - Different for admin vs recorder */}
        <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-2' : ''} gap-4 mb-8`}>
          {isAdmin && (
            <>
              <Card
                className="cursor-pointer hover:shadow-lg transition-shadow border-primary/50 bg-primary/5"
                role="button"
                tabIndex={0}
                aria-label="Curriculum Builder"
                onClick={() => navigate('/admin/curriculum-builder')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/admin/curriculum-builder'); }}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/20 rounded-full p-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Curriculum Builder</h3>
                      <p className="text-muted-foreground">Chat with AI to create lessons, vocabulary, and flashcards</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-primary/30" onClick={() => navigate('/admin/lessons/import')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <Upload className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Import Lesson Plan</h3>
                      <p className="text-muted-foreground">Upload an xlsx lesson plan to auto-create lessons with vocabulary</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/curriculum')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <GraduationCap className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Curriculum</h3>
                      <p className="text-muted-foreground">View stages, lessons, and vocabulary</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/topics')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <Settings className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Manage Topics</h3>
                      <p className="text-muted-foreground">Legacy topic management</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/videos')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <PlayCircle className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Manage Videos</h3>
                      <p className="text-muted-foreground">Add and manage Discover videos</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-pink-500/30" onClick={() => navigate('/admin/memes')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-pink-500/10 rounded-full p-4">
                      <Laugh className="h-8 w-8 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Memes</h3>
                      <p className="text-muted-foreground">Curate Arabic memes (OCR + smart audio)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-emerald-500/30" onClick={() => navigate('/admin/set-phrases')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-emerald-500/10 rounded-full p-4">
                      <MessageCircle className="h-8 w-8 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Set Phrases</h3>
                      <p className="text-muted-foreground">Curate situational phrases (greetings, eid, condolences)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-purple-500/30" onClick={() => navigate('/admin/dialect-rules')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-purple-500/10 rounded-full p-4">
                      <Languages className="h-8 w-8 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Dialect Rulebook</h3>
                      <p className="text-muted-foreground">Review AI-drafted dialect rules that steer every generation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-primary/30" onClick={() => navigate('/admin/interference-rules')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <Languages className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Interference Rulebook</h3>
                      <p className="text-muted-foreground">How Arabic shapes learners' English — steers every English generation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-accent/30" onClick={() => navigate('/admin/stories')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-full p-4">
                      <BookMarked className="h-8 w-8 text-accent-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Interactive Stories</h3>
                      <p className="text-muted-foreground">Create choose-your-adventure stories</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-accent/30" onClick={() => navigate('/admin/reading-library')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-full p-4">
                      <BookOpen className="h-8 w-8 text-accent-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Reading Library</h3>
                      <p className="text-muted-foreground">Import authentic Arabic stories for reading practice</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-primary/30" onClick={() => navigate('/admin/trending')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <TrendingUp className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Trending Videos</h3>
                      <p className="text-muted-foreground">Discover & curate trending Arabic YouTube videos</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-emerald-500/30" onClick={() => navigate('/admin/coverage')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-emerald-500/10 rounded-full p-4">
                      <ImageIcon className="h-8 w-8 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Curriculum Coverage</h3>
                      <p className="text-muted-foreground">What the AI has already taught — prevents duplicates, plans reinforcement</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-amber-500/30" onClick={() => navigate('/admin/metrics')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-amber-500/10 rounded-full p-4">
                      <Activity className="h-8 w-8 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Feature Metrics</h3>
                      <p className="text-muted-foreground">Souq News, AI Brain & dialect health — error rates and leak scores per dialect</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-rose-500/30" onClick={() => navigate('/admin/errors')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-rose-500/10 rounded-full p-4">
                      <AlertTriangle className="h-8 w-8 text-rose-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Error Log</h3>
                      <p className="text-muted-foreground">Client & edge function exceptions with stack traces</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-indigo-500/30" onClick={() => navigate('/admin/invite-codes')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-indigo-500/10 rounded-full p-4">
                      <Ticket className="h-8 w-8 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Beta Invite Codes</h3>
                      <p className="text-muted-foreground">Generate one-time or multi-use codes for closed-beta signups</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-pink-500/30" onClick={() => navigate('/admin/feedback')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-pink-500/10 rounded-full p-4">
                      <MessageCircle className="h-8 w-8 text-pink-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Beta Feedback</h3>
                      <p className="text-muted-foreground">Bugs, ideas, and praise sent in from beta testers</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {isRecorder && !isAdmin && (
            <Card className="bg-accent/5 border-accent/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="bg-accent/10 rounded-full p-4">
                    <Mic className="h-8 w-8 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Recorder Access</h3>
                    <p className="text-muted-foreground">
                      You can add new words and record audio. Click any topic below to add or edit words.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isContentReviewer && !isAdmin && !isRecorder && (
            <>
              <Card className="bg-accent/5 border-accent/20">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-full p-4">
                      <Mic className="h-8 w-8 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Content Reviewer Access</h3>
                      <p className="text-muted-foreground">
                        You can update transcripts, translations, cultural notes, and dialect rules.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/admin/videos')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-4">
                      <PlayCircle className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Manage Video Content</h3>
                      <p className="text-muted-foreground">Edit transcripts, translations, and cultural context</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-emerald-500/30" onClick={() => navigate('/admin/set-phrases')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-emerald-500/10 rounded-full p-4">
                      <MessageCircle className="h-8 w-8 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Set Phrases</h3>
                      <p className="text-muted-foreground">Review translations and cultural notes</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-lg transition-shadow border-purple-500/30" onClick={() => navigate('/admin/dialect-rules')}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-purple-500/10 rounded-full p-4">
                      <Languages className="h-8 w-8 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Dialect Rulebook</h3>
                      <p className="text-muted-foreground">Review and update dialect rules</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Lessons List */}
        <Card>
          <CardHeader>
            <CardTitle>Lessons Overview</CardTitle>
            <CardDescription>
              {isAdmin 
                ? 'Click a lesson to manage its vocabulary words' 
                : 'Click a lesson to add words or record audio'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lessons && lessons.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {lessons.map((lesson) => (
                  <Card
                    key={lesson.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(`/admin/lessons/${lesson.id}/words`)}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{lesson.icon}</span>
                        <div>
                          <h4 className="font-semibold">{lesson.name}</h4>
                          <p className="text-sm text-muted-foreground font-arabic">{lesson.name_arabic}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {lesson.word_count || 0} words
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {isAdmin ? (
                  <>
                    <p>No lessons yet. Use the Curriculum Builder or import a lesson plan to get started.</p>
                    <Button className="mt-4" onClick={() => navigate('/admin/curriculum-builder')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Lesson
                    </Button>
                  </>
                ) : (
                  <p>No lessons available. Ask an admin to create lessons first.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;
