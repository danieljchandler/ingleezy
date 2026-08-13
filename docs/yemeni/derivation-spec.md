# Lisan-Yemeni: derivation spec

**Audience:** whoever runs code where `/mnt/documents/yemeni-corpus/` is mounted
(Lovable). **Purpose:** produce four small artifacts, committed under
`docs/yemeni/`, that let agent sessions work with the corpus.

## Why this exists

Claude Code sessions are ephemeral containers that clone only the git repo.
`/mnt/documents/yemeni-corpus/` does not exist in them — verified: no such path,
`/mnt/attach` and `/mnt/user-data/working` empty, no blob over 2.5 MB in any
branch or in history. **Anything not committed does not reach an agent.**

Today the only readable Lisan data is `docs/yemeni/lisan-yemeni-lexicon.json`:
2,243 unique tokens once the `tokens` and `dialect_specific` lists are deduped
(they overlap by 957).

And one shipped artifact is wrong. `dialect_specific` is documented in
`docs/yemeni/README.md` as "top 1,200 tokens that have **no MSA lemma id** (i.e.
genuinely dialectal forms)" and pointed at as "the highest-signal list for
authoring Yemeni `dialect_rules` rows". Measured:

| Check | Result |
| --- | --- |
| Entries with an MSA lemma populated | 1,188 / 1,200 (**99%**) |
| Entries also in the plain `tokens` list | 957 / 1,200 (**80%**) |
| Highest-count entry | `مِن` — "from", 18,490 |
| 2nd, 3rd | `بَس`, `اللّٰه` |

The `MSALemmaID == 0` filter did not survive derivation; it is a frequency list.
`مِن`, `فِي` and `عَلَى` are the most ordinary MSA prepositions in the language.
Seeding rules from it would assert they are distinctively Yemeni, and if such a
token reached `examples.good` it would be harvested into generator few-shot
blocks by `harvestForbiddenTokens` in `_shared/dialectHelpers.ts`.

**Every artifact below carries self-checks for exactly this class of failure.
Please run them and put the results in `_meta`.** An artifact that fails its own
check is more dangerous than a missing one.

## Source

`Lisan-Yemeni-dataset.csv` — 994,616 annotated tokens:

```
sentenceId, wordPosition, rawToken, Token, POS, Prefixes, Stem, Suffixes,
MSALemma, MSALemmaID, DALemma, DALemmaID, Person, Gender, Number, Gloss
```

`Lisan-Yemeni RowText_sentences.csv` — 38,822 raw sentences.

## Conventions — all four artifacts

- **Group on `Token`, never `rawToken`.** `Token` is the normalised + vocalised
  form; `rawToken` is the noisy as-written original.
- **Emit `token_normalized` on every row.** App data is unvocalised, so nothing
  joins without it. Match `normalizeArabic` in
  `supabase/functions/_shared/msaLeakDetector.ts`: NFC, strip tashkeel
  `[ً-ْٰـ]`, `[إأآٱ] → ا`, `ى → ي`, `ة → ه`.
- **Keep `MSALemma` verbatim.** It carries sense-disambiguation noise (`فِي2`,
  `قال-ُ`, `عفاشي 1`, `ل1`, `هُوَ2`). Leave it in — better visible than silently
  cleaned.
- **Dedupe near-identical tweets before counting.** Retweets inflate frequency.
- **`_meta` on every file:** source filename, rows read, types emitted, cutoff
  applied, generation date, and the self-check results.
- JSON, UTF-8, no BOM. Pretty-print at 1 level; these get read in diffs.

---

## Artifact 1 — `dialect-markers.json`

The corrected version of `dialect_specific`, and the highest-value artifact.

**Filter:** `MSALemmaID` is `0`, empty, `NaN` or null **AND** `count >= 3`.

**Fields:** `token`, `token_normalized`, `count`, `pos`, `gloss`, `da_lemma`.

**Self-check — this is the acceptance gate:**

- `مِن`, `فِي`, `عَلَى`, `اللّٰه` must be **absent**.
- ≥90% of emitted rows must have an empty/zero `MSALemmaID`.
- Report the top 20 by count so the list can be eyeballed.

If the first two fail, the filter didn't apply — that is precisely the bug in
the current file, and it is silent unless checked.

## Artifact 2 — `lexicon-full.json`

**Filter:** all types with `count >= 5` — not just the top 2,000.

**Fields:** `token`, `token_normalized`, `count`, `pos`, `msa_lemma`,
`msa_lemma_id`, `gloss`.

**Self-check:** report type count and `sum(count)` — the latter should approach
994,616. Report counts for `ذحين` and `هني` specifically, including if zero.

*Why:* the top-2k lexicon yields 170 MSA→Yemeni substitution candidates by
clitic-stripped stem divergence (`بس⟵لكن`, `ليش⟵لماذا`, `ايش⟵ماذا`,
`احنا⟵نحن`, `خل⟵دع`, `عشان⟵أجل`). The full type inventory raises that
substantially. `ذحين` and `هني` are called out because both are flagship Yemeni
words in `YEMENI_IDENTITY` (`dialectHelpers.ts:33-36`), the seeded rulebook
(`20260529180101_*.sql:134-137`) and `ALWAYS_ALLOWED.Yemeni`
(`msaLeakDetector.ts:90-101`) — yet neither appears in the top 2,000 attested
types. Worth knowing whether they are genuinely rare or just truncated out.

## Artifact 3 — `affix-inventory.json`

From the `Prefixes` / `Stem` / `Suffixes` columns. Per the Lisan paper, `+`
separates parts and `/` separates the POS labels of affixes.

**Three sections:**

- `prefixes` — pattern, POS label, count, up to 5 example tokens
- `suffixes` — same shape
- `circumfixes` — prefix + suffix **co-occurring on one token**, same shape

**Cutoff:** `count >= 10`.

**Self-check:** `ما` and `لـ` must both appear under `prefixes`; report whether
any circumfix resembling `ما...ش` was found, and its count.

*Why:* this is the **only** route to syntactic rules. The committed lexicon
dropped segmentation entirely, so no grammar rule can be derived from it —
negation, the `لـ` imperative negation the paper singles out as characteristic
of Yemeni (`لتخافون` for MSA `لا تخافوا`), or possessive `حق`. Circumfixes get
their own section because `ما...ش` negation is invisible if prefixes and
suffixes are only counted independently.

## Artifact 4 — `sentences-sample.jsonl`

**~5,000 sentences**, 5–25 tokens each, deduped. One JSON object per line:

```json
{"id": 123, "text": "...", "text_clean": "...", "token_count": 12, "political": false}
```

- `text` — as in the source.
- `text_clean` — URLs, `@mentions` and `#hashtags` stripped.
- `political` — **a flag, not a filter.** Set true if the sentence contains any
  of: `حوثي`, `عفاش`, `مليشيا`, `حرب`, `قتل`, `قصف`, `شهيد`, `إرهاب`, `خيانة`,
  `عسكري`, `جيش`, `تحالف`, `شرعية`, `انتقالي`, `زعيم`, `رئيس`, `وزير`, `حكومة`.
  Match on the normalised form.

**Please flag rather than drop.** The threshold is a judgement that should stay
tunable; dropping bakes it in irreversibly and the excluded sentences can't be
recovered without re-running this.

**Self-check:** report line count, the token-length range, and the share with
`political: true`. Expect roughly 10–15% — political and military terms are 14%
of types and 13% of token mass in the top 200 of the existing lexicon.

*Why:* sentences in context are what `mine-dialect-corpus` needs. Its system
prompt already says *"only generalize what is actually attested"*
(`mine-dialect-corpus/index.ts:357`); a frequency list can only support lexical
rules, never syntactic ones.

---

## Licence

Lisan is CC BY 4.0 — commercial use permitted, attribution required. Check
`license.pdf` and `ReadMe.pdf` in the corpus folder before committing anything
derived. The four artifacts above are deliberately **derived aggregates plus a
bounded sentence sample**, not the corpus, which keeps the redistribution
surface small. Do not commit the full CSVs.

## What this unblocks

Sequenced in `docs/yemeni/lisan-integration-plan.md`; all on hold until these
land. In order: the Yemeni MSA-leak whitelist audit, the `mine-dialect-corpus`
`ReferenceError` fix, MSA→Yemeni substitution pairs seeded as `dialect_rules`
drafts, then grammar rules from Artifact 3 and sentence-level mining from
Artifact 4.
