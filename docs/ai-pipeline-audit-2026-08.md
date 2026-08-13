# AI Pipeline Audit + ALLaM/Fanar Proposal

**Project:** Hakiya (repo `arabic-buddy`). There is no separate "Lahja" project — `Lahja`
was this app's previous brand name; `src/lib/brandMigration.ts` migrates `lahja_*`
localStorage keys to `hakiya_*`. Everything below is one pipeline.

**Date:** 2026-08-04 · **Status:** Parts 1–3 are the original audit and proposal, kept as
the record of what the pipeline looked like before any changes. **The ALLaM proposal in
Part 3 was not built** — see [the 2026-08-05 update](#update--2026-08-05-what-was-actually-built)
at the end for what shipped instead and why.

---

## Part 1 — What's actually there

### 1.1 Service inventory

Every model string below was read off the actual request body / URL, not from comments
or variable names.

| # | Service | Exact model string sent | Endpoint | Auth | Pipeline stage | Invocation shape |
|---|---|---|---|---|---|---|
| 1 | **Munsit** | `munsit` | `https://api.munsit.com/api/v1/audio/transcribe` | `Bearer MUNSIT_API_KEY` | ASR — **top-priority engine** | One-shot; auto-chunks large MP3s into ~60s pieces |
| 2 | **Munsit TTS** | `munsit-tts-v1` (or resolved from `/models`; override `MUNSIT_TTS_MODEL_ID`) | `/api/v1/text-to-speech/{modelId}` | same | TTS | One-shot, with a `/models` + `/voices` discovery call |
| 3 | **Soniox** | `stt-async-v4` | `https://api.soniox.com/v1` | `Bearer SONIOX_API_KEY` | ASR #2 + free AR→EN baseline translation | 4-step async: upload → create → poll → fetch. Retries without `translation` if create fails |
| 4 | **Fanar STT** | `Fanar-Aura-STT-1` | `https://api.fanar.qa/v1/audio/transcriptions` | `Bearer FANAR_API_KEY` | ASR tie-breaker | One-shot; hard daily cap of 18 in code |
| 5 | **Fanar LLM** | `Fanar` *(bare alias)* | `https://api.fanar.qa/v1/chat/completions` | `Bearer FANAR_API_KEY` | ASR-merge **fallback** | Runs in parallel with Qwen merge; used only if Qwen's JSON fails to parse |
| 6 | **Fanar LLM** | `Fanar-Sadiq` | same | same | "meta enrichment" — vocab/grammar/culture | Parallel one-shot; output **unioned into final result** |
| 7 | **Fanar LLM** | `Fanar-C-2-27B` | same | same | Dialect validation | Parallel one-shot, **read-only** (stored for review, never gates anything) |
| 8 | **Fanar LLM** | `Fanar` *(bare alias)* | same | same | Admin curriculum builder | User-selectable in `curriculum-chat`'s own registry |
| 9 | **Qwen** | `qwen/qwen3-235b-a22b` | OpenRouter | `OPENROUTER_API_KEY` | ASR merge (Call 1) + analysis (Call 2) | Two sequential one-shots, each with a stricter-prompt retry |
| 10 | **Qwen** | `qwen/qwen3-max` | OpenRouter | same | Translation ensemble, 3rd leg (weight **0.5**) | Parallel leg of a 3-way weighted vote |
| 11 | **Claude** | `anthropic/claude-sonnet-4.5` | OpenRouter | same | Translation ensemble (weight 1.0); vocab enrichment; `DEFAULT_JUDGE` for draft_critic/council | Ensemble leg + a separate enrichment one-shot + critic passes |
| 12 | **Gemini** | `google/gemini-3.5-flash` | Lovable AI Gateway | `LOVABLE_API_KEY` | Translation ensemble (weight 1.0); CONTENT drafter | Ensemble leg / draft step |
| 13 | **Gemini** | `google/gemini-3-flash-preview` | Lovable Gateway | same | `DEFAULT_FAST`, UTILITY lineup | Solo one-shots |
| 14 | **Gemini** | `google/gemini-2.5-flash` | Lovable Gateway | same | Per-token gloss enrichment; fallback chain #1 | One-shot over every unique token |
| 15 | **Gemini** | `google/gemini-2.5-pro` | Lovable Gateway | same | `VALIDATOR_MODEL` in `dialectValidator.ts`; REASONING 3rd leg; fallback #2 | Post-generation validation one-shot |
| 16 | **Gemini (native)** | `lyria-3-clip-preview` | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` (query param) | Music generation for word/phrase jingles | One-shot |
| 17 | **OpenAI** | *(realtime session)* | `api.openai.com/v1/realtime/client_secrets` | `Bearer OPENAI_API_KEY` | Live voice conversation | Mints ephemeral client tokens; browser holds the session |
| 18 | **CAMeL-Lab BERT** | `CAMeL-Lab/bert-base-arabic-camelbert-mix-did-madar-twitter` | HF Inference API | `Bearer HUGGINGFACE_API_KEY` | City-level dialect ID, independent of any LLM | Parallel, non-blocking, never fails the pipeline |
| 19 | **Farasa (QCRI)** | *(REST, no model param)* | `farasa-api.qcri.org/msa/webapi/diacritizeV2/`, `farasa.qcri.org/webapi` | `FARASA_API_KEY` | Tashkeel/diacritization for TTS; segmentation + POS | Parallel, non-blocking |
| 20 | **Azure Speech** | *(REST STT + pronunciation assessment)* | `{region}.stt.speech.microsoft.com` or custom endpoint | `AZURE_SPEECH_KEY` | ASR leg + pronunciation scoring | One-shot |
| 21 | **ElevenLabs** | `eleven_multilingual_v2` | `api.elevenlabs.io` | `xi-api-key` | TTS (Egyptian dialect + story audio) | One-shot |
| 22 | **RunPod** | *(not an LLM)* | `api.runpod.ai/v2/up6r2cq58yg74u/run` | `RUNPOD_API_KEY` | Audio extraction/download worker | Async job + callback into `receive-audio`, HMAC'd with `RUNPOD_CALLBACK_SECRET` |

Non-AI supporting services: Firecrawl, Jina Reader, RapidAPI YouTube-MP3, YouTube Data
API, bolls.life (Bible text), Stripe.

**Nothing is self-hosted.** RunPod is the only compute you rent, and it runs audio
extraction, not inference. Every model above is a vendor API.

### 1.2 Pipeline map

**Path A — video ingestion** (`process-approved-video` → `analyze-gulf-arabic`), the deep chain:

```
STAGE 0  AUDIO ACQUISITION
         storage cache hit? ──yes──> reuse
              │no
              ├─> download-media (direct URL)
              └─> trigger-download ──> RunPod worker ──> receive-audio callback
                                                          (pipeline resumes async)
                              │
                              ▼
STAGE 1  PARALLEL ASR FAN-OUT — 5 engines, all at once, each independently failable
         ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────┐
         │ Munsit       │ Soniox       │ Fanar        │ Deepgram     │ Azure    │
         │ `munsit`     │`stt-async-v4`│`Fanar-Aura-  │ `nova-3`     │  REST    │
         │              │ +AR→EN trans │  STT-1`      │ ar,diarize   │          │
         └──────────────┴──────────────┴──────────────┴──────────────┴──────────┘
         priority ranking: Munsit > Soniox > Fanar > Azure > Deepgram
                              │
                              ▼
STAGE 2  analyze-gulf-arabic
         │
         ├─ CALL 1 — MERGE (all ASR transcripts in, clean Arabic lines out)
         │    Qwen3-235B-A22B  ∥  Fanar (bare alias)   ← Fanar used ONLY if Qwen JSON fails
         │    └─ retry w/ stricter prompt if both fail
         │
         ├─ PARALLEL BLOCK (6 concurrent branches)
         │    ├─ TRANSLATION ENSEMBLE — weighted 3-way vote
         │    │     Claude Sonnet 4.5 (1.0) ∥ Gemini 3.5 Flash (1.0) ∥ Qwen3-Max (0.5)
         │    │     └─ weighted-Jaccard clustering; Gemini+Claude cluster wins outright,
         │    │        else top cluster needs weight ≥1.5, else Claude > Gemini > Qwen
         │    ├─ CALL 2 — ANALYSIS (Qwen3-235B): per-line translations, vocab, grammar
         │    ├─ META ENRICHMENT (Fanar-Sadiq)          ← see §2.3, this is wrong
         │    ├─ DIALECT VALIDATION (Fanar-C-2-27B)     ← read-only, never acted on
         │    ├─ DIALECT ID (CAMeL-Lab BERT via HF)     ← non-blocking
         │    └─ DIACRITIZATION (Farasa)                ← non-blocking
         │
         ├─ MERGE: union Fanar-Sadiq vocab/grammar in; prefer its culturalContext if LONGER
         │
         └─ ENRICHMENT (parallel)
              ├─ Claude Sonnet 4.5 — per-item cultural/idiomatic/dialect depth
              └─ Gemini 2.5 Flash  — per-token English gloss for EVERY unique token
                              │
                              ▼
STAGE 3  persist → auto-title (Lovable gateway) → auto-rate CEFR (rate-video-cefr)
```

**Path B — content generation** (`_shared/aiBrain.ts`, used by 24 edge functions):

```
askBrain(task)
  → inject dialect identity + vocab rules + forbidden tokens
  → strategy: solo | ensemble | draft_critic | council
       TRANSLATION lineup = [Claude 4.5, Gemini 3.5 Flash], ensemble
       CONTENT     lineup = [Gemini 3.5 Flash, Claude 4.5], draft_critic
       UTILITY     lineup = [Gemini 3 Flash preview], solo
       REASONING   lineup = [Claude, Gemini Flash, Gemini Pro], council
  → MSA-leak detection (rulebook + hardcoded forbidden tokens)
  → repair pass if leaks found
  → dialectValidator (google/gemini-2.5-pro) native-speaker check
  → emit metrics

Routing:  /^(anthropic|qwen|meta-llama|mistralai|deepseek|x-ai)\//  → OpenRouter
          everything else                                            → Lovable Gateway
Timeouts: 45s per call, 90s per task wall-clock
Fallback: gemini-2.5-flash → gemini-2.5-pro → gemini-3-flash-preview
```

### 1.3 Redundant, unused, or dead

Ordered by how much it's likely costing you.

1. **`MODEL_IDS.FANAR_SADIQ` and `MODEL_IDS.FANAR_VALID` are dead constants.**
   Declared at `modelRegistry.ts:39-40`, imported by nothing. `analyze-gulf-arabic`
   hardcodes the literals instead. And they *couldn't* work through the registry anyway:
   `routeForModel()` (`aiBrain.ts:163`) sends anything without an `anthropic/`-style
   prefix to the Lovable Gateway, which doesn't serve Fanar. **There is no Fanar route in
   aiBrain at all** — Fanar lives entirely outside the Brain, in `analyze-gulf-arabic`'s
   private `callFanar()`.

2. **A "do not hardcode model IDs" comment sitting directly on top of hardcoded model IDs.**
   `analyze-gulf-arabic.ts:1679-1685` says IDs come from `modelRegistry.ts`
   "so upgrades happen in one place. Do NOT hardcode IDs here" — then immediately declares
   `const CLAUDE = 'anthropic/claude-sonnet-4.5'`, `const GEMINI = 'google/gemini-3.5-flash'`,
   `const QWEN = 'qwen/qwen3-max'`. Bumping the registry will silently *not* update your
   single highest-volume path.

3. **Three competing model registries.** `_shared/modelRegistry.ts`, `curriculum-chat`'s own
   `MODEL_REGISTRY`, and the literals above. `curriculum-chat`'s config carries
   `native?: boolean // true = native RunPod /runsync API` — nothing sets or reads it,
   leftover from a self-hosted iteration.

4. **`hf-chat` no longer touches HuggingFace.** It's a thin `askBrain` wrapper with a
   misleading name. Its only client, `src/lib/huggingface.ts`, is imported by nothing but
   its own test file — dead frontend module.

5. **`notify-due-reviews` has zero references** anywhere in `src/`, `supabase/`, or any
   cron/config in the repo. Either orphaned or externally scheduled with no record here.

6. **ASR clients are implemented twice.** Deepgram, Soniox, Fanar, and Munsit each exist as
   a standalone edge function *and* re-implemented inline inside `process-approved-video`.
   Consequence: **Deepgram Nova-3 keyterm prompting exists only in the standalone
   function** — the main video pipeline gets no vocabulary boosting from known lesson words.

7. **Fanar's dialect-validation prompt is hardcoded Gulf-only**
   (`"أنت خبير في اللهجة الخليجية"`, line 316) even though the pipeline carries a
   `DIALECT_MODULE` covering Egyptian and Yemeni. Egyptian and Yemeni content is currently
   validated against Gulf norms — actively wrong signal, not just a missing one.

8. **Fanar's validation output is write-only.** `dialectValidation` is stored and surfaced
   for review, but never feeds back into the transcript, never gates publication, never
   triggers a repair. You're paying for a signal you don't consume.

9. **Weight inconsistency.** The ensemble comment and `MODEL_WEIGHTS` disagree on Qwen
   (0.5 vs 0.6), and `analyze-gulf-arabic` uses its own local `[1.0, 1.0, 0.5]` array
   rather than calling `getModelWeight()`.

10. **Stale catalog entries.** `anthropic/claude-opus-4.1` is labelled
    "Legacy — use Sonnet 4.5" but still carries weight 0.95 and is still reachable via
    `pickModels()`. `google/gemini-3.1-pro-preview`, `openai/gpt-5`, and `openai/gpt-5-mini`
    have voting weights but no catalog entry and no caller.

---

## Part 2 — Fanar version check

### 2.1 Verdict

**You are already on Fanar 2.0 — but only for one of your four Fanar LLM calls.**

I pulled the live spec, which is public and needs no key:

```
curl https://api.fanar.qa/openapi.json
```

Its rate-limit table is the authoritative list of valid `model` values:

```
Fanar                50/min     Fanar-Sadiq-TTS-1     20/day
Fanar-S-1-7B         50/min     Fanar-Oryx-IVU-2      20/day
Fanar-C-1-8.7B       50/min     Fanar-Aura-TTS-2      20/day
Fanar-C-2-27B        50/min     Fanar-Aura-STT-1      20/day
Fanar-Sadiq          50/min     Fanar-Aura-STT-LF-1   10/day
Fanar-Sadiq-2        50/min     Fanar-Oryx-IG-2       20/day
Fanar-Guard-2        50/min     Fanar-Shaheen-MT-1    20/day
Fanar-Diwan          50/min
```

The naming decodes as `Fanar-<family>-<generation>-<size>`:

- `Fanar-C-1-8.7B` = **Fanar 1.0** chat — the "Fanar Prime" 9B, HF `QCRI/Fanar-1-9B-Instruct`
- `Fanar-C-2-27B` = **Fanar 2.0** chat — HF `QCRI/Fanar-2-27B-Instruct`, Gemma-3-27B backbone, 32k context

So, call by call:

| Call site | Model sent | Generation | Assessment |
|---|---|---|---|
| Dialect validation (`analyze-gulf-arabic:1761`) | `Fanar-C-2-27B` | **2.0** ✅ | Correct and current |
| ASR merge fallback (`:1573`) | `Fanar` (alias) | **unpinned** ⚠️ | Resolves server-side; you don't control 1.0 vs 2.0 and it can change under you |
| Meta enrichment (`:1751`) | `Fanar-Sadiq` | **gen 1, wrong family** ❌ | See §2.3 |
| Curriculum builder (`curriculum-chat:51`) | `Fanar` (alias) | **unpinned** ⚠️ | Same as above |
| STT | `Fanar-Aura-STT-1` | current ✅ | But see §2.4 |

### 2.2 The bare `Fanar` alias

Two call sites send `model: "Fanar"`. That's a server-side alias — QCRI decides what it
points at, and they can repoint it during a release without telling you. Your merge
fallback and your admin curriculum builder are both riding an unpinned pointer. Pin both
to `Fanar-C-2-27B`. Zero API changes, zero cost change.

### 2.3 The `Fanar-Sadiq` problem — highest-value finding in this audit

`Fanar-Sadiq` is **not a general-purpose chat model.** From the OpenAPI request schema,
its model-specific parameters are:

```
book_names          preferred_sources / exclude_sources / filter_sources
madhab              restrict_to_islamic          persona
```

Those are Quran/Hadith/seerah corpora, Islamic schools of thought, and an
Islamic-content-only switch. It's a multi-agent RAG system for religious content —
Fiqh reasoning, Quran/Hadith retrieval, zakat and inheritance calculation, prayer times,
Hijri calendar. The spec also states that for Sadiq models the standard LLM parameters
(temperature, top_p, etc.) **are ignored entirely**.

You are sending it `getMetaSystemPrompt()` — a generic *"extract 5–8 useful vocabulary
words, 2–4 dialect grammar points, and a cultural note from this Gulf Arabic transcript,
output JSON"* task — over secular video content.

And you don't discard the result. `analyze-gulf-arabic:1918-1944`:

- unions its vocabulary into the final vocab list,
- unions its grammar points in,
- and **prefers its `culturalContext` whenever the string is longer** ("richer").

A religious-corpus RAG agent winning your cultural-context field on a length heuristic,
over secular Gulf video transcripts, is a live and plausible source of both MSA drift and
off-topic religious framing in learner-facing content.

**Fix: change one string, `'Fanar-Sadiq'` → `'Fanar-C-2-27B'`.** No extra calls, no extra
latency, no cost delta. This is the cheapest quality win available anywhere in the pipeline.

*(If you ever do want Islamic-content features — Bible/Quran comparative work, religious
vocabulary — `Fanar-Sadiq-2` is the current generation, and it's genuinely excellent at
that. Just not at this job.)*

### 2.4 What "upgrading to Fanar 2.0" actually involves

Much less than you'd expect, because the API surface is unchanged.

**Zero-cost changes (do these regardless):**
- `'Fanar-Sadiq'` → `'Fanar-C-2-27B'` for meta enrichment
- `'Fanar'` → `'Fanar-C-2-27B'` in the merge fallback and `curriculum-chat`
- Same `/v1/chat/completions`, same OpenAI-compatible body, same Bearer auth. **No client
  changes, no schema changes, no cost change.** Chat models are 50 req/min across the board.

**Capability changes you inherit:**
- **Context: 4k → 32k.** This alone justifies pinning. Your merge call sets
  `maxTokens: 8192` and feeds up to five concatenated ASR transcripts — on a 4k model
  that silently truncates.
- **Native Arabic reasoning traces.** Fanar 2.0 emits `<think>...</think>` blocks with
  multi-step reasoning generated *natively in Arabic* (~250k Arabic reasoning examples),
  not translated English traces. **But:** the spec says `enable_thinking` is
  Fanar-C-2-27B-only *and requires additional authorization* from QCRI. Don't design around
  it until it's granted. When you do: it adds output tokens and latency, and you must strip
  `<think>` blocks before JSON parsing or every structured call will fail.
- **Tool calling — not actually reachable.** The model card advertises generic tool use
  plus 10 internal Fanar tools, but the API's `ChatCompletionRequest` schema has **no
  `tools` or `tool_choice` fields**. Tool calling is not exposed through this API today.
  Your JSON-in-prompt approach stays as-is.
- Reported gains vs Fanar 1.0: +7.32% ArabicMMLU, +10.68% GSM8K, plus hallucination
  mitigation via knowledge probing and verification traces.

**Unused models already on your key** — no new contract needed:
- `Fanar-Aura-STT-LF-1` — long-form STT. Better suited to video-length audio than
  `Fanar-Aura-STT-1`, though the quota is tighter (10/day vs 20/day).
- `Fanar-Guard-2` — moderation, 50/min.
- `Fanar-Shaheen-MT-1` — dedicated translation, 20/day.

**Cost/access:** no change. Same key, same free-tier quotas. Your code's STT cap of 18/day
correctly leaves headroom against the real 20/day limit.

---

## Part 3 — Where ALLaM fits

### 3.1 The constraint that shapes everything

**ALLaM on Groq is `allam-2-7b`, with a 4,096-token context window and 4,096 max output
tokens.** Throughput is roughly 1,800 tok/s. Pricing is still listed as *"Pending"* on
Groq's model page — budget against a comparable 7B (~$0.05–0.20 per million tokens) and
confirm before committing.

That 4k window is the whole story. ALLaM **cannot**:
- take a full video transcript,
- do your ASR merge step,
- do whole-transcript translation.

ALLaM **can**, extremely well and extremely cheaply:
- judge a single line for dialect authenticity,
- enrich one vocabulary item,
- rewrite a short MSA-leaking snippet into real dialect.

So the right frame is: **ALLaM is a per-item specialist, not a pipeline-stage replacement.**
Put it where the unit of work is one line or one word, and it's excellent. Point it at a
transcript and it silently truncates.

### 3.2 Proposed division of labor

| Stage | Today | Proposed | Rationale |
|---|---|---|---|
| ASR fan-out | 5 engines | unchanged | Not an LLM problem |
| ASR merge (Call 1) | Qwen3-235B ∥ `Fanar` alias | Qwen3-235B ∥ **`Fanar-C-2-27B`** | Needs 32k context. ALLaM can't fit — don't try |
| Translation ensemble | Claude 1.0 ∥ Gemini 1.0 ∥ Qwen 0.5 | **unchanged** | Target language is English. Arabic-centric models aren't better English writers; a 4th leg buys nothing |
| Dialect validation | `Fanar-C-2-27B`, Gulf-only prompt, output ignored | **Fanar + ALLaM, disagreement-gated**, prompt made dialect-aware, output consumed | The one place two-model voting genuinely pays — see §3.3 |
| Vocab/grammar meta | `Fanar-Sadiq` ❌ | **`Fanar-C-2-27B`** | Fix the misassignment (§2.3) |
| Vocab enrichment | Claude Sonnet 4.5 | **ALLaM primary, Claude fallback** | Per-item, short, Arabic-cultural. Fits 4k comfortably. ALLaM's benchmarked sweet spot |
| Per-token gloss | Gemini 2.5 Flash | unchanged (A/B ALLaM later) | High-volume cheap lookup; Flash already wins on cost |
| MSA-leak repair (aiBrain) | Claude/Gemini | **ALLaM** | Short snippets, Arabic-native rewrite, latency-sensitive |
| `dialectValidator` | Gemini 2.5 Pro | **ALLaM**, Gemini Pro as tiebreak | Single sentences. ALLaM is Arabic-native and far cheaper/faster |
| Content generation | Gemini draft → Claude critic | unchanged, optional ALLaM dialect-polish pass | Pedagogical structure and English prose are Claude/Gemini strengths |
| Live voice | OpenAI realtime | unchanged | No Arabic-specialist equivalent |

**Which model owns which strength:**

- **Fanar-C-2-27B** — long-context Arabic work and cultural alignment. It's the only Arabic
  specialist you have that can hold a whole transcript (32k). Give it everything
  transcript-shaped: merge fallback, meta enrichment, whole-document dialect review.
- **ALLaM** — per-item dialect authenticity and Arabic-native short-form judgment, at ~10x
  lower cost and latency than routing the same work to Claude or Gemini Pro.
- **Claude** — English prose quality, pedagogical judgment, critic/judge roles, and
  structured-output reliability. Keep it as the judge and as the enrichment fallback.
- **Gemini** — cheap high-volume utility work (per-token gloss, classification) and
  multimodal. Keep it exactly where it is.
- **Qwen** — third-leg verifier at reduced weight. No reason to change.

### 3.3 Where cross-checking is worth it — and where it isn't

**Worth it: dialect validation.** You already generate three independent dialect signals
that never talk to each other:

1. CAMeL-Lab BERT — city-level dialect ID (logged, then dropped)
2. Fanar — LLM dialect review (stored, never acted on)
3. MSA-leak detector — rulebook token scan (does gate the repair pass)

Adding ALLaM as a second LLM validator and **gating on disagreement** turns four scattered
opinions into one confidence score: when Fanar and ALLaM agree, accept and move on; only
when they disagree do you escalate to a third judge. That's cheap, and unlike today it
produces something you can actually act on.

**Worth it, but as fallback not vote: vocab enrichment.** Run ALLaM first; fall through to
Claude only when ALLaM's JSON fails to parse or the item is flagged. You get most of the
cost saving without risking the field going empty.

**Not worth it: translation.** You already run a 3-way weighted ensemble into English.
A 4th leg from an Arabic-centric model adds cost and latency on a task where its
specialization doesn't apply.

**Not worth it: ASR merge.** Context-bound. ALLaM structurally cannot do it.

### 3.4 Cost, latency, integration, and expected gain

Ordered by return on effort. Phase 0 is free.

| # | Change | Extra calls | Latency | Integration work | Expected gain |
|---|---|---|---|---|---|
| **PHASE 0 — free, no ALLaM needed** ||||||
| 0.1 | `Fanar-Sadiq` → `Fanar-C-2-27B` | 0 | 0 | One string | **High.** Removes religious-RAG contamination from vocab/grammar/cultural fields on all video content |
| 0.2 | Pin `Fanar` alias → `Fanar-C-2-27B` (2 sites) | 0 | 0 | Two strings | Medium. Removes silent-version-drift risk; gains 4k→32k on the merge fallback |
| 0.3 | Make Fanar validation prompt dialect-aware | 0 | 0 | Template the hardcoded Gulf prompt off `DIALECT_MODULE` | **High for Egyptian/Yemeni.** Today those are validated against Gulf norms — wrong signal, not absent signal |
| 0.4 | Consume the validation output | 0 | 0 | Wire `dialectValidation` into the review queue / a gate | Medium. You already pay for this signal |
| 0.5 | Delete dead code (§1.3 items 1, 4, 5, 10) | 0 | 0 | Deletions + one registry cleanup | Maintenance only, but removes a real footgun: registry bumps that don't propagate |
| **PHASE 1 — ALLaM, low risk** ||||||
| 1.1 | ALLaM in `dialectValidator.ts`, Gemini 2.5 Pro as fallback | 0 net (swap) | **−1 to −2s** per validation (Groq ~1800 tok/s vs Gemini Pro) | Route + prompt port + length guard | Medium-high. Faster and cheaper; Arabic-native judgment on single sentences. Easy to A/B against current Gemini Pro results |
| 1.2 | ALLaM as MSA-leak repair model in aiBrain | 0 net (swap) | −0.5 to −1.5s per repair | Reuse 1.1's routing | Medium. Repair inputs are short and Arabic-native — good fit |
| 1.3 | ALLaM primary for vocab enrichment, Claude fallback | 0 net | −1 to −2s | Length guard + JSON-failure fallback branch | Medium. Main win is cost: swaps Sonnet-priced calls for 7B-priced ones on a per-item task |
| **PHASE 2 — ALLaM, higher value, more work** ||||||
| 2.1 | Fanar + ALLaM dialect cross-check, disagreement-gated | **+1** per transcript (+1 more only on disagreement) | +300–500ms (parallel, so ~0 wall-clock — it joins an existing `Promise.all`) | New validator branch, agreement scoring, escalation path, storage for the confidence score | **High.** Turns 4 disconnected dialect signals into 1 actionable confidence score. Best accuracy-per-call in the proposal |
| 2.2 | Request `enable_thinking` authorization from QCRI | 0 until granted | +2–5s when used | Access request; `<think>`-block stripping before JSON parse | Unknown until you have access. Worth requesting now, designing for later |

**Integration work common to all ALLaM changes:**

1. Add `GROQ_API_KEY` to Supabase secrets and `.env.example`.
2. Extend `routeForModel()` in `aiBrain.ts:163` with a `groq/` prefix branch →
   `https://api.groq.com/openai/v1/chat/completions`. ~10 lines; Groq is OpenAI-compatible.
3. Add `ALLAM: 'allam-2-7b'` to `MODEL_IDS` and a `MODEL_WEIGHTS` entry.
4. **Build the 4k context guard first.** A char/token pre-check that skips ALLaM and falls
   through to the existing model when input is too long. This is the main integration risk —
   without it you get silent truncation rather than a clean failure, which is exactly the
   kind of bug that surfaces as mysterious quality regressions weeks later.
5. **Verify Groq's `allam-2-7b` supports forced tool calling before routing any aiBrain task
   through it.** `callModel()` sets `body.tools` + `tool_choice: {type:'function'}` and the
   retry ladder treats "no tool call" as a recoverable failure. If ALLaM on Groq doesn't
   support forced function calling, every structured task through it burns the full retry
   ladder before falling back. That would need a JSON-in-prompt branch — **this, not the
   routing, is the real integration cost.** Worth a 10-minute spike before committing to
   Phase 1.

### 3.5 Recommendation

Do **Phase 0 first, on its own.** It's five string/prompt changes and some deletions, costs
nothing in calls or latency, and 0.1 and 0.3 are probably worth more quality than anything
in Phase 1 or 2. It also cleans the registry so Phase 1's routing change lands in one place
instead of three.

Then spike the Groq tool-calling question (§3.4 item 5) before committing to Phase 1 —
the answer determines whether ALLaM integration is ~30 lines or a new prompt path through
aiBrain.

Then Phase 2.1 as the flagship accuracy change, since it's the one that finally makes your
four dialect signals add up to something.

---

## Open questions for you

1. **Is `notify-due-reviews` externally scheduled?** If not it's dead and should go.
2. **Do you want Nova-3 keyterm prompting in the main video pipeline?** It exists in the
   standalone Deepgram function but not the inline one — likely a free accuracy win on
   known lesson vocabulary.
3. **Should Fanar's dialect validation gate publication**, or stay advisory? Changes the
   design of Phase 2.1.
4. **Request `enable_thinking` access from QCRI now?** It's a lead-time item.

---

## UPDATE — 2026-08-05: what was actually built

The proposal above is superseded in two ways: **ALLaM was dropped** (it left Groq, and no
platform hosts it pay-per-token — DeepInfra, Fireworks, Together and OpenRouter were all
checked directly), and the scope widened from "add ALLaM" to "use every tool in the stack
properly." A second audit pass looked at how each already-integrated vendor is configured
versus what it can do, and a market scan looked for newer plug-and-play options.

Everything below is **implemented and merged** on `claude/ai-pipeline-audit-allam-fanar-gvacwj`.

### What replaced ALLaM

**Mistral Saba** (`mistralai/mistral-saba`) fills the Arabic-native per-item role ALLaM was
slated for. It is a 24B Arabic-focused model with 32k context at $0.20/$0.60 per 1M tokens,
reachable on the **existing OpenRouter key** — no new vendor, no 4k context guard, and
`routeForModel()` already routes `mistralai/` correctly.

`validateDialectCrossChecked()` in `_shared/dialectValidator.ts` asks Saba first and stops
on a confident pass; only an uncertain verdict escalates to Gemini 2.5 Pro, and the harsher
of the two verdicts wins with merged leak lists. A confident pass now costs one cheap call
instead of one Gemini Pro call, and the gate is never weaker than before.
`DIALECT_VALIDATOR_CROSSCHECK=off` reverts to Gemini alone.

### Fanar, used properly

| Change | Effect |
|---|---|
| `Fanar-Sadiq` → `Fanar-C-2-27B` for meta enrichment | Stops the Islamic-RAG model framing secular vocab/grammar/cultural output |
| Bare `Fanar` alias → `Fanar-C-2-27B` everywhere | Removes silent version drift; merge fallback gains 4k → 32k context |
| Validation prompt templated per dialect | Egyptian and Yemeni transcripts are no longer judged against Gulf norms |
| Validation + CAMeL output persisted to `engines_used.dialect_signals` | Two paid per-video calls that ended in `console.log` now drive an admin review banner with a composite `flagged` bit |
| **`Fanar-Shaheen-MT-1`** added as a translation tiebreak | Previously unused. One batched AR→EN call on lines the 3-way ensemble disputed or left empty; fills gaps, attaches `altTranslation` for review, metered under `fanar_usage` endpoint `mt` |
| **`Fanar-Aura-STT-LF-1`** routing | Audio over ~30s now uses the long-form model; `Fanar-Aura-STT-1` is documented for 20–30s clips only. Each is metered under its own quota |
| Inline pipeline STT metered | It bypassed `fanar_usage` entirely, so the budget was only enforced on the low-traffic Transcribe page |

### ASR: same number of engines, stronger lineup

| Slot | Was | Now |
|---|---|---|
| 1 | Munsit | Munsit — oversize-skip now visible, `MUNSIT_ASR_MODEL` knob for the `munsit-en-ar` code-switch model, re-enabled on the Transcribe page (it had been disabled since Mar 2026 for a DNS outage on a domain the server no longer calls) |
| 2 | Soniox `stt-async-v4`, `language_hints: ["ar"]` strict, no context | Soniox **`stt-async-v5`** (v4 was retired 2026-06-30 and silently rerouting), **context biasing** from dialect vocab + video title, `["ar","en"]` hints so code-switched English is no longer suppressed, diarization on, per-token confidence captured |
| 3 | Fanar STT | Fanar STT / STT-LF by duration |
| 4 | Deepgram `nova-3` | **ElevenLabs Scribe v2** — top of the Artificial Analysis WER leaderboard, best-in-class on Egyptian/Saudi Arabic-English code-switching, on the ElevenLabs key already held for TTS |
| 5 | Azure | Azure, plus **Cohere Transcribe Arabic** as an env-gated pilot (`COHERE_API_KEY`) — lowest average WER across MSA/Egyptian/Gulf/Levantine/Maghrebi of the open models |

Deepgram was a generalist called with `language=ar` (which disables its code-switch path)
whose Arabic word boundaries were never trusted for alignment. Its transcript was also
being sent to `analyze-gulf-arabic` as `deepgramTranscript` and **never read there** —
Scribe's and Cohere's are now actually consumed. Per-engine outcomes are persisted to
`engines_used.asr`, so engine failures are visible in the database rather than only in
function logs.

### Learner-facing fixes

- **The conversation simulator was speaking Egyptian in a generic English voice.**
  `elevenlabs-tts` allowed exactly one premade English voice while `listenTts` had three
  native `ar-EG` voices curated two files away. Fixed; Yemeni now routes to Azure's real
  `ar-YE` neural voices (ElevenLabs has none), and the TTS cache is keyed by dialect.
- **Pronunciation assessment returned a score, not feedback.** Added `PhonemeAlphabet:
  "IPA"` (the UI had been rendering raw SAPI symbols), `NBestPhonemeCount` (shows the
  learner what they said instead of the target) and prosody scoring — three fields in one
  object literal.
- **Yemeni learners got a hard 400** from pronunciation assessment: `ar-YE` was missing
  from `SUPPORTED_LOCALES` even though the dialect map already handled it. The assessment
  locale also followed a hardcoded `ar-SA` regardless of the learner's dialect.
- Story narration passes previous/next lines to ElevenLabs for prosody across line
  boundaries. `ELEVENLABS_TTS_MODEL` allows A/B-ing `eleven_v3` without a redeploy.

### Removed

- **RunPod, entirely** — the setup does not work. `trigger-download` and `receive-audio`
  (which existed only as RunPod's callback target) are deleted along with their config,
  the frontend fallbacks, and the dead `native` `/runsync` branch in curriculum-chat.
  `download-media` already handled YouTube via Cobalt plus three RapidAPI MP3 fallbacks
  and is now the single acquisition path — and it returns MP3, which keeps Munsit's
  chunker eligible.
- Unreachable Gemini TTS provider in `listenTts` (`planProvider` could never return it),
  `pickModels()` and its tag catalog (zero callers), `MUNSIT_FUSHA_VOICES`, and
  `MODEL_WEIGHTS` entries for models used nowhere.
- **Kept deliberately:** `notify-due-reviews` (no in-repo callers but may be externally
  scheduled) and `hf-chat` (misnamed — it calls the Lovable gateway, not HuggingFace — but
  reachable via `src/lib/huggingface.ts`).

### Registry consolidation

The rule that model bumps land in one place was being bypassed in three ways, all fixed:
16 functions hardcoded `google/gemini-3-flash-preview` inline; curriculum-chat kept its own
registry; and the admin ModelSelector offered four models the backend rejected with
"Unknown model" (`gemini-3.1-pro-preview`, `claude-opus-4.1`, `gemini-2.5-pro`,
`qwen3-max`). Also fixed three latent type bugs that were breaking `deno check` across ~30
functions, including `usageCap`'s `subscription_end` and curriculum-chat logging a
`MsaLeakResult.score` field that has never existed.

Repo lint errors: 596 → 552. All 362 tests pass.

### Still open

1. ~~Verify the Cohere model string.~~ **Resolved.** Cohere's audio-transcription
   quickstart lists both verbatim: `cohere-transcribe-03-2026` (general) and
   `cohere-transcribe-arabic-07-2026` (Arabic). The code already uses the Arabic one
   against `POST https://api.cohere.com/v2/audio/transcriptions` with `Bearer` auth and
   `file` / `model` / `language=ar` form fields — matching the documented contract.
   Set `COHERE_API_KEY` to activate the leg; `COHERE_STT_MODEL` overrides the model.
2. **Pilot Cohere against Azure** on ~10 videos per dialect before deciding whether Azure's
   ASR leg is still earning its slot. Azure's pronunciation assessment is a separate
   concern and stays regardless.
3. **A/B `eleven_v3`** against `eleven_multilingual_v2` for Egyptian narration.
4. **Trial `munsit-en-ar`** on code-switched content via `MUNSIT_ASR_MODEL`.
5. **Should Fanar's dialect validation gate publication**, or stay advisory? It is now
   surfaced in admin review with a `flagged` bit but does not block anything.
6. **Is `notify-due-reviews` externally scheduled?** If not, it can go.
7. **Request `enable_thinking` access from QCRI** — still a lead-time item.

---

## UPDATE — 2026-08-06: the four defects the last run's audit surfaced

An audit of one TikTok upload (Omani/Gulf, B2, 11 lines) found five of six ASR engines and
all three translation models working, with four things still wrong. Three were code, one is
configuration only.

### 1. Munsit returned an empty transcription — **fixed**

Munsit answered in 1.7s with HTTP 200 and a blank `data.transcription`. Root cause: every
ASR leg named its multipart part `audio.mp3` with whatever content type storage reported,
and TikTok/YouTube audio is MP4/AAC. Engines that sniff the bytes shrugged this off; Munsit
dispatches on the file extension, so it handed an MP4 container to an MP3 decoder and
returned nothing — indistinguishable downstream from a silent clip.

- `asrUpload()` in `_shared/audioChunk.ts` now names the part after the container the bytes
  actually are (`.m4a`, `.aac`, `.wav`, `.mp3`, `.webm`, `.ogg`), with a matching MIME type.
- An empty 200 on the single-payload path is retried once as a raw ADTS stream, demuxed from
  the MP4 without re-encoding.
- An empty result is now reported as `error: "empty-transcription (container=…)"` rather
  than a bare `ok:false, chars:0` — which is the same row a missing API key produces.
- ADTS is now a first-class container: `isLikelyAdts` distinguishes it from MPEG audio by
  the layer bits (they share the 11-bit sync word), and `planAsrPayloads` can chunk it.

Only the Munsit leg was re-pointed at `asrUpload()`. The other five engines are working and
were left alone deliberately.

### 2. Shaheen-MT resolved disputes but filled none — **fixed**

Not a bug in the call: the tiebreak fired, recovered 2/2 lines per-line after a batch
`line_count_mismatch`, and then did nothing with the answer. `filled` only ever counted
lines the ensemble had left *empty*; a disputed line that already had text kept the
ensemble's wording, parked Shaheen's in `altTranslation`, and stayed flagged. A tiebreak
that cannot break a tie is just an extra API call.

`_shared/translationArbiter.ts` adds `arbitrateDispute()`: when Shaheen's rendering clearly
backs one of the disputed candidates — token overlap ≥ 0.45 and ≥ 0.1 clear of the
runner-up — that candidate wins, `needs_review` clears, and the line records
`resolved_by: "shaheen→<model>"`. Ambiguous lines stay flagged; this narrows the review
queue, it does not replace it. `engines_used.translation.shaheen` now reports `filled`,
`resolved` and `unresolved` separately, and the `needs_review` tally is recounted after
arbitration so the provenance and the queue cannot disagree.

### 3. Farasa diacritization — **key still needed, but the failure is now legible**

All four endpoints answered "invalid api key. please register at farasa.qcri.org", so 0/11
lines got Farasa tashkeel. **This needs `FARASA_API_KEY` set — no code change can fix it.**
Two real code problems were fixed alongside it:

- A 200 response whose body used a field name the caller didn't know about returned `null`
  *and stopped the cascade*, so the remaining endpoints were never tried. There were two
  divergent copies of the caller, and only one of them read `result`.
- Every failure collapsed to the same `null`. `_shared/farasa.ts` now classifies:
  `invalid_api_key`, `all_endpoints_failed`, `timeout`, `empty_input`.

`engines_used.diacritization` is new and records the reason plus a config hint; the admin
video form shows it. Previously the reason existed only in the edge-function logs, which is
where the last three audits had to go looking for it.

### 4. CAMeL dialect ID — **configuration only**

`no_api_key` is already reported correctly; the module needs `HUGGINGFACE_API_KEY`. Added a
`camel_config_hint` to the stored dialect signals and surfaced it in the admin form so the
distinction between "unconfigured" and "broken" is visible without reading logs.

### Not defects

Fanar's 11 low-severity dialect issues (MSA-leaning فضول/بخاخ/الأشياء/رش, Egyptian/Levantine
بنطلون, English سيفتي/spray) are the validator doing its job — advisory, nothing blocking.

---

## UPDATE — 2026-08-06 (second pass): what the previous round got wrong

A run on video `ef23e142…` showed the first round had fixed the Shaheen tiebreak (arbitration
settled a line at score 0.54) but **not** Munsit, and had surfaced rather than solved the
diacritization problem.

### Munsit — the container fix was necessary but not sufficient

Naming the upload after its real container moved the result from 0 chars to 7 chars / 2 words.
Better, still broken. Two things were wrong:

1. **The retry guard was `if (!text)`.** Seven characters is truthy, so the ADTS fallback added
   last round never ran on the very case it was written for.
2. **The demux was a fallback when it should have been the default.** `download-media` returns
   the source MP4 whole, video track included. Every other engine demuxes that happily; Munsit
   does not. Sending an audio endpoint a video container was the actual defect.

The AAC track is now demuxed up front and sent as an audio-only ADTS stream — one in-memory
pass, no re-encode. The original container is retried only if the audio-only attempt looks
truncated.

**"Looks truncated" is now a measurement, not a guess.** `looksTruncated()` compares transcript
length against known audio duration (from the AAC frame table) at a deliberately low 2 chars/sec
— real speech runs 8-15 — and returns false whenever duration is unknown or under 5s, so it only
fires on evidence. A short result is reported as `short-transcription (N chars for Ns)` in
`engines_used.asr`; the text is still kept, but it can no longer pass as a healthy engine.

### Farasa — the vendor was fine, the overlay was broken

The call succeeded and returned 246 chars of tashkeel. The overlay applied it to 0 of 11 lines.
Two bugs, and the second is why the number was exactly zero rather than merely low:

1. **Words were compared with exact string equality after stripping tashkeel only.** Farasa
   normalises orthography — hamza carriers (أ إ آ ٱ) collapse to bare alef, tatweel vanishes,
   punctuation splits off. A word Call 1 wrote as `أَنَا` and Farasa returned as `انَا` compared
   unequal and was skipped.
2. **A miss left the read cursor in place.** One unmatched word desynced the rest of the
   transcript permanently, so every later word missed too.

`_shared/arabicDiacritics.ts` replaces both copies with normalisation-tolerant matching and a
cursor that advances past a miss.

**Direction matters too.** Call 1 is required to emit lines "FULLY voweled with tashkeel that
matches HOW THE SPEAKER ACTUALLY PRONOUNCES IT … NOT the MSA standard". Farasa is an MSA
diacritizer, so it now *fills gaps* rather than overwriting: an unvoweled word takes its marks,
a word that already carries dialect tashkeel keeps them. Where spellings differ but letter
counts match, the marks are transplanted onto our letters so the dialect spelling survives.

Provenance gained `words_matched` / `words_filled` / `strategy`. Matched-but-not-filled means
Call 1 had already voweled everything; neither means the overlay failed to align, and that case
is now labelled `warning: farasa_output_did_not_align`.

### Shaheen — the batch call never worked and was pure cost

`POST /v1/translations` takes one blob and returns one translation; `preserve_whitespace` does
not make newlines act as record separators. Every run logged `line_count_mismatch (sent N, got
1)`, fell back to per-line, and succeeded there — paying one wasted call and one 30s round-trip
per video against a 20/day budget. Multi-line requests now go straight to per-line.
`_shared/shaheenAlign.ts` and its tests are deleted as unreachable.

### rate-video-cefr — booted and shut down with no output

Two causes, both addressed. It was dispatched fire-and-forget with a *second* `waitUntil`
registered from inside a task that was itself about to settle, which does not reliably extend
the isolate — "boots, no logs, dies" is what a mid-flight teardown looks like. And it was called
with `authHeader` (whatever the original caller sent, possibly an anon key) where the analyze
call deliberately uses the service-role key. It is now awaited inside the window already being
held open, with the service key and a 90s timeout.

### CAMeL — still configuration only

`no_api_key`, correctly reported. Needs `HUGGINGFACE_API_KEY`. Nothing to fix in code.

### Note on tooling

These edge functions are not covered by `tsconfig.app.json` and had never been typechecked.
Running `deno check` over them during this round is what caught a wrong `Supabase` client type,
an unguarded `analyzeData.result` dereference, and a `Uint8Array<ArrayBufferLike>` that is not a
valid `BlobPart`. Worth adding to CI.

---

## Sources

- [Fanar OpenAPI spec (live, public)](https://api.fanar.qa/openapi.json) — authoritative model list and request schema
- [QCRI/Fanar-2-27B-Instruct](https://huggingface.co/QCRI/Fanar-2-27B-Instruct)
- [QCRI/Fanar-1-9B-Instruct](https://huggingface.co/QCRI/Fanar-1-9B-Instruct)
- [Fanar 2.0: Arabic Generative AI Stack (arXiv:2603.16397)](https://arxiv.org/abs/2603.16397)
- [Fanar: An Arabic-Centric Multimodal Generative AI Platform (arXiv:2501.13944)](https://arxiv.org/abs/2501.13944)
- [ALLaM-2-7b-instruct — Azure AI model catalog](https://ai.azure.com/catalog/models/ALLaM-2-7b-instruct)
- [ALLaM-2-7b-Instruct — HuggingFace Model Hub](https://huggingface.co/meta-llama/Llama-2-7b-instruct)
- [Groq Platform — ALLaM availability verified removed, 2026-08-05]
