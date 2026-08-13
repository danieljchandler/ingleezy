# Lisan Yemeni corpus — feasibility evaluation

Status: **evaluation only.** Nothing in this document has been implemented.
It exists to answer one question: is the Lisan Yemeni corpus worth pulling into
Hakiya, and if so, for what.

## Why we went looking

Hakiya ships three dialects, and Yemeni is by a wide margin the thinnest. The
reason is structural, not cosmetic.

Every generator gets its dialect instructions from the `dialect_rules` table via
`supabase/functions/_shared/dialectHelpers.ts` (`fetchRules` → `renderPrompt` →
cached sync getters, falling back to hard-coded strings on cache miss). Rules
reach that table from two edge functions:

- `draft-dialect-rules` — ungrounded. The council invents rules and writes them
  with `source: 'ai_generated'`.
- `mine-dialect-corpus` — grounded, but grounded in *ourselves*. Its
  `buildCorpus()` samples published Arabic from `discover_videos`,
  `interactive_stories`, `conversation_scenarios`, `daily_challenges`,
  `meme_posts` and `listening_exercises`
  (`supabase/functions/mine-dialect-corpus/index.ts:136-215`).

For Yemeni, that published content is almost entirely AI-generated. So the
"corpus miner" is largely reading back the model's own output and promoting it
to a rule that will condition the next generation. It is a closed loop with no
external input.

It is worse for Yemeni than for the other two dialects, because the miner's
largest source is empty. `discover-trending-videos/index.ts:6` searches
`GULF_REGIONS = ['SA','AE','KW','QA','BH','OM']` with Khaleeji-targeted queries
(`سعودي`, `إماراتي`, `كويتي`, `خليجي`). There is no `YE` region set and no
Yemeni query list, so every Yemeni row in `discover_videos` has to be added by
hand through `AdminVideoForm`.

Meanwhile the one place in the repo with real Yemeni depth is a hard-coded
string: `YEMENI_FLAVOR` at
`supabase/functions/generate-listen-script/index.ts:99-109`. It carries genuine
morphosyntax — possessive حَقّ/حَقَّة, أَيْش/إِيش for "what", ذَا/ذِي, the
absence of the بـ present prefix, عَاد as a discourse marker — and it is used by
exactly one function (`:124`). Nothing comparable reaches `reading-passage`,
`generate-story`, `free-chat`, `conversation-practice` or `daily-challenge`,
which get a one-line cultural string at best.

The gap is external Yemeni source material. Lisan is the most plausible fix
available.

## What Lisan is

Jarrar, Zaraket, Hammouda, Alavi and Wählisch (2022), *Līsān: Yemeni, Iraqi,
Libyan, and Sudanese Arabic Dialect Corpora with Morphological Annotations*
(arXiv 2212.06468, IEEE 10479250).

| Corpus | Tokens | Documents |
| --- | --- | --- |
| **Yemeni** | **1,098,222** | **38,819 tweets** |
| Iraqi | 45,881 | 3,326 threads |
| Libyan | 51,686 | 3,053 threads |
| Sudanese | 52,616 | 3,000 threads |

The Yemeni portion is ~22× the size of the other three combined and is the
reason this is worth evaluating at all. It was collected automatically from
Twitter and filtered with a seed list of distinctive colloquial Yemeni words.
The other three were collected by hand from Facebook and YouTube.

Annotation was done by 35 native speakers of the target dialects using ADAT
(the authors' annotation toolkit), against the LDC SAMA/BAMA tagset for
compatibility with Curras (Palestinian), Baladi (Lebanese) and Gumar (Emirati).

**No sub-dialect was preferred.** The paper is explicit that the aim was a
general corpus per dialect, so Sana'ani, Ta'izzi, Adeni and Hadrami material is
mixed together and unlabelled.

### The annotation schema

Each token is the tuple:

```
⟨ rawToken, Token, Prefixes, Stem, Suffixes, POS, Lemma, Gloss ⟩
```

- `rawToken` — the word exactly as it appeared in the tweet.
- `Token` — a **normalisation** of `rawToken`: typos corrected, letters repeated
  more than twice collapsed (`يسسسسس` → `يسس`), rare spellings regularised. The
  authors deliberately rejected CODA-style re-spelling, having found it did not
  scale across 35 annotators.
- `Prefixes` / `Stem` / `Suffixes` — the segmentation. Parts are joined with
  `+`, and the POS labels of affixes are separated with `/`.
- `POS` — SAMA tagset, applied to the stem.
- `Lemma` — **linked to an MSA lemma.**
- `Gloss` — English.

Three of these matter disproportionately for this app:

- `rawToken` + `Token` together are a **direct record of orthographic
  variation** — ذحين / ذلحين, اشتي / أشتي — which is precisely what the MSA-leak
  detector's `normalizeArabic` is guessing at today.
- The **MSA lemma link** is the dialect↔MSA pairing that `msa_transformation_rules`
  and every `msa_substitutions` rule in `dialect_rules` currently derive by
  prompting a model.
- Affix segmentation captures the concatenated functional words the paper
  singles out for Yemeni — e.g. the `لـ` prefix negating the imperative in
  `لتخافون` (short for MSA `لا تخافوا`) — which is exactly the class of pattern
  a rule-mining pass should be finding.

## Licence and access

**CC BY 4.0.** Commercial use is permitted; attribution is required.

Access is gated: `sina.birzeit.edu/currasat` requires a Google Form submission
before download links are released. There is no direct file link, no HuggingFace
mirror, and the SinaLab HuggingFace org does not host it.

Two obligations follow:

1. An attribution line wherever derived content ships to learners.
2. A judgement call about redistribution. The source is Twitter, so committing
   raw tweet text into this repo is the least attractive option on both licence
   and privacy grounds.

The recommended shape is to derive a **lexicon** — types, lemmas, POS, glosses,
frequencies — and keep the tweet corpus itself out of version control. That
sidesteps most of the redistribution question and is also the only form small
enough to be useful at prompt time.

### Note on the distributed file format

The paper documents the annotation *schema* precisely and the on-disk *format*
not at all. Neither the Currasat pages nor any secondary source resolves whether
it ships as CSV, TSV, XML or JSON. **Any importer has to begin with an
inspection step**; do not design one against an assumed layout.

### Getting the data in

The file is large enough that the repo is the wrong home for it regardless of
licence. Two workable routes:

- Upload to a Supabase Storage bucket and parse it from an admin-triggered edge
  function, matching how `import-authentic-story` already handles
  admin-supplied source text.
- Load it through Lovable into a staging table and derive the lexicon in SQL.

Either way the artefact that should end up in Postgres is the derived lexicon,
not the tweets.

## What we could do with it

Four applications, ranked by leverage against effort.

### 1. Fix the MSA-leak whitelist — smallest change, immediate payoff

`msaLeakDetector.ts:73-79` carries an admission in a comment:

> Confirmed as acceptable Gulf 2026-08. Egyptian keeps them flagged (ده/دي is
> the norm there); **Yemeni is untouched pending the same review.**

So `هذا`, `هذه` and `عندما` are absent from `ALWAYS_ALLOWED.Yemeni`
(`msaLeakDetector.ts:90-101`) while being present for Gulf. The consequence is
documented in the same comment for the Gulf case: every generated passage
tripped the detector and paid for a rewrite pass that could never clear it,
because the model kept writing words that were never actually wrong. Yemeni is
still paying that cost.

A frequency table over 1.1M attested Yemeni tokens is exactly the evidence
needed to settle which forms belong on that whitelist, rather than settling it
by intuition a third time.

Two things to keep in step: the whitelist is duplicated client-side as
`ADMIN_ALWAYS_ALLOWED` at `src/pages/admin/AdminDialectRules.tsx:55-59`, and
`DIALECT_EXTRA.Yemeni` (`msaLeakDetector.ts:56`) has already had one round of
corrections — `شلون/وش/زين/أبي/شفيك/يبغى/أبغى/لاحين` were removed in 2026-06
after being wrongly flagged.

This one is worth doing on its own merits and does **not** have to wait for the
corpus, though the corpus would make it evidence-based rather than a judgement
call.

### 2. Ground dialect-rule mining — highest leverage

Add Lisan as a source inside `buildCorpus()`. The function already normalises
everything to `{source, text}` snippets, already dedupes, and already caps the
prompt at ~12k chars (`mine-dialect-corpus/index.ts:246-255`), so a new source
slots in without touching the council call, the `emit_corpus_rules` tool schema,
or the `source: 'corpus_mined'` write path.

This is the highest-leverage option because `dialect_rules` fans out to every
generator through `dialectHelpers.ts` — identity block, vocab rules, few-shot
✅/❌ pairs, and the forbidden-token list harvested from `examples.bad`. One good
rule improves every Yemeni generation at once.

It also breaks the closed loop described at the top: the miner's system prompt
already says *"only generalize what is actually attested"*
(`mine-dialect-corpus/index.ts:357`), which is currently true of the prompt and
false of the data.

**Prerequisite — this function does not currently run.** See "Blocker" below.

### 3. Seed Yemeni vocabulary

Frequency-ranked lemma + gloss + POS rows map cleanly onto `vocabulary_words`
(`word_arabic`, `word_english`, `transliteration`, `dialect_module`), behind an
admin review queue. The precedent is the cold-start seeding in
`supabase/migrations/20260723020000_starter_set_phrases.sql`, which inserts rows
as `status='draft'` so they stay invisible until an admin publishes them.

Two honest caveats:

- Twitter frequency is not pedagogical frequency. The top of a social-media
  frequency list is function words, platform noise and current events, not an
  A1 syllabus.
- **There is no audio.** `vocabulary_words.audio_url` is central to the
  flashcard experience, so every seeded row needs TTS generated — which for
  Yemeni means the two Azure voices discussed below.

### 4. Queryable lexicon for generators — do this last

A new reference table injected into generator prompts, following the established
rulebook→prompt pattern in `dialectHelpers.ts`.

Two reasons to rank it last. First, the prompt budget is already contested, and
a 1M-token corpus cannot be injected wholesale — only a curated top-N slice,
which raises the question of who curates it and by what criterion. Second, there
is a cautionary precedent in the repo: `msa_transformation_rules` is a
well-formed reference table that is read client-side by `src/hooks/useMsaRules.ts`
for Bridge mode display and injected into **no generator at all**. A reference
table nothing consults is a maintenance cost with no return.

## Blocker found during this evaluation

`supabase/functions/mine-dialect-corpus/index.ts` cannot return a response.

`json()` is defined at module scope (`:418-423`) and references `corsHeaders`,
which is declared with `const` inside the `serve` callback at `:287`.
`_shared/cors.ts` exports `getCorsHeaders(req)` and no module-level
`corsHeaders`. Every call to `json()` therefore throws `ReferenceError` — the
success path, every validation path, and the `catch` block that tries to report
the first error.

The sibling function gets this right: `draft-dialect-rules/index.ts:126` binds
`corsHeaders` in the same scope and threads it through every
`createErrorResponse(..., corsHeaders)` call.

This is unrelated to Lisan, but it gates application 2 — there is no point
adding a corpus source to a function that cannot respond. Fixing it is out of
scope for this document.

## What Lisan does not solve

Worth stating plainly, because the corpus is easy to over-sell:

- **It is written, not spoken.** No audio, no prosody. Twitter register is not
  conversational register, and a learning app teaching spoken Arabic cannot take
  tweet syntax as a model for dialogue.
- **No sub-dialect labels.** It cannot inform the Sana'a / Aden / Hadramaut /
  Ta'izz distinction that `curriculum-chat/index.ts:342` already draws.
- **It does nothing for TTS.** Yemeni falls through the `planProvider()` chain
  in `_shared/listenTts.ts` to the final `provider: "azure"` branch (`:140-145`)
  and gets two neural voices, `ar-YE-MaryamNeural` and `ar-YE-SalehNeural`,
  while Gulf routes to Munsit (`:119`) and Egyptian to three curated ElevenLabs
  voices (`:129-136`).
- **It does nothing for ASR.** `deepgram-transcribe`, `soniox-transcribe` and
  `fanar-transcribe` all send a bare `language: "ar"` with no dialect hint, and
  the main analysis function is still named `analyze-gulf-arabic`.

## Recommendation

Request the corpus — the form is a low-cost action and the Yemeni portion is
large enough and cleanly enough annotated to justify it. But sequence the work
so that nothing waits on it unnecessarily:

| # | Application | Depends on corpus | Rough effort |
| --- | --- | --- | --- |
| 1 | MSA-leak whitelist for Yemeni | No (better with) | Hours |
| — | Fix `mine-dialect-corpus` response path | No | Under an hour |
| 2 | Ground rule mining in Lisan | Yes | Days |
| 3 | Seed Yemeni vocabulary | Yes | Days, plus TTS cost |
| 4 | Queryable lexicon for generators | Yes | Defer — revisit after 2 |

Concrete next step: submit the Currasat form, inspect the actual file layout,
and revisit applications 2–4 with the real schema in hand. Items 1 and the
`mine-dialect-corpus` fix can start now.

## Sources

- Jarrar, Zaraket, Hammouda, Alavi, Wählisch — *Līsān: Yemeni, Iraqi, Libyan,
  and Sudanese Arabic Dialect Corpora with Morphological Annotations*,
  [arXiv:2212.06468](https://arxiv.org/abs/2212.06468),
  [IEEE Xplore 10479250](https://ieeexplore.ieee.org/document/10479250/)
- [Currasat: Arabic Dialect Corpora](https://sina.birzeit.edu/currasat/about-en.html)
  — corpus listing, CC BY 4.0 licence, access form
- [SinaLab NLP Resources](https://sina.birzeit.edu/resources/index.html)
