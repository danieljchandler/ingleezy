# Lisan-Yemeni → app integration: execution plan

Companion to `docs/lisan-yemeni-corpus.md` (why) and `docs/yemeni/README.md`
(what was uploaded). This is the **how** — sequenced, with the blockers stated
first because two of them change what can be built and by whom.

## Blockers

### B1 — the raw corpus is not reachable from agent sandboxes

`docs/yemeni/README.md` states the corpus lives at `/mnt/documents/yemeni-corpus/`
and is "readable by any agent/CLI in this project". That path **does not exist**
in a Claude Code remote session — these containers are ephemeral and clone only
the git repo. Verified: `ls /mnt/documents/yemeni-corpus/` → *No such file or
directory*.

So the only Lisan data an agent can actually read is the committed
`docs/yemeni/lisan-yemeni-lexicon.json` — **2,243 unique tokens** (the `tokens`
and `dialect_specific` lists overlap by 957). Everything downstream of the raw
994,616-token CSV — segmentation, `MSALemmaID`, the 38,822 raw sentences — is
out of reach until one of:

- the derivation is run where the file *is* mounted (Lovable) and the output
  committed, or
- a further derived artifact is committed to the repo, or
- the CSVs are put in a Supabase Storage bucket an edge function can read.

**Every phase below is scoped to work from the committed lexicon alone**, and
each notes what it would gain from the raw CSV.

### B2 — `dialect_specific` does not contain what the README says

The README describes it as "top 1,200 tokens that have **no MSA lemma id**
(i.e. genuinely dialectal forms)" and "the highest-signal list for authoring
Yemeni `dialect_rules` rows". Measured against the committed file:

| Check | Result |
| --- | --- |
| Entries with an MSA lemma populated | **1,188 / 1,200 (99%)** |
| Entries also present in the plain `tokens` list | **957 / 1,200 (80%)** |
| Highest-count entry | `مِن` — "from", 18,490 |
| 2nd, 3rd | `بَس`, `اللّٰه` |

It is a frequency list, not a dialect-marker list. The `MSALemmaID = 0` filter
did not survive whatever produced the JSON. `مِن`, `فِي`, `عَلَى` are the most
ordinary MSA prepositions in the language.

This matters because that list is precisely the one the README points at for
rule authoring. Seeding `dialect_rules` or the MSA-leak allow-list from it would
assert that `مِن` is a distinctively Yemeni form — noise at best, and if it
reached `examples.good` it would be harvested into generator few-shot blocks.

**Do not use `dialect_specific` as-is.** Re-derive it where the raw CSV is
mounted (`MSALemmaID == 0`, `count >= 3`), or use the substitution-pair
derivation in Phase 2, which works from the committed data.

Also note `da` (dialectal lemma) is empty for **97%** of `tokens` and **99%** of
`dialect_specific`, so that field carries almost nothing.

### B3 — `mine-dialect-corpus` cannot return a response

Already documented in `docs/lisan-yemeni-corpus.md`: `json()` at
`supabase/functions/mine-dialect-corpus/index.ts:418-423` is module-scope and
references `corsHeaders`, declared inside the `serve` callback at `:287`.
`_shared/cors.ts` exports only `getCorsHeaders(req)`. Every path throws
`ReferenceError`, including the `catch`. Gates Phase 3.

## What the corpus actually contains

Worth stating before anything is seeded from it. Frequency analysis over the
committed lexicon:

- **It is Yemeni civil-war Twitter.** Political/military terms are **14% of
  types and 13% of token mass in the top 200**, ~10% through the top 1,000.
  The top of the list includes `الحُوثي` (Houthi — 4,230 + 2,767 + 2,053 +
  1,557 + 488 across inflections), `الحَرْب`, `الشَّرْعِيَّة`,
  `الاِنْتِقالِيّ`, `الزَّعِيم`, and `العَفَافِيش` (a political slur, 442).
  The README's warning about this is correct and load-bearing.
- Tokens are **vocalized** (`مِن`, `بَسّ`). Anything joining against app data
  must normalise first — `normalizeArabic` in
  `supabase/functions/_shared/msaLeakDetector.ts` already does the right thing.
- MSA lemmas carry sense-disambiguation noise to strip: `فِي2`, `قال-ُ`,
  `عفاشي 1`, `ل1`, `هُوَ2`.

**Attested Yemeni markers, with counts** — this is the real payload:

| Form | Count | MSA lemma |
| --- | --- | --- |
| بس | 9,883 | لكن |
| مش | 1,137 | مُشْ |
| هٰذِهِ | 1,135 | هٰذا |
| ليش | 786 | لِماذا |
| كيف | 751 | كَيْفَ |
| ايش | 660 | ماذا |
| احنا | 593 | نحن |
| قات | 557 | قََات |
| حق | 358 | حَقّ |
| وين | 243 | أين |
| عاد | 239 | عاد |
| ذا | 196 | ذَا |
| اشتي | 157 | شاءَ |
| زين | 54 | زِينْ |

**Two flagship "Yemeni" words in our current rulebook are absent from the top
2,000: `ذحين` and `هني`.** Both appear in `ALWAYS_ALLOWED.Yemeni`
(`msaLeakDetector.ts:90-101`), in the seeded `dialect_rules` vocabulary row
(`20260529180101_*.sql:134-137`), and in `YEMENI_IDENTITY`
(`dialectHelpers.ts:33-36`). This is evidence worth acting on but not proof —
the lexicon is truncated at 2,000 types and the register is written social
media. Flag for native-speaker review; do not delete on this basis alone.

## Phase 1 — MSA-leak whitelist for Yemeni

**Unblocked. Smallest change, largest immediate return. Start here.**

`msaLeakDetector.ts:73-79` records that the Gulf whitelist was audited in
2026-08 and "Yemeni is untouched pending the same review". The consequence is
spelled out in that same comment for Gulf: every generated passage tripped the
detector and bought a rewrite pass that could never clear it, because the model
kept writing words that were never wrong. Yemeni is still paying it — and
`هٰذِهِ` is the 3rd-most-frequent divergent form in the corpus at 1,135.

Changes:

1. `supabase/functions/_shared/msaLeakDetector.ts` — add `هذا`, `هذه`, `عندما`
   to `ALWAYS_ALLOWED.Yemeni`, matching what Gulf already has, plus the attested
   forms above not yet present (`مش`, `ايش`, `حق`, `عاد`, `ذا`, `بس`).
2. `src/pages/admin/AdminDialectRules.tsx:55-59` — the client mirror
   `ADMIN_ALWAYS_ALLOWED.Yemeni` must move in step; it is a hand-maintained copy
   and drifting it silently changes what admins are warned about.
3. `src/test/msaLeakDetector.test.ts` — extend with Yemeni cases asserting the
   attested forms do not leak. There is precedent: the existing suite already
   pins detector behaviour.

Add a dated comment in the same style as the 2026-06 and 2026-08 entries,
citing corpus counts as the evidence — the file's history of documenting *why*
a token was added or removed is the reason this audit is tractable at all.

## Phase 2 — MSA→Yemeni substitution pairs into `dialect_rules`

**Unblocked**, derivable from the committed lexicon.

The derivation that works: normalise both `token` and `msa`, strip the definite
article and conjunction/preposition proclitics and pronoun enclitics from each,
then keep pairs whose stems still differ. Naive surface comparison does **not**
work — it is swamped by inflection (`فِيها`→`فِي`, `اليَمَن`→`يَمَن`).

Yield from the committed 2,243 tokens: **170 candidates**, roughly half genuine.
Real pairs at the top:

```
بس    ⟵ لكن      ليش   ⟵ لماذا     ايش  ⟵ ماذا
احنا  ⟵ نحن      عيال  ⟵ طفل       خل   ⟵ دع
وين   ⟵ أين      عشان  ⟵ أجل       وبعدين ⟵ بعدين
```

Residual noise is inflectional (`منهم`, `وفي`, `كلهم`, `ايام`). So this is a
**candidate generator feeding human approval, not an automatic writer** — which
is exactly the shape the app already has.

Implementation:

- A derivation script under `scripts/` (the directory currently holds only
  `lint-ratchet.mjs`) reading `docs/yemeni/lisan-yemeni-lexicon.json` and
  emitting candidate pairs. Reuse `normalizeArabic` rather than reimplementing
  Arabic normalisation.
- Emit a migration seeding `dialect_rules` with `dialect='Yemeni'`,
  `source='corpus_mined'`, **`status='draft'`**, `category='msa_substitutions'`,
  and `examples: {good: [Yemeni], bad: [MSA]}`. Draft status is the established
  cold-start pattern — see `20260723020000_starter_set_phrases.sql`.
- Admins approve through the existing Dialect Rulebook UI. On approval the rules
  flow to every generator automatically via `dialectHelpers.ts` (`fetchRules` →
  `renderPrompt` → `getDialectVocabRules` / `getDialectFewShot`), and the MSA
  side is harvested into forbidden tokens by `harvestForbiddenTokens`.

**Sequencing note:** Phase 1 must land first. `harvestForbiddenTokens`
(`dialectHelpers.ts:157-176`) drops any bad-example token that is in
`ALWAYS_ALLOWED`, so the whitelist is what stops a seeded MSA example from
poisoning the detector.

The same pairs also populate `msa_transformation_rules` for Bridge mode
(`src/hooks/useMsaRules.ts`) — the columns line up directly (`msa_pattern`,
`dialect_pattern`, `example_msa`, `example_dialect`).

## Phase 3 — repair and ground `mine-dialect-corpus`

1. **Fix B3.** Thread `corsHeaders` explicitly, as
   `draft-dialect-rules/index.ts:126` already does. Under an hour, and it should
   land on its own merits regardless of this project — the function is dead code
   in production today.
2. Add the lexicon as a corpus source. `buildCorpus()` normalises everything to
   `{source, text}` and the prompt builder already caps at ~12k chars
   (`:246-255`), so a `lisan_lexicon` source slots in without touching the
   council call, the `emit_corpus_rules` tool, or the write path.

**With the raw CSV (B1)** this phase gets much stronger: the 38,822 raw
sentences are real attested Yemeni *in context*, which is what the miner's
system prompt — *"only generalize what is actually attested"* (`:357`) — has
been asking for and not receiving. A frequency list supports lexical rules; only
sentences support syntactic ones. Filter political content before sampling.

## Phase 4 — vocabulary seeding

**Do not drive this off raw frequency.** Two independent reasons: 10–14% of the
top of the list is war and factional politics, and Twitter frequency is not
pedagogical frequency — the head of the distribution is function words, place
names and current events.

If pursued: filter by POS (the lexicon tags `اسم` / `فعل ماضي` / `فعل مضارع` /
`صفة`, ~1,500 of 2,243), exclude `اسم علم` (proper nouns, 183) and a political
stop-list, then have the Brain rank the remainder for learner utility rather
than trusting counts. Seed `vocabulary_words` as drafts behind admin review.

Note the cost tail: `vocabulary_words.audio_url` is central to the flashcard
experience and the corpus has **no audio**, so every seeded row needs TTS —
which for Yemeni means the two Azure voices (`ar-YE-MaryamNeural`,
`ar-YE-SalehNeural`) that `_shared/listenTts.ts:140-145` falls through to.

## Phase 5 — queryable lexicon for generators

**Defer; revisit after Phase 3.** The prompt budget is already contested and
1M tokens cannot be injected wholesale — only a curated slice, which is the same
curation problem as Phase 4. And there is a cautionary precedent in-repo:
`msa_transformation_rules` is a well-formed reference table read client-side by
`useMsaRules.ts` and injected into **no generator at all**. If Phase 2's rules
land in `dialect_rules`, generators already get the benefit through the existing
rulebook path — which is the cheaper route to the same outcome.

## Status

| # | Work | State |
| --- | --- | --- |
| 1 | Yemeni MSA-leak whitelist + tests | **Done** |
| 2 | Fix `mine-dialect-corpus` cors bug | **Done** |
| 3 | Substitution pairs → `dialect_rules` drafts | **Done** — 7 rows, all `status='draft'` |
| 4 | Re-derive artifacts correctly | **Done** — all four, self-checks passing |
| 5 | Sentences as a miner source | **Pool + vetting built; not yet enabled** — see below |
| 6 | Vocabulary seeding | Not started — needs curation + TTS |
| 7 | Generator lexicon injection | Revisit after 5 |

### Why 5 is held

The sample cannot be cleaned by keyword filtering, and mined rules quote the
corpus *verbatim* into `dialect_rules.examples`, which `dialectHelpers` folds
into every generator prompt.

| Filter | Sentences |
| --- | --- |
| Total | 5,000 |
| `political: false` (the shipped 18-term stop-list) | 2,139 |
| …of those, hitting an extended slur/faction list | **822 (38%)** |
| …after also dropping `?`-artifacts and Latin runs | 1,039 |

Hand-reading ten of those 1,039 survivors still turns up the factional slur
`العفافيش` — missed because the stop-list carries `عفاش`, which is not a
substring of it — plus sectarian terms, obscenity and a drug reference. Each
round of stop-list widening returns less against a corpus that is ~57%
political by the derivation's own measure.

What shipped instead is the **output** guard: `_shared/corpusExampleGuard.ts`
caps what any mined rule may quote (short patterns, never sentences) and
screens the citations. That was worth doing on its own merits — the miner could
always quote an arbitrary span of any of its six existing sources into a rule
reaching every generator prompt, for all three dialects. The corpus work only
exposed it.

The unlock for 5 is a cleaner pool, which needs a model pass rather than more
stop-list terms. That now runs **inside the app**, which beats an offline script
because the verdicts are auditable in the DB, the run is resumable, and the
rubric can be changed and re-run:

- `20260804130000_dialect_corpus_sentences.sql` — the pool. `vetted` is
  three-state and defaults to NULL; `buildCorpus` reads `vetted = true`, so
  seeding changes no generated content by itself. No `anon` grant.
- `20260804140000_seed_yemeni_corpus_sentences.sql` — all 5,000 sentences,
  generated by `scripts/generate-corpus-seed.py`. All 5,000, not the
  keyword-filtered 1,039: pre-filtering the pool would hard-code the very
  stop-list this section says is unreliable. 76% arrive `keyword_flagged`, which
  is a **cost hint, not a gate** — `includeFlagged: true` re-judges them and
  recovers the pre-pass's false positives.
- `vet-corpus-sentences` — admin-only, batched, resumable. Uses the Brain's
  cheap path (`purpose: 'utility'` → solo, `skipRepair`, `GEMINI_FAST`), the
  same shape as `import-authentic-story`. Fail-closed: `_shared/corpusVettingCore.ts`
  rejects anything short of an affirmative `ok === true`, so a truncated
  response, a hallucinated index or a repeated one cannot produce a pass.

**Step 4 is deliberately not done.** `buildCorpus` still has no seventh source.
Run the vetting, read a sample of what it accepted — an LLM pass beats keywords
comfortably but "comfortably" on a 57%-political corpus still warrants reading
~50 of its accepts — and only then point the miner at `vetted = true`.

Note also that the highest-value syntactic result so far — the 39:1 `ما` vs
`ما...ش` ratio — came from `affix-inventory.json`, a derived aggregate with no
verbatim-text risk at all. Aggregates may simply be the better route.

## Verification

- **Phase 1:** `npm test` — extend `src/test/msaLeakDetector.test.ts` with
  Yemeni cases; assert attested forms return no leaks and that genuine Egyptian
  intrusions (`دلوقتي`, `عايز`) still do. Confirm the client mirror matches the
  runtime set.
- **Phase 2:** apply the migration locally; confirm rows land as `status='draft'`
  and are invisible to generators until approved. Then approve one and assert
  `getDialectVocabRules('Yemeni')` picks it up after cache TTL.
- **Phase 3:** invoke `mine-dialect-corpus` as an admin and confirm it returns
  JSON rather than a 500 — today it cannot.
- Throughout: `npm run lint:ratchet` and `npm run build`, per CI.
