# Ingleezy — English for Arabic speakers

Ingleezy (اِنجليزي) is a web app that teaches **real spoken English to Arabic
speakers** — with scaffolding in the learner's own dialect (Gulf, Egyptian,
Yemeni) *and* Fusha, native audio, spaced-repetition flashcards, and lessons
built from real English media.

It is a full fork of [Hakiya](https://github.com/danieljchandler/arabic-buddy)
(the spoken-Arabic learning app), retargeted in the opposite direction: the
same learner-modeling engine, with English as the target language and Arabic
as the scaffold. **`RETARGET.md` is the master map of that conversion** —
which subsystems carry over, which flip direction, and which get pruned. Until
the retarget is complete, parts of this codebase still describe the
Arabic-learning direction.

## What makes it different

Every mainstream English app (Duolingo, Babbel, ELSA, Speak) is
L1-agnostic — a Spanish speaker and an Arabic speaker get identical content.
Ingleezy is built around the specific, well-documented ways Arabic speakers
learn English:

- **L1-interference Brain** — generation and correction conditioned on
  Arabic-transfer patterns: article drops, copula omission ("the report
  ready"), /p/→/b/, consonant-cluster epenthesis, preposition transfer,
  calques.
- **Dialect + Fusha scaffolding** — explanations and translations shown in
  the learner's own dialect and in Fusha, not just generic Arabic.
- **Mistake-driven content** — every miss is logged, tagged with the
  interference pattern it exhibits, and fed back into what gets generated
  next (`learner_errors` flywheel, inherited from Hakiya).
- **Arabic-first UI** — the app chrome speaks Arabic (RTL); English is the
  studied content.

## Tech stack

- **Frontend:** Vite + React + TypeScript, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (Postgres + RLS, Auth, Edge Functions) — its own
  project, independent of Hakiya's
- **AI:** orchestrated through the shared "Brain"
  (`supabase/functions/_shared/aiBrain.ts`); model IDs centralized in
  `supabase/functions/_shared/modelRegistry.ts`
- **Learner model:** `supabase/functions/_shared/learnerProfile.ts` builds
  each learner's known / in-progress / weak vocabulary server-side from real
  SRS state — never from a client-supplied list
- **Content bridge:** published videos from Hakiya (dialect Arabic speech
  with English + Fusha transcript lines) are snapshot-synced in as secondary
  content, alongside Ingleezy's own English uploads (YouTube/TikTok)

## Repositories

**This repo is canonical.** All development happens here.

[`danieljchandler/ingleezy-landing-page`](https://github.com/danieljchandler/ingleezy-landing-page)
is a **mirror** of this one, not a separate project. It exists for a single
reason: the Lovable project at
`lovable.dev/projects/e14d9316-75ef-45a5-ba69-84c5d53ca1e7` is wired to that
repository and is the only Lovable project for Ingleezy, so pointing it at a
copy of this app is what makes the app openable in Lovable.

That repo previously held a separate landing-page scaffold — a Lovable starter
template whose only hand-written page rendered the word "ingleezy". It was
replaced wholesale rather than merged: its shadcn components were a strict
subset of this repo's, its `src/lib/utils.ts` was byte-identical, and the rest
was TanStack Start plumbing that this Vite + react-router app cannot use. The
stacks were incompatible anyway — React 19 / Vite 8 / Tailwind 4 there against
React 18 / Vite 5 / Tailwind 3 here.

The logged-out landing surface lives in this app: both `/` (`Feed`) and
`/today` (`Index`) render `<LandingHero />`
(`src/components/LandingHero.tsx`) when the visitor isn't authenticated. Grow
the public page there.

**Keeping the mirror current:** it has no automatic sync. After a change here
that you want visible in Lovable, re-copy this tree into that repo. The two
will drift otherwise.

## Local development

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. **No Supabase project is linked yet**, so
without those two values the app builds and serves but throws on first import
of the Supabase client, by name. That is deliberate: the fork inherited
Hakiya's project ref as a hardcoded fallback, which meant an Ingleezy dev
server with no `.env` read and wrote Hakiya's production database while looking
perfectly healthy. No backend is the honest state until Ingleezy has its own.

The e2e suite needs **no Supabase credentials** — it runs against a hermetic
fake (`e2e/support/supabase.ts`), and `npm test` likewise.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build |
| `npm run lint:ratchet` | Fail only if lint errors increased (what CI runs) |
| `npm test` | Run the Vitest suite |
| `npm run test:e2e` | Run the Playwright end-to-end suite |
| `npm run typecheck` | `tsc` over app + e2e configs |
| `npm run check:edge` | Typecheck the Deno edge functions (needs `deno`) |

CI (`.github/workflows/ci.yml`) runs typecheck + lint ratchet + Vitest +
build, `deno check` over the edge functions, and Playwright — inherited
unchanged from Hakiya, and the same bar applies: every retarget step keeps
all three jobs green.

## Branding

Name locked: **Ingleezy**. Logo and final palette pending — the app currently
runs a placeholder cobalt theme defined entirely in `src/index.css` tokens.
When the brand guide lands, the swap is that one file plus
`public/favicon.png`.
