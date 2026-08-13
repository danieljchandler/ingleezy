import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { ChatMessage } from '@/hooks/useCurriculumChat';
import { LessonPreviewCard } from './LessonPreviewCard';
import { VocabPreviewCard } from './VocabPreviewCard';
import {
  GrammarPreviewCard,
  ListeningPreviewCard,
  ReadingPreviewCard,
  DailyChallengePreviewCard,
  ConversationPreviewCard,
  GameSetPreviewCard,
} from './ContentPreviewCard';


interface PreviewPanelProps {
  message: ChatMessage | null;
  onClose: () => void;
  onApproveLesson: (messageId: string, data: Record<string, unknown>, stageId: string) => void;
  onApproveVocab: (
    messageId: string,
    data: Record<string, unknown>,
    lessonId: string,
    selectedIndices: number[],
  ) => void;
  onApproveContent: (messageId: string, outputType: string, data: Record<string, unknown>) => void;
  onSaveEdits: (messageId: string, data: Record<string, unknown>) => void;
}

const TYPE_LABEL: Record<string, string> = {
  lesson_preview: 'Lesson',
  vocab_preview: 'Vocabulary',
  grammar_preview: 'Grammar',
  listening_preview: 'Listening',
  reading_preview: 'Reading',
  daily_challenge_preview: 'Daily Challenge',
  conversation_preview: 'Conversation',
  game_set_preview: 'Game Set',
  
};

export const PreviewPanel = ({
  message,
  onClose,
  onApproveLesson,
  onApproveVocab,
  onApproveContent,
  onSaveEdits,
}: PreviewPanelProps) => {
  const original = useMemo(
    () => (message?.structured_output ? JSON.stringify(message.structured_output, null, 2) : ''),
    [message?.id, message?.structured_output],
  );
  const [jsonText, setJsonText] = useState(original);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setJsonText(original);
    setJsonError(null);
  }, [original]);

  if (!message || !message.structured_output) return null;

  const data = message.structured_output;
  const type = message.output_type ?? 'preview';
  const label = TYPE_LABEL[type] ?? 'Preview';
  const dirty = jsonText !== original;

  const handleSave = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onSaveEdits(message.id, parsed);
      toast.success('Edits saved — preview updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON';
      setJsonError(msg);
      toast.error('Invalid JSON: ' + msg);
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Preview</p>
          <h2 className="text-sm font-semibold">{label}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="preview" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="edit">Edit JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="flex-1 overflow-hidden mt-2">
          <ScrollArea className="h-full">
            <div className="p-4">
              {type === 'lesson_preview' && (
                <LessonPreviewCard
                  data={data}
                  onApprove={(stageId) => onApproveLesson(message.id, data, stageId)}
                />
              )}
              {type === 'vocab_preview' && (
                <VocabPreviewCard
                  data={data}
                  onApprove={(lessonId, idxs) => onApproveVocab(message.id, data, lessonId, idxs)}
                />
              )}
              {type === 'grammar_preview' && (
                <GrammarPreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
              {type === 'listening_preview' && (
                <ListeningPreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
              {type === 'reading_preview' && (
                <ReadingPreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
              {type === 'daily_challenge_preview' && (
                <DailyChallengePreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
              {type === 'conversation_preview' && (
                <ConversationPreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
              {type === 'game_set_preview' && (
                <GameSetPreviewCard data={data} onApprove={() => onApproveContent(message.id, type, data)} />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="edit" className="flex-1 overflow-hidden mt-2 flex flex-col">
          <div className="px-4 pb-2 text-xs text-muted-foreground">
            Edit raw fields before approving. Save to refresh the preview, then approve.
          </div>
          <div className="flex-1 px-4 overflow-hidden">
            <Textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError(null);
              }}
              className="h-full font-mono text-xs resize-none"
              spellCheck={false}
            />
          </div>
          {jsonError && (
            <p className="px-4 py-1 text-xs text-destructive truncate">{jsonError}</p>
          )}
          <div className="flex items-center justify-end gap-2 p-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setJsonText(original);
                setJsonError(null);
              }}
              disabled={!dirty}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty}>
              <Save className="h-3.5 w-3.5 mr-1" />
              Save edits
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
