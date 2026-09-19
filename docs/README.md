# What is in `docs/`

Two kinds of document live here and they were not distinguishable from each
other, which is a problem when one kind is about a different product.

`RETARGET.md` at the repo root makes the argument better than this file can: a
map that has drifted from the territory stops getting read, and then the
drift is permanent. It made that argument about itself. These are now the ones
it was describing.

## About Ingleezy

| Document | What it is |
| --- | --- |
| [`backend-bootstrap.md`](backend-bootstrap.md) | Standing up Ingleezy's own Supabase project — `RETARGET.md` step 10, the one thing left. Current. |
| [`testing.md`](testing.md) | How the suites are organised and what each one is for. Current. |
| [`handoff-findings.md`](handoff-findings.md) | The 47 behaviour findings the test suite turned up, all fixed, plus the standing constraints on the test environment. A record, and the constraints are live. |
| [`curriculum-builder-plan.md`](curriculum-builder-plan.md) | Design for the admin curriculum builder. Built; the plan is the rationale. |
| [`lesson-import-plan.md`](lesson-import-plan.md) | Design for the lesson xlsx importer. Built; same. |

## Inherited from Hakiya

These three were written for **Hakiya** (`arabic-buddy`) in August 2026, before
the fork. They came across whole and they still say so in their opening lines —
"where Hakiya should invest next", "Project: Hakiya (repo `arabic-buddy`)".

They are kept rather than deleted because most of what they analyse is shared:
the SRS engine, the learner model, the Brain pipeline, the cost structure and
the flywheel are the same machinery in both apps, and the reasoning is the
record of why things are the way they are. What does **not** carry over is the
direction of learning, so every sentence about dialect Arabic as the *target*
describes Hakiya and not this app. `RETARGET.md` is the map of that inversion.

Each now opens with a header saying so, and what has since been built.

| Document | Status |
| --- | --- |
| [`product-audit-2026-08.md`](product-audit-2026-08.md) | Hakiya-era. Its four Track A margin findings have all been implemented here. |
| [`improvement-plan-2026-08.md`](improvement-plan-2026-08.md) | Hakiya-era. Sprints 1 and 2 are done; Sprint 3+ is still a reasonable reading of what to build, with the target language flipped. |
| [`ai-pipeline-audit-2026-08.md`](ai-pipeline-audit-2026-08.md) | Hakiya-era, and explicitly a historical record even then — its own Part 3 proposal was not built, and it says what shipped instead. |

## Not in this directory

- [`../RETARGET.md`](../RETARGET.md) — the master map of the Hakiya → Ingleezy
  conversion. Which subsystems carried over, which flipped, which were pruned,
  and what is left.
- [`../README.md`](../README.md) — the product, the stack, the repos, and how
  to run it.
- `branding/` — the supplied brand assets the icon and palette were drawn from.
