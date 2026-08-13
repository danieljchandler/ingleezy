// =============================================================================
// CENTRAL MODEL REGISTRY — single source of truth for all AI model selection.
// =============================================================================
//
// RULE: Do NOT hardcode model IDs in feature code. If a model breaks, fix the
// root cause (credits, routing, prompt) rather than silently swapping models
// in individual edge functions. Only swap models HERE, in one place.
//
// Two named lineups power everything translation- or content-related:
//   - TRANSLATION: Claude Sonnet 4.5 + Gemini 3.5 Flash, ensemble.
//   - CONTENT:    Claude Sonnet 4.5 + Gemini 3.5 Flash, draft_critic.
//
// Claude routes via OpenRouter (OPENROUTER_API_KEY); Gemini routes via the
// Lovable AI Gateway (LOVABLE_API_KEY). See routeForModel() in aiBrain.ts.
//
// Live voice (realtime-session-token) and ASR/TTS/image models are NOT
// governed by this registry — they have their own provider-specific configs.
// =============================================================================

// ---- Canonical model IDs ----------------------------------------------------
// Bump these when upgrading; everything downstream picks it up automatically.
export const MODEL_IDS = {
  CLAUDE: 'anthropic/claude-sonnet-4.5',          // one tier below Opus (cheaper)
  CLAUDE_CHAT: 'anthropic/claude-sonnet-5',        // newest Sonnet — Ask AI text chat
  GEMINI_FLASH: 'google/gemini-3.5-flash',         // via Lovable Gateway
  GEMINI_PRO: 'google/gemini-2.5-pro',             // heavy reasoning fallback
  GEMINI_FAST: 'google/gemini-3-flash-preview',    // cheapest utility default
  QWEN: 'qwen/qwen3-max',                          // third-leg verifier
  SABA: 'mistralai/mistral-saba',                  // Arabic-native 24B, via OpenRouter
  // All general Fanar work (merge fallback, meta enrichment, dialect
  // validation, curriculum chat) uses the pinned gen-2 model. Never use the
  // bare 'Fanar' alias (silently tracks gen 1, 4k ctx) and never use
  // 'Fanar-Sadiq' for non-religious content — it is the Islamic-RAG model.
  FANAR: 'Fanar-C-2-27B',
} as const;

// ---- Named lineups (preferred entry point) ---------------------------------
export type LineupName = 'TRANSLATION' | 'CONTENT' | 'UTILITY' | 'REASONING';

export interface Lineup {
  drafters: string[];                              // models the ensemble/draft step uses
  judge: string;                                   // critic model for draft_critic / council
  strategy: 'solo' | 'ensemble' | 'draft_critic' | 'council';
}

export const MODEL_LINEUPS: Record<LineupName, Lineup> = {
  // Translation: parallel ensemble — Claude and Gemini both translate, brain
  // picks the lower-MSA-leak result. Both models route via OpenRouter/Lovable
  // and use weighted Jaccard ranking inside aiBrain.runEnsemble.
  TRANSLATION: {
    drafters: [MODEL_IDS.CLAUDE, MODEL_IDS.GEMINI_FLASH],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'ensemble',
  },
  // Content creation (stories, news, lessons, memes): Gemini drafts, Claude
  // critiques and rewrites for tone + dialect authenticity.
  CONTENT: {
    drafters: [MODEL_IDS.GEMINI_FLASH, MODEL_IDS.CLAUDE],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'draft_critic',
  },
  // Utility: cheap classification, extraction, scoring — single fast model.
  UTILITY: {
    drafters: [MODEL_IDS.GEMINI_FAST],
    judge: MODEL_IDS.GEMINI_FAST,
    strategy: 'solo',
  },
  // Reasoning: hardest tasks (lesson planning, council debates). Adds Pro Gemini
  // as a third verifier on top of the standard tandem.
  REASONING: {
    drafters: [MODEL_IDS.CLAUDE, MODEL_IDS.GEMINI_FLASH, MODEL_IDS.GEMINI_PRO],
    judge: MODEL_IDS.CLAUDE,
    strategy: 'council',
  },
};

export function getLineup(name: LineupName): Lineup {
  return MODEL_LINEUPS[name];
}

// ---- Aliases consumed by aiBrain.ts ----------------------------------------
// These intentionally point at the CONTENT lineup so changing the tandem in
// one place propagates to every brain caller that doesn't pass models[].
export const DEFAULT_FAST = MODEL_IDS.GEMINI_FAST;
export const DEFAULT_JUDGE = MODEL_LINEUPS.CONTENT.judge;
export const DEFAULT_DRAFTERS = MODEL_LINEUPS.TRANSLATION.drafters;
// The learner-facing Ask AI text chat: instruction-following and dialect
// quality matter more than raw speed here, so it gets the newest Sonnet
// rather than the cheap utility default. Routes via OpenRouter.
export const DEFAULT_CHAT = MODEL_IDS.CLAUDE_CHAT;

// ---- Voting weights for runEnsemble ranking --------------------------------
// Both Claude Sonnet 4.5 and Gemini 3.5 Flash are co-equal authoritative
// drafters. Qwen and other legacy models stay at lower weights.
export const MODEL_WEIGHTS: Record<string, number> = {
  [MODEL_IDS.CLAUDE]: 1.0,
  [MODEL_IDS.GEMINI_FLASH]: 1.0,
  [MODEL_IDS.GEMINI_PRO]: 0.9,
  [MODEL_IDS.GEMINI_FAST]: 0.7,
  [MODEL_IDS.QWEN]: 0.6,
  [MODEL_IDS.SABA]: 0.7,
  'openai/gpt-5-mini': 0.6,   // second drafter in generate-story
};

export function getModelWeight(id: string): number {
  return MODEL_WEIGHTS[id] ?? 0.8;
}
