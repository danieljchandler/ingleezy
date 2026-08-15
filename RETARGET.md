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

### Column names — the deferred rename, now DONE
- [x] Through the retarget the rule was: keep the Arabic-era column names,
      flip only the content. That was right while features were moving —
      one concern per change, no migration per PR — and the debt it built
      is that a handful of columns ended up saying one thing and holding
      another. Paid off in `20260815120000_semantic_column_renames.sql`,
      while no real Supabase project is linked: plain renames, no
      expand/contract, no backfill.
      `learner_errors.target_arabic` / `produced_arabic` →
      `target_text` / `produced_text` — neither `_arabic` nor `_english`
      is honest, because shadowing still scores bridged Arabic clips and
      the recogniser is picked per clip. `user_vocabulary.root` and
      `vocabulary_words.root` → `word_family`: an Arabic root is generative
      (ك-ت-ب → كتب, كتاب, مكتب) and an English word family is not, which is
      the whole reason `wordFamily.ts` replaced `arabicRoot.ts`.
      `authentic_story_lines.english_literal` → `literal_arabic` and
      `daily_vocab_stories.body_english_literal` → `body_literal_arabic`,
      the most actively wrong of the set — both hold Arabic, and they hold
      the same kind of thing, so they now answer to one word. `user_phrases`
      and
      `set_phrases` `transliteration` → `phonetic_ar`: these hold the
      English respelled in Arabic letters ("ثانك يو"), the *opposite* of
      `user_vocabulary.transliteration`, which is a Latin transliteration
      of Arabic and keeps its name. One identifier meaning opposite things
      two tables apart was the clearest case for moving. And
      `user_letter_progress.letter_code` → `user_sound_progress.sound_code`,
      since a sound code ("p", "clusters") is not a letter and several are
      not one letter. Deliberately NOT renamed: `word_arabic` /
      `word_english` and friends, which name the *language* and still name
      it correctly — what flipped is which is target and which is scaffold,
      and that is a property of the app, not the column.
      Dropped with it: `body_fusha`, `body_fusha_vocalized`,
      `body_dialect_vocalized`, `arabic_vocalized`, `dialect`,
      `dialect_vocalized` — vocalisation is a reading aid for Arabic script
      and the library no longer renders Arabic script as its text — plus
      `daily_vocab_stories.body_transliteration`, romanization of Arabic for
      a reader who reads Arabic, hard-nulled since the flip, and
      `picture_scene_hotspots.root`, which outlived the feature that wrote
      it. That last one is dropped rather than renamed for a specific
      reason: `schemaContract` attributes a column to any table that has it,
      so one surviving `root` anywhere kept a stale `root` acceptable
      everywhere. Not hypothetical — that is exactly how a `root` in
      MyWordsReview's select list survived this pass's own sweep and turned
      the saved-words deck up empty.
      **Bugs that fell out of the pass.** `user_vocabulary`'s uniqueness was
      `(user_id, word_arabic, dialect)`, right when the Arabic was the word
      being learned; post-flip the Arabic is the *gloss* and distinct
      English words routinely share one — "big" and "large" are both كبير,
      so the second save was silently dropped as a duplicate in the one
      flow where a learner is actively collecting vocabulary. Now keyed on
      `word_english`. And `columnDefaults.ts`, which reads the migrations
      to work out what the emulator should default, did not follow
      `ALTER TABLE … RENAME` — so a renamed table silently lost every
      default it had, invisibly, until a test asserted on a defaulted
      column and got undefined. It follows renames now.
      A third came out of the same gap: `suggest-flashcards` emitted `root`
      in its tool schema while `SuggestFlashcardsDialog` read `word_family`,
      so every suggested card arrived without the family the model had just
      been asked for and was queued for a backfill it did not need. Nothing
      errored — a missing optional key never does. The deno test now pins
      the key rather than the value. Two type-level `root`s went the same
      way, `VocabularyCard`'s `VocabularyWord` and `MyWordsReview`'s row
      types, both of which are shaped after the table and so silently stop
      matching it. What all four have in common is that TypeScript cannot
      see through a PostgREST select string or an AI tool schema, which is
      the whole reason the emulator rejects unknown columns and the reason
      it now has no `root` left to accept.

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
      units د/س/ي/ش). MyWordsReview and MyPhrasesReview DONE the same
      way: English fronts on recognition, Arabic prompts on production,
      English TTS for word/phrase audio (transliteration = phonetic_ar
      shown with the English answer as a reading aid), Arabic chrome and
      toasts throughout. LeechHelperPanel + SiblingWordsPanel are Arabic.
      The cloze card now blanks the ENGLISH word inside its English
      sentence (case-insensitive) with English distractors and masked
      English TTS; the Arabic translation sits behind the reveal.
      Transcript-mined cloze fallback is parked until the English
      transcription pipeline lands. ReviewQuizCard and
      ReviewImageQuizCard had no consumers — pruned. Remaining:
      scoreBand labels (flip with the pronunciation pages).
- [ ] Clickable transcript words → save-as-flashcard: KEEP mechanism,
      direction flips (tap English word, card scaffolds in Arabic)
- [x] **Root-morphology sibling cards → English word families**. Same
      linking pattern, genuinely different linguistics: Arabic *generates*
      a vocabulary from a consonantal root, so ك-ت-ب is a real derivable
      thing that three letters identify. English has no such generator —
      it has the word family, a base word plus what is built from it
      (act → action, active, actor). `user_vocabulary.root` keeps its
      name and carries the base form instead.
      `src/lib/arabicRoot.ts` became `src/lib/wordFamily.ts`, and the
      rule changes follow the linguistics: the 2-5 radical bound
      (which doubled as a garbage filter) becomes a 2-20 letter bound,
      the "ك · ت · ب" display transform is gone because an English base
      form *is* a readable word, and case and hyphens fold. Two rules
      are new. `none`/`unknown`/`n/a` are rejected explicitly — the
      Arabic version got that free, since they are not Arabic letters,
      but in English they are well-formed base forms and would collect
      every unanalysable word into one enormous fake family. And
      `familyKey` refuses Arabic script, which quietly retires every
      root written before the flip: those rows drop out of the index
      rather than needing a migration.
      `enrich-word-roots` derives from `word_english` with an English
      closed-class stoplist and a prompt that names the trap directly
      ("actual" is NOT in the "act" family). Its sanitiser now *refuses*
      rather than strips, because stripping the spaces out of "the act
      of doing" leaves "theactofdoing", which passes every shape check
      there is — the Arabic version could strip freely only because a
      laundered phrase never fit in five letters.
      One real bug fixed on the way: `word-enrichment` returned the
      Arabic root and the save path wrote it into `root`. Post-flip that
      is wrong twice over — the client refuses to display it, and since
      the backfill only fills rows where `root IS NULL`, the card was
      locked out of ever getting a real family. It no longer returns
      one, and both save paths leave the column null for the backfill.

### Media pipeline — FLIP + BRIDGE
- [x] **Hakiya bridge**: `sync-hakiya-videos` function + `source` column
      landed (same discover_videos table, so existing surfaces serve bridged
      rows with zero UI changes; idempotent upsert on Hakiya UUIDs; drift
      degrades to stale/skipped rows). config.toml entry, the deno suite
      (auth posture, unconfigured bridge → 503, upstream failure → 502,
      happy path with a drifted row skipped) and the learner-surface
      rendering split all landed — `TranscriptLine.english` is the switch:
      absent means a bridged Arabic clip, so the reader takes the
      Arabic-clip path with `translation` primary. The admin trigger
      landed too: a "Sync from Hakiya" button on /admin/videos that
      reports both counts the function returns — how many landed and how
      many were skipped for drift — because a bridge that has quietly
      stopped copying looks identical to a healthy one otherwise, and
      names an unconfigured bridge as unconfigured rather than as a
      failure, since that is its normal state until the env vars are
      set. Bridged rows carry a "Hakiya" badge in the list: editing one
      is pointless, because the next sync overwrites it. **DONE.**
- [~] **English uploads** (YouTube/TikTok): `process-english-video` landed —
      Deepgram nova-3 EN with utterance segmentation, batched Arabic-target
      Brain calls for the scaffold (dialect + fusha + literal gloss of the
      English, with the MSA-leak scan reading ONLY the dialect lines — fusha
      is deliberate MSA), same audio-acquisition ladder as the Arabic
      pipeline, admin-only, full status machine. AdminVideoForm routes
      non-meme uploads to it. Learner transcript rendering DONE (EnglishLineCard,
      TappableEnglishText, translate-phrase en_to_ar). Home lead clip
      prefers native English over bridged; Discover badges bridged rows
      as immersion. Remaining: Arabic pipeline prune once memes decided.
- [x] **Trending discovery → FLIPPED to the US and the UK.** The crawler
      searched six Gulf states for Arabic Shorts; it now searches `US`
      and `GB` for English ones — the accents an Arabic speaker actually
      meets in media and at work. Two regions instead of six, so the
      per-region keep rises from 8 to 12 and a fetch still fills an admin
      review session.
      The queries are picked for one property: people TALKING (street
      interview, storytime, podcast clip, day in my life). A Short with
      no speech is worthless to a listening pipeline however well it
      trends, which is also what the exclusions had to become. Hakiya
      excluded Quran recitation — content that trends hugely and teaches
      the target language nothing. English has no single equivalent but a
      large one in aggregate, so that slot now holds music, ASMR and the
      "satisfying"/"no talking" genres, plus YouTube's own music
      category. Gaming stays excluded for the reason it always was.
      The Arabic-script requirement inverts into an English one, and it
      is **proportional rather than presence-based**: `regionCode` and
      `relevanceLanguage` are ranking hints, not filters, so a US crawl
      returns plenty of Shorts in other languages, and a
      contains-a-Latin-letter test would keep "أفضل vlog". It reads the
      title, not the description — descriptions are boilerplate and
      hashtags in whatever language the uploader's template is in.
      Three silent mislabels were found and pinned while writing the
      topic lists: a bare `ai` matched "expl-ai-ned", a bare `tips` filed
      every makeup and travel clip under education, and a bare
      `interview` filed a vox pop under work — while "street interview"
      is one of the crawler's own queries.
      The admin page keeps the Gulf region labels for display, since
      pre-flip candidates still carry those codes, but only US/GB get
      filter chips.
- [x] CEFR video rating: FLIPPED — English transcripts (lines carrying
      `english`) rate against an English A1/A2 baseline with English
      descriptors (phrasal verbs, connected speech); transcripts without
      English lines are Hakiya-bridged clips and keep the Arabic-era
      dialect-aware path.
- [x] Stories / reading library / listen episodes / daily story: FLIP
      generation direction (English text, Arabic scaffold).
      **Reading library DONE — and it was the last whole feature still
      pointing the old way.** Filed under this bullet next to "reading
      practice", which had been done for weeks, so it read as finished; it
      is a separate feature and none of it had been touched. Front to back
      it still ran Hakiya's direction: `import-authentic-story` took a
      pasted *Arabic* text, vocalised it with tashkeel and translated it to
      English; `ReadingLibraryStory` rendered `arabic_vocalized || arabic`
      as the primary tappable line with the English behind a toggle; the
      two audio functions narrated the Arabic through `planProvider(dialect)`.
      Nothing errored, because the whole path agreed with itself — an
      Arabic speaker simply opened the library and got Arabic reading
      practice with English glosses.
      Now: the admin pastes **real English** (article, essay, story), the
      importer keeps it verbatim and generates the scaffold around it —
      dialect line + literal gloss in English word order + English-headword
      vocabulary, the same `{english, arabic, literal}` contract as
      reading-passage. Tashkeel is gone: it is a reading aid for Arabic
      script and nobody is reading Arabic script here. The reader is
      English-primary tappable lines (`TappableEnglishText`), scaffold
      behind one toggle that defaults ON (a learner who cannot see the help
      does not know it is there), and the audio functions narrate
      `line.english` via `planEnglishProvider()`.
      Per the empty-shelf decision, **generation is kept as a fallback**:
      `generate-suggested-story-text` now writes graded ENGLISH and feeds
      the same importer, so a generated story and a pasted one reach their
      scaffold by one path rather than two that can drift.
      `translate-story-dialect` got a better job than it had — it used to
      turn a Fusha source into dialect, a step that only existed because
      the source was Arabic; it now **re-scaffolds a story into a different
      dialect from the English**, so a piece imported for a Gulf learner
      can be moved to Egyptian without re-importing or re-narrating it.
      Two bugs previously *pinned* in `story_admin_test.ts` are fixed on
      the way: it now refuses to stamp a story with a new dialect when only
      some lines converted (a story badged Egyptian with a Gulf second half
      is worse than a run that plainly failed), and a run that translated
      nothing reports 502 instead of `success: true` after erasing the old
      scaffold. A third — **no admin check at all**, so any signed-in
      account could re-gloss every line of a published story — is closed
      too.
      **The story-video generators went with it**, found by grepping for
      what still read the retired columns. `generate-story-video-full`
      planned its storyboard from `story.body_fusha`, which the flipped
      importer never writes — so post-flip it handed the director an empty
      story and captioned the real text "ENGLISH REFERENCE TRANSLATION
      (context only, do NOT use English words in prompts)". Its preview
      sibling narrated the Arabic and *threw* on Latin characters, so it
      would have rejected every story in the flipped library outright. Both
      now read the English, narrate it through `planEnglishProvider()`, and
      keep their script guards **inverted rather than deleted** — a beat
      with no Latin in it is now the error, because that check is what
      catches a story whose columns were filled the wrong way round.
      Also dropped from both: `culturalSetting(dialect)`, which keyed the
      illustration style on the dialect. That was right when the dialect
      was the story's origin; post-flip it is the *learner's own language*,
      so it was dressing a London news article in kanduras because the
      reader happens to be Gulf.
      Learner-facing e2e coverage added (`e2e/reading-library.spec.ts`);
      the surface had none.
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
      fields directly — and curriculum-chat now does, so the crosswire
      only serves drafts left in sessions opened before the flip.
      Remaining in this area: the authentic-stories media pipeline
      (import → dialect translate → audio/slideshow), which still
      serves Arabic content — flip or prune with the memes decision.

### Grammar — FLIP (drills done)
- [x] Grammar drills flipped: English questions with dialect instruction
      lines, English choices with dialect glosses, explanations in the
      learner's dialect naming the Arabic-transfer trap. Taxonomy extended
      with `articles` + `prepositions` rungs (adding keys is safe; renaming
      orphans mastery) — keyword parity migration 20260813180000. The
      mastery ladder (ids, record-grammar-outcome, user_concept_mastery)
      carries over unchanged. Open: admin grammar-exercise authoring form
      relabel.

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
      Still open: a seeded minimal-pairs drill set for THIS page (the
      general pronunciation deck). The English Sounds journey (now built,
      see Arabic-only-surfaces) has its own minimal pairs per sound in
      `src/data/englishSounds.ts` — a ready source to pull from rather than
      re-authoring a second set from scratch.
- [~] Shadowing, sentence coach, set phrases: KEEP loops, English targets.
      **Shadowing DONE, and it was broken rather than merely unflipped.**
      `useShadowQueue` had always worked out the right language per line —
      `en-US` for a native English clip, `ar-*` for a Hakiya-bridged one —
      but nothing carried that locale to the server. So
      `score-shadow-attempt` transcribed every take with Munsit, an Arabic
      ASR, and `pronunciation-feedback` opened every tip with "You are a
      friendly Arabic pronunciation coach… reference the specific Arabic
      words/sounds they missed".
      On English clips — the primary content — that meant the learner's
      English was run through an Arabic recogniser, which does not error:
      it returns Arabic-script noise, the edit-distance similarity lands
      near zero, and a learner who said the line perfectly is told they
      mispronounced all of it. Then the coach, handed English text, was
      instructed to talk about Arabic sounds.
      The locale is now plumbed clip → `useShadowScore` → both functions.
      The scorer routes to Deepgram nova-3 for English (keyterm-boosted
      with the clip's own words, and nova-3 handles accented English,
      which matters when the speaker is an Arabic native by definition)
      and keeps Munsit for bridged Arabic. The coach branches the same
      way, and the English branch names the interference sounds the way
      the Azure-scores path already did. Unlabelled requests default to
      English — the common case — so a stale client degrades to rare
      rather than universal.
      Pinned in a new `shadow_test.ts` on both sides, because every part
      of this failure is silent: nothing in the response looks wrong.
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
      follows the CLIP's language now (English lines from English
      videos scored against en-US; Hakiya-bridged Arabic clips scored
      against the dialect) — it echoes native clips (immersion),
      revisit with the
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
- [x] TTS: English voices for targets; Arabic TTS kept for scaffold audio.
      `planEnglishProvider()` (ElevenLabs premade English voices, Azure
      en-US fallback) is the shared plan, used by the listen-episode audio,
      the story audio and the English Sounds journey's `SoundAudioButton` —
      which has to force the Azure English path explicitly, since
      `useAzureTTS` routes Gulf dialects through Munsit for every *other*
      button in the app. `planProvider(dialect)` stays for scaffold audio.
- [x] Realtime conversation simulator: KEEP, English persona.
      `realtime-session-token` bakes an English-only immersion partner
      (speaks only English, recasts transfer errors rather than stopping to
      correct, expects the dropped-article / missing-copula / /p/-as-/b/ /
      epenthesis set for the learner's L1); the Ask-AI persona beside it is
      deliberately bilingual, explaining in dialect. `conversation-practice`
      matches. Hakiya's usage-cap finding was ported: `voiceBudgetCore` +
      `recordVoiceUsage` meter SECONDS, not sessions.
      *(Both were checked off late — the code landed with the Brain flip
      and the boxes drifted. Found while auditing what was left after the
      English Sounds rebuild.)*

### Content generators (admin) — FLIP
- [x] `curriculum-chat` FLIPPED: the builder now drafts ENGLISH lessons,
      vocab, grammar drills, listening clips, reading passages, daily
      challenges, conversation scenarios and game sets for native Arabic
      speakers, with every gloss, hint and explanation written in the
      learner's dialect. The dialect argument stopped naming the taught
      language and now names the learner's L1 (the "do NOT use Egyptian
      terms" rules still apply — to the scaffold). generate_* routes
      through the Brain with `target: 'english'` + the stage's CEFR; the
      non-brain MSA repair pass survives because the Arabic *scaffold*
      still has to be dialect, and it now explicitly leaves English
      strings alone. Reading drafts emit title/title_arabic and
      passage/passage_arabic directly, so the approval crosswire is only
      for pre-flip drafts. Field names throughout stay Arabic-era with
      flipped content: `word_english`/`question_english`/`text_english`/
      `audio_text`/`passage` carry the English, their `_arabic` twins the
      scaffold, and `transliteration` is phonetic_ar (menu → مينيو).
- [x] Admin preview cards follow: English leads and renders LTR, the
      dialect gloss sits under it RTL; vocab tables read English →
      phonetic (ع) → meaning; the reading preview crosswires legacy
      drafts the same way the publish path does, so the admin sees what
      would actually be saved.
- [x] `extract-concepts` keys concepts on the ENGLISH headword — keying
      on the Arabic gloss filed one English word under a different
      concept per dialect, and the coverage planner would keep
      re-introducing it. `coveragePlanner`'s prompt block leads with the
      English for the same reason.
- [x] `extract-grammar-points` extracts ENGLISH grammar notes from a
      transcript (articles, copula, third-person -s, prepositions, word
      order, countability), quoting real English lines, with Arabic
      titles and dialect explanations; DiscoverVideo renders the quoted
      examples as English rather than RTL Arabic.

### Arabic-only surfaces — PRUNE or REPURPOSE
- [x] Alphabet Journey → **English Sounds journey, DONE**. Researched
      first (contrastive Arabic/English phonology, TESOL's Arabic-speaker
      pronunciation guidance, cluster-epenthesis studies) rather than
      guessing, then rebuilt on that basis — not a copy-edit of the old
      28-letter tour, a different curriculum entirely.
      `src/data/englishSounds.ts` replaces `arabicAlphabet.ts`: 28 stops,
      four groups of seven mirroring the old checkpoint shape, ordered by
      contrastive difficulty rather than A-B-C — sounds Arabic already has
      first (m b t d s n l, then k f h w y z, ending the familiar set on a
      *retrained* ر since English /r/ is no trill), then sounds genuinely
      IN Arabic that get under-taught (ش ث ذ, the dialect-dependent ق/ج→/g/
      case) paired with the vowel-LENGTH bridge (beat/bit, fool/full,
      bet/bat — leaning on the short/long vowel concept Arabic already
      has), then the sounds Arabic has no phoneme for at all: /p/ (→/b/),
      /v/ (→/f/), /tʃ/, /ŋ/, /ʒ/, consonant clusters (the documented
      vowel-epenthesis repair — "street"→"istreet"), and word-final
      devoicing as the capstone (flagged in the literature as
      disproportionately important because it's a word-final phenomenon).
      The three phonology rules already hardcoded in
      `englishPromptCore.ts`'s FALLBACK_INTERFERENCE_RULES — p→b, v→f,
      cluster epenthesis — are dedicated stops here too, so the Journey and
      the AI coaching prompts teach against the same documented errors.
      Each stop carries an IPA, spellings (English's opaque orthography
      needed a dedicated "how is it written" step — the letter-tracing step
      it replaced taught letter SHAPE, which nobody reaching this journey
      needs; English's actual writing problem is one sound spelled several
      ways), position-tagged example words, curated spot-words (English
      spelling can't be scanned for a sound the way Arabic script can, so
      SpotTheSoundGame reads a hand-tagged word list instead of deriving
      membership), and minimal pairs (park/bark, pin/bin) that drive both a
      mouth-position/voicing panel (MouthGuidePanel, with a "hand on your
      throat" voicing check generated once rather than authored 28 times)
      and a listening-discrimination game (MinimalPairGame — "which word
      did you hear", the standard mechanic the literature converges on,
      not a shape-matching game). Six steps per stop: meet, mouth, spell,
      examples, spot, contrast. Checkpoints became an 8-round "which word
      did you hear" boss battle over the whole pool covered so far.
      TTS is real English audio (`en-US-JennyNeural`, forced past the
      dialect-routing hook that every other button in the app uses to play
      Arabic back) — SoundAudioButton is the mirror of LetterAudioButton
      but always English, never dialect-routed.
      Learner-facing entry points are back: LearnHub's tile and a
      DailySoundGoalRing card on Home, both pointing at the real feature
      this time instead of the placeholder that used to sit there.
      **Also resolved the coupled Typing tab**, left running-but-undecided
      since the fourth sweep: it was an Arabic-keyboard drill tied to the
      old alphabet's letter order and stage math, and would have broken
      outright once `arabicAlphabet.ts` was deleted. Rebuilt as a spelling
      drill instead of a keyboard-layout one — English doesn't need a
      mapped on-screen keyboard (every learner already has a physical
      QWERTY one and already knows where its keys are), it needs spelling
      practice, since the same sound can be written several ways. Stages
      now come from `SPELLING_STAGES` (built off `englishSounds.ts`'s own
      checkpoint groups), and `ArabicKeyboard.tsx` is gone along with the
      whole key-layout/normalisation half of `typingDrills.ts` — no
      physical keyboard to map, so nothing to replace it with.
- [x] **Written production (WritingPractice + `writing-coach`) →
      FLIPPED**. Found during the fourth sweep, and it was the last whole
      feature still pointing the old way: the "Write" tab asked the model
      for a casual incoming message *in the learner's dialect* and then
      corrected the learner's *Arabic* against the dialect Rulebook — one
      of its correction kinds was literally `msa_leak`. Now the message
      arrives in English, the learner replies in English, and the review
      corrects the English while writing every explanation, verdict and
      tip in their dialect: the correction is the moment the explanation
      has to land, so it is given in the language they think in. The
      correction kinds are redrawn as `article` / `preposition` /
      `verb_tense` — where Arabic actually pulls a writer off course,
      since it has no indefinite article, maps prepositions differently
      and marks time with fewer forms. `learner_errors.error_kind` is
      free text with a label fallback, so no migration was needed, only
      new labels in `src/lib/mistakes.ts` (`msa_leak` keeps its label for
      rows the Arabic era already wrote). The input gate flipped with it:
      a reply typed entirely in Arabic is now refused (`not_english`)
      rather than coached, which is what stops the feature quietly
      becoming the Arabic-writing trainer it used to be.
      The "Typing" tab's Arabic-keyboard drill was the one thing left
      hanging here — **resolved by the English Sounds rebuild** below,
      which retired it in favour of a spelling drill.
- [x] MSA Bridge → PRUNED (only stale generated-types references remain
      until types regeneration)
- [x] Dialect Compare → PRUNED (revisit later as "how do Brits vs
      Americans say it")
- [x] Yemeni corpus tooling → PRUNED
- [x] Bible reading (Arabic scripture) → PRUNED
- [x] **Meme analyzer → FLIPPED**, not pruned. Memes carry the hardest
      English there is — sarcasm, slang, abbreviations, references — and a
      learner who can read every word still misses the joke, which is
      exactly the gap this app exists for. analyze-meme now reads the
      ENGLISH off the frames and writes every gloss, explanation and
      grammar note in the learner's dialect; the dialect identity and MSA
      rules still lead the prompt because everything it *generates* is the
      Arabic scaffold. Lines come back `english` + `arabic` + `literal`,
      a line with no English is dropped rather than rendered blank, and
      word tokens come off the English with a case- and
      punctuation-insensitive gloss lookup. `deepgram-transcribe` gained a
      per-call `language` (default "ar", so the Arabic-era callers are
      untouched) and the meme video's audio now goes out as English —
      before this it came back as garbled Arabic and every gloss
      downstream was built on it.
- [x] **Learn-from-X → FLIPPED**: new `analyze-english-text` replaces
      analyze-gulf-arabic on that page. Same TranscriptResult shape, same
      transcript components, `english` set so they take the English-first
      path. Auth posture kept identical to the function it replaced
      (verify_jwt = false, no cap) — the route has no guard and a
      signed-out visitor can already read a post there.
- [x] **Souq news → FLIPPED**: the regional search was the part worth
      keeping — a Yemeni learner reading about Sanaa is reading news they
      already half-know, which is the cheapest comprehension scaffold
      there is. So the region queries stay, `lang: "en"` sources English
      articles, and the AI retells each story in easy spoken English
      (`title_english` / `body_english` / per-sentence `arabic` + `literal`)
      with a dialect headline and summary beside it. `souq-news-quiz`
      takes the English body. Page chrome is Arabic; article text renders
      `font-english`.

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
      Souq now describe English content; Meme & Learn-from-X have since
      flipped for real and their tiles say so; Transcribe kept
      language-neutral until the pipeline flips).
      Hub strings stay page-local per the strings-module doc (single
      use); shared/counted strings live in `strings.ts`.
      Since migrated: the three hubs, Discover chrome (+ feed reason
      chips server-side), PAGE_HINTS/assistant context, the whole
      review surface (curriculum + personal decks + panels + cloze),
      Settings (+ Arabic labels on reasons/topics data), Auth,
      Onboarding, placement CTA.
      Remaining: Me-area pages (MyWords, Profile, analytics…),
      the learner-facing pass is now COMPLETE — every
      hub, practice surface, content page, Me-area tool and the video
      player speak Arabic. Admin stays English by design.
      **Correction**: "complete" was overstated twice over.
      The first pass covered pages and missed the shared components
      underneath them; an audit found ~125 English strings still live in
      learner-facing code. A second sweep migrated them: the subscription
      paywall (RequireSubscription, featureLabel, the Ask-AI live-voice
      gate), the transcript reader and its word/phrase popovers,
      TappableArabicText / TappableEnglishText, the shadowing panels, the
      Ask-AI chat and voice tabs, the quiz cards and results, the
      set-phrases request card, the Anki importer, the tutor candidate
      cards, the feedback widget, and the Listen / Stories / DailyStory /
      DailyChallenge / SavedChats / SavedTranslations / SetPhrases /
      NativeFeedback / Quiz / PlacementQuiz / ReadingPractice /
      ReadingLibraryStory / WritingPractice / Translate / Transcribe /
      TutorUpload / SouqNews pages. Deliberately left English at the time:
      the /alphabet routes (slated for an all-new English Sounds rebuild,
      so translating Arabic-alphabet copy would have been wasted work —
      since done, see the Arabic-only-surfaces section) and the Privacy /
      Terms pages (legal text, translated with the lawyer not the
      linter).
      A **third sweep** then took the chrome that sits above and beside
      the pages rather than inside them, which the page-by-page audits
      kept skipping: the bottom nav, the Ask-AI FAB and panel, the
      onboarding tour, the notification bell, the Continue card, the
      home-button / navigation arrows / phrase-of-the-day, the dialect
      ritual switcher, the weekly-goal and level-journey cards, the
      referral card and video rating, MyWordsSection and the My Words
      dialogs, SaveUnknownsBar, RootChip / RootFamilySheet,
      SoundSpotlight, DiscoverPreviewCard, and the ConversationSimulator
      / Curriculum / HowDoISay / ListeningPractice / MyWords /
      MyWordsReview / NativeFeedback / Pricing / PronunciationPractice /
      ReadingLibrary / ResetPassword / SetPhrases / SetPhrasesPractice /
      VocabGames / DiscoverVideo pages. Two of these were direction bugs,
      not just untranslated strings: NativeFeedback asked the learner to
      "write a few sentences in Arabic" when post-flip they write English
      for a native English speaker to review, and the dialect switcher
      rendered the same Arabic word twice once both its label fields were
      translated (the second field now carries a Latin transliteration,
      so the chip still shows two scripts).
      A **fourth sweep** widened the audit itself, which is why there was
      a fourth: the earlier passes matched plain quoted strings, so every
      label built from a template literal or wrapped around an
      interpolation was invisible to them, as was everything in the
      learner-facing `.ts` modules. Roughly 190 strings surfaced. The
      biggest was the whole logged-out **LandingHero** — untouched since
      the fork, still promising "Real spoken Arabic, one story at a time"
      and telling visitors "Ingleezy means حكاية". It is rewritten:
      Arabic throughout, English as the thing being learned and the
      dialect as what it is explained in, and the only Latin script left
      on the page is the logo. Also flipped: the free-daily-cap toast
      (every capped feature reaches for it), the notification bell's five
      messages — with `arCount` for the two that count things, since
      Arabic does not pluralise on one-vs-many — the crash and
      page-error toasts, the error boundary, the loading panel, the
      footer, the transcript reader's Literal / Fusha / On-screen /
      Sentences chrome, the tappable-text popovers, the practice sheet,
      the quiz cards, the tutor review controls, and the difficulty and
      dialect options in the reading library and translator.
      One more direction bug: the live-voice **drift badge** read
      "تحدث بالعربية" — Hakiya's meaning, where drift meant the partner
      spoke English. `detectLiveLeaks` was flipped long ago to flag the
      partner slipping OUT of English, so the badge had been telling the
      learner the exact opposite of what it detected. It now reads
      "خرج عن الإنجليزي".
      — grammar drills, listening practice, conversation + live voice,
      and the vocab games/battles now done. Backend flips landed with
      them: listening-quiz generates English audio via the Brain's
      english-target mode, and realtime-session-token's practice
      persona is an English immersion partner (assistant persona
      explains in dialect) with the input transcriber switched from
      "ar" to "en" for practice calls and auto-detect for the
      bilingual assistant.
      — mistakes/profile/how-do-i-say/culture-guide now done
      (culture-guide's backend prompt flipped with it: Anglosphere
      etiquette answered in the learner's dialect, exact English
      phrases quoted with dialect glosses, US/UK differences and
      transfer traps called out)
      with the pronunciation pages — no hardcoded learner-facing
      English; admin exempt
- [x] **Mirror-aware components — DONE.** Two problems, one cause: the root
      flip to `dir="rtl"` was never followed through the chrome.
      *Icons.* Every back button still rendered `ArrowLeft`, which in an RTL
      page points at where the learner is *going*, and every "next" rendered
      `ChevronRight`, pointing back at what they just finished. Row-disclosure
      chevrons pointed at the start of the row rather than the end. Fixed
      through `components/shared/DirectionalIcon.tsx`, which names the intent
      (`IconBack`, `IconNext`, `ChevronOpen`) and keeps the one mapping in one
      place — call sites never name a compass direction, so the next button
      added cannot get it wrong by copying a neighbour. Fixed to RTL rather
      than read at runtime: there is exactly one UI language, and a
      `useDirection()` hook would be machinery serving a case that cannot
      occur. It carries a test, because `IconBack = ArrowRight` reads like a
      bug and someone will eventually "fix" it — and nothing else in the suite
      asserts on which way a glyph points. The media transport (`SkipBack` /
      `SkipForward`) is deliberately excluded: those mean earlier and later in
      *time*, which does not mirror.
      *Spacing.* 177 physical `mr-`/`ml-`/`pr-`/`pl-` classes across 70
      learner files put every icon gap on the wrong side. Swept to the logical
      `me-`/`ms-`/`pe-`/`ps-` (Tailwind 3.4), and verified by grepping the
      built CSS for the `margin-inline-*` declarations rather than trusting
      the class names.
      *And the reason admin was left alone.* Admin inherited `dir="rtl"` from
      `<html>` — English prose right-aligned, with the same wrong-side gaps.
      Since admin is English by design, `AdminLayout` now opts back out with
      `dir="ltr"`, which fixes the whole subtree in one attribute and makes
      the physical classes there correct again. The shadcn primitives under
      `components/ui` are shared with admin and were left untouched for the
      same reason.

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
9. **English Sounds journey** — DONE

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
