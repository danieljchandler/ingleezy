import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLessonImport } from '@/hooks/useLessonImport';
import type { ParsedLessonPlan } from '@/lib/parseLessonXlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Upload, FileSpreadsheet, Check, BookOpen } from 'lucide-react';

const LessonImport = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMutation = useLessonImport();

  const [parsed, setParsed] = useState<ParsedLessonPlan | null>(null);
  const [fileName, setFileName] = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      // Dynamic import so the heavy SheetJS (xlsx) bundle loads only when an
      // admin actually picks a file, not on every visit to this route.
      const { parseLessonXlsx } = await import('@/lib/parseLessonXlsx');
      const result = parseLessonXlsx(buffer);
      setParsed(result);
      toast({ title: 'File parsed successfully', description: `Found ${result.vocabulary.length} vocabulary words.` });
    } catch (err: any) {
      console.error('Parse error:', err);
      toast({ variant: 'destructive', title: 'Failed to parse file', description: err.message });
      setParsed(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImport = async () => {
    if (!parsed) return;

    try {
      await importMutation.mutateAsync({
        stageId: 'default',
        lessonNumber: parsed.overview.lessonNumber,
        title: parsed.overview.title || `Lesson ${parsed.overview.lessonNumber}`,
        titleArabic: undefined,
        description: parsed.overview.approach,
        durationMinutes: parsed.overview.durationMinutes,
        cefrTarget: parsed.overview.cefrTarget,
        approach: parsed.overview.approach,
        unlockCondition: parsed.overview.unlockCondition,
        vocabulary: parsed.vocabulary,
        lessonSequence: parsed.lessonSequence,
        imageScenes: parsed.imageScenes,
        flashcardSpec: parsed.flashcardSpec,
        realWorldPrompts: parsed.realWorldPrompts,
        designRationale: parsed.designRationale,
        soundSpotlight: parsed.soundSpotlight,
      });

      toast({ title: 'Lesson imported!', description: `"${parsed.overview.title}" with ${parsed.vocabulary.length} words.` });
      navigate('/admin');
    } catch (err: any) {
      console.error('Import error:', err);
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Import Lesson Plan</h1>
            <p className="text-sm text-muted-foreground">Upload an xlsx lesson plan to auto-create a lesson with vocabulary</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Step 1: Upload Lesson Plan
            </CardTitle>
            <CardDescription>
              Upload an xlsx file with sheets for Lesson Overview, Vocabulary, etc.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full py-8 border-dashed border-2">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span>{fileName || 'Click to select xlsx file'}</span>
              </div>
            </Button>
          </CardContent>
        </Card>

        {parsed && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Step 2: Review Parsed Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-lg">{parsed.overview.title || 'Untitled'}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Stage:</span> {parsed.overview.stageLabel}</div>
                  <div><span className="text-muted-foreground">Lesson:</span> {parsed.overview.lessonLabel}</div>
                  <div><span className="text-muted-foreground">Duration:</span> {parsed.overview.duration}</div>
                  <div><span className="text-muted-foreground">CEFR:</span> {parsed.overview.cefrTarget}</div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Vocabulary ({parsed.vocabulary.length} words)</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-right">Arabic</th>
                        <th className="px-3 py-2 text-left">Translit.</th>
                        <th className="px-3 py-2 text-left">English</th>
                        <th className="px-3 py-2 text-left">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.vocabulary.map((v, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{v.number}</td>
                          <td className="px-3 py-2 text-right font-arabic text-base" dir="rtl">{v.arabic}</td>
                          <td className="px-3 py-2 text-muted-foreground">{v.transliteration}</td>
                          <td className="px-3 py-2">{v.english}</td>
                          <td className="px-3 py-2 text-muted-foreground">{v.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={importMutation.isPending}
                onClick={handleImport}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Import Lesson ({parsed.vocabulary.length} words)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default LessonImport;