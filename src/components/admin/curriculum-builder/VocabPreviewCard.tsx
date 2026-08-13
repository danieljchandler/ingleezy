import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, BookOpen } from 'lucide-react';
import { useAllLessons } from '@/hooks/useLessons';

interface VocabPreviewCardProps {
  data: Record<string, unknown>;
  onApprove: (lessonId: string, selectedIndices: number[]) => void;
}

interface VocabItem {
  word_arabic: string;
  word_english: string;
  transliteration?: string;
  category?: string;
  teaching_note?: string;
}

export const VocabPreviewCard = ({ data, onApprove }: VocabPreviewCardProps) => {
  const vocabulary = ((data as Record<string, unknown>).vocabulary as VocabItem[] | undefined) ?? [];
  const dialectNotes = (data as Record<string, unknown>).dialect_notes as string | undefined;

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(vocabulary.map((_, i) => i)),
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const { data: allLessons } = useAllLessons();

  const toggleIndex = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIndices.size === vocabulary.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(vocabulary.map((_, i) => i)));
    }
  };

  if (vocabulary.length === 0) return null;

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Vocabulary Preview
          </CardTitle>
          <Badge variant="secondary">
            {selectedIndices.size}/{vocabulary.length} selected
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Word list with checkboxes */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={selectedIndices.size === vocabulary.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="text-right px-3 py-2 font-medium">Arabic</th>
                <th className="text-left px-3 py-2 font-medium">Transliteration</th>
                <th className="text-left px-3 py-2 font-medium">English</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              {vocabulary.map((word, i) => (
                <tr
                  key={i}
                  className={`border-t cursor-pointer hover:bg-muted/30 ${
                    selectedIndices.has(i) ? '' : 'opacity-50'
                  }`}
                  onClick={() => toggleIndex(i)}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIndices.has(i)}
                      onCheckedChange={() => toggleIndex(i)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-3 py-2 font-arabic text-right">{word.word_arabic}</td>
                  <td className="px-3 py-2 text-muted-foreground">{word.transliteration ?? '-'}</td>
                  <td className="px-3 py-2">{word.word_english}</td>
                  <td className="px-3 py-2">
                    {word.category && (
                      <Badge variant="outline" className="text-[10px]">
                        {word.category}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Teaching notes (if any word has one) */}
        {vocabulary.some((w) => w.teaching_note) && (
          <div className="text-xs space-y-1 bg-muted/40 rounded p-3">
            <strong>Teaching Notes:</strong>
            {vocabulary
              .filter((w) => w.teaching_note)
              .map((w, i) => (
                <p key={i}>
                  <span className="font-arabic">{w.word_arabic}</span>: {w.teaching_note}
                </p>
              ))}
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
              Add to lesson:
            </label>
            <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a lesson..." />
              </SelectTrigger>
              <SelectContent>
                {allLessons?.map((lesson) => (
                  <SelectItem key={lesson.id} value={lesson.id}>
                    {lesson.icon} {lesson.name}
                    {lesson.name_arabic ? ` · ${lesson.name_arabic}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => onApprove(selectedLessonId, Array.from(selectedIndices))}
            disabled={!selectedLessonId || selectedIndices.size === 0}
            size="sm"
            className="shrink-0"
          >
            <Check className="h-4 w-4 mr-1.5" />
            Add {selectedIndices.size} Words
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
