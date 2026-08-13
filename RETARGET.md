# RETARGET.md — Hakiya → Ingleezy

**Ingleezy** (اِنجليزي) teaches **English to Arabic speakers**. It is a full fork
of Hakiya (arabic-buddy @ `1063aff`), retargeted rather than rebuilt: the SRS
engine, learner model, Brain pipeline, media pipeline, and admin tooling all
carry over; the *direction of learning* flips.

This document is the master map. Every subsystem gets one of three fates:

- **KEEP** — works as-is or with trivial renames
- **FLIP** — same machinery, direction reversed (Arabic-target → English-target)
- **PRUNE** — Arabic-specific surface with no English-side meaning

Status: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Product direction (agreed in planning)

- Target learner: **Arabic speakers learning English** (Gulf/Egyptian/Yemeni
  dialects first, matching Hakiya's content bridge).
- UI: **Arabic-first, RTL**. English is the *studied content*; the app chrome
  speaks the learner's language. Admin surfaces may stay English.
- Branding: name **Ingleezy** locked; logo/palette pending from Daniel.
  Placeholder palette: **cobalt** primary (teal→indigo bridge rationale),
  warm accent for CTAs, near-white neutral base. All via CSS tokens in
  `src/index.css` — swap-in-one-file when branding lands.
- Backend: **own Supabase project**, not shared with Hakiya. Code-first:
  everything builds and e2e-tests against the hermetic fake-Supabase harness
  until a real project is linked (`.env`).
- Hakiya content: **snapshot-sync bridge**, read-only, from Hakiya's public
  RLS-readable `discover_videos` (published rows only). Not a live runtime
  coupling.

## The core inversion

Hakiya's asymmetry: *target* = dialect Arabic, *scaffold* = English.
Ingleezy's: *target* = English, *scaffold* = Arabic (learner's dialect **and**
Fusha, both — the Fusha transcript layer from Hakiya PR #252 carries over as a
second scaffold line).

The Brain flips the same way:

| Hakiya | Ingleezy |
| --- | --- |
| Dialect identity block (be Gulf/Egyptian/Yemeni) | English register block (natural spoken English, CEFR-conditioned) |
| `dialect_rules` rulebook (good/bad dialect examples) | **L1-interference rulebook**: article drops, copula omission ("the report ready"), /p/→/b/, consonant-cluster epenthesis, preposition transfer, calques |
| MSA-leak detector + repair pass | **Transfer-error detector + repair pass** (flag Arabic-shaped English in generated content *and* in learner output) |
| Native-speaker validator (is this authentic dialect?) | Naturalness validator (is this idiomatic English?) — cheaper, LLMs are strong here |
| Learner profile: known/weak Arabic vocab | Learner profile: known/weak English vocab — **schema unchanged**, semantics flip |

`learner_errors` becomes the L1-interference flywheel: every miss is tagged
with the interference pattern it exhibits, feeding both `/mistakes` and
generation conditioning.

---

## Subsystem map

### Infrastructure — KEEP
- [ ] Vite/React/TS/shadcn/Tailwind shell, CI (typecheck + lint ratchet +
      Vitest + Playwright + deno check), hermetic e2e harness
- [ ] Supabase schema: auth, RBAC, billing/usage caps, FSRS tables,
      `learner_errors`, `user_concept_mastery`, curriculum tables
- [ ] Admin: curriculum builder, lesson xlsx import, feedback, invite codes,
      metrics, roles
- [ ] `modelRegistry.ts` central model IDs

### Identity — FLIP (first commit series)
- [~] package name, index.html meta/OG, manifest (name, `lang: "ar"`,
      `dir: "rtl"`), README rewrite
- [ ] Theme tokens → placeholder cobalt palette; fonts: keep Noto Sans Arabic
      (now the *UI* face), add Cairo for Arabic headings; Latin face for
      English content
- [ ] `src/config.ts`: `DIALECTS` becomes the learner's *native dialect*
      (onboarding choice, drives scaffold rendering), not the studied target

### The Brain — FLIP
- [x] `_shared/aiBrain.ts`: `target: 'english'` mode on both entry points
      (askBrain + streamBrain) — English identity + interference guidance
      replace the dialect blocks; MSA scan/repair/validator skipped for
      English output. **Design decision:** the dialect machinery is NOT
      deleted — Arabic-target calls still run it in full, because Ingleezy
      generates Arabic scaffold (dialect + Fusha lines) that must stay
      authentic. Default target is 'arabic', so every pre-fork caller is
      unchanged until explicitly flipped.
- [x] `interference_rules` table (20260813150000) — same shape/workflow as
      dialect_rules; `dialect` NULL = all Arabic speakers; `explanation_ar`
      carries the learner-facing Fusha explanation. Seeded with the 12
      documented core transfer patterns (articles, copula, /p/-/b/,
      epenthesis, /v/-/f/, prepositions, calques, word order, 3sg -s,
      resumptive pronouns, spelling).
- [x] Transfer-error detector (`transferErrorDetector.ts`) — lexical matcher
      for calques/prepositions/spelling; grammar-shaped categories are
      deliberately NOT string-matched ("he go" is innocent in "where did he
      go") — those need AI grading. Pure core in `englishPromptCore.ts`;
      Vitest + Deno tested.
- [ ] Admin CRUD for interference_rules (mirror AdminDialectRules)
- [x] First English-target caller end-to-end: practice-sentence-coach —
      Deepgram EN ASR, Brain target:'english', deterministic transfer scan
      feeding the prompt, bilingual feedback (English rewrites + dialect
      verdict/tips/interference notes), learner_errors tagged with
      interference categories. Remaining generators flip one by one.
- [x] `learnerProfile.ts` / `learnerProfileCore.ts`: `target: 'english'`
      rendering — English side primary, lexicon named "English"; data path
      untouched (decks are bilingual). CEFR placement re-aim still open.
- [x] Corpus-mining pipeline pruned: mine-dialect-corpus +
      vet-corpus-sentences functions, corpusExampleGuard/corpusVettingCore,
      derive-yemeni + corpus-seed scripts, docs/yemeni, embed-content's
      corpus branch, admin Mine-corpus button. dialect_rules and the
      dialect eval harness (eval-dialect-live, golden sets) STAY — they
      serve the Arabic scaffold direction.

### SRS / flashcards — FLIP (mostly renames)
- [ ] Decks: front = English word/phrase (clickable-word save flow KEEP),
      back = Arabic dialect + Fusha + audio
- [ ] Clickable transcript words → save-as-flashcard: KEEP mechanism,
      direction flips (tap English word, card scaffolds in Arabic)
- [ ] Root-morphology sibling cards → English **word families**
      (act/action/active/actor) — same linking pattern, different linguistics

### Media pipeline — FLIP + BRIDGE
- [~] **Hakiya bridge**: `sync-hakiya-videos` function + `source` column
      landed (same discover_videos table, so existing surfaces serve bridged
      rows with zero UI changes; idempotent upsert on Hakiya UUIDs; drift
      degrades to stale/skipped rows). Remaining: config.toml entry, admin
      trigger button, learner-surface rendering flip (English primary,
      dialect + Fusha as scaffold), deno happy-path test.
- [~] **English uploads** (YouTube/TikTok): `process-english-video` landed —
      Deepgram nova-3 EN with utterance segmentation, batched Arabic-target
      Brain calls for the scaffold (dialect + fusha + literal gloss of the
      English, with the MSA-leak scan reading ONLY the dialect lines — fusha
      is deliberate MSA), same audio-acquisition ladder as the Arabic
      pipeline, admin-only, full status machine. AdminVideoForm routes
      non-meme uploads to it. Learner transcript rendering DONE (EnglishLineCard,
      TappableEnglishText, translate-phrase en_to_ar). Home lead clip
      prefers native English over bridged; Discover badges bridged rows
      as immersion. Remaining: trending discovery flip or prune, Arabic
      pipeline prune once memes decided.
- [ ] CEFR video rating: KEEP (re-aim prompt at English)
- [~] Stories / reading library / listen episodes / daily story: FLIP
      generation direction (English text, Arabic scaffold).
      **Daily story DONE**: english-target Brain call, English-primary
      sentences {english, arabic, literal}, transliteration retired,
      body_arabic nullable (20260813170000), reader flipped to tappable
      English cards with the scaffold behind the display preference.
      **Reading practice DONE**: reading-passage (english-target,
      englishPassageGate, {english, arabic, literal} lines, bilingual
      quiz), reading-qa (English answers, dialect glosses), ReadingPractice
      page flipped to tappable-English lines. Open: reading library
      authoring flip (passage_arabic scaffold column + admin form),
      interactive stories, listen episodes, souq news.

### Grammar — FLIP (drills done)
- [x] Grammar drills flipped: English questions with dialect instruction
      lines, English choices with dialect glosses, explanations in the
      learner's dialect naming the Arabic-transfer trap. Taxonomy extended
      with `articles` + `prepositions` rungs (adding keys is safe; renaming
      orphans mastery) — keyword parity migration 20260813180000. The
      mastery ladder (ids, record-grammar-outcome, user_concept_mastery)
      carries over unchanged. Open: admin grammar-exercise authoring form
      relabel; extract-concepts/extract-grammar-points prompts still
      Arabic-era.

### Speaking / audio — FLIP
- [ ] Pronunciation practice: English phoneme scoring, seeded with the
      Arabic-speaker confusion set (/p/-/b/, /v/-/f/, vowel pairs,
      clusters) — this *replaces* Alphabet Journey's role
- [~] Shadowing, sentence coach, set phrases: KEEP loops, English targets
      (sentence coach DONE — the model for the rest)
- [ ] TTS: English voices for targets; Arabic TTS kept for scaffold audio
- [ ] Realtime conversation simulator: KEEP, English persona
      (⚠ port Hakiya's usage-cap findings: meter minutes, not sessions)

### Arabic-only surfaces — PRUNE or REPURPOSE
- [ ] Alphabet Journey → **English Sounds** journey (phonics for Arabic
      speakers) — repurpose structure, all-new content
- [ ] MSA Bridge (`MsaBridge.tsx`, `msa_transformation_rules`) → PRUNE
- [ ] Dialect Compare → PRUNE (or later: "how do Brits vs Americans say it")
- [ ] Yemeni corpus tooling (`docs/yemeni`, mine-dialect-corpus,
      derive-yemeni-* scripts) → PRUNE
- [x] Bible reading (Arabic scripture) → PRUNED
- [ ] Meme analyzer / Souq news / Learn-from-X: FLIP if cheap, else defer

### Arabic-first UI — FLIP (dedicated pass)
- [ ] `dir="rtl"` root, manifest `lang: ar`
- [ ] Strings module (`src/lib/strings.ts` or i18n lib TBD) — no hardcoded
      learner-facing English; admin exempt
- [ ] Mirror-aware components (icons, arrows, progress) — Tailwind logical
      properties where needed

---

## Sequencing

1. **Identity flip** — buildable, renamed, placeholder palette (this week)
2. **RETARGET.md** + prune list executed (dead code out early, smaller diffs)
3. **Brain flip + interference rulebook** — the differentiating core
4. **SRS/flashcard direction flip** + clickable words
5. **English upload pipeline** end-to-end (one video, admin → learner)
6. **Hakiya bridge**
7. **Speaking feedback** (pronunciation + shadowing)
8. **Arabic-first UI pass** (big, mechanical, best done once features settle)
9. **English Sounds journey**

Each step keeps `npm run typecheck && npm test && npm run test:e2e` green —
same bar as Hakiya's CI.

## Known risks

- **RTL flip late**: features built LTR need re-checking under RTL. Mitigation:
  strings module lands early even while values are still English.
- **Hakiya schema drift** breaks the bridge — snapshot design + source tag
  isolates blast radius to stale content, never runtime errors.
- **Realtime voice cost**: uncapped in Hakiya (see
  `docs/product-audit-2026-08.md` A1) — do not inherit; meter minutes from
  day one.
- **e2e fixtures** encode Arabic-direction data; flip fixtures alongside each
  feature or the suite rots.
