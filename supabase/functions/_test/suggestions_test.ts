import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `suggest-flashcards` and `request-situation-phrases` — the two functions that
 * hand a learner new material rather than explaining material they already had.
 *
 * Both generate against something the learner supplied (a topic, a situation)
 * and both post-process the result. The interesting part is `suggest-flashcards`
 * deduplicating *after* the model call as well as before: the prompt lists the
 * words already saved, and the response is then filtered against the same list
 * with Arabic spelling folded. Prompts are advice; the filter is the guarantee,
 * and a suggestion the learner already has is worse than one fewer suggestion.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

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

function promptOf(bodies: Array<string | null>, calls: string[]): string {
  const i = calls.findIndex((u) => u.includes("chat/completions"));
  return bodies[i] ?? "";
}

// ── suggest-flashcards ──────────────────────────────────────────────────────

const aCard = (word_arabic: string, word_english = "a word") => ({
  word_arabic,
  word_english,
});

Deno.test("suggest-flashcards carries a word family through to the client", async () => {
  const { status, body } = await call(
    "suggest-flashcards",
    { topic: "reading", dialect: "Gulf", count: 1 },
    caller({
      "ai.gateway.lovable.dev": emitting({
        flashcards: [{ ...aCard("مكتبة", "library"), word_family: "library" }],
      }),
    }),
  );

  assertEquals(status, 200);
  // The model call is happening anyway, so asking for the family costs a
  // handful of tokens and saves the card from the backfill entirely. The key
  // has to be the one `SuggestFlashcardsDialog` reads on the way to
  // `user_vocabulary.word_family` — under any other name it arrives, is
  // ignored, and the card is enqueued for a backfill it did not need.
  assertEquals(
    (body.flashcards as Array<Record<string, unknown>>)[0].word_family,
    "library",
  );
});

Deno.test("suggest-flashcards returns the cards it generated", async () => {
  const { status, body } = await call(
    "suggest-flashcards",
    { topic: "at the airport", dialect: "Gulf", count: 3 },
    caller({
      "ai.gateway.lovable.dev": emitting({
        flashcards: [aCard("مطار", "airport"), aCard("جواز", "passport")],
      }),
    }),
  );

  assertEquals(status, 200);
  assertEquals((body.flashcards as unknown[]).length, 2);
});

Deno.test("suggest-flashcards filters out words the learner already has", async () => {
  const { body } = await call(
    "suggest-flashcards",
    { topic: "at the airport", existingWords: ["مطار"] },
    caller({
      "ai.gateway.lovable.dev": emitting({
        flashcards: [aCard("مطار", "airport"), aCard("جواز", "passport")],
      }),
    }),
  );

  const cards = body.flashcards as Array<{ word_arabic: string }>;
  // The prompt already asks for this, and the model already ignores it
  // sometimes. Prompts are advice; the filter is the guarantee — and a
  // "suggestion" the learner saved last week is worse than one fewer card.
  assertEquals(cards.map((c) => c.word_arabic), ["جواز"]);
});

Deno.test("suggest-flashcards folds Arabic spelling before deduplicating", async () => {
  const { body } = await call(
    "suggest-flashcards",
    { topic: "school", existingWords: ["مدرسة"] },
    caller({
      // Same word, ta marbuta written as ha, plus diacritics.
      "ai.gateway.lovable.dev": emitting({
        flashcards: [aCard("مَدْرَسه", "school"), aCard("جامعة", "university")],
      }),
    }),
  );

  const cards = body.flashcards as Array<{ word_arabic: string }>;
  // Comparing raw strings lets the same word through under any of its
  // spellings, which is exactly how a duplicate reaches the deck.
  assertEquals(cards.map((c) => c.word_arabic), ["جامعة"]);
});

Deno.test("suggest-flashcards drops cards with no Arabic", async () => {
  const { body } = await call(
    "suggest-flashcards",
    { topic: "school" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        flashcards: [aCard("مطار"), { word_english: "orphan" }, {}],
      }),
    }),
  );

  assertEquals((body.flashcards as unknown[]).length, 1);
});

Deno.test("suggest-flashcards tells the model what is already saved", async () => {
  const { bodies, calls } = await call(
    "suggest-flashcards",
    { topic: "school", existingWords: ["مدرسة", "جامعة"] },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [aCard("قلم")] }) }),
  );

  const prompt = promptOf(bodies, calls);
  // Belt as well as braces: filtering afterwards means the learner gets fewer
  // cards, so the prompt is what keeps the count usable.
  assertStringIncludes(prompt, "DO NOT repeat any of these");
  assertStringIncludes(prompt, "مدرسة");
});

Deno.test("suggest-flashcards says so when nothing is saved yet", async () => {
  const { bodies, calls } = await call(
    "suggest-flashcards",
    { topic: "school" },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [aCard("قلم")] }) }),
  );

  // "(none)" rather than an empty line, so the model is not left guessing
  // whether the list was omitted or is genuinely empty.
  assertStringIncludes(promptOf(bodies, calls), "(none)");
});

Deno.test("suggest-flashcards caps how much of the deck it sends", async () => {
  const { bodies, calls } = await call(
    "suggest-flashcards",
    {
      topic: "school",
      existingWords: Array.from({ length: 2000 }, (_, i) => `كلمة${i}`),
    },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [aCard("قلم")] }) }),
  );

  const prompt = promptOf(bodies, calls);
  // 500. A learner with several thousand saved words would otherwise send the
  // whole deck as a prompt on every suggestion.
  assert(prompt.includes("كلمة499"));
  assert(!prompt.includes("كلمة500"));
});

Deno.test("suggest-flashcards still filters against the words it did not send", async () => {
  const { body } = await call(
    "suggest-flashcards",
    {
      topic: "school",
      existingWords: Array.from({ length: 2000 }, (_, i) => `كلمة${i}`),
    },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [aCard("كلمة3"), aCard("قلم")] }) }),
  );

  const cards = body.flashcards as Array<{ word_arabic: string }>;
  // Pinned as a real limit. The post-filter uses the *same truncated list* as
  // the prompt, so a duplicate of word 501 or later passes both checks and
  // reaches the deck. Only the first 500 are protected either way.
  assertEquals(cards.map((c) => c.word_arabic), ["قلم"]);
});

Deno.test("suggest-flashcards keeps the dialect out of MSA", async () => {
  const { bodies, calls } = await call(
    "suggest-flashcards",
    { topic: "school", dialect: "Egyptian" },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [aCard("قلم")] }) }),
  );

  const prompt = promptOf(bodies, calls);
  assertStringIncludes(prompt, "Egyptian");
  assertStringIncludes(prompt, "Never MSA");
});

Deno.test("suggest-flashcards refuses a request with no topic", async () => {
  const { status, body, calls } = await call(
    "suggest-flashcards",
    { dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting({ flashcards: [] }) }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "topic is required");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("suggest-flashcards preserves 429 and 402", async () => {
  for (const upstream of [429, 402]) {
    const { status } = await call(
      "suggest-flashcards",
      { topic: "school" },
      caller({ "ai.gateway.lovable.dev": () => json({ error: "no" }, upstream) }),
    );

    assertEquals(status, upstream);
  }
});

Deno.test("suggest-flashcards returns an empty list when the model skipped the tool", async () => {
  const { status, body } = await call(
    "suggest-flashcards",
    { topic: "school" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("Here are some words!") }),
  );

  // The page shows "no suggestions" rather than an error — this is an optional
  // helper on top of a deck the learner already has.
  assertEquals(status, 200);
  assertEquals(body.flashcards, []);
});

// ── request-situation-phrases ───────────────────────────────────────────────

const aPhrase = (over: Record<string, unknown> = {}) => ({
  phrase_arabic: "ممكن الحساب لو سمحت",
  phrase_english: "Could I have the bill please",
  literal: "possible the-bill if you-permit",
  transliteration: "mumkin il-hisaab law samaht",
  notes: "Said with a small hand gesture.",
  ...over,
});

Deno.test("request-situation-phrases returns phrases for the situation", async () => {
  const { status, body } = await call(
    "request-situation-phrases",
    { situation: "asking for the bill in a restaurant", dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
  );

  assertEquals(status, 200);
  const phrases = body.phrases as Array<Record<string, unknown>>;
  assertEquals(phrases.length, 1);
  assertEquals(phrases[0].phrase_arabic, "ممكن الحساب لو سمحت");
  // Echoed back so the caller can label the result without keeping its own
  // copy of what it asked for.
  assertEquals(body.dialect, "Gulf");
  assertEquals(body.situation, "asking for the bill in a restaurant");
});

Deno.test("request-situation-phrases clamps how many it will generate", async () => {
  for (const [count, expected] of [[1, 3], [6, 6], [50, 10], ["abc", 6]] as const) {
    const { bodies, calls } = await call(
      "request-situation-phrases",
      { situation: "at a café", count },
      caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
    );

    // Between 3 and 10, with a non-number falling to the default rather than
    // interpolating NaN into the prompt.
    assertStringIncludes(promptOf(bodies, calls), `Generate ${expected} phrases`);
  }
});

Deno.test("request-situation-phrases drops phrases missing either half", async () => {
  const { body } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        phrases: [
          aPhrase(),
          aPhrase({ phrase_arabic: "" }),
          aPhrase({ phrase_english: "   " }),
        ],
      }),
    }),
  );

  // A phrase card shows both languages. One without the Arabic is not a
  // phrase; one without the English cannot be learned from.
  assertEquals((body.phrases as unknown[]).length, 1);
});

Deno.test("request-situation-phrases defaults the optional fields to empty strings", async () => {
  const { body } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        phrases: [{ phrase_arabic: "شكراً", phrase_english: "thank you" }],
      }),
    }),
  );

  const phrases = body.phrases as Array<Record<string, unknown>>;
  // `String(undefined)` is "undefined", which would be printed under the
  // phrase as its transliteration.
  assertEquals(phrases[0].transliteration, "");
  assertEquals(phrases[0].literal, "");
  assertEquals(phrases[0].notes, "");
});

Deno.test("request-situation-phrases asks for a note only when it matters", async () => {
  const { bodies, calls } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
  );

  // A usage note on every phrase trains the learner to skip all of them —
  // and the notes that do appear arrive in the learner's dialect.
  assertStringIncludes(promptOf(bodies, calls), "ONLY if register/context matters");
});

Deno.test("request-situation-phrases asks for real phrases in dialect", async () => {
  const { bodies, calls } = await call(
    "request-situation-phrases",
    { situation: "at a café", dialect: "Yemeni" },
    caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
  );

  const prompt = promptOf(bodies, calls);
  // The whole value of this feature is that the phrases are what someone would
  // actually say; an invented-but-grammatical phrase is worse than nothing
  // because the learner will use it.
  assertStringIncludes(prompt, "NEVER invent unnatural phrases");
  // Flipped: the phrases are English; the Yemeni is the gloss language.
  assertStringIncludes(prompt, "ENGLISH phrases");
  assertStringIncludes(prompt, "authentic Yemeni Arabic only");
});

Deno.test("request-situation-phrases refuses a request with no situation", async () => {
  const { status, body, calls } = await call(
    "request-situation-phrases",
    { dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
  );

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "situation required");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("request-situation-phrases turns an anonymous caller away", async () => {
  const { status, body, calls } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({
      "/auth/v1/user": () => json({ message: "no session" }, 401),
      "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }),
    }),
  );

  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("request-situation-phrases names a missing key as a config problem", async () => {
  const { status, body } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({ "ai.gateway.lovable.dev": emitting({ phrases: [aPhrase()] }) }),
    { env: { LOVABLE_API_KEY: undefined } },
  );

  // A machine-readable code rather than prose, because the page distinguishes
  // "we are broken" from "you are out of credit".
  assertEquals(status, 500);
  assertEquals(body.error, "config_missing");
});

Deno.test("request-situation-phrases preserves 429 and 402 with their codes", async () => {
  for (
    const [upstream, code] of [
      [429, "rate_limit"],
      [402, "credits_exhausted"],
    ] as const
  ) {
    const { status, body } = await call(
      "request-situation-phrases",
      { situation: "at a café" },
      caller({ "ai.gateway.lovable.dev": () => json({ error: "no" }, upstream) }),
    );

    assertEquals(status, upstream);
    assertEquals(body.error, code);
    assert(body.message);
  }
});

Deno.test("request-situation-phrases fails when the model skipped the tool", async () => {
  const { status } = await call(
    "request-situation-phrases",
    { situation: "at a café" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("Here are some phrases!") }),
  );

  // Unlike `suggest-flashcards`, this one has nothing to fall back on: the
  // learner asked a question and an empty list would read as "there is nothing
  // to say in that situation".
  assertEquals(status, 500);
});
