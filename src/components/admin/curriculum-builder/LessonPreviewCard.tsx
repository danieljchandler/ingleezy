import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, BookOpen, Clock, GraduationCap } from 'lucide-react';
import { useStages } from '@/hooks/useStages';

interface LessonPreviewCardProps {
  data: Record<string, unknown>;
  onApprove: (stageId: string) => void;
}

interface VocabItem {
  word_arabic: string;
  word_english: string;
  transliteration?: string;
  category?: string;
  teaching_note?: string;
}

export const LessonPreviewCard = ({ data, onApprove }: LessonPreviewCardProps) => {
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const { data: stages } = useStages();

  const lesson = (data as Record<string, unknown>).lesson as Record<string, unknown> | undefined;
  if (!lesson) return null;

  const title = lesson.title as string;
  const titleArabic = lesson.title_arabic as string | undefined;
  const description = lesson.description as string | undefined;
  const duration = lesson.duration_minutes as number | undefined;
  const cefr = lesson.cefr_target as string | undefined;
  const approach = lesson.approach as string | undefined;
  const icon = lesson.icon as string | undefined;
  const vocabulary = (lesson.vocabulary as VocabItem[] | undefined) ?? [];
  const culturalNotes = lesson.cultural_notes as string | undefined;
  const dialectNotes = lesson.dialect_notes as string | undefined;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span>{icon ?? '📚'}</span>
              <span>{title}</span>
            </CardTitle>
            {titleArabic && (
              <p className="text-sm font-arabic text-muted-foreground mt-1">{titleArabic}</p>
            )}
          </div>
          <Badge variant="secondary">Lesson Preview</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Meta info */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {duration} min
            </span>
          )}
          {cefr && (
            <span className="flex items-center gap-1">
              <GraduationCap className="h-3 w-3" /> {cefr}
            </span>
          )}
          {vocabulary.length > 0 && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> {vocabulary.length} words
            </span>
          )}
        </div>

        {description && <p className="text-sm">{description}</p>}
        {approach && (
          <p className="text-xs text-muted-foreground">
            <strong>Approach:</strong> {approach}
          </p>
        )}

        {/* Vocabulary table */}
        {vocabulary.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right px-3 py-2 font-medium">Arabic</th>
                  <th className="text-left px-3 py-2 font-medium">Transliteration</th>
                  <th className="text-left px-3 py-2 font-medium">English</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {vocabulary.map((word, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-arabic text-right">{word.word_arabic}</td>
                    <td className="px-3 py-2 text-muted-foreground">{word.transliteration ?? '-'}</td>
                    <td className="px-3 py-2">{word.word_english}</td>
                    <td className="px-3 py-2">
                      {word.category && <Badge variant="outline" className="text-[10px]">{word.category}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cultural and dialect notes */}
        {culturalNotes && (
          <div className="text-xs bg-muted/40 rounded p-3">
            <strong>Cultural Notes:</strong> {culturalNotes}
          </div>
        )}
        {dialectNotes && (
          <div className="text-xs bg-muted/40 rounded p-3">
            <strong>Dialect Notes:</strong> {dialectNotes}
          </div>
        )}

        {/* Approve section */}
        <div className="flex items-end gap-3 pt-2 border-t">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Add to stage:
            </label>
            <Select value={selectedStageId} onValueChange={setSelectedStageId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a curriculum stage..." />
              </SelectTrigger>
              <SelectContent>
                {stages
                  ?.filter((s) => s.stage_number > 0)
                  .map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      Stage {stage.stage_number}: {stage.name}
                      {stage.cefr_level ? ` (${stage.cefr_level})` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => onApprove(selectedStageId)}
            disabled={!selectedStageId}
            size="sm"
            className="shrink-0"
          >
            <Check className="h-4 w-4 mr-1.5" />
            Approve & Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
