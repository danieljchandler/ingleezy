# Standing up Ingleezy's backend

`RETARGET.md` step 10 — the only thing left that is not a retarget step, and
the only thing between this app and a real learner. All nine retarget steps are
done; the app builds, tests and e2e-tests green against a hermetic fake, and
has never once talked to a database of its own.

This is the checklist for giving it one. It assumes nothing exists yet.

Two things are worth knowing before you start, because both are easier to
decide than to discover halfway through:

1. **The Brain is gated on a key you may not have** (§0). Settle it first.
2. **Nobody can sign up until you insert an invite code by hand** (§7).
   Signup requires one, invite codes are created by admins, and there is no
   admin until someone has signed up.

---

## 0. Decide the AI routing before you create anything

`supabase/functions/_shared/aiBrain.ts` opens `askBrain` with:

```ts
const apiKey = Deno.env.get('LOVABLE_API_KEY');
if (!apiKey) throw new BrainHttpError(500, 'LOVABLE_API_KEY not configured');
```

That runs *before* it looks at which model the task wants, so every generation
call fails without the key — including tasks that would only ever have used
Claude through OpenRouter. And `routeForModel` (same file) sends everything
not matching `anthropic|qwen|meta-llama|mistralai|deepseek|x-ai` to the Lovable
gateway, which is all of `google/*` — half of both named lineups in
`modelRegistry.ts`. Twenty-seven edge functions read the key.

`LOVABLE_API_KEY` is issued by Lovable Cloud and injected into the functions of
a project it backs. So:

- **If the new Supabase project is backed by Lovable Cloud**, the key is
  supplied and nothing here needs changing.
- **If it is a standalone Supabase project**, the Brain is dark on day one
  until two things change: the unconditional guard above (a task routed
  entirely through OpenRouter has no business requiring it), and
  `routeForModel`, which needs a destination for Google models — either
  OpenRouter, which already carries the Anthropic traffic, or Google directly
  via `GEMINI_API_KEY`, which `.env.example` already lists.

Neither is a large change. Doing it after the project exists means discovering
it as a 500 from whichever generator someone tries first.

---

## 1. Create the project

Create a new Supabase project. **Not Hakiya's.** The fork carried
`ovscskaijvclaxelkdyf` as a hardcoded fallback in `vite.config.ts` and a pin in
`supabase/config.toml` for the whole retarget, which meant an Ingleezy dev
server with no `.env` read and wrote Hakiya's production database while looking
entirely healthy. Both are gone, and `src/test/envGuard.test.ts` fails the
build if a project ref or JWT reappears in the build config — matched by shape,
not by that one string.

Note the project ref, the project URL, and the anon (publishable) key.

## 2. Point the app at it

```sh
cp .env.example .env
```

Fill in at least:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the anon key |
| `VITE_SUPABASE_PROJECT_ID` | the project ref |
| `VITE_PUBLIC_SITE_URL` | the public origin, once there is a domain |

`vite.config.ts` reads the root `.env` by hand — `envDir` points at an empty
directory, so Vite's own discovery does not see it. Until these are set,
`src/integrations/supabase/client.ts` throws by name on first import. That is
deliberate: no backend is a better state than a working app attached to
someone else's data.

`npm test` and `npm run test:e2e` need none of this. They run against the
in-memory backend and override these variables with fake values on purpose;
`src/test/envGuard.test.ts` fails if that drifts.

## 3. Push the migrations

```sh
supabase link --project-ref <ref>
supabase db push
```

Link rather than editing `project_id` in `supabase/config.toml` — that line is
a local name now, and it used to be Hakiya's ref.

164 migrations. They **do** replay cleanly from nothing: CI's `contract` job
rebuilds the whole schema against a stock Postgres 16 on every PR and asserts
that every table and every column the app queries exists afterwards. That was
not true until recently — the history had accumulated fourteen failures behind
a skipped check, and a rebuilt database silently lacked the `learner-audio`
bucket, `lessons.dialect_module`, `user_vocabulary.stage` and a policy hiding
draft lessons from non-admins. `RETARGET.md`'s Known risks section has the full
account. The relevant part here is that the replay is proven, so a failure
during `db push` is news.

To rehearse it locally first:

```sh
docker run -d --name ingleezy-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  npx vitest run src/test/migrationReplay.test.ts
```

That is the same check CI runs, and it exercises the security-definer functions
the client calls as well as the schema.

Storage buckets are created by the migrations — `avatars`, `audio`,
`video-audio`, `tutor-audio-clips`, `learner-audio`, `listen-audio`,
`story-videos`, `flashcard-audio`, `flashcard-images`, `meme-uploads`,
`feedback-screenshots`, `training-exports`. Worth listing them in the dashboard
afterwards rather than assuming: the `learner-audio` bucket is exactly what a
half-applied migration lost last time.

## 4. Regenerate the types

```sh
supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
```

`src/integrations/supabase/types.ts` currently describes *Hakiya's* database —
it is the file the fork inherited. Regenerating it is what closes several
things at once:

- `src/test/support/postgrest/typesDrift.ts` should shrink to nothing. Its
  entries exist only because a column the migrations create is missing from the
  generated types; `src/test/typesDrift.test.ts` will tell you to delete each
  one that is no longer drifting, by name.
- A chunk of the `as any` and `as never` casts around Supabase queries exist
  only because the types are stale — including the two hand-added `Functions`
  entries for `record_review_day` and `set_weekly_goal`, which regeneration
  supplies for real. 494 of the repo's 526 lint errors are `no-explicit-any`,
  83 of them Supabase query casts.
- Re-run `npm run lint:ratchet` afterwards and lower `BASELINE` in
  `scripts/lint-ratchet.mjs` to whatever it reports. The ratchet only ever goes
  down.

Then `npm run typecheck && npm test` — the schema contract test reads the app's
queries against this file, so a genuine mismatch between the app and the new
database surfaces here rather than as an empty page.

## 5. Set the edge-function secrets

```sh
supabase secrets set KEY=value
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
provided by the runtime. `.env.example` is the full annotated list; this is
what goes dark without each group, so the ones that matter on day one can be
told apart from the ones that can wait.

**Needed for anything to work**

| Secret | Without it |
| --- | --- |
| `LOVABLE_API_KEY` | every generation call 500s — see §0 |
| `ALLOWED_ORIGINS` | the deployed app's own requests are rejected; must contain `VITE_PUBLIC_SITE_URL` |

**Needed for the differentiating features**

| Secret | Without it |
| --- | --- |
| `OPENROUTER_API_KEY` | the Claude/Qwen/Saba leg of every lineup; ensembles fall back to one drafter |
| `GEMINI_API_KEY` | direct Gemini, and the dialect validator's escalation path |
| `ELEVENLABS_API_KEY` | English TTS and the Scribe ASR leg |
| `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | pronunciation assessment and Azure TTS |
| `DEEPGRAM_API_KEY` | the English video pipeline's transcription |

**Per-feature; each one degrades alone**

`MUNSIT_*`, `SONIOX_API_KEY`, `COHERE_API_KEY`, `FANAR_API_KEY` (Arabic ASR
legs) · `FARASA_API_KEY` (transcript tashkeel — without it every call returns
`invalid_api_key` and transcripts simply carry none) · `HUGGINGFACE_API_KEY`
(CAMeL dialect ID, the only non-LLM check on a detected dialect) ·
`JINA_API_KEY` · `RAPIDAPI_KEY`, `YOUTUBE_API_KEY`, `COBALT_API_KEY`,
`FIRECRAWL_API_KEY` (media fetch and scraping) · `STRIPE_SECRET_KEY` and `STRIPE_ANNUAL_PRICE_STANDARD`,
`STRIPE_ANNUAL_PRICE_ALLIN`, `STRIPE_FEEDBACK_PACK_PRICE` and
`STRIPE_REFERRAL_COUPON` (checkout, subscriptions, the feedback credit packs) ·
`VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT` with
`VITE_VAPID_PUBLIC_KEY` on the client (web push — the Settings toggle hides
itself when unset) · `HAKIYA_SUPABASE_URL`/`HAKIYA_SUPABASE_ANON_KEY` (the
content bridge, read-only against Hakiya's published videos).

**Meter the voice minutes from day one.** `_shared/voiceBudget.ts` and
`voiceBudgetCore.ts` are in place and enforce a monthly cap per learner. They
fail open — a broken meter degrades to "not enforced", never to "voice is
down" — so a misconfigured `voice_usage` table costs money silently.
`docs/product-audit-2026-08.md` A1 is the record of this being uncapped in
Hakiya; do not inherit that.

## 6. Deploy the functions

```sh
supabase functions deploy
```

92 of them. `supabase/config.toml` carries the `verify_jwt` posture for each —
payment, admin and learner-data functions require a JWT; public learning
content does not. That file is the reviewed decision, so deploy with it rather
than setting the flags in the dashboard.

Check the deploy with something cheap and unauthenticated, e.g. `farasa` or
`how-do-i-say`, before trusting the pipeline ones.

## 7. Make the first account, and the first admin

This is the step that deadlocks if you do not plan for it.

`src/pages/Auth.tsx` requires an invite code on signup, pre-validates it with
`verify_invite_code`, and redeems it with `redeem_invite_code` after the
account exists. Invite codes are created from the admin surface. The admin
surface requires the `admin` role. The `admin` role is granted from the admin
surface. Nothing in the migrations seeds any of it.

So, in the SQL editor, before anyone tries to sign up:

```sql
-- One code, one use. `max_uses` defaults to 1 and `uses` to 0.
insert into public.invite_codes (code, note, max_uses)
values ('FOUNDER', 'bootstrap: first account', 1);
```

A code starting with `BETA` also grants `beta_tester` on redemption — see
`redeem_invite_code`. `FOUNDER` does not, which is fine; the role you actually
need is next.

Sign up in the app with that code. Then, still in the SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'::app_role from auth.users where email = '<your email>'
on conflict (user_id, role) do nothing;
```

Sign out and back in. `/admin` is now reachable, and every further invite code
can be made there rather than in SQL.

## 8. Smoke test, in this order

Each of these fails differently, so doing them in order tells you which layer
is wrong.

1. **The app loads signed out.** `/` renders `<LandingHero />`. If this throws
   on the Supabase client, §2 is wrong.
2. **Signup works.** If the invite code is rejected, §7 is wrong. If the
   account is created but the app errors after, the `handle_new_user` trigger
   or the profiles policies did not apply — check §3.
3. **A lesson list renders.** `useLessons` filters on
   `lessons.dialect_module`. An empty list on a database with no content is
   correct; a 400 in the console is a schema problem.
4. **Rate one card in a review deck.** Then check three things moved:
   `word_reviews` has a row, `weekly_goals.completed_reviews` is 1, and
   `review_streaks.current_streak` is 1 with today's date. The streak is the
   newest of these — it had no writer at all until
   `20260918120000_record_review_day_and_weekly_goal.sql` — so it is worth
   confirming rather than assuming.
5. **Ask the AI anything.** The Ask AI panel is reachable from every learner
   screen. A 500 saying `LOVABLE_API_KEY not configured` means §0 was not
   settled.

## 9. Afterwards

- Set `VITE_PUBLIC_SITE_URL` and rebuild, so `robots.txt` gains its `Sitemap:`
  line and `sitemap.xml` is emitted at all (`scripts/seo.ts`). Add the same
  origin to `ALLOWED_ORIGINS`.
- Tick step 10 in `RETARGET.md` and say what the project ref is — not the key.
- Update `README.md`'s "**No Supabase project is linked yet**" paragraph, which
  will then be describing a state that no longer exists. A map nobody trusts
  stops getting read; that is `RETARGET.md`'s own argument and it applies here.
