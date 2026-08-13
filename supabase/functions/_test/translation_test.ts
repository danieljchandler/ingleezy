import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The three translation functions, which look alike and are not.
 *
 * `how-do-i-say` goes Arabic→English through the Brain's *council* strategy —
 * several drafters plus a judge — and post-processes the result heavily: it
 * filters incomplete translations, clamps naturalness, and forces exactly one
 * preferred entry. That normalisation is the part the page depends on and the
 * part a model can break by returning two preferred entries or none.
 *
 * `translate-text` goes Arabic→English per sentence, and its contract is that
 * the Arabic comes back *verbatim* — it is a reading aid, so a model that
 * "helpfully" rewrote the learner's passage into MSA would be showing them
 * something they never read.
 *
 * `translate-phrase` uses neither Brain strategy. It fires four model calls in
 * parallel by hand and prefers Claude's translation over Gemini's, which makes
 * partial failure its normal operating mode rather than an error.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

/** Every gateway route answers the same tool call. */
const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction(name, { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(name, body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

// ── how-do-i-say ────────────────────────────────────────────────────────────

const aTranslation = (over: Record<string, unknown> = {}) => ({
  english: "How's it going?",
  arabic: "شلونك",
  phonetic_ar: "هاوز إت قوينق",
  context: "casual greeting",
  naturalness: 4,
  isPreferred: false,
  ...over,
});

Deno.test("how-do-i-say wraps its result in a success envelope", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "how are you", dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        inputMode: "translation",
        detectedContext: "greeting",
        translations: [aTranslation({ isPreferred: true })],
      }),
    }),
  );

  assertEquals(status, 200);
  // The page checks `data?.success` before reading `result`, so the envelope is
  // load-bearing rather than decorative.
  assertEquals(body.success, true);
  const result = body.result as Record<string, unknown>;
  assertEquals(result.phrase, "how are you");
  assertEquals(result.inputMode, "translation");
});

Deno.test("how-do-i-say drops translations missing either language", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "شلون أقول شلونك" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [
          aTranslation({ isPreferred: true }),
          { english: "How are you?" },
          { arabic: "كيفك", phonetic_ar: "هاو آر يو" },
        ],
      }),
    }),
  );

  const result = body.result as { translations: unknown[] };
  // Both halves are required: the page renders the English with its dialect
  // gloss together, and a row with one missing renders as a blank.
  assertEquals(result.translations.length, 1);
});

Deno.test("how-do-i-say promotes the most natural option when none is preferred", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [
          aTranslation({ arabic: "كيفك", naturalness: 3 }),
          aTranslation({ arabic: "شلونك", naturalness: 5 }),
        ],
      }),
    }),
  );

  const result = body.result as { translations: Array<Record<string, unknown>> };
  // The page leads with the preferred entry. With none marked it would lead
  // with whatever the model happened to emit first.
  assertEquals(result.translations[0].arabic, "شلونك");
  assertEquals(result.translations[0].isPreferred, true);
});

Deno.test("how-do-i-say keeps only the first of several preferred options", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [
          aTranslation({ arabic: "شلونك", isPreferred: true }),
          aTranslation({ arabic: "كيفك", isPreferred: true }),
        ],
      }),
    }),
  );

  const result = body.result as { translations: Array<{ isPreferred: boolean }> };
  // "Preferred" means one. Two of them is a model slip, and rendering both as
  // the recommendation tells the learner nothing.
  assertEquals(result.translations.filter((t) => t.isPreferred).length, 1);
});

Deno.test("how-do-i-say sorts the rest by naturalness", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [
          aTranslation({ arabic: "أ", naturalness: 2 }),
          aTranslation({ arabic: "ب", naturalness: 5, isPreferred: true }),
          aTranslation({ arabic: "ج", naturalness: 4 }),
        ],
      }),
    }),
  );

  const result = body.result as { translations: Array<{ arabic: string }> };
  assertEquals(result.translations.map((t) => t.arabic), ["ب", "ج", "أ"]);
});

Deno.test("how-do-i-say clamps naturalness into its range", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [
          aTranslation({ arabic: "أ", naturalness: 99, isPreferred: true }),
          aTranslation({ arabic: "ب", naturalness: -4 }),
          aTranslation({ arabic: "ج", naturalness: "high" }),
        ],
      }),
    }),
  );

  const result = body.result as { translations: Array<{ arabic: string; naturalness: number }> };
  const by = Object.fromEntries(result.translations.map((t) => [t.arabic, t.naturalness]));
  // The page renders this as a 1–5 dot scale, so an out-of-range value draws
  // outside the widget or vanishes.
  assertEquals(by["أ"], 5);
  assertEquals(by["ب"], 1);
  // A non-number falls to the midpoint rather than NaN.
  assertEquals(by["ج"], 3);
});

Deno.test("how-do-i-say falls back to translation for an unknown input mode", async () => {
  const { body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        inputMode: "interpretive-dance",
        translations: [aTranslation({ isPreferred: true })],
      }),
    }),
  );

  const result = body.result as { inputMode: string };
  // The page switches its whole layout on this value; an unrecognised one would
  // render none of the three branches.
  assertEquals(result.inputMode, "translation");
});

Deno.test("how-do-i-say fails when the model produced nothing usable", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "how are you" },
    caller({ "ai.gateway.lovable.dev": emitting({ translations: [] }) }),
  );

  assertEquals(status, 500);
  // Named, because "try rephrasing" is actionable where an empty result list
  // looks like the feature is broken.
  assertStringIncludes(String(body.error), "could not produce translations");
});

Deno.test("how-do-i-say refuses an empty phrase", async () => {
  for (const phrase of ["", "   ", null, 42]) {
    const { status, calls } = await call(
      "how-do-i-say",
      { phrase },
      caller({ "ai.gateway.lovable.dev": emitting({ translations: [] }) }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(phrase)} to be refused`);
    assert(!calls.some((url) => url.includes("ai.gateway")));
  }
});

Deno.test("how-do-i-say caps the phrase length it forwards", async () => {
  const { bodies, calls } = await call(
    "how-do-i-say",
    { phrase: "a".repeat(5000) },
    caller({
      "ai.gateway.lovable.dev": emitting({ translations: [aTranslation({ isPreferred: true })] }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ content: string }> };
  // 2,000 characters. A pasted conversation is a legitimate input here, so the
  // cap is what stops one becoming an unbounded prompt across several drafters.
  assertEquals(sent.messages.at(-1)?.content.length, 2000);
});

Deno.test("how-do-i-say narrows the dialect to the three the app supports", async () => {
  for (const [requested, expected] of [
    ["Egyptian", "Egyptian"],
    ["Yemeni", "Yemeni"],
    ["Gulf", "Gulf"],
    ["Kuwaiti", "Gulf"],
    [undefined, "Gulf"],
  ] as const) {
    const { bodies, calls } = await call(
      "how-do-i-say",
      { phrase: "hello", dialect: requested },
      caller({
        "ai.gateway.lovable.dev": emitting({ translations: [aTranslation({ isPreferred: true })] }),
      }),
    );

    const i = calls.findIndex((u) => u.includes("ai.gateway"));
    // Settings offers six Gulf countries as if they were separate modules; only
    // three reach the prompt, and everything else folds to Gulf.
    assertStringIncludes(bodies[i] ?? "", expected, `expected ${requested} → ${expected}`);
  }
});

Deno.test("how-do-i-say still answers when the usage log write fails", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "hello" },
    caller({
      "ai.gateway.lovable.dev": emitting({ translations: [aTranslation({ isPreferred: true })] }),
      "/rest/v1/llm_usage_logs": () => json({ message: "denied" }, 403),
    }),
  );

  // Best-effort bookkeeping. A learner's translation must not be lost because
  // an analytics insert was refused.
  assertEquals(status, 200);
  assertEquals(body.success, true);
});

Deno.test("how-do-i-say reports exhausted credits as 402", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "hello" },
    // Both gateways, because the council splits its drafters across them:
    // models prefixed `anthropic/`, `qwen/`, `deepseek/` and friends route to
    // OpenRouter and the rest to the Lovable gateway. Stubbing one leaves the
    // other answering normally, and a council that got *an* answer does not
    // raise the credit error at all.
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402),
      "openrouter.ai": () => json({ error: "no credits" }, 402),
    }),
  );

  assertEquals(status, 402);
  assertStringIncludes(String(body.error), "Not enough AI credits");
});

Deno.test("how-do-i-say survives one gateway being down", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "hello" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        translations: [aTranslation({ isPreferred: true })],
      }),
      "openrouter.ai": () => json({ error: "down" }, 500),
    }),
  );

  // The council is the redundancy: several drafters, and losing a whole
  // provider degrades quality rather than failing the request.
  assertEquals(status, 200);
  assertEquals(body.success, true);
});

Deno.test("how-do-i-say turns an anonymous caller away", async () => {
  const { status } = await call(
    "how-do-i-say",
    { phrase: "hello" },
    caller({
      "ai.gateway.lovable.dev": emitting({ translations: [aTranslation({ isPreferred: true })] }),
    }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── translate-text ──────────────────────────────────────────────────────────

const aSentence = (over: Record<string, unknown> = {}) => ({
  arabic: "الجو حلو اليوم",
  literal: "the-weather nice today",
  natural: "The weather is nice today",
  ...over,
});

Deno.test("translate-text returns a sentence breakdown with the detected dialect", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "الجو حلو اليوم", dialect: "auto" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Egyptian",
        sentences: [aSentence()],
      }),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.detected_dialect, "Egyptian");
  // The requested dialect is echoed back separately, so the page can show
  // "you asked for auto, we detected Egyptian" rather than one or the other.
  assertEquals(body.used_dialect, "auto");
  assertEquals((body.sentences as unknown[]).length, 1);
});

Deno.test("translate-text keeps both the literal and the natural reading", async () => {
  const { body } = await call(
    "translate-text",
    { text: "الجو حلو اليوم" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Gulf",
        sentences: [aSentence()],
      }),
    }),
  );

  const sentences = body.sentences as Array<Record<string, unknown>>;
  // The two together are the teaching: the natural one says what it means, the
  // literal one shows how the Arabic is built.
  assertEquals(sentences[0].literal, "the-weather nice today");
  assertEquals(sentences[0].natural, "The weather is nice today");
});

Deno.test("translate-text omits the note when there is nothing to say", async () => {
  const { body } = await call(
    "translate-text",
    { text: "الجو حلو" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Gulf",
        sentences: [aSentence(), aSentence({ arabic: "وبعدين", note: "   " })],
      }),
    }),
  );

  const sentences = body.sentences as Array<Record<string, unknown>>;
  // A note is for idioms and register shifts. An empty one renders an empty
  // callout on every line, which trains the learner to ignore all of them.
  assert(!("note" in sentences[0]));
  assert(!("note" in sentences[1]));
});

Deno.test("translate-text drops sentences with no Arabic", async () => {
  const { body } = await call(
    "translate-text",
    { text: "الجو حلو" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Gulf",
        sentences: [aSentence(), { natural: "invented" }, { arabic: "   " }],
      }),
    }),
  );

  // The Arabic is the anchor — the page renders the translation *under* it, so
  // a sentence without one has nothing to attach to.
  assertEquals((body.sentences as unknown[]).length, 1);
});

Deno.test("translate-text falls back to the requested dialect when detection is nonsense", async () => {
  const { body } = await call(
    "translate-text",
    { text: "الجو حلو", dialect: "Yemeni" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Levantine",
        sentences: [aSentence()],
      }),
    }),
  );

  // Levantine is not a module this app has, and the value is rendered as a
  // badge and saved with the translation.
  assertEquals(body.detected_dialect, "Yemeni");
});

Deno.test("translate-text defaults an auto request's prompt to Gulf", async () => {
  const { bodies, calls } = await call(
    "translate-text",
    { text: "الجو حلو", dialect: "auto" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        detected_dialect: "Gulf",
        sentences: [aSentence()],
      }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ content: string }> };
  // "auto" still needs a dialect for the rulebook prompt; the model reports
  // what it actually detected in the output rather than in the prompt.
  assertStringIncludes(sent.messages.at(-1)?.content ?? "", "Detect the dialect");
});

Deno.test("translate-text refuses empty input", async () => {
  const { status, body, calls } = await call(
    "translate-text",
    { text: "   " },
    caller({ "ai.gateway.lovable.dev": emitting({ sentences: [] }) }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "missing_text");
  assert(!calls.some((url) => url.includes("ai.gateway")));
});

Deno.test("translate-text refuses a passage that is too long", async () => {
  const { status, body, calls } = await call(
    "translate-text",
    { text: "ا".repeat(100_000) },
    caller({ "ai.gateway.lovable.dev": emitting({ sentences: [] }) }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "text_too_long");
  // The limit is reported so the page can say how much to cut rather than just
  // refusing.
  assert(typeof body.limit === "number");
  assert(!calls.some((url) => url.includes("ai.gateway")));
});

Deno.test("translate-text reports an empty translation as 502", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "الجو حلو" },
    caller({
      "ai.gateway.lovable.dev": emitting({ detected_dialect: "Gulf", sentences: [] }),
    }),
  );

  // Distinguished from a 200 with an empty list, which the page would render as
  // a blank result and the learner would read as "this text means nothing".
  assertEquals(status, 502);
  assertEquals(body.error, "empty_translation");
});

Deno.test("translate-text reports a gateway failure as ai_failed", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "الجو حلو" },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "boom" }, 429) }),
  );

  assertEquals(status, 429);
  assertEquals(body.error, "ai_failed");
});

Deno.test("translate-text turns an anonymous caller away", async () => {
  const { status } = await call(
    "translate-text",
    { text: "الجو حلو" },
    caller({
      "ai.gateway.lovable.dev": emitting({ detected_dialect: "Gulf", sentences: [aSentence()] }),
    }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── translate-phrase ────────────────────────────────────────────────────────

Deno.test("translate-phrase returns the translation, the MSA form and the gloss", async () => {
  const { status, body } = await call(
    "translate-phrase",
    { phrase: "شخبارك اليوم", dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("gemini answer"),
      "openrouter.ai": () => chatCompletion("claude answer"),
    }),
  );

  assertEquals(status, 200);
  // Claude wins when both drafters answer.
  assertEquals(body.translation, "claude answer");
  assertEquals(body.msa, "gemini answer");
  assertEquals(body.literal, "gemini answer");
});

Deno.test("translate-phrase asks for no gloss on a single word", async () => {
  const { body, calls } = await call(
    "translate-phrase",
    { phrase: "شخبارك" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("news"),
      "openrouter.ai": () => chatCompletion("news"),
    }),
  );

  assertEquals(body.literal, "");
  // Three calls, not four. A word-for-word gloss of one word is the
  // translation again, so it is a model call bought for nothing.
  assertEquals(calls.filter((u) => u.includes("chat/completions")).length, 3);
});

Deno.test("translate-phrase falls back to Gemini when Claude is unavailable", async () => {
  const { status, body } = await call(
    "translate-phrase",
    { phrase: "شخبارك" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("gemini answer"),
      "openrouter.ai": () => json({ error: "down" }, 500),
    }),
  );

  // Partial failure is this function's normal mode: four calls in parallel and
  // each one may come back null.
  assertEquals(status, 200);
  assertEquals(body.translation, "gemini answer");
});

Deno.test("translate-phrase reports both drafters failing rather than an empty answer", async () => {
  const { status, body } = await call(
    "translate-phrase",
    { phrase: "شخبارك" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "down" }, 500),
      "openrouter.ai": () => json({ error: "down" }, 500),
    }),
  );

  // An empty translation on a 200 looks to a learner like the word has no
  // meaning, which is worse than an error they can retry.
  assertEquals(status, 502);
  assertEquals(body.error, "translation_unavailable");
});

Deno.test("translate-phrase gives an empty MSA rather than failing", async () => {
  const { status, body } = await call(
    "translate-phrase",
    { phrase: "شخبارك" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "down" }, 500),
      "openrouter.ai": () => chatCompletion("your news"),
    }),
  );

  // The MSA form and the gloss are extras. Losing them is a degraded popover,
  // not a failed lookup.
  assertEquals(status, 200);
  assertEquals(body.translation, "your news");
  assertEquals(body.msa, "");
});

Deno.test("translate-phrase disambiguates using the sentence it came from", async () => {
  const { bodies, calls } = await call(
    "translate-phrase",
    {
      phrase: "عين",
      sentenceArabic: "غسل عينه بالماء",
      sentenceEnglish: "He washed his eye with water",
    },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("eye"),
      "openrouter.ai": () => chatCompletion("eye"),
    }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  const sent = bodies[i] ?? "";
  // عين is eye, spring, spy and several other things. Without the sentence the
  // model returns the dictionary's first sense, which is routinely the wrong
  // one for the line the learner is reading.
  assertStringIncludes(sent, "غسل عينه بالماء");
  assertStringIncludes(sent, "He washed his eye with water");
});

Deno.test("translate-phrase answers a phrase that cleans to nothing without calling a model", async () => {
  const { status, body, calls } = await call(
    "translate-phrase",
    { phrase: "،؟!" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("x"),
      "openrouter.ai": () => chatCompletion("x"),
    }),
  );

  // Punctuation-only input comes from tapping a stray character in a
  // transcript. A null translation on a 200 is the "nothing to look up"
  // answer, and it costs nothing.
  assertEquals(status, 200);
  assertEquals(body.translation, null);
  assert(!calls.some((url) => url.includes("chat/completions")));
});

Deno.test("translate-phrase refuses a request with no phrase", async () => {
  const { status, body } = await call(
    "translate-phrase",
    {},
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("x"),
      "openrouter.ai": () => chatCompletion("x"),
    }),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "Missing phrase");
});

// ── CORS ────────────────────────────────────────────────────────────────────

for (const name of ["how-do-i-say", "translate-text", "translate-phrase"]) {
  Deno.test(`${name} answers a preflight`, async () => {
    const fn = await loadFunction(name, { upstreams: caller() });
    try {
      const response = await fn.handler(optionsRequest(name));

      assertEquals(response.status, 200);
      assert(response.headers.get("access-control-allow-origin"));
      assertEquals(fn.calls.length, 0);
    } finally {
      fn.restore();
    }
  });
}
