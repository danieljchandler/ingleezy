import { useNavigate } from 'react-router-dom';
import { useStages } from '@/hooks/useStages';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Upload, ChevronRight } from 'lucide-react';
import { useDialect } from '@/contexts/DialectContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface LessonRow {
  id: string;
  title: string;
  title_arabic: string | null;
  stage_id: string;
  lesson_number: number;
  display_order: number;
  icon: string;
  status: string;
  dialect_module: string;
  vocabulary_words: { id: string }[];
}

const Stages = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAdminAuth();
  const { data: stages, isLoading: stagesLoading } = useStages();
  const { activeDialect } = useDialect();

  // Fetch real lessons from the lessons table, filtered by dialect
  const { data: lessons, isLoading: lessonsLoading } = useQuery({
    queryKey: ['admin-lessons', activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lessons')
        .select('id, title, title_arabic, stage_id, lesson_number, display_order, icon, status, dialect_module, vocabulary_words(id)')
        .eq('dialect_module', activeDialect)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LessonRow[];
    },
  });

  const isLoading = stagesLoading || lessonsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Group lessons by stage_id
  const lessonsByStage = new Map<string, LessonRow[]>();
  lessons?.forEach(lesson => {
    const existing = lessonsByStage.get(lesson.stage_id) || [];
    existing.push(lesson);
    lessonsByStage.set(lesson.stage_id, existing);
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Curriculum</h1>
          </div>
          {isAdmin && (
            <Button onClick={() => navigate('/admin/lessons/import')}>
              <Upload className="h-4 w-4 mr-2" />
              Import Lesson Plan
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {stages?.map(stage => {
          const stageLessons = lessonsByStage.get(stage.id) || [];

          return (
            <Card key={stage.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {stage.stage_number > 0 ? `Stage ${stage.stage_number}: ` : ''}
                      {stage.name}
                      {stage.name_arabic && (
                        <span className="text-muted-foreground font-arabic mr-2"> · {stage.name_arabic}</span>
                      )}
                    </CardTitle>
                    {stage.cefr_level && (
                      <CardDescription>{stage.cefr_level}</CardDescription>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {stageLessons.length} {stageLessons.length === 1 ? 'lesson' : 'lessons'}
                  </span>
                </div>
                {stage.description && (
                  <p className="text-sm text-muted-foreground mt-1">{stage.description}</p>
                )}
              </CardHeader>
              <CardContent>
                {stageLessons.length > 0 ? (
                  <div className="space-y-2">
                    {stageLessons.map(lesson => (
                      <button
                        key={lesson.id}
                        className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                        onClick={() => navigate(`/admin/lessons/${lesson.id}/words`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{lesson.icon}</span>
                          <div>
                            <p className="font-medium">
                              Lesson {lesson.lesson_number}: {lesson.title}
                            </p>
                            {lesson.title_arabic && (
                              <p className="text-sm text-muted-foreground font-arabic">{lesson.title_arabic}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={lesson.status === 'published' ? 'default' : 'secondary'} className="text-xs">
                            {lesson.status}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {lesson.vocabulary_words?.length || 0} words
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No lessons yet. Use the Curriculum Builder to create lessons.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>
    </div>
  );
};

export default Stages;
