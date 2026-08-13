# Yemeni dialect corpus (Lisan-Yemeni)

Source: Lisan-Yemeni annotated corpus, **CC BY 4.0** (commercial use permitted,
attribution required). See `license.pdf` / `ReadMe.pdf` in the corpus folder.
Only derived aggregates and a bounded sentence sample are committed — never the
full CSVs.

## Where the raw corpus lives

~142 MB, intentionally **not** committed:

```
/mnt/documents/yemeni-corpus/
  Lisan-Yemeni-dataset.csv            # 994,413 annotated tokens
  Lisan-Yemeni RowText_sentences.csv  # 38,822 raw sentences
  tagset_translation.xlsx, ReadMe.pdf, license.pdf
```

That path exists **only in Lovable agent sessions**. Claude Code and CI clone the
git repo alone, so anything an external agent needs must be a committed artifact
in this folder.

## Committed artifacts (spec: `derivation-spec.md`)

All produced in one deterministic pass by `scripts/derive-yemeni-artifacts.py`,
which exits non-zero if any self-check regresses. Every file carries `_meta`
with source, rows read, types emitted, cutoff, generation date and its
self-check results.

| File | Contents |
| --- | --- |
| `dialect-markers.json` | 5,069 Yemeni dialect markers. Filter: `MSALemmaID` zero/empty in ≥90% of occurrences **and** `count >= 3`, minus the MSA closed-class stoplist and proper nouns. Fields: `token`, `token_normalized`, `count`, `pos`, `gloss`, `da_lemma`, `msa_lemma_id_zero_ratio`. |
| `lexicon-full.json` | 20,035 types with `count >= 5` (not truncated to 2k). Fields: `token`, `token_normalized`, `count`, `pos`, `msa_lemma` (verbatim, sense noise kept), `msa_lemma_id`, `gloss`. `sum(count)` = 801,443. |
| `affix-inventory.json` | `prefixes` (254), `suffixes` (600) and `circumfixes` (870) at `count >= 10`, each with pattern, POS label, count and up to 5 example tokens. The only route to syntactic rules. |
| `sentences-sample.jsonl` | 5,000 deduped sentences, 5–25 tokens, one JSON object per line: `id`, `text`, `text_clean` (URLs/@mentions/#hashtags stripped), `token_count`, `political`. |
| `derivation-report.json` | Stats + all self-check results for the committed cut. |

Superseded and removed: `lisan-yemeni-lexicon.json`,
`lisan-yemeni-dialect-specific.json`, `lisan-yemeni-msa-pairs.json`,
`lisan-yemeni-allowlist.json`.

The last two were removed rather than kept for reference. `…-allowlist.json`
was "every form attested in the corpus", which is not the same thing as "every
form acceptable in Yemeni learner content" — it contained 17 of the 18
`UNIVERSAL_MSA_LEAKS` (`الذي`, `سوف`, `ليس`, `لماذا`…) plus `دلوقتي`, `كده` and
`هالحين`, because Yemeni Twitter code-switches into MSA and borrows from
Egyptian media. Feeding it into `ALWAYS_ALLOWED.Yemeni` as the old step 5 here
advised would have switched the MSA-leak detector off for Yemeni almost
entirely. `…-msa-pairs.json` labelled hollow-verb conjugation (`يقول ⟵ قال`,
`يكون ⟵ كان`) as lexical substitution, which would have seeded tense changes
into the rulebook as dialect rules.

## Normalization

`token_normalized` matches `normalizeArabic` in
`supabase/functions/_shared/msaLeakDetector.ts`: NFC, strip tashkeel
`[\u064B-\u0652\u0670\u0640]`, `[إأآٱ] → ا`, `ى → ي`, `ة → ه`. App data is
unvocalised, so nothing joins without it. Grouping is always on `Token`
(normalised + vocalised), never `rawToken`.

Near-identical tweets are deduped on the whole normalized token sequence before
counting (1,099 duplicate sentences dropped, 924,315 of 994,413 rows counted;
the rest are non-Arabic / single-char / `SPELL`+`SPLIT` annotation rows).

## Why the old `dialect_specific` list was wrong

It was documented as "tokens with no MSA lemma id" and was in practice a
frequency list topped by `مِن`. The zero filter *did* apply — it is the wrong
filter on its own: annotators assign `MSALemmaID` only to **open-class** words,
so every function word, including plain MSA `من`, `في`, `ما`, scores 0. The
current derivation keeps the zero-ratio filter **and** subtracts an explicit MSA
closed-class stoplist (auto-expanded with `و`/`ف` variants and
preposition+pronoun clitics) plus proper nouns. `msa_lemma_id_zero_ratio` stays
on every row so a consumer can re-check the claim.

## Self-check results for this cut

All pass; see `derivation-report.json`.

- `مِن`, `فِي`, `عَلَى`, `اللّٰه` absent from `dialect-markers.json`
- 5,069/5,069 marker rows at zero-ratio ≥ 0.9; no proper nouns
- Lexicon: 20,035 types, `sum(count)` 801,443
- Flagship probe: `ذحين` = 9, `هني` = 8 — both **genuinely rare** in the corpus,
  not truncated out. They are asserted as flagship Yemeni forms in
  `YEMENI_IDENTITY` (`dialectHelpers.ts`), the seeded rulebook and
  `ALWAYS_ALLOWED.Yemeni`; the corpus barely supports that weighting.
- Prefixes contain both `ما` and `لـ`
- `ما...ش` circumfix: found, 2 patterns / 122 tokens (`مافيش`, `ماكانش`, `ماـهوش`)
- Sentence sample: 5,000 lines, token range 5–25

## Political content

`political` is a **flag, not a filter** — the threshold stays tunable. Share in
the sample: **57%**, far above the 10–15% the spec expected. The corpus is
scraped political social media (`الحوثي`, `دحباشي`, `الشمال` rank inside the top
20 markers). The sample is taken with an even stride across the whole file, not
the head, so this is the corpus rate rather than an ordering artifact. Filter
hard before showing anything to learners, and never ship the political
vocabulary into lessons.

## Top 20 markers (eyeball check)

`بس، الحوثي، اللي، هه، مش، دحباشي، حوثي، عشان، ده، اكثر، اهل، العرب، احد، حق،
العالم، شوي، لما، الشمال، مالك، مو`

## How to use the artifacts

1. Mine `dialect-markers.json` for negation, demonstrative, interrogative and
   vocabulary rules; add them to `dialect_rules` (`dialect = 'Yemeni'`) with
   ✅/❌ examples. Skip political tokens.
2. Derive MSA→Yemeni substitution candidates with
   `scripts/derive-yemeni-rule-candidates.py`, which writes
   `rule-candidates.json`. It is closed-class only, never proposes a form that
   is itself MSA, and flags Egyptian code-switches rather than proposing them —
   see the module docstring for why each of those exists. The curated result is
   seeded by `supabase/migrations/20260804120000_yemeni_corpus_rule_drafts.sql`.

   If you widen it to content words, triage before seeding: Arabic broken
   plurals change the internal vowel pattern (`فانوس → الفوانيس`) and hollow
   verbs shift their surface consonants (`قال → يقول`, `كان → يكون`), so stem
   comparison reads both as lexical substitution and would seed "use يقول
   instead of قال" — a tense change, not a dialect rule.
3. Use `affix-inventory.json` for grammar rules: `ما...ش` negation, the `لـ`
   imperative negation the paper singles out for Yemeni (`لتخافون` for MSA
   `لا تخافوا`), possessive `حق`.
4. Feed `sentences-sample.jsonl` into `mine-dialect-corpus` for attested
   sentence-level generalization.
5. For `ALWAYS_ALLOWED.Yemeni` in
   `supabase/functions/_shared/msaLeakDetector.ts`, never whitelist a form just
   because the corpus attests it. The test applied in the 2026-08 audit: compare
   the MSA form against its dialectal alternative and whitelist only where the
   MSA form genuinely dominates (`هذا` 3,615 vs `ذا` 218 → whitelist;
   `الذي` 2,259 vs `اللي` 4,406 → keep flagged, steering the model toward `اللي`
   is the detector working). Mirror any change into `ADMIN_ALWAYS_ALLOWED` in
   `src/pages/admin/AdminDialectRules.tsx` — `src/test/msaLeakDetector.test.ts`
   fails if the two drift.

## Regenerating

```
python3 scripts/derive-yemeni-artifacts.py   # repo root, Lovable session only
```

Deterministic: same CSVs in, same JSON out. Non-zero exit means a self-check
failed — fix the derivation, never commit a failing cut.
