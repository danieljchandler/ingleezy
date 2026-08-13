# Testing

Five layers, each its own CI job so a failure is diagnosable at a glance.

| Layer | Runner | Lives in | Covers |
| --- | --- | --- | --- |
| Unit | Vitest | `src/**/*.test.ts` | pure logic, `src/lib`, `supabase/functions/_shared` |
| Component | Vitest + Testing Library | `src/**/*.test.tsx` | components and hooks in isolation |
| End-to-end | Playwright | `e2e/**/*.spec.ts` | every route, every interaction, in a real browser |
| Edge runtime | `deno test` | `supabase/functions/**` | the 84 edge functions |
| Schema contract | Vitest + Postgres | `contract/**` | the app's real queries against the real schema |

```sh
npm test              # unit + component
npm run test:watch
npm run test:coverage
npm run test:e2e      # hermetic; needs no credentials
npm run test:edge     # edge functions; needs Deno
npm run typecheck     # app AND e2e trees
npm run lint:ratchet
```

## The one thing to know first

**A test run that is misconfigured talks to the production database, and still
goes green.**

`vite.config.ts` sets `envDir: ".vite-env"` — an empty directory — so a root
`.env` file is *ignored*. The Supabase client vars are injected through `define`
from `process.env`, and **fall back to the real production project ref and a real
anon key when unset**. Nothing warns you.

Four layers guard against it. Do not remove one without understanding the others:

1. `vitest.config.ts` sets `test.env` to the fake host `https://e2e.supabase.co`.
   It deliberately does **not** mirror `vite.config.ts`'s fallback logic.
2. `playwright.config.ts` sets `webServer.env` to the same fake host, and
   `reuseExistingServer: false` so a hand-started dev server can't be inherited.
3. `e2e/support/globalSetup.ts` refuses to start the suite if (2) is not in
   effect, with a message naming the missing variable.
4. `src/test/setup.ts` replaces `fetch` with one that throws, so a unit test that
   forgets to stub the network fails loudly instead of reaching out.

`src/test/envGuard.test.ts` asserts all four are still in place, and drives the
globalSetup guard with the configs it is meant to reject. If you change how the
app is configured, that file is the one that will tell you.

## Where a test goes

- **Unit and component tests co-locate** with their subject:
  `src/lib/reviewQueue.ts` → `src/lib/reviewQueue.test.ts`,
  `src/hooks/useReview.ts` → `src/hooks/useReview.test.ts`.
- **`src/test/`** holds shared harness code plus cross-cutting suites with no
  single home — notably the tests for `supabase/functions/_shared/*`, which are
  Deno modules and cannot sit inside the Vitest `include` glob.
- **`e2e/`** holds Playwright specs, one file per functional area.

Both conventions currently exist in the tree for historical reasons. New tests
follow the rule above.

## Test code standards

Test files are held to a *higher* lint standard than the app, not a lower one
(see the override in `eslint.config.js`):

- **No `any`.** The fixtures and harness expose typed helpers. The app carries
  ~548 pre-existing `no-explicit-any` errors that `scripts/lint-ratchet.mjs`
  holds the line on; test code starts from zero and stays there.
- **No `.only`.** At this suite's size a stray `.only` silently reduces
  thousands of tests to one, and CI still reports green. It is an error.

## Browser APIs

`src/test/setup.ts` provides what jsdom lacks and the app requires:
`HTMLMediaElement.play/pause/load`, `matchMedia`, `ResizeObserver`,
`IntersectionObserver`, `scrollIntoView`, the pointer-capture methods Radix
calls on every menu interaction, and `URL.createObjectURL`.

Interactions go through `@testing-library/user-event`, not `fireEvent`. Radix —
which is every dropdown, select, popover and dialog in the app — opens on
`pointerdown`/`keydown` and inspects `event.pointerType`, none of which a bare
`fireEvent.click` dispatches.

## Edge functions

The 84 functions in `supabase/functions/` are Deno, and every one of them calls
`serve(handler)` (or `Deno.serve`) at module scope and exports nothing — so
there is no handler to import. Rather than editing 84 production files to add an
export, `supabase/functions/_test/` intercepts both forms:

- a **test-only import map** redirects the std http server to `serveShim.ts`,
  which captures the handler instead of binding a port;
- `Deno.serve` is monkey-patched before the dynamic import, for the rest.

`loadFunction(name)` returns the handler with the ~30 secrets set to fakes and
every outbound `fetch` routed to canned upstreams. An unrouted call **throws** —
if a test is not in control of what the function talks to, any assertion about
the result is describing something else.

The import map is passed via `--import-map` and deliberately **not** placed in a
`deno.json`. The `edge` CI job runs `deno check` over the real sources; if the
map applied there it would typecheck the shim instead of the real std module and
quietly remove the coverage that job exists to provide.

One gotcha worth knowing: the routing `fetch` is installed once and never
swapped, because `_shared/usageCap.ts` caches its Supabase client at module
scope and that cache outlives any single test. A per-test stub would leave the
cached client calling a dead one. `restore()` clears the route table instead.

## Schema contract

Two checks, because they answer different questions.

**`src/test/schemaContract.test.ts`** parses every `.from("t").select(...)`,
`.rpc(...)` and `functions.invoke(...)` in `src/` and `supabase/functions/` with
the TypeScript compiler API and checks each name against the generated Supabase
types. It needs no database and runs on every push.

It exists for one failure mode: a renamed or dropped column makes PostgREST
return 400, react-query surfaces an empty array, and the page renders a
plausible empty state. No error, no crash, nothing to notice.

**`src/test/migrationReplay.test.ts`** replays all 137 migrations against a real
Postgres to check the history still produces the schema. Skipped without
`DATABASE_URL`; CI runs it against a service container.

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
  npx vitest run src/test/migrationReplay.test.ts
```

`contract/prelude.sql` supplies the `auth` and `storage` objects the migrations
reference but do not create — 233 uses of `auth.uid()` alone — so stock Postgres
is enough and the Supabase CLI is not needed.

### What it currently finds

Both are recorded as pinned baselines rather than fixed, so they cannot get
worse; shrinking them is the goal.

- **7 of 137 migrations do not replay from scratch.** Five create something an
  earlier migration already created; two reference tables nothing creates.
- **Three tables exist in production but in no migration**: `processed_videos`,
  `review_streaks` and `subscribers`. A rebuilt database would not have them.
  `subscribers` is the significant one — `_shared/usageCap.ts` reads it to
  decide whether a caller is a paying customer, so on a rebuilt database every
  user would look free-tier. It is not in the generated types either.

Fixing the last two means writing migrations for tables whose real shape only
production knows, which needs a schema dump rather than a guess.

## Time

`spacedRepetition`, `reviewQueue`, `todayCompletion`, `useNewCardBudget`,
streaks and `xp_today_date` all branch on wall-clock time. Freeze it —
`vi.setSystemTime` in Vitest, `page.clock.install()` in Playwright — at a fixed
instant that is neither midnight nor a DST boundary. A suite that only fails at
23:59 UTC is a suite nobody trusts.
