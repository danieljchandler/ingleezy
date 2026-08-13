# Behaviour findings found by the test suite — all fixed

The test suite added in PR #242 covers every route, hook, lib module and edge
function, plus the components that carry real branching logic. While writing it,
**47 behaviour findings** were found across 27 components.

**All 47 have now been fixed.** They were pinned first — each as a passing test
describing what the code did at the time — so that the corrections could be made
later with a safety net underneath them. That is what happened: every fix landed
together with a rewrite of its pinned test and the deletion of its `FINDING`
comment block, in the same commit.

Nothing is outstanding. This check should return no results:

```sh
grep -rn "FINDING —" src --include=*.test.tsx --include=*.test.ts
```

If it ever returns something again, the convention is the one that worked here:

> **Every fix will make its pinned test fail. That is the signal the fix
> landed.** Rewrite that one test to describe the corrected behaviour in the
> same commit as the fix — do not delete it.

---

## The standing constraints

**Do not touch the test environment variables.** `vitest.config.ts` and
`playwright.config.ts` deliberately override `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PROJECT_ID` with fake
values. `vite.config.ts` falls back to **real production credentials** if they
are missing, so removing the overrides would point the whole test suite at
production. `src/test/envGuard.test.ts` fails the build if they drift. The
Playwright fixture additionally aborts every request to a foreign host.

**The lint ratchet only ever goes down.** `npm run lint:ratchet` fails if the
error count rises above the baseline in `scripts/lint-ratchet.mjs`. The repo
carries pre-existing debt; the baseline moved 549 → 548 during this work.

**Check exit codes, not summary lines.** The suite has printed "4238 passed"
while exiting 1 on an unhandled error, and `npm run typecheck | tail` hides
tsc's exit code. Redirect and echo `$?`.

---

## What was fixed

Grouped as they were tackled. Each entry names the component and the mechanism;
the commit messages carry the full reasoning, and every one has a test.

### Wrong behaviour a user could hit

| Component | What was wrong |
|---|---|
| `ErrorBoundary` | `classifyError` matched a bare `token` substring, so `Unexpected token < in JSON` — a parse error — was classified as an expired session and the panel's only button sent the user to `/auth`. Also un-gated the details disclosure, which only appeared on the generic panel. |
| `admin/AdminTranscriptEditor` | Glosses were cached by position, so deleting or inserting a word renumbered everything after it and dropped every gloss that followed; a split lost the glosses of whichever half got a new id. Now claimed in order by surface, per line, with a transcript-wide fallback. Its failure toast also showed supabase-js's fixed "non-2xx" message rather than what the function said. |
| `alphabet/MilestoneBanner` | `markSeen` recorded only the milestone on screen, so the banner counted downwards — 28, then 21, then 14, then 7 — and a dismissal did not survive the count moving. |
| `shared/MarkUnknownsToggle` | Leaving mark mode called `clear()`, discarding a whole passage of marked words with no confirmation and no undo. |
| `MyWordsSection` / `pages/MyWordsReview` | The "Mixed" toggle counted across every dialect but opened a deck scoped to the active one. The link now carries `?mixed=1`. |

### Arithmetic

| Component | What was wrong |
|---|---|
| `TranscriptEditor/DiffPreview` | Boundaries keyed as `` `${start}-${end}` `` strings, so float noise from summed word durations made every line read as new. Now keyed as whole milliseconds. Also gained a per-line **Keep** on removed boundaries — previously the only way to save one was Reject All. |
| `TranscriptEditor/SegmentList` | `gap < 0` reported "⚠ overlap 0.00s" on float noise. Now allows half a millisecond, and a non-overlap gap cannot render as `-0.00s`. |
| `quiz/QuizResults` | `score / answers.length` is 0/0 for an empty quiz, and every band comparison against NaN is false — so it fell through to "Try again!" over "NaN% correct". |
| `gamification/WeeklyGoalCard` | A zero target divided to NaN while the separate `0 >= 0` completion check passed, so the card fired its confetti line for a week in which nothing was done. |

### Props sampled once and never re-read

`transcript/TimeRangeSelector` (ignored a revised `value`, never reported the
range it chose for itself, and showed the configured cap rather than the
effective one) · `admin/ImageUploader` (ignored a `currentUrl` that arrived after
mount, and never revoked its source object URLs) · `souq-news/ArticleSentences`
(revealed lines carried over to the next article) · `ContinueCard` (the server
fallback had no expiry, so a lesson abandoned in January was still offered in
September).

### Audio lifecycle

`alphabet/LetterAudioButton` (synthesised on render rather than on tap — 28 per
screen; autoplay never lit the button; nothing stopped the clip on unmount) ·
`bible/VerseAudioButton` (stayed armed, so changing the verse played it unasked;
an untranslated verse left a live-looking button that did nothing) ·
`learn/SoundSpotlight` (every row synthesised on arrival, and collapsing the
panel unmounted the rows so the clips were remade on reopening).

### Timers outliving their components

`alphabet/LetterTracer` (a 750ms fade per spark, a dozen per stroke) and
`transcript/LineByLineTranscript` (1.5s/3s selection timers). Uncancelled, these
set state after unmount — and under a runner that tears the DOM down between
files, the late callback took the whole run down with `window is not defined`.

### Accessibility

`InfoHint` was a `<span role="button">` whose keydown handler only called
`stopPropagation`, so it announced itself as a button, took focus and did
nothing — putting every feature hint in the app out of reach of a keyboard.
`TranscriptEditor/WordConfidence` had the same gap on Space, a zero-width split
target a pointer could never enter, and no way for the parent to tell a split
from a word selection. `discover/DiscoverPreviewCard`'s label carried only the
title, so the dialect, level and length were inaudible.

### The rest

`admin/TranscriptionStatusBanner` ("Cancel job" only hid the banner while the
pipeline kept running and spending — relabelled to "Hide"; a real cancel needs
an endpoint that does not exist yet) · `admin/curriculum-builder/ChatSidebar`
(clock skew rendered "-1d ago"; an unlisted dialect lost its flag; archive was
hover-only) · `.../ChatWindow` (a payload-only reply rendered an empty bubble; an
unrecognised `output_type` hid the draft entirely) · `.../QuickActionsMenu` (the
panel stayed over the composer; the two reference actions left the trigger
saying "Generate") · `gamification/AchievementBadge` (`earnedAt` was a date used
as a flag, and a null one hid the XP of an earned achievement) ·
`gamification/StreakDisplay` (the header pill stayed orange at zero) ·
`learn/IntroCard` (promised audio it did not have, and its card tap only set a
flag nothing read — it plays now) · `shared/TranslationPair` (labelled an empty
Literal column) · `souq-news/ArticleSentences` (an untranslated line was
described to the AI as the whole article summary).

---

## Two things deliberately not done

- **A real cancel for `process-approved-video`.** The banner is honest about
  what its button does; actually stopping a running pipeline needs an endpoint.
- **`hasPlayed` as a gate in `IntroCard`.** The dead state looked like the
  remains of a rule that a learner should hear a word before being quizzed on
  it. Whether that rule is wanted is a product question, so the bookkeeping was
  removed rather than wired up, and a test pins that Continue stays open.
