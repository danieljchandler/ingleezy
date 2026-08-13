// Shared English-target helpers for edge functions — the mirror image of
// dialectHelpers.ts.
//
// Rules live in the `interference_rules` Postgres table (the L1-Interference
// Rulebook): the documented ways Arabic speakers' L1 shapes their English.
// At runtime we load approved rules into an in-memory cache (5 min TTL,
// same lifecycle as the dialect cache) and expose:
//   - English identity prompt block (natural spoken English, CEFR-aware)
//   - interference guidance block ("teach against these" bullet lines)
//   - transfer patterns (lexically matchable bad examples, for the
//     transferErrorDetector)
//
// Call `primeEnglishPrompt(dialect)` at the top of an English-target edge
// function to warm the cache. All sync getters fall back to the hardcoded
// FALLBACK_INTERFERENCE_RULES on cache miss.
//
// `dialect` here is the learner's NATIVE dialect (their L1), used to select
// dialect-scoped rules (rows with matching `dialect`) alongside the
// universal ones (rows with NULL dialect) — not a generation target.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { Dialect } from './dialectTypes.ts';
import {
  FALLBACK_INTERFERENCE_RULES,
  harvestTransferPatterns,
  renderEnglishIdentity,
  renderInterferenceGuidance,
  type InterferenceRule,
  type TransferPattern,
} from './englishPromptCore.ts';

interface RenderedEnglishPrompt {
  guidance: string;
  transferPatterns: TransferPattern[];
  rulesCount: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, RenderedEnglishPrompt>();
const inflight = new Map<string, Promise<void>>();

async function fetchRules(dialect: Dialect): Promise<InterferenceRule[]> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return [];
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('interference_rules')
    .select('id, dialect, category, rule, explanation_ar, examples, priority')
    .eq('status', 'approved')
    .or(`dialect.is.null,dialect.eq.${dialect}`)
    .order('priority', { ascending: false })
    .order('category');
  if (error || !data) return [];
  return data as InterferenceRule[];
}

export async function primeEnglishPrompt(dialect: Dialect): Promise<void> {
  const existing = cache.get(dialect);
  if (existing && existing.expiresAt > Date.now()) return;
  const pending = inflight.get(dialect);
  if (pending) return pending;
  const p = (async () => {
    try {
      const rules = await fetchRules(dialect);
      if (rules.length) {
        cache.set(dialect, {
          guidance: renderInterferenceGuidance(rules),
          transferPatterns: harvestTransferPatterns(rules),
          rulesCount: rules.length,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }
    } catch (e) {
      console.warn('[englishHelpers] primeEnglishPrompt failed', dialect, e);
    } finally {
      inflight.delete(dialect);
    }
  })();
  inflight.set(dialect, p);
  return p;
}

// =================== Public sync API ===================

export function getEnglishIdentity(cefr?: string): string {
  return renderEnglishIdentity(cefr);
}

export function getInterferenceGuidance(dialect: Dialect): string {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) return c.guidance;
  return renderInterferenceGuidance(FALLBACK_INTERFERENCE_RULES);
}

export function getTransferPatterns(dialect: Dialect): TransferPattern[] {
  const c = cache.get(dialect);
  if (c && c.expiresAt > Date.now()) return c.transferPatterns;
  return harvestTransferPatterns(FALLBACK_INTERFERENCE_RULES);
}

export function getInterferenceRulesCount(dialect: Dialect): number {
  const c = cache.get(dialect);
  return c && c.expiresAt > Date.now() ? c.rulesCount : 0;
}
