# The content library bridge — Ingleezy side

**Status:** built. Written 2026-09-19; this repo's half is
`supabase/functions/ingest-from-library`, tested in
`supabase/functions/_test/ingest_from_library_test.ts`.

A third app (working name **Maktaba**, مكتبة) is planned: a standalone content
library holding researched and forwarded material — TikToks, YouTube links, X
posts, screenshots — categorised, attributed to creators, and dispatchable to
Hikaya or Ingleezy for transcription with one button.

**The full architecture lives in Hikaya's
[`docs/content-library-architecture.md`](https://github.com/danieljchandler/arabic-buddy/blob/main/docs/content-library-architecture.md).**
This file covers only what Ingleezy has to do, and the two things about this
repo that make its half harder than Hikaya's.

## What the bridge is not

It is **not** `sync-hakiya-videos`, and must not be folded into it. That
function pulls Hikaya's *published* rows in as secondary learner content,
snapshot-style, on Hikaya's anon key and `published = true` RLS. It keeps
working unchanged.

The library bridge is the opposite edge: **raw, unprocessed research pushed
in to be transcribed**. Different direction, different auth, different
lifecycle. Two functions.

```
Maktaba ──dispatch-item──▶ ingest-from-library ──▶ discover_videos
                                                        │
                                                 process-english-video
                                                        │
Maktaba ◀──dispatch-callback───────────────────── pg_net trigger
```

## What shipped

| Piece | Where |
| --- | --- |
| Shared-secret auth | `_shared/requireRole.ts`, ported wholesale from Hakiya |
| The bridge | `supabase/functions/ingest-from-library` (`verify_jwt = false`) |
| Pipeline door | `process-english-video` now also accepts a service-role call |
| Schema | `supabase/migrations/20260919120000_library_bridge.sql` |
| Tests | `supabase/functions/_test/ingest_from_library_test.ts` |

Two things to do before the button works end to end:

1. **Apply `20260919120000_library_bridge.sql` to the live project** — see the
   warning below. `typesDrift` pins the three columns as known drift until a
   regeneration picks them up.
2. **Set the secrets**: `LIBRARY_BRIDGE_SECRET` (the same value the library
   holds as `INGLEEZY_BRIDGE_SECRET`) and `LIBRARY_BRIDGE_USER_ID`, the
   account new rows are attributed to. Without the latter the bridge answers
   503 rather than attributing content to an id that does not exist.

## What it needed

### 1. Port `_shared/requireRole.ts` from Hikaya — this was the blocker

Ingleezy has **no `_shared/requireRole.ts`**. Its content-writing functions do
inline `user_roles` lookups (see `sync-hakiya-videos`), which works for a user
JWT and has no answer at all for a service-to-service caller.

Hikaya's module is the one place that decides between the three legitimate
callers for a write to a row nobody owns — a staff member, the pipeline
calling itself with the service role, and a scheduled job holding a configured
shared secret. The bridge needs the third, and specifically:

- `hasSharedSecret(req, header, envVar)`
- `secretEquals(a, b)` — constant-time, both sides SHA-256'd first so the
  comparison is over fixed-length digests and neither the secret's length nor
  its prefix leaks.

Port the module wholesale rather than writing a one-off check. Hikaya's
`import-x-bundle` already runs on it (`x-harvest-secret` /
`SOCIAL_HARVEST_SECRET`), so it is proven, and porting it also gives Ingleezy
`requireContentManager` for the inline checks it currently repeats.

### 2. `ingest-from-library`

```ts
// POST /functions/v1/ingest-from-library
// Header: x-library-secret: <LIBRARY_BRIDGE_SECRET>
{ library_item_id, source_url, platform, title, language, dialect,
  creator_name, creator_handle, note, tags, thumbnail_url,
  audio_url?, callback_url, autostart }
→ { remote_id, remote_url, status: "processing" | "exists" }
```

Body: create the `discover_videos` row (unpublished, `transcription_status`
pending, `source = 'maktaba'`), then kick `process-english-video` with
`{ videoId }`. Most of it already exists as Hikaya's `ingest-shared-video` —
URL parsing, oEmbed, dedupe, pipeline kickoff — so port that and swap the
auth and the target pipeline.

Two requirements:

- **`config.toml` must set `verify_jwt = false`** for this function. The
  gateway's JWT check cannot help here: the caller is another app with its own
  identity system, and the publishable key that would satisfy `verify_jwt`
  ships in every browser bundle anyway. The shared secret **is** the check,
  so the function must be the thing that runs it.
- **Honour `audio_url` when present.** If the library already mirrored the
  audio, write it into the `video-audio` bucket as `<remote_id>.m4a` before
  kicking the pipeline. `process-english-video` already reads staged storage
  first — see its acquisition ladder, `video-audio` → cached `audio_files` row
  → `download-media` — so this needs no pipeline change and skips the flakiest
  step in the chain.

### 3. Schema: three columns on `discover_videos`

```sql
alter table public.discover_videos
  add column if not exists library_item_id uuid,
  add column if not exists creator_name    text,
  add column if not exists creator_handle  text;

create index if not exists discover_videos_library_item_idx
  on public.discover_videos (library_item_id);
```

`creator_name` / `creator_handle` are missing from both apps today —
`trending_video_candidates` collects them and the promotion to
`discover_videos` drops them, so no published video in either app knows who
made it.

> ⚠️ **This repo is currently demonstrating why that migration needs care.**
> `supabase/migrations/20260813160000_hakiya_bridge_source.sql` adds
> `discover_videos.source`, `sync-hakiya-videos` writes to it — and it is
> **not in `src/integrations/supabase/types.ts`**, because Lovable only
> applies SQL it runs itself and regenerates the types from the live schema.
> The column exists in CI's migration replay and in nobody's database. Apply
> the bridge migration to the live project (ask Lovable to run it, or
> `supabase db push` with a token) and let the regeneration carry the columns
> — and while you are there, apply the `source` one too.

### 4. Status: polled, not pushed

The design sketched a `pg_net` trigger POSTing to a callback in the library.
What shipped is the other direction: the library's `dispatch-status` asks
`ingest-from-library` with `{ action: "status", remote_id }`, and gets back
the transcription status plus, once complete, the transcript's **English**
lines for the library's own search index.

Polling won because it keeps this app ignorant of the library's address:
nothing here needs a `MAKTABA_CALLBACK_URL`, a second secret, or the `pg_net`
extension, and a library that is down is a stale row rather than a failed
trigger nobody sees. A trigger can be added later without changing this
function — the status action stays useful either way.

### 5. Secrets

| Secret | Used by |
| --- | --- |
| `LIBRARY_BRIDGE_SECRET` | `ingest-from-library`, both the ingest and status actions. Same value as the library's `INGLEEZY_BRIDGE_SECRET`. |
| `LIBRARY_BRIDGE_USER_ID` | the account bridged rows are attributed to (`created_by`) |

## Why English content routes here at all

The library's `items.language` is a fact about the content; `dispatches` is a
list of destinations. English items dispatch to Ingleezy, Arabic to Hikaya,
and a code-switched Gulf/English clip dispatches to **both** — each app
transcribes it in its own direction off the same mirrored audio. Nothing in
the library's schema forces the choice, which is the point: the creator record
is shared, the dispatch is not.
