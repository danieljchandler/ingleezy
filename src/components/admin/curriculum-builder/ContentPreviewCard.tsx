import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

interface ContentPreviewCardProps {
  title: string;
  subtitle?: string;
  icon: string;
  badges?: string[];
  children: React.ReactNode;
  onApprove: () => void;
  approveLabel?: string;
  isApproving?: boolean;
}

export const ContentPreviewCard = ({
  title,
  subtitle,
  icon,
  badges,
  children,
  onApprove,
  approveLabel = 'Publish',
  isApproving,
}: ContentPreviewCardProps) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span>{icon}</span>
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            {badges?.map((b) => (
              <Badge key={b} variant="outline" className="text-[10px]">
                {b}
              </Badge>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="h-6 w-6 p-0"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {children}
          <Button size="sm" onClick={onApprove} disabled={isApproving} className="w-full">
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {isApproving ? 'Publishing...' : approveLabel}
          </Button>
        </CardContent>
      )}
    </Card>
  );
};

// ─── GRAMMAR PREVIEW ─────────────────────────

export const GrammarPreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const exercises = (data.exercises as Array<Record<string, unknown>>) || [];
  return (
    <ContentPreviewCard
      title={`Grammar Exercises (${exercises.length})`}
      icon="📝"
      badges={[data.category as string, data.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel={`Publish ${exercises.length} exercises`}
      isApproving={isApproving}
    >
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {exercises.slice(0, 3).map((ex, i) => (
          <div key={i} className="text-xs p-2 bg-background rounded border">
            <p className="font-medium" dir="rtl">{ex.question_arabic as string}</p>
            <p className="text-muted-foreground">{ex.question_english as string}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Point: {ex.grammar_point as string}
            </p>
          </div>
        ))}
        {exercises.length > 3 && (
          <p className="text-[10px] text-muted-foreground text-center">
            +{exercises.length - 3} more exercises
          </p>
        )}
      </div>
    </ContentPreviewCard>
  );
};

// ─── LISTENING PREVIEW ─────────────────────────

export const ListeningPreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const exercises = (data.exercises as Array<Record<string, unknown>>) || [];
  return (
    <ContentPreviewCard
      title={`Listening Exercises (${exercises.length})`}
      icon="🎧"
      badges={[data.mode as string, data.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel={`Publish ${exercises.length} exercises`}
      isApproving={isApproving}
    >
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {exercises.map((ex, i) => (
          <div key={i} className="text-xs p-2 bg-background rounded border">
            <p className="font-medium" dir="rtl">{ex.audio_text as string}</p>
            <p className="text-muted-foreground">{ex.audio_text_english as string}</p>
          </div>
        ))}
      </div>
    </ContentPreviewCard>
  );
};

// ─── READING PREVIEW ─────────────────────────

export const ReadingPreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const passage = data.passage as Record<string, unknown>;
  return (
    <ContentPreviewCard
      title={passage?.title_english as string || 'Reading Passage'}
      subtitle={passage?.title as string}
      icon="📖"
      badges={[data.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel="Publish passage"
      isApproving={isApproving}
    >
      <div className="text-xs p-2 bg-background rounded border max-h-40 overflow-y-auto">
        <p dir="rtl" className="leading-relaxed">{(passage?.passage as string || '').slice(0, 200)}...</p>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {((passage?.questions as unknown[]) || []).length} questions · {((passage?.vocabulary as unknown[]) || []).length} vocab items
      </p>
    </ContentPreviewCard>
  );
};

// ─── DAILY CHALLENGE PREVIEW ─────────────────────────

export const DailyChallengePreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const questions = (data.questions as unknown[]) || [];
  return (
    <ContentPreviewCard
      title={data.title as string || 'Daily Challenge'}
      subtitle={data.title_arabic as string}
      icon="🔥"
      badges={[data.challenge_type as string, data.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel={`Publish challenge (${questions.length} questions)`}
      isApproving={isApproving}
    >
      <p className="text-xs text-muted-foreground">{questions.length} questions ready</p>
    </ContentPreviewCard>
  );
};

// ─── CONVERSATION PREVIEW ─────────────────────────

export const ConversationPreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const scenario = data.scenario as Record<string, unknown>;
  return (
    <ContentPreviewCard
      title={scenario?.title as string || 'Conversation Scenario'}
      subtitle={scenario?.description as string}
      icon="💬"
      badges={[scenario?.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel="Publish scenario"
      isApproving={isApproving}
    >
      <div className="text-xs p-2 bg-background rounded border">
        <p className="text-muted-foreground line-clamp-3">{scenario?.system_prompt as string}</p>
      </div>
    </ContentPreviewCard>
  );
};

// ─── GAME SET PREVIEW ─────────────────────────

export const GameSetPreviewCard = ({
  data,
  onApprove,
  isApproving,
}: {
  data: Record<string, unknown>;
  onApprove: () => void;
  isApproving?: boolean;
}) => {
  const wordPairs = (data.word_pairs as Array<Record<string, unknown>>) || [];
  return (
    <ContentPreviewCard
      title={data.title as string || 'Game Set'}
      icon="🎮"
      badges={[data.game_type as string, data.difficulty as string].filter(Boolean)}
      onApprove={onApprove}
      approveLabel={`Publish game set (${wordPairs.length} words)`}
      isApproving={isApproving}
    >
      <div className="flex flex-wrap gap-1">
        {wordPairs.slice(0, 8).map((wp, i) => (
          <Badge key={i} variant="secondary" className="text-[10px]">
            {wp.word_arabic as string} = {wp.word_english as string}
          </Badge>
        ))}
        {wordPairs.length > 8 && (
          <Badge variant="outline" className="text-[10px]">+{wordPairs.length - 8} more</Badge>
        )}
      </div>
    </ContentPreviewCard>
  );
};
