---
name: Unified Model Lineup System
description: Single registry (MODEL_LINEUPS in _shared/modelRegistry.ts) drives every translation/content edge function. Two named lineups: TRANSLATION and CONTENT, both = Claude Sonnet 4.5 + Gemini 3.5 Flash tandem. Bump model IDs in one place; never hardcode in feature code.
type: feature
---

## The rule
- Do NOT hardcode model IDs in edge function code. Import from `MODEL_LINEUPS` in `supabase/functions/_shared/modelRegistry.ts`.
- If a model breaks, fix the root cause (credits, routing, prompt). Do NOT silently swap models in individual functions — that creates inconsistency across dialects and hides the underlying issue.
- Claude routes via OpenRouter (`OPENROUTER_API_KEY`). Gemini routes via Lovable Gateway (`LOVABLE_API_KEY`). aiBrain's `routeForModel()` handles this automatically.

## Lineups
- **TRANSLATION**: ensemble of `anthropic/claude-sonnet-4.5` + `google/gemini-3.5-flash`. Used by `translate-phrase`, `falcon-translate`, `analyze-gulf-arabic` (+ qwen3-max as third verifier), and aiBrain purposes `translation` / `phrase_of_the_day` / `sample_sentences` / `vocab_definition`.
- **CONTENT**: draft_critic — Gemini 3.5 Flash drafts, Claude Sonnet 4.5 critiques. Used by aiBrain purposes `story` / `news_summary` / `meme_explain` and by `generate-daily-story`.
- **UTILITY**: solo `google/gemini-3-flash-preview`. Cheap classification/scoring.
- **REASONING**: council of Claude + Gemini 3.5 Flash + Gemini 2.5 Pro. Used by `lesson_generation` / `how_do_i_say`.

## Preserved enrichment chains (do not collapse)
- `analyze-gulf-arabic` keeps **Fanar-Sadiq** (cultural context) + **Fanar-C-2-27B** (dialect validation) calls alongside the translation ensemble.
- `analyze-gulf-arabic` keeps the **Claude Sonnet 4.5 vocab enrichment** pass after translation (line ~1955) — adds cultural/contextual depth on top of base vocab.

## Explicitly out of scope
- `realtime-session-token` (Live Voice / Conversation Simulator) uses the OpenAI Realtime API and must NOT be migrated to this registry.
- ASR (Munsit/Soniox/Fanar/Azure/Deepgram), TTS, and image generation models have their own provider-specific configs.

## Why
User had silent regressions where individual functions were swapped to cheap Gemini fallbacks when OpenRouter ran out of credits. Centralizing in one registry means future upgrades = one-file edit, and credit issues surface as explicit 402 errors instead of degraded output.
