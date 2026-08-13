import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

// Every id here must exist in MODEL_REGISTRY in
// supabase/functions/curriculum-chat/index.ts — an option this list offers but
// that map lacks fails at request time with "Unknown model".
export type LLMModelId =
  | 'google/gemini-3.5-flash'
  | 'google/gemini-3-flash-preview'
  | 'google/gemini-2.5-flash'
  | 'google/gemini-2.5-pro'
  | 'anthropic/claude-sonnet-4-5'
  | 'qwen/qwen3-max'
  | 'qwen/qwen3-235b-a22b'
  | 'mistralai/mistral-saba'
  | 'google/gemma-3-12b-it'
  | 'fanar';

interface ModelOption {
  id: LLMModelId;
  name: string;
  provider: string;
  description: string;
  badge?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'Lovable',
    description: 'Pipeline-aligned drafter. Top dialect quality.',
    badge: 'Recommended',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'OpenRouter',
    description: 'Pipeline-aligned drafter & judge.',
    badge: 'Pipeline',
  },
  {
    id: 'fanar',
    name: 'Fanar 2 (27B)',
    provider: 'Qatar (QCRI)',
    description: 'Arabic-native specialist, 32k context.',
    badge: 'Arabic Expert',
  },
  {
    id: 'mistralai/mistral-saba',
    name: 'Mistral Saba',
    provider: 'OpenRouter',
    description: 'Arabic-focused 24B. Cheap second opinion.',
    badge: 'Arabic',
  },
  {
    id: 'qwen/qwen3-max',
    name: 'Qwen3 Max',
    provider: 'OpenRouter',
    description: 'Third verifier (weighted lower than Gemini/Claude).',
    badge: 'Verifier',
  },
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen3 235B',
    provider: 'OpenRouter',
    description: 'Strong reasoning, large context.',
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Lovable',
    description: 'Previous-gen strong Gemini.',
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'Lovable',
    description: 'Fast preview, lower cost.',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Lovable',
    description: 'Fast, reliable.',
  },
  {
    id: 'google/gemma-3-12b-it',
    name: 'Gemma 3 12B',
    provider: 'OpenRouter',
    description: 'Good Arabic understanding.',
  },
];

interface ModelSelectorProps {
  value: LLMModelId;
  onChange: (model: LLMModelId) => void;
  className?: string;
}

export const ModelSelector = ({ value, onChange, className }: ModelSelectorProps) => {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LLMModelId)}>
      <SelectTrigger className={className ?? 'w-[220px]'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_OPTIONS.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            <span className="flex items-center gap-2">
              <span className="font-medium">{opt.name}</span>
              <span className="text-xs text-muted-foreground">({opt.provider})</span>
              {opt.badge && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  {opt.badge}
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const getModelName = (id: LLMModelId | string): string => {
  return MODEL_OPTIONS.find((m) => m.id === id)?.name ?? id;
};

export { MODEL_OPTIONS };
