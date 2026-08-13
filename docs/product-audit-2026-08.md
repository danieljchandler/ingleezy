# Product & AI stack review — August 2026

A code-grounded review of where Hakiya should invest next. Scope: 65 learner
pages, 87 edge functions, 139 migrations, 3 dialects.

The app is further along than a feature list suggests — FSRS scheduling, a
server-built learner model, a grammar mastery ladder and root-linked cards all
ship today. So the useful findings are not *missing features*. They are four
places where the product gives away margin, leaves the AI stack
under-exploited, stops short of what the learning research supports, and
under-prices itself.

## What's already strong

Stated plainly, because it rules out most of the obvious advice. None of this
needs building — it needs exploiting.

- **FSRS-4.5 scheduling** across three decks, with leech handling
  (`useLeechPrefs`), new-card budgets (`useNewCardBudget`) and a forecast chart.
- **Server-built learner model** (`_shared/learnerProfile.ts`) — known / weak
  vocabulary from real SRS state, injected into every generator, never
  client-supplied.
- **Grammar mastery ladder** (`user_concept_mastery`, `conceptMasteryCore.ts`)
  with a canonical taxonomy and a "wrong answer never promotes" rule.
- **Root morphology** — `useSiblingWords` links cards sharing an Arabic root.
- **The dialect Brain** — MSA-leak detection, repair pass and native-speaker
  validator around every generation call.
- **Input volume** — video pipeline, Listen episodes, Reading library, stories,
  Souq news, memes.

---

## Track A — Stop the margin leaks

Four small diffs. Highest urgency in this document: every day they run they cost
real money, and there is no way to see how much.

### A1. Live voice has no usage limit at all — *hours*

`supabase/functions/realtime-session-token/index.ts:115-117` gates assistant
mode on **any** active subscription. No daily cap, no minute budget, no session
length ceiling. Practice mode — the cheaper path — is the one that gets a limit.

```ts
const cap = mode === "assistant"
  ? await requireActiveSubscription(req, corsHeaders)
  : await enforceDailyCap(req, "live-session", 30, corsHeaders);
```

On OpenAI Realtime audio pricing, one enthusiastic subscriber on the $5 plan can
cost several times their subscription in a month. Uncapped downside on the
cheapest tier.

**The move.** Meter voice in **minutes, not sessions** — sessions are the wrong
unit when length is unbounded. Monthly minute allowance per tier, top-ups for
sale, consumed seconds recorded on session close, remaining balance shown to the
learner (which doubles as an upgrade prompt).

### A2. The $15 tier buys nothing the $5 tier doesn't already have — *1–2 days*

`_shared/usageCap.ts` asks one question — is this user subscribed? — and both
paid tiers answer yes. All-In advertises "Priority AI processing"; nothing
enforces it. The upgrade path rests on saved-word limits and library breadth,
while the genuinely expensive capabilities (voice, video ingestion, image and
jingle generation) are equally unlimited on both.

**The move.** Make the cap helper **tier-aware** and express each tier as an
allowance table rather than a boolean. Put the expensive capabilities on the
ladder: voice minutes, video ingests per month, generated images.

### A3. You cannot answer "which feature loses money?" — *1 day*

`supabase/migrations/20260224010000_llm_usage_logs.sql` records
`function_name`, `llm_used`, `phrase`, `user_id`, `created_at` — no token
counts, no cost. Speech, TTS and image spend are not logged at all. With eleven
external providers wired up, unit economics are currently unknowable, which
makes every pricing decision below a guess.

**The move.** Add prompt / completion / cached token counts, provider and
computed cost; log the speech and image legs the same way. Then one admin view:
cost per active user per feature per week.

### A4. Every AI call re-sends the same long preamble at full price — *1–2 days*

A repo-wide search for `cache_control` returns nothing. Each Brain call
rebuilds and re-sends the dialect identity block, the `dialect_rules` Rulebook
and the learner profile as fresh input tokens, across ~28 functions. That
preamble is exactly the shape prompt caching exists for: long, stable, repeated
across calls and users.

**The move.** Restructure the system prompt as **[stable dialect block] →
[stable Rulebook] → [volatile learner profile]** and mark a cache breakpoint
after the stable half. Order matters — anything volatile placed early
invalidates everything after it.

---

## Track B — Get more out of the AI stack

The provider surface is impressive: six ASR engines, three TTS routes, a model
registry with four named lineups. What's missing is the connective tissue that
turns it into a moat.

### B1. There are no embeddings anywhere — and that's the biggest unlock — *1–2 weeks*

No migration mentions `vector` or `embedding`. Content is found by recency,
dialect and topic; nothing can answer *"which video actually uses the words this
learner is weak on?"*

What it unlocks:

- **Weakness-targeted content** — match a learner's weak-word set against every
  transcript line and serve the clip that drills exactly those.
- **Semantic dedupe** — the dialect corpus and vocabulary lists almost certainly
  carry near-duplicates keyword matching can't see.
- **RAG over the Rulebook** — retrieve the three relevant dialect rules per call
  instead of prepending all of them.
- **"More like this"** — currently impossible.

**The move.** Enable `pgvector`, embed transcript lines, vocabulary and reading
passages, index them. Most likely item on this list to produce a feature
competitors can't copy quickly, because it compounds with the existing corpus.

### B2. Model swaps are only testable in production — *1 week*

The MSA-leak detector and dialect validator run **online, per request**. There is
no offline golden set, so a model change ships blind. The chat model was just
moved to Claude Sonnet 5; no artefact says whether dialect fidelity improved.

**The move.** A **frozen eval set** — a few hundred prompts per dialect with
known-good outputs, scored by the existing MSA-leak detector plus a judge model
on dialect authenticity and register. Run in CI on any change to
`modelRegistry.ts`. Second-order benefit: it tells you when a *cheaper* model is
good enough, which is where routing savings actually come from.

### B3. Everything is generated on demand, at full latency and full price — *3–5 days*

Nothing is prepared ahead of time, so the learner waits and you pay peak rates.

**The move.** A nightly job that pre-builds tomorrow's personalised set — story,
reading passage, drill batch — for active learners only. Instant on open, batch
pricing where offered, and the existing due-review push gains something concrete
to announce.

---

## Track C — Deepen the pedagogy

The features learners will actually feel. Each is grounded in something the app
already stores but doesn't yet use.

### C1. The comprehension shelf — *1–2 weeks*

The strongest single feature idea here. The research consensus behind
comprehensible input is that learners progress fastest on material where they
already know the large majority of the words — and Hakiya is unusually well
positioned to compute that, because it knows each learner's vocabulary from real
SRS state and it owns the transcripts.

Today the library sorts by recency, dialect and topic. A learner cannot tell
whether a video is a comfortable stretch or a wall.

**The move.** Compute a **known-word coverage percentage** per learner per
content item and surface it everywhere content is listed — Discover, Reading
Library, Listen. Add a *Just right for you* shelf filtered to the sweet spot,
with the handful of unknown words pre-extracted as a saveable card set.
`_shared/coveragePlanner.ts` and `learnerProfile.ts` already do most of the work;
what's missing is running it against library items and showing the number.

### C2. FSRS is running on frozen factory settings — *1 week*

`src/lib/spacedRepetition.ts:36-57` ships the stock 17-parameter FSRS-4.5
defaults for every learner — the comment even notes they "can be personalised
per-user with optimizer". Most of FSRS's published advantage comes from fitting
those parameters to the individual's own review history, which is already
recorded in `word_reviews`.

**The move.**

- **Per-user optimisation** once a learner passes a few hundred reviews, re-fit
  periodically.
- **A retention dial** in Settings — fewer reviews / more forgetting vs more
  reviews / better recall. One slider, and it makes the scheduler legible.
- **Load balancing** so a heavy import doesn't produce a 300-card day six months
  out — the most common reason people abandon spaced repetition.

### C3. There is no way to produce written Arabic anywhere in the app — *2 weeks*

Listening, reading, speaking and pronunciation are covered thoroughly. Writing is
absent entirely: no Arabic keyboard practice, no typing trainer, no guided
composition, no handwriting tracing to pair with the Alphabet Journey. For a
learner who wants to text in Gulf Arabic — arguably *the* use case for spoken
dialect today — that's a hole, since dialectal Arabic is overwhelmingly a written
medium in messaging.

**The move.**

- **Arabic keyboard trainer** — progressive key introduction tied to letters
  already learned in the Alphabet Journey.
- **Handwriting tracing** on the existing letter pages: initial, medial, final
  and isolated forms, stroke-ordered.
- **Guided writing with correction** — reply to a message in dialect, corrected
  against the same Rulebook that governs generation, with errors written to
  `learner_errors` so they feed the learner model like every other error type.

### C4. Placement happens once and is never revisited — *1 week*

`PlacementQuiz` writes `placement_level_<dialect>` once. A learner six months in
has XP, a streak and a card count — but no evidence they've moved from A2 to B1.

**The move.** Re-run a short adaptive assessment every 90 days and plot the
trajectory. Progress against a recognised scale is more motivating than XP, and
it's the one thing a learner can show someone else. It also sets up D3.

---

## Track D — Charge properly

Current pricing is two monthly plans, $5 and $15. Several standard levers are
not installed.

### D1. There is no annual plan — *hours*

`src/hooks/useSubscription.ts:14-40` defines exactly two monthly Stripe prices.
No annual, no lifetime; the pricing FAQ confirms no trial either, only a
money-back guarantee. Annual plans typically carry a large share of revenue in
consumer subscription apps and change the business twice over: cash arrives up
front, and the churn decision moves from twelve times a year to once.

**The move.** Annual at roughly two months' discount, defaulted on the pricing
page with the monthly equivalent underneath. Language learning is a New Year
purchase — annual is worth more here than in most categories.

### D2. Native-speaker review is half-built and unmonetized — *3–5 days*

`human_review_requests` and `dialect_native_reviews` already exist, along with
the `content_reviewer` role and the admin workflow. Nobody can buy it.

**The move.** Sell **native feedback credits** — submit a recording or a piece of
writing, get a real Gulf or Egyptian speaker's correction within 48 hours. High
margin, high perceived value, and the one thing a pure-AI competitor
structurally cannot offer. It also feeds the dialect Rulebook with authentic
corrections, so the reviews improve the product while the learner pays for them.

### D3. Nobody certifies spoken dialectal Arabic — you're closest — *2–3 weeks*

Proficiency evidence is becoming what learners, employers and institutions
actually pay for, and dialectal Arabic has essentially no recognised assessment.
Hakiya has CEFR placement, pronunciation scoring, a grammar mastery ladder and
per-dialect tracking — four of the five pieces.

**The move.** A paid **proficiency report**: a supervised adaptive assessment
producing a shareable, verifiable page with a CEFR-style band, a pronunciation
score and a per-skill breakdown. Prices independently of the subscription,
inherently viral because people share credentials, and the natural front door to
institutional sales — relocation, NGO and diplomatic language programmes need
Gulf and Yemeni dialect and pay far more than $15/month.

### D4. Invite codes exist, but there's no referral loop — *2–3 days*

`invite_codes` / `invite_redemptions` are admin-issued beta gating
(`AdminInviteCodes.tsx`), not a learner-facing reward. Attribution plumbing is
already there.

**The move.** Give every learner a code worth a free month to both sides, surfaced
where motivation peaks — after a streak milestone or a completed stage, not in
Settings. Pair it with a shared-goal plan for two: dialect learners often come in
pairs (partners, relocating colleagues, family).

---

## Priority

Ranked by effect per unit of effort. The top four are all small.

| # | Item | Effort | Effect |
| --- | --- | --- | --- |
| A1 | Meter voice in minutes | Hours | Closes uncapped cost exposure |
| D1 | Annual plan | Hours | Cash up front, churn once a year |
| A3 | Token & cost telemetry | 1 day | Makes every other decision measurable |
| A4 | Prompt caching | 1–2 days | Large input-cost cut, lower latency |
| A2 | Tier-aware caps | 1–2 days | Gives All-In a reason to exist |
| D4 | Referral loop | 2–3 days | Cheapest acquisition channel |
| D2 | Native feedback credits | 3–5 days | High-margin, AI-proof revenue |
| B3 | Nightly pre-generation | 3–5 days | Instant open, batch pricing |
| C2 | Personalised FSRS | 1 week | Fewer reviews, same retention |
| B2 | Offline eval harness | 1 week | Safe model swaps, cheaper routing |
| C4 | Recurring placement | 1 week | Real progress evidence |
| C1 | Comprehension shelf | 1–2 weeks | Strongest learner-facing differentiator |
| B1 | Embeddings / pgvector | 1–2 weeks | Compounding moat on the corpus |
| C3 | Written production | 2 weeks | Closes the fourth skill |
| D3 | Proficiency certification | 2–3 weeks | New revenue line, B2B front door |

### If you only do one week

1. **Cap voice by minutes** — stop the uncapped downside on the $5 tier.
2. **Log tokens and cost** — you cannot price what you cannot see.
3. **Turn on prompt caching** — reorder the system prompt, mark the breakpoint.
4. **Make caps tier-aware** — convert the boolean into an allowance table.
5. **Ship the annual plan** — one Stripe price, one pricing-page default.

---

The through-line: Hakiya has built the expensive things — a dialect-faithful
generation pipeline, a real learner model, a large authentic corpus — and is
currently giving away their output at an unmeasured price. Fix the metering
first, then spend the recovered margin on the comprehension shelf and
embeddings, which are where the durable advantage is.
