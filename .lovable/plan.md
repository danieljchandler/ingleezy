# Make the Lisan-derived Yemeni rules live

## Review result first

I checked the repo against GitHub: `origin/main` is at the same commit as this project (`3a6c7410`), and the working tree is clean. **No Claude Code commits have landed** — nothing new to review on the code side. If they were pushed to a different branch or a PR that isn't merged, tell me the branch name and I'll review it.

What I did find in the backend:

- The 7 Yemeni rules derived from the Lisan corpus are still `draft`, so they are invisible to generation: the prompt builder only loads rules with status `approved`.
- All 5,000 seeded Lisan sentences are still unvetted, so no corpus few-shot examples are in play either.
- Separately, 7 older `ai_generated` Yemeni drafts contain wrong dialect claims — `زول` for "man" (Sudanese), `قوي/خالص` for "very" (Egyptian), `هني/هانا` for "here". These should not be approved.

## What this change does

1. Promote the 7 corpus-mined Yemeni rules to `approved` (negation with ما and no ...ش circumfix, اللي as universal relative, وين/ليش/أيش/منو interrogatives, مش/مو instead of ليس, الحين/ذلحين for "now", انتو for 2pl, ذول/هذول for plural demonstratives). Each has clean good/bad examples already and priorities 3–5.
2. Retire the 7 questionable `ai_generated` Yemeni drafts so they can never be approved by accident, with a note explaining why (cross-dialect contamination).
3. Verify the effect end to end: generate a Yemeni reading passage and a Yemeni story after the rule cache expires, and confirm the approved rules appear in the injected prompt and that MSA forms (الذي، أين، ليس، الآن) no longer surface.

No schema changes and no code changes are needed — approval is a data update, and the prompt builder plus MSA leak detector already read from `dialect_rules`.

## Technical notes

- Data update on `public.dialect_rules`: set `status = 'approved'`, `approved_at = now()` for `dialect = 'Yemeni' AND source = 'corpus_mined'`; set `status = 'retired'` plus a `notes` line for the 7 `ai_generated` drafts.
- `_shared/dialectHelpers.ts` caches the rendered prompt per dialect with a TTL, so newly approved rules take effect on the next cache refresh — no redeploy required, though I can redeploy `reading-passage` to force an immediate cold cache for verification.
- The corpus few-shot path (vetting the 5,000 sentences, wiring `dialect_corpus_sentences` into `mine-dialect-corpus`) is deliberately out of scope here and can be a follow-up.
