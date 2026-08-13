import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getEnglishIdentity,
  getInterferenceGuidance,
  getInterferenceRulesCount,
  getTransferPatterns,
  primeEnglishPrompt,
} from "../_shared/englishHelpers.ts";

/**
 * englishHelpers — the English-target mirror of dialectHelpers, backing the
 * Brain's `target: 'english'` mode.
 *
 * The rendering and harvesting logic is pure and lives in
 * englishPromptCore.ts, tested from Vitest (transferErrorDetector.test.ts).
 * What that suite cannot exercise is this module's cache lifecycle, because
 * it reads `Deno.env` at call time: the contract that a cold cache (no
 * SUPABASE_URL, or a prime that never ran) serves the hardcoded fallback
 * rulebook rather than nothing. An English-target generation with an empty
 * interference block would silently produce generic ESL content — the exact
 * L1-blindness this app exists to avoid — so the fallback path is the part
 * worth pinning here.
 */

Deno.test("cold cache serves the fallback interference guidance, not nothing", () => {
  const guidance = getInterferenceGuidance("Gulf");
  assertStringIncludes(guidance, "COMMON ARABIC-SPEAKER ERRORS");
  // A canonical pair from the fallback rulebook proves real rules rendered.
  assertStringIncludes(guidance, "I am a student");
});

Deno.test("cold cache serves built-in transfer patterns", () => {
  const patterns = getTransferPatterns("Egyptian");
  assert(patterns.length > 0);
  assert(patterns.some((p) => p.pattern === "open the light"));
});

Deno.test("rules count reads 0 on a cold cache (fallback is not the rulebook)", () => {
  assertEquals(getInterferenceRulesCount("Yemeni"), 0);
});

Deno.test("identity block is CEFR-aware and dialect-independent", () => {
  assertStringIncludes(getEnglishIdentity("A1"), "CEFR A1");
  const noLevel = getEnglishIdentity();
  assertStringIncludes(noLevel, "natural, contemporary, SPOKEN English");
});

Deno.test("primeEnglishPrompt without Supabase env is a silent no-op", async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  try {
    await primeEnglishPrompt("Gulf");
    // Still on fallbacks afterwards — the failed prime must not poison the getters.
    assertStringIncludes(getInterferenceGuidance("Gulf"), "COMMON ARABIC-SPEAKER ERRORS");
  } finally {
    if (url !== undefined) Deno.env.set("SUPABASE_URL", url);
    if (key !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key);
  }
});
