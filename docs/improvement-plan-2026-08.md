# Implementation plan & training-data flywheel — August 2026

Companion to `docs/product-audit-2026-08.md`. Two parts:

1. **Sequencing** for the audit's recommendations (what to build, in what order).
2. **The flywheel** — a design for capturing every human correction the app
   receives (native-speaker transcript fixes above all) as durable,
   provenance-stamped training data that is easy to export and that feeds back
   into the app automatically.

---

# Part 1 — Implementation sequence

## Sprint 1 (≈1 week): metering & pricing

All small diffs; they change unit economics before any feature work.

1. **A1 — Voice minutes.** New `voice_usage` accounting: record consumed seconds
   on session close (client posts duration; server sanity-checks against token
   `expires_at`). Monthly allowance per tier enforced in
   `realtime-session-token` before minting a token. Remaining balance returned
   to the client and shown in `VoiceTab`.
2. **A3 — Cost telemetry.** Extend `llm_usage_logs` with
   `prompt_tokens, completion_tokens, cached_tokens, provider, cost_usd`;
   populate from the usage block already present in OpenRouter/Lovable
   responses inside `aiBrain.ts`'s single call path. Add the same logging to
   the TTS/STT/image legs. One admin chart: cost per user per feature per week.
3. **A4 — Prompt caching.** Reorder `askBrain`'s system prompt to
   [dialect identity] → [Rulebook] → [learner profile], mark the cache
   breakpoint after the stable half on Anthropic-routed calls.
4. **A2 — Tier-aware caps.** Replace `hasActiveSubscription`'s boolean with a
   tier lookup and an allowance table (`FREE / STANDARD / ALLIN` per feature).
   `enforceDailyCap` callers pass a feature key they already pass today.
5. **D1 — Annual plan.** Two annual price IDs in Stripe, added to
   `SUBSCRIPTION_TIERS`, pricing page defaults to annual with monthly
   equivalent shown.

## Sprint 2 (≈2 weeks): the flywheel (Part 2 below) + referrals

The flywheel's capture points are cheapest to add while the transcript editor
and native-review workflow are fresh; referrals (D4) ride along as an
independent small diff.

## Sprint 3+: the differentiators

Order by dependency, not appetite:

- **B1 embeddings first** (pgvector, embed transcripts/vocab/passages) — C1's
  comprehension shelf reads from it, and the flywheel's dedupe uses it.
- **C1 comprehension shelf** on top of B1 + `learnerProfile`.
- **B2 offline eval harness** — seeded directly from flywheel gold corrections
  (see Part 2, "loop-back"), so it should follow the flywheel, not precede it.
- **C2 FSRS personalisation**, **C4 recurring placement**, **B3 nightly
  pre-generation**, **C3 written production**, **D2 native feedback credits**
  (monetizes the same review workflow the flywheel instruments), **D3
  certification** last — it depends on C4's longitudinal assessment.

---

# Part 2 — The training-data flywheel

## Goal

Every time a human makes the app's Arabic better — a native speaker fixing a
Yemeni transcript line, a reviewer correcting a generated phrase, an admin
repairing an ASR segment — that correction should be:

1. **Captured at the moment it happens**, with full provenance (what the
   machine said, what the human changed it to, who they were, which audio it
   covers).
2. **Stored in one canonical, export-ready shape** — not scattered across
   feature tables that an export script has to reverse-engineer.
3. **Fed back into the app automatically** (Rulebook drafts, eval sets,
   few-shot corpora, engine weighting), so the product improves continuously.
4. **Exportable in one action** as versioned JSONL + audio manifests suitable
   for fine-tuning an ASR or dialect model later — "hours of audio with
   corrected transcripts" is exactly the artifact this produces.

## What already exists (the flywheel builds on, not around, these)

| Piece | Where | What it gives us |
| --- | --- | --- |
| Pre-edit ASR output | `discover_videos.raw_transcript_arabic` + `engines_used` | The machine's "before" per video |
| Final human-edited segments | `discover_videos` segments, edited via `useTranscriptEditor` / `AdminVideoForm` | The human "after", with per-segment timestamps |
| Source audio | `video-audio` bucket + `audio_files` (`storage_path`, `duration`) | The audio the pairs align to |
| Native review queue | `dialect_native_reviews` (`original_text` → `corrected_text`, dialect, source, reviewer) | Gold text corrections, already role-gated |
| MSA-leak sink | `dialect_rule_violations` via `msaViolationLogger.ts` | Automated before/after repair pairs |
| Vetted corpus | `dialect_corpus_sentences.vetted` | The loop-back target for corrected sentences |
| Learner errors | `learner_errors` | Weakness signal (already feeds the learner model) |

**The gap:** corrections are applied *destructively*. The transcript editor's
undo stack (SplitOp/MergeOp in `useTranscriptEditor`) lives client-side and is
discarded on save — the final `.update()` in `AdminVideoForm.tsx` overwrites
segments with no record of what changed. Native reviews keep before/after text
but aren't linked to audio spans. Nothing is exportable without archaeology.

## Canonical store: `training_examples`

One migration, one table, admin/service-role only (RLS: no learner access).

```sql
CREATE TABLE public.training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL CHECK (task_type IN
    ('asr','translation','generation','diacritization','pronunciation','dialect_id')),
  dialect text NOT NULL CHECK (dialect IN ('Gulf','Egyptian','Yemeni')),

  -- the pair
  machine_output text NOT NULL,      -- what the model/engine produced
  human_output   text NOT NULL,      -- what a human corrected it to
  context        jsonb NOT NULL DEFAULT '{}',  -- surrounding segs, prompt, source text

  -- audio alignment (null for text-only tasks)
  audio_bucket   text,
  audio_path     text,
  audio_start_ms integer,
  audio_end_ms   integer,

  -- provenance
  source_table    text NOT NULL,     -- 'discover_videos' | 'dialect_native_reviews' | ...
  source_id       uuid,
  source_function text,              -- edge function or UI surface that wrote it
  engines         jsonb,             -- ASR engines / model ids behind machine_output
  corrector_role  text NOT NULL,     -- 'native_speaker' | 'content_reviewer' | 'admin' | 'auto_repair'
  corrector_id    uuid,

  -- quality & governance
  tier            text NOT NULL CHECK (tier IN ('gold','silver','bronze')),
  source_license  text NOT NULL DEFAULT 'internal',  -- filterable at export
  pii_reviewed    boolean NOT NULL DEFAULT false,

  export_batch_id uuid,              -- stamped when exported; enables incremental exports
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.training_examples (task_type, dialect, tier, created_at);
```

Tier semantics: **gold** = corrected by a native speaker or `content_reviewer`;
**silver** = admin-corrected; **bronze** = automated (MSA repair pass,
validator rewrites). Exports default to gold+silver; bronze serves distillation
and eval-negative mining.

## Capture points (writers), in value order

### W1. Transcript editor saves → ASR pairs *(the "hours of audio" source)*

On save in `AdminVideoForm`, before the destructive `.update()`: diff the
outgoing segments against the currently stored ones (first save diffs against
`raw_transcript_arabic`'s segmentation). Every segment whose text changed
becomes one `asr` example: `machine_output` = old text, `human_output` = new
text, audio ref = `video-audio` path + the segment's start/end ms,
`engines` = the video's `engines_used`, tier by editor's role. The diff runs
server-side in a small `record-transcript-corrections` edge function (service
role writes; the client only sends before/after ids) so nobody can forge
training rows. Unchanged segments are *also* valuable — a native speaker
scrolling past a segment without touching it is weak confirmation — but start
with changes only; confirmations can come later as a `confirmed` context flag.

### W2. Native review corrections → generation/translation pairs

When `dialect_native_reviews.status` transitions to `corrected`, a DB trigger
copies the row into `training_examples` (`task_type` from the review's
`source_function`, tier gold). This instantly backfills nothing but captures
everything going forward; a one-off backfill script copies historical
`corrected` rows.

### W3. MSA repair pass → bronze pairs

`msaViolationLogger` already writes violations; extend `aiBrain`'s repair path
to also write (pre-repair → post-repair) pairs as bronze. These are the
distillation set: they teach a smaller model what the big pipeline fixes.

### W4. Learner signal → review queue → gold

Two lightweight UI additions, both funneling into the *existing*
`dialect_native_reviews` queue (which W2 then harvests once corrected):

- **Ask AI thumbs-down** on an assistant message → review row with
  `source: 'user_report'`, the message as `original_text`.
- **"Report this phrase"** on flashcards / stories / listen lines → same path.

Learners never write `training_examples` directly; their reports become
training data only after a native speaker corrects them. That keeps the gold
tier trustworthy.

### W5. Learner audio (later, opt-in only)

Pronunciation and shadowing audio is currently scored and discarded — correct
default. A Settings opt-in ("help improve Arabic voice recognition") would
retain the clip + reference text + score as `pronunciation` examples. Requires
consent copy and a Terms update; do not ship before those. Non-native accented
Arabic paired with known target text is scarce and genuinely valuable for
robust-ASR work.

## Export: `export-training-data`

Admin-only edge function (or `scripts/export-training-data.mjs` run with the
service key — start with the script; it avoids edge-function time limits):

- **Filters:** task_type, dialect, tier floor, date range, license,
  `unexported_only`.
- **Output:** one JSONL per task type into a private `training-exports`
  bucket, versioned by date: `exports/2026-08-12/asr_yemeni_gold.jsonl`.
  ASR rows use a HuggingFace-datasets-friendly shape:

  ```json
  {"audio": "video-audio/abc123.mp3", "start_ms": 41200, "end_ms": 44700,
   "text": "الليلة بنروح السوق", "machine_text": "الليلة نروح إلى السوق",
   "dialect": "Yemeni", "tier": "gold", "engines": ["soniox","munsit"], "id": "..."}
  ```

- **Audio:** export *references + offsets*, not sliced files — audio stays
  single-copy in the bucket, and a companion `manifest.txt` lists the distinct
  object paths for bulk download (training pipelines slice cheaply). An
  optional `--slice` mode can cut clips for a fully self-contained dataset.
- **Reproducibility:** each run stamps `export_batch_id`, so "everything since
  the last export" is one query, and any past dataset can be reconstructed
  exactly.
- **Admin surface:** a card on the admin dashboard — hours of gold audio per
  dialect, examples per week per tier, and an "Export" button. *Hours of gold
  audio per dialect* is the flywheel's north-star metric.

## Loop-back: how it makes the app improve continuously

Each is a small wire between the store and something that already exists:

1. **Rulebook mining.** `draft-dialect-rules` (exists) gains a mode that reads
   recent gold corrections instead of the raw corpus — real human fixes are
   the highest-signal source of new dialect rules.
2. **Eval set growth.** Every gold correction is a labeled test case. A weekly
   job appends distilled cases to the frozen eval set (audit item B2), so the
   evals get harder as the product gets corrected — model swaps are then
   judged against exactly the mistakes humans have had to fix.
3. **Corpus vetting.** Gold-corrected sentences upsert into
   `dialect_corpus_sentences` with `vetted = true`, growing the few-shot pool
   that `mine-dialect-corpus` and the generators draw from.
4. **Engine weighting.** ASR pairs record which engines produced the wrong
   text (`engines`). A per-engine, per-dialect correction-rate view answers
   the audit's open pilot questions (Cohere vs Azure; `munsit-en-ar`) with
   data instead of vibes, and can eventually tune merge weights.
5. **Digest.** `dialect-violations-digest` (exists) gains a flywheel section:
   examples captured this week, hours accumulated, top corrected patterns.

## Governance

- `source_license` marks each example's origin class (platform media vs
  app-generated vs learner-contributed) so any export can filter to what a
  given training use permits; the field exists from day one so this never
  needs backfilling.
- Learner-derived rows require the W5 opt-in; `pii_reviewed` gates Ask-AI
  conversation snippets out of exports until scrubbed.
- The table is service-role + admin read only; learners can never read
  another user's corrections.

## Build order & effort

| Step | What | Effort |
| --- | --- | --- |
| F1 | Migration (`training_examples` + `training-exports` bucket + RLS) | ½ day |
| F2 | W1 transcript-diff capture (`record-transcript-corrections`) | 1–2 days |
| F3 | W2 native-review trigger + historical backfill | ½ day |
| F4 | Export script + manifest + admin metrics card | 1–2 days |
| F5 | W3 repair-pass pairs, W4 learner report UI | 1–2 days |
| F6 | Loop-back wires 1–5 | 2–3 days |
| F7 | W5 learner-audio opt-in (needs consent copy first) | later |

F1–F4 alone deliver the user-stated goal: native corrections of dialect audio
stored durably and exportable as training data. F5–F6 make it a flywheel.

## Verification

- **Unit:** the segment-diff function is pure — test rename/split/merge/no-op
  cases produce the right example rows (pattern: `lessonPath.ts`-style pure
  module + Vitest).
- **Edge:** `deno test` for `record-transcript-corrections` (role → tier
  mapping, forged-payload rejection) alongside the existing `_test` suites;
  `npm run check:edge` stays green.
- **Contract:** migration replays in the contract job (`contract/` layer).
- **End-to-end manual:** edit two segments of a Yemeni video in the admin
  editor → two `asr` rows with correct audio offsets → run the export → JSONL
  row plays back the right audio span.
- Exit codes, not summary lines (`docs/handoff-findings.md`).
