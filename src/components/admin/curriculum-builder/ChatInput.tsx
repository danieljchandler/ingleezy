import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, X, MessageSquare, GraduationCap, BookOpen, PenLine, Headphones, BookOpenCheck, Flame, MessageCircle, Gamepad2 } from 'lucide-react';
import { QuickActionsMenu } from './QuickActionsMenu';

export type ChatMode =
  | 'chat'
  | 'generate_lesson'
  | 'generate_vocab'
  | 'generate_grammar'
  | 'generate_listening'
  | 'generate_reading'
  | 'generate_daily_challenge'
  | 'generate_conversation'
  | 'generate_game_set'
  | 'suggest_lessons'
  | 'suggest_vocab';

interface ChatInputProps {
  onSend: (message: string, mode?: ChatMode) => void;
  disabled?: boolean;
  isGenerating?: boolean;
}


export const ChatInput = ({ onSend, disabled, isGenerating }: ChatInputProps) => {
  const [value, setValue] = useState('');
  const [currentMode, setCurrentMode] = useState<ChatMode>('chat');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isGenerating) return;
    onSend(trimmed, currentMode);
    setValue('');
    setCurrentMode('chat');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, currentMode, disabled, isGenerating, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action: { prompt: string; mode: ChatMode }) => {
    setValue(action.prompt);
    setCurrentMode(action.mode);
    textareaRef.current?.focus();
  };

  const clearMode = () => setCurrentMode('chat');

  const PRIMARY_MODES: { mode: ChatMode; label: string; icon: React.ComponentType<{ className?: string }>; prompt: string }[] = [
    { mode: 'chat', label: 'Chat', icon: MessageSquare, prompt: '' },
    { mode: 'generate_lesson', label: 'Lesson', icon: GraduationCap, prompt: 'Create a complete lesson about: ' },
    { mode: 'generate_vocab', label: 'Vocab', icon: BookOpen, prompt: 'Generate vocabulary words for the topic: ' },
    
    { mode: 'generate_grammar', label: 'Grammar', icon: PenLine, prompt: 'Create grammar drill exercises for: ' },
    { mode: 'generate_listening', label: 'Listening', icon: Headphones, prompt: 'Create listening exercises about: ' },
    { mode: 'generate_reading', label: 'Reading', icon: BookOpenCheck, prompt: 'Create a reading passage about: ' },
    { mode: 'generate_daily_challenge', label: 'Daily', icon: Flame, prompt: 'Create a daily challenge set about: ' },
    { mode: 'generate_conversation', label: 'Convo', icon: MessageCircle, prompt: 'Create a conversation practice scenario for: ' },
    { mode: 'generate_game_set', label: 'Game', icon: Gamepad2, prompt: 'Create a vocabulary game set for: ' },
  ];

  const pickMode = (m: ChatMode, prompt: string) => {
    setCurrentMode(m);
    if (m !== 'chat' && !value.trim()) setValue(prompt);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t bg-card p-2 sm:p-3 space-y-2">
      {/* Content type selector — visible chip row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0 mr-1">
          Make:
        </span>
        {PRIMARY_MODES.map(({ mode, label, icon: Icon, prompt }) => {
          const active = currentMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => pickMode(mode, prompt)}
              disabled={disabled || isGenerating}
              className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted border-border text-muted-foreground'
              } disabled:opacity-50`}
            >
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1 shrink-0">
          <QuickActionsMenu
            currentMode={currentMode}
            onSelect={handleQuickAction}
            disabled={disabled || isGenerating}
          />
          {currentMode !== 'chat' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearMode}
              className="h-6 px-1.5 text-[10px] text-muted-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              clear
            </Button>
          )}
        </div>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGenerating
              ? 'Waiting for AI response...'
              : currentMode !== 'chat'
                ? 'Describe what to generate…'
                : 'Message the curriculum AI…  (Enter to send)'
          }
          disabled={disabled || isGenerating}
          className="min-h-[44px] max-h-[200px] resize-none"
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!value.trim() || disabled || isGenerating}
          size="icon"
          className="shrink-0 h-9 w-9"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
