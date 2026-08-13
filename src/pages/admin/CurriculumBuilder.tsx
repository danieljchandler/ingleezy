import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDialect } from '@/contexts/DialectContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles, Menu, FileText, LayoutGrid } from 'lucide-react';
import { useCurriculumChat } from '@/hooks/useCurriculumChat';
import { useCurriculumApproval } from '@/hooks/useCurriculumApproval';
import { ChatSidebar } from '@/components/admin/curriculum-builder/ChatSidebar';
import { ChatWindow } from '@/components/admin/curriculum-builder/ChatWindow';
import { ChatInput, type ChatMode } from '@/components/admin/curriculum-builder/ChatInput';
import { DialectSelector, type GulfDialect } from '@/components/admin/curriculum-builder/DialectSelector';
import { ModelSelector, type LLMModelId } from '@/components/admin/curriculum-builder/ModelSelector';
import { PreviewPanel } from '@/components/admin/curriculum-builder/PreviewPanel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useStages } from '@/hooks/useStages';
import { useIsMobile } from '@/hooks/use-mobile';

const CurriculumBuilder = () => {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const { activeDialect } = useDialect();
  const isMobile = useIsMobile();

  const {
    sessions,
    messages,
    activeSessionId,
    setActiveSessionId,
    isGenerating,
    createSession,
    sendMessage,
    archiveSession,
    updateModel,
    updateMessageStructured,
  } = useCurriculumChat();

  const {
    approveLesson,
    approveVocabulary,
    approveGrammarExercises,
    approveListeningExercises,
    approveReadingPassage,
    approveDailyChallenge,
    approveConversationScenario,
    approveGameSet,
  } = useCurriculumApproval();
  const { data: stages } = useStages();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newDialect, setNewDialect] = useState<GulfDialect>(activeDialect as GulfDialect);
  const [newModel, setNewModel] = useState<LLMModelId>('google/gemini-3-flash-preview');
  const [newStageId, setNewStageId] = useState<string>('');
  const [newCefr, setNewCefr] = useState<string>('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [previewOpenMobile, setPreviewOpenMobile] = useState(false);

  useEffect(() => {
    if (routeSessionId && routeSessionId !== activeSessionId) {
      setActiveSessionId(routeSessionId);
    }
  }, [routeSessionId, activeSessionId, setActiveSessionId]);

  // Auto-select newest preview when one arrives
  useEffect(() => {
    const latestPreview = [...messages]
      .reverse()
      .find((m) => m.structured_output && m.output_type);
    if (latestPreview && latestPreview.id !== selectedMessageId) {
      setSelectedMessageId(latestPreview.id);
      if (isMobile) setPreviewOpenMobile(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const dialectSessions = sessions.filter((s) => s.target_dialect === activeDialect);
  const selectedMessage = messages.find((m) => m.id === selectedMessageId) ?? null;

  const handleNewSession = useCallback(() => {
    setNewDialect(activeDialect as GulfDialect);
    setShowNewDialog(true);
    setSessionsOpen(false);
  }, [activeDialect]);

  const handleCreateSession = useCallback(() => {
    createSession.mutate(
      {
        dialect: newDialect,
        model: newModel,
        stageId: newStageId && newStageId !== 'any' ? newStageId : undefined,
        cefr: newCefr && newCefr !== 'any' ? newCefr : undefined,
      },
      { onSuccess: () => setShowNewDialog(false) },
    );
  }, [createSession, newDialect, newModel, newStageId, newCefr]);

  const handleSend = useCallback(
    (content: string, mode?: ChatMode) => {
      sendMessage(content, mode as string, activeSession);
    },
    [sendMessage, activeSession],
  );

  const handleSelectPreview = useCallback((messageId: string) => {
    setSelectedMessageId(messageId);
    if (isMobile) setPreviewOpenMobile(true);
  }, [isMobile]);

  const handleApproveLesson = useCallback(
    (messageId: string, data: Record<string, unknown>, stageId: string) => {
      if (!activeSessionId) return;
      const lesson = data.lesson as Record<string, unknown>;
      approveLesson.mutate({
        messageId,
        sessionId: activeSessionId,
        stageId,
        dialectModule: activeSession?.target_dialect || activeDialect,
        lessonData: {
          title: lesson.title as string,
          title_arabic: lesson.title_arabic as string | undefined,
          description: lesson.description as string | undefined,
          duration_minutes: lesson.duration_minutes as number | undefined,
          cefr_target: lesson.cefr_target as string | undefined,
          approach: lesson.approach as string | undefined,
          icon: lesson.icon as string | undefined,
          vocabulary: lesson.vocabulary as Array<{
            word_arabic: string;
            word_english: string;
            transliteration?: string;
            category?: string;
            teaching_note?: string;
            image_scene_description?: string;
          }>,
        },
      });
    },
    [activeSessionId, approveLesson, activeSession, activeDialect],
  );

  const handleApproveVocab = useCallback(
    (messageId: string, data: Record<string, unknown>, lessonId: string, selectedIndices: number[]) => {
      if (!activeSessionId) return;
      const vocabulary = (data.vocabulary as Array<{
        word_arabic: string;
        word_english: string;
        transliteration?: string;
        category?: string;
        teaching_note?: string;
      }>) ?? [];
      const selectedWords = selectedIndices.map((i) => vocabulary[i]).filter(Boolean);
      approveVocabulary.mutate({
        messageId,
        sessionId: activeSessionId,
        lessonId,
        words: selectedWords,
        dialectModule: activeSession?.target_dialect || activeDialect,
      });
    },
    [activeSessionId, approveVocabulary, activeSession, activeDialect],
  );

  const handleApproveContent = useCallback(
    (messageId: string, outputType: string, data: Record<string, unknown>) => {
      if (!activeSessionId) return;
      const params = { messageId, sessionId: activeSessionId, data };
      switch (outputType) {
        case 'grammar_preview': approveGrammarExercises.mutate(params); break;
        case 'listening_preview': approveListeningExercises.mutate(params); break;
        case 'reading_preview': approveReadingPassage.mutate(params); break;
        case 'daily_challenge_preview': approveDailyChallenge.mutate(params); break;
        case 'conversation_preview': approveConversationScenario.mutate(params); break;
        case 'game_set_preview': approveGameSet.mutate(params); break;
      }
    },
    [activeSessionId, approveGrammarExercises, approveListeningExercises, approveReadingPassage, approveDailyChallenge, approveConversationScenario, approveGameSet, activeSession, activeDialect],
  );

  const sidebar = (
    <ChatSidebar
      sessions={dialectSessions}
      activeSessionId={activeSessionId}
      onSelectSession={(id) => {
        setActiveSessionId(id);
        setSelectedMessageId(null);
        setSessionsOpen(false);
      }}
      onNewSession={handleNewSession}
      onArchiveSession={(id) => archiveSession.mutate(id)}
    />
  );

  const previewPanel = (
    <PreviewPanel
      message={selectedMessage}
      onClose={() => {
        setSelectedMessageId(null);
        setPreviewOpenMobile(false);
      }}
      onApproveLesson={handleApproveLesson}
      onApproveVocab={handleApproveVocab}
      onApproveContent={handleApproveContent}
      onSaveEdits={updateMessageStructured}
    />
  );

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* HEADER */}
      <header className="border-b bg-card px-3 sm:px-4 py-2.5 flex items-center gap-2 shrink-0">
        {isMobile && (
          <Sheet open={sessionsOpen} onOpenChange={setSessionsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              {sidebar}
            </SheetContent>
          </Sheet>
        )}

        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} className="h-9 w-9">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/admin/coverage')}
          className="h-9 gap-1 hidden sm:inline-flex"
          title="View Curriculum Coverage ledger"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-xs">Coverage</span>
        </Button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <h1 className="text-sm sm:text-base font-bold truncate">
            {activeSession?.title ?? 'Curriculum Builder'}
          </h1>
        </div>

        {activeSession && !isMobile && (
          <div className="flex items-center gap-2">
            <DialectSelector
              value={activeSession.target_dialect as GulfDialect}
              onChange={() => {}}
              className="w-[160px] h-9"
            />
            <ModelSelector
              value={activeSession.llm_model as LLMModelId}
              onChange={updateModel}
              className="w-[180px] h-9"
            />
          </div>
        )}

        {isMobile && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/admin/coverage')}
            className="h-9 w-9"
            title="Coverage"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        )}

        {isMobile && selectedMessage && (
          <Sheet open={previewOpenMobile} onOpenChange={setPreviewOpenMobile}>
            <SheetTrigger asChild>
              <Button variant="default" size="sm" className="h-9 gap-1">
                <FileText className="h-4 w-4" />
                <span className="text-xs">Preview</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-full sm:max-w-md">
              {previewPanel}
            </SheetContent>
          </Sheet>
        )}
      </header>

      {/* BODY: 3-pane on desktop */}
      <div className="flex flex-1 overflow-hidden">
        {!isMobile && <div className="shrink-0">{sidebar}</div>}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <ChatWindow
            messages={messages}
            isGenerating={isGenerating}
            sessionId={activeSessionId}
            selectedMessageId={selectedMessageId}
            onSelectPreview={handleSelectPreview}
          />
          <ChatInput
            onSend={handleSend}
            disabled={!activeSession}
            isGenerating={isGenerating}
          />
        </div>

        {!isMobile && selectedMessage && (
          <div className="w-[360px] xl:w-[420px] border-l shrink-0 overflow-hidden">
            {previewPanel}
          </div>
        )}
      </div>

      {/* NEW SESSION DIALOG */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Curriculum Building Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Target Dialect</Label>
              <DialectSelector value={newDialect} onChange={setNewDialect} className="w-full" />
            </div>
            <div className="space-y-2">
              <Label>AI Model</Label>
              <ModelSelector value={newModel} onChange={setNewModel} className="w-full" />
            </div>
            <div className="space-y-2">
              <Label>Target Stage (optional)</Label>
              <Select value={newStageId} onValueChange={setNewStageId}>
                <SelectTrigger><SelectValue placeholder="Any stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any stage</SelectItem>
                  {stages?.filter((s) => s.stage_number > 0).map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      Stage {stage.stage_number}: {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>CEFR Level (optional)</Label>
              <Select value={newCefr} onValueChange={setNewCefr}>
                <SelectTrigger><SelectValue placeholder="Any level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any level</SelectItem>
                  <SelectItem value="Pre-A1">Pre-A1</SelectItem>
                  <SelectItem value="A1">A1</SelectItem>
                  <SelectItem value="A2">A2</SelectItem>
                  <SelectItem value="B1">B1</SelectItem>
                  <SelectItem value="B2">B2</SelectItem>
                  <SelectItem value="C1">C1</SelectItem>
                  <SelectItem value="C2">C2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateSession} disabled={createSession.isPending}>
              {createSession.isPending ? 'Creating...' : 'Start Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CurriculumBuilder;
