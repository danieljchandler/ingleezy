# Second review pass — English-learning pedagogy & feature gaps, August 2026

A code-grounded second pass over Ingleezy, after the retarget reached "every
learner surface flipped". The first Hakiya-era audit
(`docs/product-audit-2026-08.md`) was about margin, metering and the AI stack;
this one is about **whether the app teaches English the way the research says
English gets learned** — specifically by Arabic speakers — and what features
that comparison suggests.

Scope of the pass: the daily loop and motivation systems, the SRS/vocabulary
engine, every listening and speaking surface, and content
selection/leveling/curriculum. Everything below cites the code it describes.

The headline: the retarget flipped the *content* of nearly every feature, but
several of the **instruments** that decide what a learner sees still measure
the Arabic side, sit unwired, or are never written. Those come first, because
building new pedagogy on top of miswired measurement wastes the work twice.

---

## Track 0 — Fix the instruments before adding features

These are not feature ideas. They are places where something the app already
claims to do is measuring the wrong thing or nothing. Each one silently
undermines a pedagogy feature that otherwise looks shipped.

### 0.1 Known-word coverage measures the Arabic scaffold, not the English — *2–3 days*

The single most important finding in this pass. The comprehensible-input
machinery — the "you know N% of this video's words" bar, the *just-right*
filter, the feed's sweet-spot curve — all run on the wrong language:

- `src/lib/comprehension.ts:106` reads `raw.arabic` (the dialect scaffold
  line) and `tokenizeArabic()` (`:50-56`) filters to the Arabic letter range,
  so **every English token is discarded**. The known-set is built from
  `word_arabic` (`useComprehensionMap.ts:33-34`).
- Server side is the same: `discover-feed/index.ts:159` builds `knownLemmas`
  from `user_vocabulary.word_arabic`, and its overlap runs over the video's
  curated Arabic highlight words.
- The file still imports `normalizeArabic` / `ALWAYS_ALLOWED` from
  `msaLeakDetector` (`comprehension.ts:23-26`) — Arabic tokenisation applied
  to English transcripts.

Post-rename, `word_english` is the target the learner is acquiring. So the
i+1 shelf currently answers "how much of the *subtitle* do you know", on an
app whose product is the English. Comprehensible-input research (the
90–98%-coverage sweet spot the bands at `comprehension.ts:124-128` encode) is
about coverage of the **input** — the English line.

**The move.** Flip both computations to the English side: tokenise
`line.english`, lemmatise lightly (case-fold, strip possessives/plural-s —
a small closed-class English stoplist, not NLP), build the known set from
`word_english` + `phrase` fronts, and keep the Arabic path only for bridged
Hakiya clips (`line.english` absent is already the switch everywhere else).
The bands, the filter chip and the feed weights all keep working — they just
start measuring the right language. Everything in Track 1 sits on top of this.

### 0.2 Streaks are displayed everywhere and written nowhere — *1 day*

`review_streaks` is read in six places (`StreakDisplay`, `MajlisWelcome`,
`useSmartNotifications:64`, `useGamification:272`, `useSocial:113`,
`useAnalytics:64`) and **nothing in the repo ever writes it** — no trigger, no
RPC, no client mutation; `increment_review_count()` touches only
`weekly_goals` despite its name. There is not even a `CREATE TABLE` migration
for it (`docs/testing.md:144` confirms a rebuilt DB lacks it). Consequences
cascade: the streak-at-risk notification is dead code, `streak_days`
achievements can never fire, and the flame on the home hero shows a number
with no writer. Habit streaks are the single most load-bearing retention
mechanic in this category — right now the app has the UI for one and not the
mechanic.

**The move.** One migration (create the table properly) + extend the XP RPC
to upsert the streak on any XP-earning day. Then the dead consumers come
alive for free. Fold in the two related inconsistencies while there: three
different week-start conventions (`useGamification.ts:151` Monday vs
`Onboarding.tsx:121` Sunday vs SQL `date_trunc`), and the daily-challenge
multiplier disagreeing between client (`DailyChallenge.tsx:187`,
`1 + streak*0.1`) and server (`daily-challenge/index.ts:70`, step function).

### 0.3 The conversation mic transcribes English speech with an Arabic ASR — *hours*

`ConversationSimulator.tsx:214` sends push-to-talk audio to
`munsit-transcribe` — the Arabic recogniser — on a page whose placeholder
says "اكتب بالإنجليزي". This is exactly the bug class `score-shadow-attempt`'s
docstring records finding and fixing in shadowing (English takes scored by an
Arabic ASR return garbage that *looks* like a transcription). Route it to the
Deepgram EN path the shadow scorer already uses.

Same page, same visit: the text lane calls `free-chat`, while
`conversation-practice` — the function with transfer-error detection and
difficulty tiers — has **zero callers** in `src/`. Either point the page at
it or port its transfer detection into `free-chat` and delete it; an orphaned
second conversation prompt is exactly the drift the retarget doc warns about.

### 0.4 Azure already scores prosody and the app throws it away — *hours*

`azure-pronunciation/index.ts` requests `EnableProsodyAssessment: true`
(`:256-263`), parses `ProsodyScore` and returns it (`:191-195`) — and
`grep -rni prosody src/` returns **zero hits**. The client interface
(`useAzurePronunciation.ts:45-60`) simply doesn't declare the field. The same
boundary drops the per-phoneme `nbest` alternatives (`:167-180`) — i.e. *what
the learner actually said instead of the target*, the one datum that turns
"accuracy 62" into "you said /b/ where /p/ goes".

**The move.** Declare and render both: a prosody sub-score on the result
panel, and a "you said → target" phoneme chip when nbest disagrees with the
target. This is the cheapest genuinely-new feedback in the entire review —
the server work is already done and paid for. It is also the down-payment on
Track 2.

### 0.5 The curriculum still describes the Arabic app — *1–2 days*

`20260224000000_curriculum_restructure.sql:120-127` seeds Stage 1 as *"Read
Arabic script, produce Gulf sounds, use 50+ survival phrases"* and Stage 3 as
*"Follow authentic Gulf content"* — and no later migration re-seeds them. A
learner opening `/curriculum` today reads stage descriptions for the language
they already speak. Alongside it: `useLessons.ts:33-40` never filters on
`status`, so draft lessons from the admin builder are learner-visible; and
placement writes `profiles.placement_level` which `Curriculum.tsx` never
reads — there is no path from "you tested A2" to "start at stage 2".

**The move.** Re-seed the stages for the English journey (CEFR-aligned,
descriptions in Arabic), filter `status='published'`, and route placement
into a suggested starting stage. Small, and it un-embarrasses the app's
spine.

### 0.6 Smaller instrument fixes, batched — *2–3 days total*

- **Curriculum new cards are uncapped in practice**: `useClaimNewCard` (the
  server-counter increment) is called only from `MyWordsReview.tsx:554`; the
  curriculum deck reads the budget but never claims against it.
- **`match_content` has zero callers** — pgvector, the HNSW index and the
  embedding writer all exist (`20260812160000`), and nothing ever issues a
  similarity query. Also, embedded content is still Arabic-first shaped.
- **`Feed.tsx:91-96` throws away** the `comprehension`, `reason` and `bucket`
  the feed function computes per item, and hardcodes the streak to `0`
  (`:79`). The home feed — the highest-traffic surface — shows none of the
  personalisation the server already did.
- **`weekly_recommendations` and `challenges.*_progress` are read and never
  written** — the bell's "coach advice" and friends' challenge bars can never
  move.
- **XP is awarded by 4 of the ~10 daily activities** (reviews, daily
  challenge, reading, listening practice); daily story, Souq, video watching,
  set phrases, sounds, writing and pronunciation award none, while the
  queue's `xpEstimate` promises otherwise (and is itself never rendered).
- **Weekly goal targets don't roll over** — set only at onboarding/Settings
  for the *current* week; next Monday's row is created with the migration
  default and the learner's chosen target is lost (`WeeklyGoalCard.tsx:15-25`
  documents the resulting bug).
- **Push copy is English** (`notify-due-reviews/index.ts:189-193`) in an
  Arabic-first app, only one push type exists, and there is **no cron entry**
  for the sender in `supabase/config.toml` — the whole push stack may never
  fire.
- **`set_phrases` seeds are still Arabic-era** (`20260723020000` — Arabic
  phrases with English glosses, all drafts).

---

## Track 1 — Input: make listening comprehensible, then make it work

The app's input volume is genuinely strong (videos, Listen episodes, reading
library, stories, Souq, memes). What's missing is the *technique* layer the
research is clearest about.

### 1.1 A listen-first mode — hide the English, then reveal — *3–5 days*

Every transcript surface shows the English by default; the three toggles on
DiscoverVideo (`:1902-1926`) govern only the Arabic support layers. **The
target-language line cannot be hidden anywhere.** That forecloses the single
best-evidenced listening exercise there is: listen → attempt understanding →
reveal → re-listen. Reading along on the first pass trains reading, not
listening — and Arabic speakers' listening gap (connected speech, see Track
2) is precisely what reading-along papers over.

**The move.** A per-line "listen first" mode on DiscoverVideo and
ListenEpisode: English blurred/tap-to-reveal, auto-reveal after the second
replay. The line-by-line playback mode (`:1893-1941`) already gives the
replay loop; this is a render-state change, not an engine change. Track
reveal-before-listen vs listen-first per learner — it feeds 1.4.

### 1.2 Dictation from real lines, with a word-level diff — *3–5 days*

ListeningPractice's dictation mode exists but is binary exact-match
(`:222-241`) — no partial credit, no indication of *which* words were missed
— over TTS sentences in one hardcoded voice. Meanwhile the app already owns
`alignWords()` (`score-shadow-attempt/index.ts:111-161`), a per-token
match/sub/missing/extra aligner, used for speech and never for typing.

**The move.** Reuse the aligner for dictation: show the learner's sentence
with matched words green, substitutions marked, missing words gapped;
missed words offered as one-tap saves; misses logged to `learner_errors`
(dictation misses are disproportionately function words and reductions — the
exact evidence Track 2 needs). Then add real-clip dictation: the eligible
shadow-clip pool (`useShadowQueue`) is *already* short native lines with
audio; typing what you hear from a real speaker is a different (and harder)
skill than typing TTS.

### 1.3 Put slow playback where comprehension happens, not where XP does — *hours*

Speed control currently exists as a *challenge* — `SPEED_RATES` in
ListeningPractice pays more XP for faster (`:50-55`) and renders only in
`speed` mode; dictation and comprehension are locked at 1.0x, and
ListenEpisode has no rate control at all (`:70-93`). That is backwards:
slow-down is a comprehension scaffold, speed-up is a fluency drill, and the
one place learners most need 0.75x is the one place it's absent.
DiscoverVideo already has the full 0.5–1.5 range (`:1877-1892`) — copy the
control to ListenEpisode and un-gate it in dictation/comprehension (keep the
XP bonus tied to the *speed challenge* mode only).

### 1.4 Real comprehension questions — *2–3 days*

The "comprehension" mode's MCQs ask *what the sentence means*
(`listening-quiz/index.ts:65`) — a translation-matching task, not
comprehension. Gist / detail / inference questions are a different skill and
the generators can already write them (reading-passage's quiz does).
Regenerate the listening quiz prompt to ask about content, not meaning, and
add one gist question *before* the transcript is available on ListenEpisode —
which currently has **no questions at all** (`:202-225`), so an "episode" is
consumed with zero retrieval.

### 1.5 Level the Listen library and count the input — *2–3 days*

`listen_episodes` has **no level column at all** and the generator takes no
level; reading passages carry a 3-tier `difficulty` that never reconciles
with CEFR. Pass the learner's CEFR into `generate-listen-script` (it already
receives the learner profile — `:105`), stamp episodes with it, and unify the
two level systems behind one mapping instead of the lossy `DIFF_TO_CEFR`
bridge in the feed (`:32-37`).

Then count the input: extensive reading/listening programs live on visible
volume — *words read* and *minutes listened* are the metrics learners in
those programs track, and every surface here already knows its word count.
Two counters on the analytics page and a weekly total in the Monday summary.
Cheap, and it reframes "watched a video" as accumulation rather than a
checkbox.

---

## Track 2 — The music of English: suprasegmentals are a total blank

The headline *content* gap of this pass. The English Sounds journey is a
genuinely well-built segmental curriculum — 28 stops ordered by contrastive
difficulty, minimal pairs, spelling, discrimination games. But a repo-wide
search for stress / intonation / rhythm / linking / weak forms / reductions
finds **zero teaching content**. Every hit is incidental: a fallback line in
the pronunciation-feedback prompt, CEFR descriptors that list connected
speech as a reason a video is *hard* (`rate-video-cefr:310-343`), TTS engine
conditioning.

This matters more for Arabic speakers than for most L1s, and the literature
is blunt about it: Arabic and English are both stress-timed, but Arabic's
stress is predictable and its vowel system doesn't reduce — so Arabic
speakers give full value to every English vowel, don't produce or *perceive*
schwa, and transfer regular stress placement onto English's lexical stress.
The perception half is why suprasegmentals are a **listening** feature, not
just an accent feature: a learner who has never been taught that "can" is
/kən/ in "I can go" cannot hear the sentence they're being played. The app's
own CEFR rater already knows this — it charges videos difficulty for
`gonna/wanna/lemme` — while nothing anywhere teaches them.

**The move — a second track in the Sounds journey ("موسيقى الإنجليزي"), ~2
weeks, in this order:**

1. **Schwa and weak forms** — the missing 29th sound. /ə/ is the most common
   vowel in English and is not one of the 28 stops. Teach it as the
   citation-form vs weak-form pair for the closed class (can, was, to, for,
   of, that…): hear both, discriminate ("did you hear *can* or *c'n*?"),
   MinimalPairGame's mechanic reused as-is.
2. **Word stress** — stress-placement drills on the learner's own deck
   (SYLlable-tap UI: tap the stressed syllable, score against dictionary
   stress). Minimal stress pairs (REcord/reCORD) as a dedicated stop.
3. **Reductions and linking** — gonna/wanna/gotta/lemme + linking-r and
   consonant-vowel liaison, taught as *listening decode* first (dictation
   lines seeded with them — Track 1.2 supplies the mechanic) and production
   second.
4. **Sentence stress and intonation** — content-word stress, question vs
   statement contours. Scoring exists already: this is where the discarded
   `ProsodyScore` (0.4) becomes the grade for shadow takes, which are the
   natural drill surface for rhythm.

Everything reuses existing mechanics (stops, steps, discrimination games,
shadowing, dictation) — the work is curriculum data plus one new syllable-tap
widget, not new engines. Add the missing diphthongs (/aɪ eɪ oʊ aʊ ɔɪ/) and
/ɜːr/ to the segmental track while in the file; the current 28 skip them.

---

## Track 3 — Output: close the loop on speaking and mistakes

### 3.1 Task-based speaking scenarios with a debrief — *1–2 weeks*

The conversation simulator has six topic strings (`TOPIC_SEEDS`, coffee /
family / work / travel / food / free) spliced into the prompt as "Today's
topic: X" — no roles, no goal, no success condition. And when a live call
ends, `handleEnd` is `stop()` — **the transcript is discarded**; the app's
most authentic speaking practice produces no artefact, no score, no error
log, nothing in `learner_errors`.

Task-based language teaching is the best-supported frame for speaking
practice: give the learner a *job* (order coffee and change the order when
they're out of oat milk; call the landlord about the leak; answer "tell me
about yourself"), let the conversation run, then debrief. The app has every
piece: personas and difficulty tiers already exist server-side
(`realtime-session-token:36-44`), transfer detection exists
(`detectTransferErrors`), and the orphaned `conversation-practice` function
was already built to do the analysis.

**The move.**
- A scenario deck (10–15 authored situations per level: role, goal, twist,
  target phrases drawn from `set_phrases`) replacing the topic chips.
- On call end, keep the transcript and run one Brain call over it: goal
  achieved?, 3 recasts of transfer errors (tagged into `learner_errors`),
  2 phrases a native would have used (one-tap save), fluency stat
  (words/turn). That debrief card is the single feature that makes live
  voice *teach* rather than merely *exercise* — and it makes the voice
  minutes feel worth paying for.
- Completing a scenario's goal is the natural place for a can-do checkmark
  (Track 5.2).

### 3.2 Make mistakes drive practice, not just a list — *1 week*

`Mistakes.tsx` is deliberately "a review surface, not a drill" — and nothing
else drills them either. `learner_errors` is written by five scorers with
interference categories, and its only consumption is the LLM `weak` bucket.
`detail` jsonb (per-phoneme data, alignment diffs) is written and never read.
Errors never touch `user_concept_mastery`, so the grammar ladder doesn't know
about mistakes made *outside* grammar drills. Error-driven relearning is the
whole point of logging errors — this is stored fuel with no engine.

**The move.**
- **"درّبني عليها" on the Mistakes page**: generate a 5-item micro-drill from
  the learner's top error group (the generators all accept arbitrary
  seeds; `practice-sentence-coach` already exists for spoken retry).
- **Map `error_kind` → taxonomy rung** and feed `applyOutcome`, so an
  article error in *writing* demotes the articles rung and the grammar
  focus-nudge starts pointing at reality.
- **Aggregate the kinds**: "40% of your errors are articles" on the
  analytics page — the free-text kinds are already normalised enough via
  `mistakes.ts:62-78`.

### 3.3 A typed-recall card and per-skill balance in the SRS — *3–5 days*

Card types today: recognition, audio, production (self-graded reveal), and a
cloze that exists only in the personal deck on alternating indices. There is
**no free-typed recall** anywhere in the SRS — the one modality that catches
spelling, article and morphology errors the reveal-and-self-rate flow lets
slide (and Arabic speakers' p/b spelling transfer is literally seeded rule
#12). The typing machinery exists (`typingDrills.ts` scores per-keystroke) —
it's just parked on a standalone page. Add `typed` as a scheduled card
variant (production cards past first success), diff with the same
`alignWords`, log misses. While in there: give the curriculum deck the cloze
card (it has none), and constrain cloze distractors (currently any due word,
no POS control).

---

## Track 4 — Vocabulary: put frequency science under the deck

### 4.1 Frequency-grade the vocabulary — *1 week, highest-value item in this track*

There is **no frequency information anywhere**: no rank column, no word
list, no CEFR tag on `vocabulary_words` (grep for cefr/frequency/ngsl/
oxford3000 over the vocab tables returns nothing). New curriculum words are
introduced by *shuffling the entire table* (`useAllWords.ts:30-94`);
suggested flashcards are prompted to "mix difficulty" with no list. Meanwhile
vocabulary-size research is the most actionable finding in L2 pedagogy: the
~2,800 highest-frequency word families cover ~90%+ of spoken English, and
coverage targets are the basis of the comprehension bands the app already
renders.

**The move.** Import one open frequency list (NGSL is licensed for this) as
a reference table; stamp `frequency_rank` + CEFR band onto
`vocabulary_words` and onto saved words at save time; then:
- introduce curriculum new cards **by band** instead of by shuffle;
- constrain `suggest-flashcards` to the learner's band with the list as the
  sampling frame;
- show a **"top-1000 words" coverage meter** — "you know 640 of the 1,000
  most common words" is the most motivating progress number the app could
  render, because it's true and it moves weekly;
- feed rank into 0.1's English-side comprehension, so unknown-word
  extraction can prioritise frequent unknowns (learn "though" before
  "algorithm").

### 4.2 Give formulaic language a first-class home — *1 week*

Phrasal verbs, collocations and chunks have **zero structural presence** —
the words appear only inside LLM prompt prose. Yet formulaic sequences are
where the lexical-approach research puts much of fluency, phrasal verbs are
a notorious Arabic-speaker gap (Arabic has no verb-particle pattern —
learners systematically avoid them and calque single-verb equivalents), and
the app already has the perfect vehicle: `set_phrases` with tags, formality,
distractors and its own SRS. Add linguistic tags (`phrasal_verb`,
`collocation`, `chunk`), seed a phrasal-verb pack organised by *particle
meaning* (up = completion, out = exhaustively…) rather than alphabetically,
and have the transcript word-save flow detect when a tapped word sits inside
a phrasal verb and offer the phrase instead of the bare verb (the aligner and
the line context are both in hand at tap time).

### 4.3 Finish the FSRS story — *1 week*

The Hakiya audit's C2 shipped its cheapest third: the retention dial exists
(`desired_retention`, Settings). Still stock: the 17 weights (the comment at
`spacedRepetition.ts:37` still says "can be personalised"), no optimizer, no
true load balancing (only ±5% fuzz — no due-day histogram lookahead, no
`maximumInterval` cap), and **four separate SRS implementations** write the
same fields (`useReview`, `useUserVocabulary`, `useUserPhrases`,
`useSetPhrases` — only two share `buildReviewOrder`, and the leech threshold
is copy-pasted three times). Consolidate the four paths onto one scheduling
module first — per-user optimisation is a job you run *once* the write path
is single — then fit weights for learners past ~400 reviews.

---

## Track 5 — Teach the interference, and prove the progress

### 5.1 Learner-facing micro-lessons from the interference rulebook — *1 week*

The 12 seeded interference rules are the app's stated differentiator, and
today they are visible **only to admins** (`AdminInterferenceRules.tsx`).
Learners meet them solely as reactive chips after an error. Each rule already
carries a hand-written Fusha `explanation_ar` and good/bad examples — that
*is* a micro-lesson, unshipped. Add `/why-english-does-that`: one card per
rule (the Arabic habit → the English rule → 3-item try-it drill via the
grammar generator), linked from every error chip that names the category
("لماذا؟ →"). Explicit contrastive instruction on transfer errors is one of
the better-supported uses of L1 in the classroom — and it is the feature a
competitor without the L1 thesis cannot copy.

While in there: three rule categories (copula, word_order, resumptive
pronouns) have **no drill rung** in the grammar taxonomy — add them; and the
`dialect` scoping on rules is unused (the Egyptian /θ/→/s/ case the migration
header names is not seeded) — seed the first dialect-scoped rules.

### 5.2 CEFR can-do statements as the visible spine — *1 week*

Grep for can-do returns nothing. The app has placement, `placement_history`,
and a 90-day recheck nudge buried on the Profile page — but between
placements there is *no visible skill progress*, only XP. CEFR's actual
substance is its can-do descriptors ("I can order food", "I can describe my
job"), which are free, learner-legible, and map naturally onto features the
app already has: complete the café *scenario* (3.1) → check "أقدر أطلب في
مطعم"; pass the articles drill at strong → check its descriptor. A per-level
checklist of 15–20 descriptors, auto-checked by feature completions and
self-checkable otherwise, gives (a) a progress artefact between placements,
(b) an *adaptive daily-queue seed* (Track 6.1 wants exactly this), and (c)
the natural bridge to the certification product the first audit proposed
(D3).

### 5.3 Auto-focus the grammar drills — *2–3 days*

The mastery ladder computes `next_due_at` per concept and never uses it to
*build* anything; the "focus" chip is advisory and difficulty defaults from
placement, not mastery. Add a "درّب نقاط ضعفي" one-tap entry that picks the
due/weak rung automatically — the data and the generator both exist; what's
missing is the button.

---

## Track 6 — The daily loop: from checklist to coach

### 6.1 An adaptive queue — *1 week*

`useTodayQueue.ts:9-16` is the same seven hardcoded tasks for every learner
on every day, gated only by due-counts; completion lives in localStorage
keyed by device; the curriculum lesson is not in the loop at all. The queue
is the app's coach voice, and today it can't say anything personal.

**The move.** Server-side task completion first (a small
`daily_task_completions` table — localStorage completion is also why streaks
and analytics can't see the loop), then compose the queue from signals that
already exist: due reviews (keep), the next curriculum lesson
(`findNextUpLessonId` already computes it), the weakest grammar rung when one
is due (5.3), a sounds stop when the ring is behind, the next unchecked
can-do's feature (5.2), a *just-right* video (0.1). Cap at five, explain each
pick in one Arabic clause ("لأنك أخطأت في حروف الجر أمس") — the explanation is
what makes it feel like coaching rather than a to-do list.

### 6.2 Finish the motivation mechanics the UI already promises — *1 week*

With 0.2's streak writer in place: streak **milestones** (7/30/100 with the
referral card surfaced at exactly those moments — the first audit's D4 noted
motivation peaks are where referral belongs), a **streak freeze** earned by a
7-day week (loss-aversion protection is the single most copied mechanic in
the category because it works), XP for the six activities that award none,
weekly-goal rollover, and rendering `AchievementsGrid` somewhere a learner
actually goes (it is imported on Home and never rendered; achievements also
need a seed migration — the catalogue currently isn't in the repo). Push
notifications: Arabic copy, a cron entry (there is none), and a second type —
streak-at-risk — now that the streak exists.

### 6.3 Instrument learning outcomes — *3–5 days*

There is no client event stream at all (`feature_metrics` is service-role
ops telemetry; no page views, no funnels, no exposure logs, no variant
assignment). Every pedagogy change in this document is currently
unevaluable: "did the just-right filter improve retention?" has no data
path. A minimal `learning_events` table (event, surface, item, correct?,
latency) written from the review/drill/dictation/scenario surfaces — plus a
per-learner weekly retention roll-up — is enough to compare cohorts before
and after each Track lands. Ship it before the big tracks, not after.

---

## Track 7 — New product lines the codebase is already pointed at

### 7.1 An exam-prep mode (IELTS first) — *2–3 weeks, new revenue line*

`IELTS` appears zero times in the repo, and the landing page positions
against "exam English" — a fine brand stance that is leaving the market's
single biggest *purchase trigger* on the table. For Gulf, Egyptian and Yemeni
learners, IELTS/TOEFL is the gate to study visas, professional licensure and
migration; it is the moment an Arabic speaker *pays* for English. The app
already owns every component of the IELTS speaking and writing sections:
scored monologue speaking (Azure + prosody), a writing coach with error
tagging, adaptive placement, listening comprehension, and a human-review
pipeline (`NativeFeedback`) that could sell **mock-band scoring by a real
examiner** — the high-margin human product the first audit wanted (D2), with
an audience that already budgets for it. Ship as a mode, not a rebrand:
"وضع الآيلتس" — timed Part-2 cue cards through the conversation simulator,
Task-1/Task-2 writing prompts through the writing coach, an estimated band
trajectory next to the CEFR journey.

### 7.2 Work English scenarios — *1 week, rides on 3.1*

"Interview" exists only as a listening format and a YouTube search term.
The scenario deck (3.1) should ship with a work pack — job interview,
salary conversation, standup update, complaint call — and the writing coach
with an **email mode** (request, apology, follow-up; register is where
Arabic formality transfer bites hardest). This is the `learning_reason =
work` cohort's entire use case, and that field is already collected at
onboarding and stored on the profile — content conditioned on it exists;
*features* conditioned on it don't.

### 7.3 Levantine — the fourth dialect — *1–2 weeks*

Levantine speakers can *filter content* by their dialect but cannot *be*
Levantine (`DialectModule` is Gulf/Egyptian/Yemeni). Syrian, Jordanian,
Lebanese and Palestinian communities — including the largest Arabic-speaking
diaspora populations in exactly the Anglosphere countries the Culture Guide
covers — are the biggest addressable expansion this side of Maghrebi. The
survey found the touch list is bounded: `config.ts`, `DialectContext`,
onboarding, the `interference_rules` CHECK, one `placement_level_levantine`
column, ~10 `DIALECT_PROMPTS` maps, and the function-word lists. One orphan
already points the way (`useShadowQueue.ts:77` maps `Levantine: "ar-JO"`).

### 7.4 Turn the embeddings on — *3–5 days*

The first audit's B1 was half-executed: pgvector, the table, the index, the
writer all exist — and `match_content` has zero callers, while the embedded
content is still Arabic-shaped. Re-embed English-first, then wire the two
cheapest callers: "more like this" on DiscoverVideo, and weak-word→clip
matching to power the queue's video pick (6.1) — serve the clip that uses
the words the learner keeps missing.

---

## Priority

Instruments first — they multiply everything after them. Then the two tracks
with the highest pedagogy-per-effort (suprasegmentals, scenarios+debrief),
then the structural investments.

| # | Item | Effort | Why this rank |
| --- | --- | --- | --- |
| 0.1 | Coverage → English side | 2–3 days | Headline feature currently measures the wrong language |
| 0.3 | EN ASR in conversation; un-orphan conversation-practice | hours | Active mis-scoring of learner speech |
| 0.4 | Surface prosody + phoneme nbest | hours | Paid-for feedback, discarded at the client |
| 0.2 | Write the streak; fix week math | 1 day | Every retention mechanic reads it |
| 0.5 | Re-seed curriculum stages; publish filter; placement routing | 1–2 days | The spine describes the wrong app |
| 1.3 | Slow playback where comprehension happens | hours | Backwards incentive today |
| 6.3 | Learning-outcome events | 3–5 days | Makes every later item measurable |
| 0.6 | Batched instrument fixes | 2–3 days | Feed personalisation, XP parity, push cron |
| 1.1 | Listen-first mode | 3–5 days | The core listening exercise, currently impossible |
| 1.2 | Dictation with word-diff + real clips | 3–5 days | Reuses the aligner; feeds Track 2 |
| 3.2 | Mistakes → drills → mastery ladder | 1 week | Stored fuel, no engine |
| 5.3 | Auto-focus grammar drills | 2–3 days | Data and generator exist; button missing |
| 2 | Suprasegmentals track (schwa → stress → reductions → intonation) | 2 weeks | Biggest content gap, strongest L1 fit |
| 3.1 | Scenarios + debrief | 1–2 weeks | Makes live voice teach; unlocks 7.2 |
| 4.1 | Frequency-graded vocabulary | 1 week | Puts science under new-word selection |
| 5.1 | Interference micro-lessons | 1 week | The differentiator, currently admin-only |
| 6.1 | Adaptive daily queue | 1 week | Turns checklist into coach; needs 0.2, 5.2 |
| 5.2 | Can-do checklist | 1 week | Progress spine between placements |
| 6.2 | Streak freeze, milestones, XP parity | 1 week | Retention mechanics the UI promises |
| 4.2 | Phrasal verbs / collocations | 1 week | Known Arabic-speaker gap, vehicle exists |
| 4.3 | Consolidate SRS; per-user FSRS | 1 week | Four write paths → one, then optimise |
| 7.4 | Wire match_content | 3–5 days | Half-built moat |
| 3.3 | Typed-recall card | 3–5 days | Catches what self-grading misses |
| 1.4/1.5 | Real comprehension Qs; level Listen | ~1 week | Input volume → input pedagogy |
| 7.2 | Work English pack | 1 week | learning_reason cohort, on 3.1 |
| 7.3 | Levantine | 1–2 weeks | Largest bounded expansion |
| 7.1 | IELTS mode | 2–3 weeks | The purchase trigger; new revenue line |

### If you only do two weeks

1. All of Track 0 (≈1 week total) — the app starts measuring what it thinks
   it measures.
2. Slow playback + listen-first + dictation diff (1.1–1.3) — listening
   becomes trainable, not just watchable.
3. Prosody surfaced + schwa/weak-forms stop shipped — the first
   suprasegmental content, riding on scoring that already works.

---

The through-line this time: the retarget built an unusually complete set of
*surfaces*, and the L1-interference thesis is real and coded. What separates
this app from a generic one now is not more surfaces — it is (1) instruments
that measure the English, (2) the music of English taught explicitly to the
one L1 group that most needs it taught, and (3) closing the loop so that
every error a learner makes somewhere becomes practice somewhere else.
