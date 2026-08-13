# Hakiya — Learn Spoken Arabic

Hakiya is a web app for learning **spoken (dialectal) Arabic** — Gulf (Khaliji),
Egyptian, and Yemeni — with native audio, spaced-repetition flashcards, and
lessons built from real Arabic media. The emphasis throughout is on authentic
dialect, never Modern Standard Arabic (MSA / فصحى).

## Tech stack

- **Frontend:** Vite + React + TypeScript, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (Postgres + Row-Level Security, Auth, Edge Functions)
- **AI:** dialect-aware generation orchestrated through a shared "Brain"
  (`supabase/functions/_shared/aiBrain.ts`) that layers dialect identity, an
  MSA-leak detector, a repair pass, and an optional native-speaker validator on
  top of the underlying models. Model IDs are centralized in
  `supabase/functions/_shared/modelRegistry.ts` — do not hardcode them in
  feature code.
- **Learner model:** generated content is conditioned on what each learner
  actually knows. `supabase/functions/_shared/learnerProfile.ts` assembles their
  known / in-progress / weak vocabulary from real SRS state across both decks,
  plus CEFR placement and stated interests, and generators pass it to `askBrain`
  as `systemPromptExtra`. Its pure half (`learnerProfileCore.ts`) is unit-tested
  from the Vitest suite. Never send a client-supplied "words the user knows"
  list — build it server-side.
- **Grammar mastery:** the learner model also carries *structural* weakness, not
  just lexical — see "Grammar mastery" below.

## Local development

Requires Node.js (or Bun) and the Supabase CLI for the backend.

```sh
# Install dependencies
npm install          # or: bun install

# Start the dev server
npm run dev
```

Copy `.env.example` to `.env` and fill in the client variables
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Server-side secrets for
the edge functions are configured in the Supabase dashboard, not committed.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the codebase |
| `npm test` | Run the Vitest suite |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Run the Playwright end-to-end suite |
| `npm run test:e2e:ui` | Run the E2E suite in Playwright's UI mode |
| `npm run lint:ratchet` | Fail only if lint errors increased (what CI runs) |
| `npm run check:edge` | Typecheck the Deno edge functions (needs `deno` installed) |

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request,
in three jobs so a failure names its own kind:

- **Typecheck, lint & unit tests** — `tsc` over `src/`, the lint ratchet, Vitest,
  and the production build.
- **Typecheck edge functions (Deno)** — `deno check` over
  `supabase/functions/**`. See below.
- **End-to-end** — Playwright. A failed run uploads its HTML report as an
  artifact.

**The edge functions need their own typecheck.** They are Deno, they import over
`https://`, and `tsc` cannot resolve those specifiers — so `tsconfig.app.json`
covers `src/` and the shared modules the Vitest suite imports, but never the
functions themselves. That left roughly 15k lines with no typechecker at all.
Adding `deno check` found eight real defects in its first three runs, including
a `corsHeaders` reference from a scope that did not contain it (every response
from `dialect-violations-digest` threw a `ReferenceError`, success path
included), a `fallback()` call missing the argument that carries CORS headers,
and an unguarded `analyzeData.result` dereference in the transcription pipeline.

Unlike lint, this one is a clean gate rather than a ratchet: the whole directory
passes today, so there is no debt to tolerate. The Deno version in the workflow
is pinned exactly — `deno check` bundles its own TypeScript, so a Deno release
can turn the job red with no repo change, and that is how a check stops being
trusted. Bump it deliberately.

**Lint is a ratchet, not a clean-lint gate.** The repo carries a few hundred
pre-existing errors — almost all `no-explicit-any` — so requiring zero would
make every build red and train everyone to ignore CI. `scripts/lint-ratchet.mjs`
fails only when the error count goes *up*, and prints the new number to use when
you bring it down. Lower `BASELINE` in that file in the same commit that reduces
it.

### End-to-end tests

`e2e/` runs the real app in a browser. It needs **no Supabase credentials**:
`playwright.config.ts` points the dev server at a fake Supabase host, and
`e2e/support/supabase.ts` seeds an auth session into `localStorage` and answers
every request from fixtures. The suite is hermetic — no network, no shared
state — so it verifies the app's own routing and rendering rather than that
queries match the production schema.

## Curriculum

Stages and lessons live in `curriculum_stages` / `lessons` and are walked by the
learner at `/curriculum` (`src/pages/Curriculum.tsx`), with progress in
`lesson_progress`. The path state — which lesson is "next up", completion
percentages, best-score merging — is pure and tested in `src/lib/lessonPath.ts`.

Gating is deliberately **soft**: `lessons.unlock_condition` is free text imported
from a spreadsheet, not a machine-readable rule, so it's shown as guidance while
exactly one lesson is marked "Next up" and anything can be opened.

Lesson plans imported from `.xlsx` (`src/lib/parseLessonXlsx.ts` →
`useLessonImport`) persist their authored sections. `sound_spotlight`,
`lesson_sequence` and `real_world_prompts` are rendered to the learner in
`src/pages/Learn.tsx`; `image_scenes`, `flashcard_spec` and `design_rationale`
are stored as authoring metadata and have no learner-facing surface. Every
section renders nothing when empty, so lessons imported before this was wired up
are unaffected.

## Project layout

- `src/` — React app (pages, components, hooks, domain logic in `src/lib`)
- `supabase/functions/` — Deno edge functions (AI, TTS/STT, billing, content)
- `supabase/functions/_shared/` — shared helpers (Brain, dialect rules, CORS,
  usage caps, model registry)
- `supabase/migrations/` — database schema and RLS policies
- `docs/` — planning notes and branding assets

## The Fusha row

A transcript line carries three things about the same sentence: the Arabic as
spoken, the English translation, and — since this feature — `fusha`, the same
sentence rewritten in Modern Standard Arabic. It is a **conversion, not a
translation**: the row stays in Arabic and only the dialect-specific parts move
(شلونك → كيف حالك, يبغى → يريد, ما راح أروح → لن أذهب), so a learner who arrived
from فصحى can see which pieces the dialect changed rather than only what the
line means. That is why it renders beside the Arabic rather than inside the
collapsible English.

The rules live in `supabase/functions/_shared/fushaBridge.ts` — prompt text,
parsing, alignment, and the comparison that decides whether anything actually
changed — so the analysis pipeline, the on-demand converter and the React
component all agree on what a Fusha rendering is. Two of its rules are worth
knowing:

- **Anything without Arabic script is dropped.** The row renders RTL under a
  فصحى heading, so a model that answers "I went to the market" produces a second
  translation wearing Arabic's clothes. A blank is better; the row just doesn't
  render.
- **Short answers pad, they never shift.** A model that returns nine renderings
  for ten lines has merged two of them, and sliding the array into place files
  every later line's Fusha under the wrong sentence — invisible to exactly the
  learner this row is for.

`analyze-gulf-arabic` runs the conversion as its own model call, parallel to the
translation ensemble rather than folded into it: the ensemble picks a winner by
clustering *English* token overlap, and a Fusha rendering has no bearing on
which English translation is right. Provenance lands in
`engines_used.fusha` (status, model, `lines_filled` / `lines_total`) — a pass
that "succeeded" while filling 3 of 40 lines is a failure a learner sees.

Everything analysed before this existed has no `fusha`, which is most of the
Discover library and every saved transcription. `convert-to-fusha` fills those
in on demand: `useFushaLines` sends only the lines missing one, only once the
learner turns the row on, and only once per line per mount. The switch is the
global "Formal Arabic (MSA)" display preference on every screen that shows the
row, so asking for MSA once — in Settings, on a transcript, on a video — turns
it on everywhere.

## The learner's mistakes

`learner_errors` collects every pronunciation miss, shadowing gap, sentence-coach
failure and set-phrase mismatch, written by the scoring edge functions under the
service role. It fed the `weak` bucket in the learner profile from the start —
so the *content generators* knew what a learner kept getting wrong, while the
learner themselves could not see a single row.

`/mistakes` (`src/pages/Mistakes.tsx`) is the read side. Rows are grouped by
target rather than listed raw — six misses on one word is one problem, not six —
and ranked by count then recency, in `src/lib/mistakes.ts` (pure, unit-tested).
Each entry shows what you were aiming for, what came out, how often and how
recently, with TTS on demand to hear it correct.

Reads and writes are asymmetric, as with grammar mastery: the client may read
its own rows and set `resolved_at`, and nothing else. `20260726140000` revoked
blanket UPDATE and re-granted it on that one column, because `target_arabic` and
`detail` feed the learner's own content generation.

## Grammar mastery

Vocabulary has a full SRS; grammar used to have nothing. A Grammar Drills score
was rendered on the results screen and dropped, so no part of the app knew which
*structures* a learner kept missing — only which words.

`user_concept_mastery` (created back in `20260503134531`, never written to until
now) is the ladder. `record-grammar-outcome` folds a finished drill's answers
into it, one exposure per question, keyed on the drill **category** rather than
the model's free-text `grammar_point` — the six category ids are also
`curriculum_concepts.key` values, so they're a contract: renaming one starts a
fresh concept and orphans the old history. The edge function keeps its own copy
of the id list as an allowlist so a drift returns 400 instead of quietly
splitting a learner's record.

**One key space.** `curriculum_concepts` grew two writers that both produced
`kind: 'grammar'` rows and disagreed about the key: `extract-concepts` used the
model's free-text `grammar_point` ("Negation with ما", "negation of the past
tense", "Past-tense negation" — three rows, one concept), while the mastery
ladder used the six category ids. Content was therefore tagged with concepts no
learner's mastery could join to. Both writers now go through
`_shared/grammarTaxonomy.ts`, which maps prose onto a canonical category or
slugs it when the taxonomy has no home for it. Migration `20260801150000` merges
the rows that already exist; its keyword table is a copy of the module's, pinned
by a test that parses the `.sql` and fails on drift.

The ladder itself lives in `supabase/functions/_shared/conceptMasteryCore.ts`
(pure, unit-tested) with the IO in `conceptMastery.ts`. Its one non-obvious rule:
**a wrong answer never promotes.** Strength is derived from cumulative accuracy,
so a learner sitting just under a gate would otherwise cross it *by getting the
question wrong* — one more exposure can lift the average past the threshold. A
miss demotes one rung and makes the concept due immediately.

Reads and writes are deliberately asymmetric. The client reads its own mastery
straight from the table under RLS (`useGrammarMastery`); it cannot write — that
goes through the edge function under the service role, so nobody posts
themselves a score. Both ends consume the shared core, so the UI and the server
agree on what "familiar" means.

It feeds back in two directions: `GrammarDrills` shows per-category strength and
nudges toward one category instead of six equal tiles, and `buildLearnerProfile`
carries `weakGrammar` into every generator's prompt as its own line — a shaky
word wants another exposure in context, a shaky structure wants the correct form
modelled, and blurring them helps neither.

## RBAC roles

Roles are assigned in `public.user_roles` (INSERT/UPDATE/DELETE restricted to
admins via RLS; users may only read their own role):

- `admin`: full access everywhere, including admin and Bible management.
- `content_reviewer`: can manage content workflows (transcripts / translations /
  cultural notes / dialect rules) but is blocked from Bible access.
- `beta_tester`: can access beta-only features.
- `bible_reader`: grants Bible reading access (except when the user is also
  `content_reviewer`).

## PWA and push notifications

The frontend is installable: `public/manifest.webmanifest` plus a hand-rolled
service worker in `public/sw.js`. The worker caches the app shell, the
content-hashed build assets, and card audio, and **never** caches Supabase — so
auth, decks and AI calls always hit the network. It is registered in production
builds only (`src/lib/serviceWorker.ts`), which keeps the hermetic Playwright
suite deterministic.

Web push is optional and off unless configured. Generate a keypair once:

```sh
npx web-push generate-vapid-keys
```

Then set `VITE_VAPID_PUBLIC_KEY` for the frontend, and `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` as edge-function secrets. Schedule
`notify-due-reviews` hourly (Supabase dashboard → Cron); it only notifies inside
each learner's local evening, at most once a day, and only when enough cards are
actually due. With no key set, the Settings toggle hides itself rather than
offering something that can't work.

## Deployment

The frontend is a static Vite build; the backend runs as Supabase Edge
Functions. Set `ALLOWED_ORIGINS` (comma-separated) as an edge-function secret to
restrict CORS to your production domain(s).
