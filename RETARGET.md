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
- [x] Admin CRUD for interference_rules (AdminInterferenceRules page,
      route + dashboard tile)
- [x] First English-target caller end-to-end: practice-sentence-coach —
      Deepgram EN ASR, Brain target:'english', deterministic transfer scan
      feeding the prompt, bilingual feedback (English rewrites + dialect
      verdict/tips/interference notes), learner_errors tagged with
      interference categories. Remaining generators flip one by one.
- [x] `learnerProfile.ts` / `learnerProfileCore.ts`: `target: 'english'`
      rendering — English side primary, lexicon named "English"; data path
      untouched (decks are bilingual).
- [x] CEFR placement re-aimed: placement-quiz generates ENGLISH questions
      (vocabulary/grammar/reading/translation, grammar favouring the
      points that trip Arabic speakers), with the prompt and every choice
      glossed in the learner's dialect; A1-A2 keep full Arabic support.
      The page leads with the English; the dialect support sits behind
      the toggle. The dialect still buckets placement_history — it names
      the learner's L1, not the tested language.
- [x] Corpus-mining pipeline pruned: mine-dialect-corpus +
      vet-corpus-sentences functions, corpusExampleGuard/corpusVettingCore,
      derive-yemeni + corpus-seed scripts, docs/yemeni, embed-content's
      corpus branch, admin Mine-corpus button. dialect_rules and the
      dialect eval harness (eval-dialect-live, golden sets) STAY — they
      serve the Arabic scaffold direction.

### SRS / flashcards — FLIP (mostly renames)
- [~] Decks: front = English word/phrase (clickable-word save flow KEEP),
      back = Arabic dialect + Fusha + audio.
      Curriculum deck (/review) DONE: recognition shows the English word
      and reveals the Arabic gloss; production prompts from the Arabic and
      the learner produces English; the listening card synthesises the
      English target with an English voice (persist-word-audio caches
      word_english audio now); PronunciationButton scores against en-US
      for every learner (dialect shapes coaching only) and sends
      word_english = spoken target / word_arabic = gloss to
      pronunciation-feedback. Review chrome is Arabic (rating buttons,
      session progress/handoff with arCount agreement, Arabic interval
      units د/س/ي/ش). Remaining: MyWordsReview + MyPhrasesReview pages
      (PronunciationButton call already flipped), quiz/cloze/image cards,
      LeechHelperPanel + SiblingWordsPanel strings, scoreBand labels.
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
- [x] CEFR video rating: FLIPPED — English transcripts (lines carrying
      `english`) rate against an English A1/A2 baseline with English
      descriptors (phrasal verbs, connected speech); transcripts without
      English lines are Hakiya-bridged clips and keep the Arabic-era
      dialect-aware path.
- [~] Stories / reading library / listen episodes / daily story: FLIP
      generation direction (English text, Arabic scaffold).
      **Daily story DONE**: english-target Brain call, English-primary
      sentences {english, arabic, literal}, transliteration retired,
      body_arabic nullable (20260813170000), reader flipped to tappable
      English cards with the scaffold behind the display preference.
      **Reading practice DONE**: reading-passage (english-target,
      englishPassageGate, {english, arabic, literal} lines, bilingual
      quiz), reading-qa (English answers, dialect glosses), ReadingPractice
      page flipped to tappable-English lines.
      **Listen episodes DONE**: generate-listen-script emits English
      scripts (ScriptLine {speaker, speaker_role, english, arabic,
      literal}), English title + dialect-Arabic title_arabic
      (20260813190000) and Arabic summary teaser; tashkeel pass and
      dialect-flavor blocks removed. listenTts gained planEnglishProvider
      (ElevenLabs premade English voices, Azure en-US fallback) used by
      both audio functions, synthesizing line.english. ListenEpisode
      reader flipped: English-primary tappable lines, scaffold behind the
      display preference, english-led vocab.
      **Souq News DONE**: same regional Firecrawl search (your region's
      news, now in English — familiar events carrying unfamiliar
      language), retelling flipped to easy spoken English with per-line
      dialect scaffold {english, arabic, literal}, dialect summary +
      title_arabic behind the Show Arabic toggle, vocabulary
      {english, arabic}. SentenceReader rebuilt English-primary
      (TappableEnglishText, reveal shows the Arabic scaffold, `invisible`
      when collapsed); souq-news-quiz english-target (English questions
      with dialect glosses, dialect explanation); ArticleQuiz flipped;
      Mark-Unknowns machinery replaced by tap-word save on this page.
      **Interactive stories DONE**: generate-story english-target
      (English scenes over a dialect scaffold — narrative_arabic natural
      dialect, narrative_literal Arabic-in-English-order, transliteration
      retired from the schema; structure rules kept). StoryPlayer flipped:
      TappableEnglishText narrative (paragraph + line-by-line), Arabic
      behind Show translation, English-led choices and vocab pills,
      word saves keyed on the English sentence. AdminStoryForm flipped
      (English-first fields, scaffold labels, dialect list Gulf/Egyptian/
      Yemeni, English-scenario placeholders). Story audio/video media
      functions still narrate the Arabic-era authentic-stories pipeline —
      flip or prune with that decision.
      **Reading library scaffold DONE**: reading_passages gained
      title_arabic / passage_arabic / lines (20260813200000) — `title`
      and `passage` carry English (as the flipped reader already
      assumed), the scaffold pairs by sentence position or by authored
      lines. Curriculum-approval publish crosswires the Arabic-era
      builder payload into the flipped columns (detected by its
      *_english fields); a flipped builder can emit english/arabic
      fields directly. Remaining in this area: the curriculum builder's
      own prompts (still Arabic-era), and the authentic-stories media
      pipeline (import → dialect translate → audio/slideshow), which
      still serves Arabic content — flip or prune with the memes
      decision.

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
- [x] Pronunciation practice FLIPPED: word/sentence modes drill the
      learner's English deck against Azure en-US phoneme scoring (en-GB
      supported), with the learner's dialect riding along as the
      learner_errors bucket; the feedback coach names the Arabic-speaker
      confusion set (/p/-/b/, /v/-/f/, vowel pairs, epenthesis, dropped
      finals) when the scores point at it. The card shows the English to
      pronounce with the Arabic meaning behind a reveal; deck "listen
      first" audio removed until English card audio exists. Shadow mode
      deliberately stays Arabic (immersion echo of native clips).
      Still open: a seeded minimal-pairs drill set — goes with the
      English Sounds journey.
- [~] Shadowing, sentence coach, set phrases: KEEP loops, English targets.
      **Set phrases DONE**: English phrases with dialect glosses, phonetic_ar
      in the transliteration columns, Arabic-in-English-order literals, and
      the scenario in the learner's dialect (scenario_english column name
      historical). seed-set-phrases + request-situation-phrases generate
      English with dialect-guarded glosses; generate-set-phrase-quiz emits
      dialect scenarios + English choices with glosses (Arabic fallback
      prompt when generation fails); score-set-phrase-voice moved from
      Munsit to Deepgram EN with English normalisation (case/punctuation/
      apostrophes), learner_errors carrying English targets. Practice/hub
      pages and RequestSituationCard flipped English-primary. Shadowing
      still Arabic — it echoes native clips (immersion), revisit with the
      Hakiya-bridge listening decisions.
      **Phrase of the day + jingle DONE**: an English expression a native
      would say today (category wheel re-aimed at English life; one shared
      list — the dialect only names the gloss), recall direction mirrored
      (dialect gloss shown, English behind the reveal with phonetic_ar),
      notes in the learner's dialect; english-target Brain call. The jingle
      sings the English in an English pop style.
      **Translate & Save DONE**: translate-text flipped — paste English,
      get a per-sentence dialect breakdown (natural Arabic + literal
      Arabic-in-English-order + idiom notes in dialect); the Brain call
      stays arabic-target so the full dialect machinery guards the
      generated scaffold, with the MSA scan reading every gloss. Both
      pages (Translate, SavedTranslations) render tappable English over
      RTL glosses with word-save wired through translate-phrase; "auto"
      dialect now means the learner's own. saved_text_translations
      stores the flipped sentence shape in the same jsonb.
      (sentence coach DONE — the model for the rest)
- [ ] TTS: English voices for targets; Arabic TTS kept for scaffold audio
- [ ] Realtime conversation simulator: KEEP, English persona
      (⚠ port Hakiya's usage-cap findings: meter minutes, not sessions)

### Arabic-only surfaces — PRUNE or REPURPOSE
- [~] Alphabet Journey → **English Sounds** journey (phonics for Arabic
      speakers) — repurpose structure, all-new content. Its learner-facing
      entry points are now hidden (LearnHub tile, Home progression card,
      DailyLetterGoalRing) since teaching the Arabic alphabet to Arabic
      speakers is absurd post-flip; the /alphabet routes and components
      remain in place as the skeleton for the English Sounds rebuild.
- [x] MSA Bridge → PRUNED (only stale generated-types references remain
      until types regeneration)
- [x] Dialect Compare → PRUNED (revisit later as "how do Brits vs
      Americans say it")
- [x] Yemeni corpus tooling → PRUNED
- [x] Bible reading (Arabic scripture) → PRUNED
- [ ] Meme analyzer / Souq news / Learn-from-X: FLIP if cheap, else defer

### Arabic-first UI — FLIP (dedicated pass)
- [x] `dir="rtl"` root landed: `<html lang="ar" dir="rtl">`; manifest was
      already ar/rtl. The `.font-english` marker class (previously CSS-less)
      now carries `direction: ltr; unicode-bidi: isolate`, so every English
      content block keeps left-to-right order and left alignment inside the
      RTL page — that one rule is what made the root flip safe. Full e2e
      sweep: 1764/1767 on first run; the three failures were two stale pins
      from earlier flips plus one selector colliding with the now-RTL root.
- [~] Strings module landed (`src/lib/strings.ts`, plain module — one UI
      language, no i18n framework) with the bottom-nav labels in Arabic
      (الرئيسية / تعلّم / اكتشف / تدرّب / أنا). Pages migrate onto it
      incrementally — Home's daily-queue loop is the first migrated page
      (Today heading, task titles/subtitles/hints, goal popover, states,
      placement banner, review nudge, video card, top-bar actions), with an
      `arCount` helper carrying Arabic one/two/3-10/11+ number agreement.
      The three hub pages (Learn/Practice/Me) are migrated — titles,
      section headers, tile labels and descriptions — with stale
      Arabic-era descriptions corrected to flipped semantics in the same
      pass (Reading Library / Listen / Translate / Writing / Stories /
      Souq now describe English content; Meme & Learn-from-X honestly
      labeled as still-Arabic pending their flip/prune decision;
      Transcribe kept language-neutral until the pipeline flips).
      Hub strings stay page-local per the strings-module doc (single
      use); shared/counted strings live in `strings.ts`.
      Remaining: Discover chrome, Review session, Me pages, Settings,
      Auth/Onboarding, remaining pages — no hardcoded
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
