# Fix: Yemeni reading-passage generation fails

## What actually happened

The error came from Reading Practice → generate a passage, in Yemeni. The backend logs for the failing runs show the whole story:

```text
[aiBrain] google/gemini-3.5-flash retry #1 (lower temp)
[aiBrain] google/gemini-3.5-flash retry #2 (tool nudge)
[aiBrain] google/gemini-3.5-flash exhausted retries, falling back to google/gemini-2.5-flash
[reading-passage] intermediate/Yemeni total=85081ms  (draft 76984ms, validate 7595ms)
[aiBrain] skipping repair pass, latency budget spent
[aiBrain] out of latency budget, not trying fallback google/gemini-2.5-pro
reading-passage brain error: 504 lovable google/gemini-2.5-flash timed out after 29045ms
```

Two compounding causes:

1. **The primary drafter never produces a usable tool call for this request.** Every Yemeni run spends three full attempts on `gemini-3.5-flash` (initial, lower temperature, tool nudge) before it gives up. Those three attempts burn most of the 95s wall-clock budget before any model has written a word.
2. **The fallback then has no time left.** `gemini-2.5-flash` needs ~77s for this passage schema on its own. Started late, it either finishes right at the ceiling (85s total, no time for the MSA repair pass — which is why leaks like أين / ماذا survived) or is cut off with a 504. The function then correctly returns 503, and the page shows the generic "Could not generate a passage right now" error.

So it is not Yemeni-specific content that breaks — it's that Yemeni runs are the heaviest (largest dialect rulebook + strictest prompt), so they are the first to fall off the latency cliff created by the wasted retries.

## The fix

1. **Fail fast on tool-call failures.** In the shared AI brain's fallback ladder, a "no tool call / unparseable" failure should cost at most one same-model retry, not two. If a model fails to emit the tool call twice, further perturbations of the same model don't help — move to the stable chain immediately. Timeouts already skip straight to fallback; keep that.
2. **Draft reading passages with a tool-reliable model first.** For the `reading_passage` purpose, order the drafters so the model that reliably emits this large tool schema leads, instead of discovering that only after three failures.
3. **Give the run honest headroom.** The server budget (95s) currently equals the client timeout (95s), so a slow-but-successful run can be killed by the browser mid-flight. Lower the server generation budget so it always returns a real answer or a real error before the client gives up, and reserve enough of that budget for the MSA repair pass so leaks are still cleaned up.
4. **Make the failure recoverable in the UI.** When the passage call fails, retry once automatically before surfacing the error, and show a specific message ("the writer took too long — try again") with the existing retry button rather than a generic failure.

## Technical notes

- `supabase/functions/_shared/aiBrain.ts` — `callModelWithFallback`: collapse attempts 2 and 3 into a single same-model retry; enter `STABLE_FALLBACKS` sooner so the fallback runs with a usable share of the deadline.
- `supabase/functions/_shared/modelRegistry.ts` / `aiBrain` purpose→lineup mapping: put the stable fast Gemini build ahead of the preview build for `reading_passage` drafting.
- `supabase/functions/reading-passage/index.ts` — `GENERATION_BUDGET_MS`: reduce below the client timeout and keep a repair-pass reserve.
- `src/pages/ReadingPractice.tsx` — one silent retry on 503/timeout, plus a clearer error message; no change to the existing Cancel behaviour.

No schema, prompt-content, or other feature changes.
