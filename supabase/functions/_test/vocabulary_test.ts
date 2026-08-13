import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The functions behind a saved word.
 *
 * `word-enrichment` and `generate-sample-sentences` both run the Brain's
 * *ensemble* strategy and both branch on something the caller does not send
 * explicitly — enrichment on whether the input is one word or several, sample
 * sentences on what the learner already knows. Those branches change the tool
 * schema itself, not just the prompt, so they are the interesting surface.
 *
 * `persist-word-audio` is the odd one: it writes to shared curriculum rows with
 * the service role, so its guards are about not corrupting other people's data
 * rather than about the caller's own. It synthesises server-side rather than
 * accepting an upload for the same reason.
 *
 * `generate-mnemonic` is the plainest — one model call, no Brain — and is the
 * only one of the four with no daily cap at all.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const WORD_ID = "11111111-0000-4000-8000-000000000000";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/vocabulary_words": () => json([]),
    "/rest/v1/profiles": () => json(null),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/feature_metrics": () => json({}, 201),
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
      headers: fn.calls.map((c) => c.headers),
    };
  } finally {
    fn.restore();
  }
}

// ── word-enrichment ─────────────────────────────────────────────────────────

Deno.test("word-enrichment returns one word's detail, not a list", async () => {
  const { status, body } = await call(
    "word-enrichment",
    { word: "كتاب", dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "book",
        root: "ك-ت-ب",
        transliteration: "kitaab",
        uses: [{ arabic: "مكتبة", english: "library" }],
      }),
    }),
  );

  assertEquals(status, 200);
  // Flat fields at the top level — the word popover reads each one directly.
  assertEquals(body.definition, "book");
  assertEquals(body.root, "ك-ت-ب");
  assertEquals(body.transliteration, "kitaab");
  assertEquals((body.uses as unknown[]).length, 1);
});

Deno.test("word-enrichment asks for a literal gloss only for a phrase", async () => {
  const phrase = await call(
    "word-enrichment",
    { word: "شخبارك اليوم" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "how are you today",
        literal: "what news-your today",
        root: "خ-ب-ر",
        transliteration: "shakhbarak alyoum",
        uses: [],
      }),
    }),
  );
  const single = await call(
    "word-enrichment",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "book",
        root: "ك-ت-ب",
        transliteration: "kitaab",
        uses: [],
      }),
    }),
  );

  // The branch changes the *tool schema*, not just the prompt: `literal` is
  // added to the required properties for a phrase and omitted for a word. A
  // word-for-word gloss of one word is the definition again.
  assertEquals(phrase.body.literal, "what news-your today");
  assertEquals(single.body.literal, null);
  const i = single.calls.findIndex((u) => u.includes("ai.gateway"));
  assert(!(single.bodies[i] ?? "").includes("preserving Arabic word order"));
});

Deno.test("word-enrichment treats a whitespace-separated input as a phrase", async () => {
  const { bodies, calls } = await call(
    "word-enrichment",
    { word: "بيت كبير" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "a big house",
        literal: "house big",
        root: "ب-ي-ت",
        transliteration: "bayt kabeer",
        uses: [],
      }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // Detected from the input rather than requiring the caller to say so — most
  // callers tap a word and never set the flag.
  assertStringIncludes(bodies[i] ?? "", "PHRASE");
});

Deno.test("word-enrichment honours an explicit phrase flag for a single token", async () => {
  const { bodies, calls } = await call(
    "word-enrichment",
    { word: "شخبارك", isPhrase: true },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "how are you",
        literal: "what news-your",
        root: "خ-ب-ر",
        transliteration: "shakhbarak",
        uses: [],
      }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // Arabic writes some multi-word expressions as one token, so the caller can
  // override the whitespace heuristic.
  assertStringIncludes(bodies[i] ?? "", "PHRASE");
});

Deno.test("word-enrichment disambiguates using the sentence it came from", async () => {
  const { bodies, calls } = await call(
    "word-enrichment",
    {
      word: "عين",
      sentenceArabic: "شرب من العين",
      sentenceEnglish: "He drank from the spring",
    },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "spring, water source",
        root: "ع-ي-ن",
        transliteration: "'ayn",
        uses: [],
      }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  // Without the sentence the model returns the dictionary's first sense, which
  // for عين is "eye" — and the learner is reading about a spring.
  assertStringIncludes(sent, "شرب من العين");
  assertStringIncludes(sent, "He drank from the spring");
  assertStringIncludes(sent, "not the most common dictionary meaning");
});

Deno.test("word-enrichment caps the related expressions it returns", async () => {
  const { body } = await call(
    "word-enrichment",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "book",
        root: "ك-ت-ب",
        transliteration: "kitaab",
        uses: Array.from({ length: 12 }, (_, i) => ({ arabic: `و${i}`, english: `use ${i}` })),
      }),
    }),
  );

  assertEquals((body.uses as unknown[]).length, 5);
});

Deno.test("word-enrichment normalises empty strings to null", async () => {
  const { body } = await call(
    "word-enrichment",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "book",
        root: "",
        transliteration: "",
        uses: [],
      }),
    }),
  );

  // The popover renders a row per non-null field. An empty string is truthy
  // enough to draw a labelled row with nothing in it.
  assertEquals(body.root, null);
  assertEquals(body.transliteration, null);
});

Deno.test("word-enrichment caps the word length it forwards", async () => {
  const { bodies, calls } = await call(
    "word-enrichment",
    { word: "ا".repeat(1000) },
    caller({
      "ai.gateway.lovable.dev": emitting({
        definition: "x",
        literal: "x",
        root: "",
        transliteration: "",
        uses: [],
      }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ content: string }> };
  // A tap on a transcript can select a very long run; 200 characters is the
  // ceiling on what becomes a prompt.
  assert((sent.messages.at(-1)?.content.length ?? 0) < 300);
});

Deno.test("word-enrichment refuses a request with no word", async () => {
  for (const word of [undefined, "", 42]) {
    const { status, calls } = await call(
      "word-enrichment",
      { word },
      caller({ "ai.gateway.lovable.dev": emitting({}) }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(word)} to be refused`);
    assert(!calls.some((url) => url.includes("ai.gateway")));
  }
});

Deno.test("word-enrichment degrades to an empty shape on failure", async () => {
  const { status, body } = await call(
    "word-enrichment",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 500),
      "openrouter.ai": () => json({ error: "boom" }, 500),
    }),
  );

  // 500, but with the shape the caller expects rather than an error object.
  // `TappableArabicText` reads the fields optionally, so a lookup that fails
  // shows an empty popover instead of throwing inside a render.
  assertEquals(status, 500);
  assertEquals(body.root, null);
  assertEquals(body.uses, []);
});

Deno.test("word-enrichment turns an anonymous caller away", async () => {
  const { status } = await call(
    "word-enrichment",
    { word: "كتاب" },
    caller({ "ai.gateway.lovable.dev": emitting({}) }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── generate-sample-sentences ───────────────────────────────────────────────

const threeSentences = {
  sentences: [
    { arabic: "قريت الكتاب", english: "I read the book", literal: "read-I the-book" },
    { arabic: "وين الكتاب؟", english: "Where is the book?", literal: "where the-book" },
    { arabic: "الكتاب زين", english: "The book is good", literal: "the-book good" },
  ],
};

Deno.test("generate-sample-sentences returns the sentences with both glosses", async () => {
  const { status, body } = await call(
    "generate-sample-sentences",
    { word: "كتاب", dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting(threeSentences) }),
  );

  assertEquals(status, 200);
  const sentences = body.sentences as Array<Record<string, unknown>>;
  assertEquals(sentences.length, 3);
  // Natural and literal together: one says what it means, the other shows how
  // the Arabic is assembled.
  assertEquals(sentences[0].english, "I read the book");
  assertEquals(sentences[0].literal, "read-I the-book");
});

Deno.test("generate-sample-sentences pins the sense when one is supplied", async () => {
  const { bodies, calls } = await call(
    "generate-sample-sentences",
    { word: "عين", definition: "spring, water source" },
    caller({ "ai.gateway.lovable.dev": emitting(threeSentences) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // The word was saved with a particular meaning. Examples in another sense
  // teach the wrong thing about a word the learner already recorded.
  assertStringIncludes(bodies[i] ?? "", "spring, water source");
});

Deno.test("generate-sample-sentences keeps the surrounding words inside the learner's lexicon", async () => {
  const { bodies, calls } = await call(
    "generate-sample-sentences",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": emitting(threeSentences),
      "/rest/v1/user_vocabulary": () =>
        json([
          { word_arabic: "بيت", word_english: "house" },
          { word_arabic: "ولد", word_english: "boy" },
        ]),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // The target word is meant to be the one new thing in the sentence. An
  // example built from words the learner cannot read teaches nothing.
  assertStringIncludes(bodies[i] ?? "", "بيت");
});

Deno.test("generate-sample-sentences caps how many it returns", async () => {
  const { body } = await call(
    "generate-sample-sentences",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        sentences: Array.from({ length: 9 }, (_, i) => ({
          arabic: `جملة${i}`,
          english: `sentence ${i}`,
          literal: `sentence ${i}`,
        })),
      }),
    }),
  );

  assertEquals((body.sentences as unknown[]).length, 5);
});

Deno.test("generate-sample-sentences refuses a request with no word", async () => {
  const { status, calls } = await call(
    "generate-sample-sentences",
    {},
    caller({ "ai.gateway.lovable.dev": emitting(threeSentences) }),
  );

  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("ai.gateway")));
});

Deno.test("generate-sample-sentences degrades to an empty list on failure", async () => {
  const { status, body } = await call(
    "generate-sample-sentences",
    { word: "كتاب" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 500),
      "openrouter.ai": () => json({ error: "boom" }, 500),
    }),
  );

  assertEquals(status, 500);
  assertEquals(body.sentences, []);
});

Deno.test("generate-sample-sentences turns an anonymous caller away", async () => {
  const { status } = await call(
    "generate-sample-sentences",
    { word: "كتاب" },
    caller({ "ai.gateway.lovable.dev": emitting(threeSentences) }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── generate-mnemonic ───────────────────────────────────────────────────────

Deno.test("generate-mnemonic returns the model's text and nothing else", async () => {
  const { status, body } = await call(
    "generate-mnemonic",
    { arabic: "كتاب", english: "book", transliteration: "kitaab" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("  A kitten reading a book.  "),
    }),
  );

  assertEquals(status, 200);
  // Trimmed. The prompt forbids labels and prefixes, so leading whitespace is
  // the one bit of tidying left to do.
  assertEquals(body.mnemonic, "A kitten reading a book.");
});

Deno.test("generate-mnemonic anchors on the pronunciation when it has one", async () => {
  const { bodies, calls } = await call(
    "generate-mnemonic",
    { arabic: "كتاب", english: "book", transliteration: "kitaab" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("mnemonic") }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // The technique is sound-alike, so the transliteration is the useful input —
  // the Arabic script tells an English speaker nothing about how it sounds.
  assertStringIncludes(bodies[i] ?? "", "kitaab");
  assertStringIncludes(bodies[i] ?? "", "Anchor on the SOUND");
});

Deno.test("generate-mnemonic omits the pronunciation line when there is none", async () => {
  const { bodies, calls } = await call(
    "generate-mnemonic",
    { arabic: "كتاب", english: "book" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("mnemonic") }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assert(!(bodies[i] ?? "").includes("Pronounced roughly"));
});

Deno.test("generate-mnemonic says whether it is a word or a phrase", async () => {
  const { bodies, calls } = await call(
    "generate-mnemonic",
    { arabic: "شخبارك", english: "how are you", kind: "phrase" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("mnemonic") }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assertStringIncludes(bodies[i] ?? "", "Arabic phrase:");
});

Deno.test("generate-mnemonic refuses a request missing either half", async () => {
  for (const body of [{ english: "book" }, { arabic: "كتاب" }, {}]) {
    const { status, calls } = await call(
      "generate-mnemonic",
      body,
      caller({ "ai.gateway.lovable.dev": () => chatCompletion("mnemonic") }),
    );

    // A mnemonic links a sound to a meaning; without both there is nothing to
    // link.
    assertEquals(status, 400);
    assert(!calls.some((url) => url.includes("ai.gateway")));
  }
});

Deno.test("generate-mnemonic rejects an empty answer rather than saving it", async () => {
  const { status, body } = await call(
    "generate-mnemonic",
    { arabic: "كتاب", english: "book" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("   ") }),
  );

  // The caller writes whatever comes back onto the word. A blank mnemonic
  // stored against a word looks to the learner like the feature ran and had
  // nothing to say.
  assertEquals(status, 500);
  assertEquals(body.error, "Empty mnemonic");
});

Deno.test("generate-mnemonic preserves 429 and 402 from the gateway", async () => {
  for (const upstreamStatus of [429, 402]) {
    const { status } = await call(
      "generate-mnemonic",
      { arabic: "كتاب", english: "book" },
      caller({ "ai.gateway.lovable.dev": () => json({ error: "no" }, upstreamStatus) }),
    );

    assertEquals(status, upstreamStatus);
  }
});

Deno.test("generate-mnemonic needs no sign-in", async () => {
  const { status } = await call(
    "generate-mnemonic",
    { arabic: "كتاب", english: "book" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("mnemonic") }),
    { jwt: null },
  );

  // Pinned as-is. Alone among the four functions here it calls no
  // `enforceDailyCap`, so with `verify_jwt` off there is nothing between an
  // anonymous caller and a model call on the app's credits. Its neighbours all
  // gate: word-enrichment at 60/day, sample sentences at 30, word audio at 200.
  assertEquals(status, 200);
});

// ── persist-word-audio ──────────────────────────────────────────────────────

/** Storage upload and public-URL endpoints, which the admin client calls. */
function storage(): Record<string, UpstreamHandler> {
  return {
    "/storage/v1/object/flashcard-audio": () => json({ Key: "flashcard-audio/x" }),
    "/functions/v1/azure-tts": () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
  };
}

const aWord = (over: Record<string, unknown> = {}) => ({
  id: WORD_ID,
  word_arabic: "كتاب",
  audio_url: null,
  dialect_module: "Gulf",
  ...over,
});

Deno.test("persist-word-audio synthesises and stores a word with no audio", async () => {
  const { status, body, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({
      ...storage(),
      "/rest/v1/vocabulary_words": () => json(aWord()),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.cached, false);
  assert(String(body.audioUrl).length > 0);
  // Synthesised here rather than accepting a client-uploaded blob: the row is
  // shared across every learner, so its audio must provably be this word.
  assert(calls.some((url) => url.includes("azure-tts")));
});

Deno.test("persist-word-audio returns the existing audio without synthesising", async () => {
  const { status, body, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({
      ...storage(),
      "/rest/v1/vocabulary_words": () =>
        json(aWord({ audio_url: "https://cdn.test/existing.mp3" })),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.cached, true);
  assertEquals(body.audioUrl, "https://cdn.test/existing.mp3");
  // The whole point: each curriculum word is synthesised once ever, across all
  // learners. A cache miss that re-synthesised would multiply the cost by the
  // user count.
  assert(!calls.some((url) => url.includes("azure-tts")));
});

Deno.test("persist-word-audio picks the voice for the word's dialect", async () => {
  for (const [dialect, voice] of [
    ["Egyptian", "ar-EG-ShakirNeural"],
    ["Yemeni", "ar-YE-MaryamNeural"],
  ] as const) {
    const { bodies, calls } = await call(
      "persist-word-audio",
      { wordId: WORD_ID, dialect },
      caller({
        ...storage(),
        "/rest/v1/vocabulary_words": () => json(aWord()),
      }),
    );

    const i = calls.findIndex((u) => u.includes("azure-tts"));
    // azure-tts takes a *voice*, not a dialect. Passing a dialect name falls
    // through to its Gulf default, so every Egyptian and Yemeni word would be
    // cached — permanently, for everyone — in a Gulf voice.
    assertStringIncludes(bodies[i] ?? "", voice);
  }
});

Deno.test("persist-word-audio sends no voice for Gulf", async () => {
  const { bodies, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID, dialect: "Gulf" },
    caller({
      ...storage(),
      "/rest/v1/vocabulary_words": () => json(aWord()),
    }),
  );

  const i = calls.findIndex((u) => u.includes("azure-tts"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { voice?: string };
  // azure-tts's own default is already a Gulf voice, so naming one here would
  // be a second place to keep in sync for no gain.
  assertEquals(sent.voice, undefined);
});

Deno.test("persist-word-audio falls back to the word's own dialect", async () => {
  const { bodies, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({
      ...storage(),
      "/rest/v1/vocabulary_words": () => json(aWord({ dialect_module: "Egyptian" })),
    }),
  );

  const i = calls.findIndex((u) => u.includes("azure-tts"));
  // Callers do not always know the dialect of a curriculum word; the row does.
  assertStringIncludes(bodies[i] ?? "", "ar-EG-ShakirNeural");
});

Deno.test("persist-word-audio only fills an empty audio slot", async () => {
  const { calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({
      ...storage(),
      "/rest/v1/vocabulary_words": () => json(aWord()),
    }),
  );

  // Matched on `is.null` rather than on `audio_url`, which also appears in the
  // earlier select's column list.
  const update = calls
    .map((url) => decodeURIComponent(url))
    .find((url) => url.includes("vocabulary_words") && url.includes("is.null"));
  // `is.null` on the update, so a recording an admin uploaded between the read
  // and the write is never overwritten by a synthesised one.
  assert(update, `no conditional update found in:\n${calls.join("\n")}`);
  assertStringIncludes(update, "audio_url=is.null");
});

Deno.test("persist-word-audio reports an unknown word as 404", async () => {
  const { status, body, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({ ...storage(), "/rest/v1/vocabulary_words": () => json(null) }),
  );

  assertEquals(status, 404);
  assertEquals(body.error, "word not found");
  assert(!calls.some((url) => url.includes("azure-tts")));
});

Deno.test("persist-word-audio refuses a request with no word id", async () => {
  const { status, calls } = await call(
    "persist-word-audio",
    {},
    caller({ ...storage(), "/rest/v1/vocabulary_words": () => json(aWord()) }),
  );

  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("azure-tts")));
});

Deno.test("persist-word-audio reports a failed synthesis as 502", async () => {
  const { status, body } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({
      "/rest/v1/vocabulary_words": () => json(aWord()),
      "/storage/v1/object/flashcard-audio": () => json({ Key: "x" }),
      "/functions/v1/azure-tts": () => json({ error: "no key" }, 503),
    }),
  );

  // Nothing is written when there is nothing to write: an empty object in the
  // bucket would be cached as this word's audio forever.
  assertEquals(status, 502);
  assertEquals(body.error, "tts_failed");
});

Deno.test("persist-word-audio turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    "persist-word-audio",
    { wordId: WORD_ID },
    caller({ ...storage(), "/rest/v1/vocabulary_words": () => json(aWord()) }),
    { jwt: null },
  );

  // It runs with the service role, so the cap is the only thing between an
  // anonymous caller and unbounded synthesis into shared rows.
  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("azure-tts")));
});

// ── enrich-word-roots ───────────────────────────────────────────────────────

/**
 * The catch-up pass that fills in `user_vocabulary.root`.
 *
 * Roots were only ever written on one save path, so most of a learner's deck
 * has none and the "words from the same root" footnote has nothing to say. The
 * interesting surface here is not the happy path — it is everything the
 * function refuses to spend money on, and what it does with an answer it does
 * not trust.
 */

/** Vocabulary rows on the read, and a capture of every write. */
function vocabulary(rows: Array<{ id: string; word_arabic: string }>, writes: string[] = []) {
  return {
    "/rest/v1/user_vocabulary": (request: Request) => {
      if (request.method === "PATCH") {
        writes.push(new URL(request.url).search);
        return json({});
      }
      return json(rows);
    },
  };
}

/**
 * Distinct words made only of Arabic letters.
 *
 * Numbering them "كلمة1" would be the obvious thing and would prove nothing:
 * the function resolves anything containing a digit locally as "no root", so
 * every fixture word would be answered for free and no model would ever be
 * called.
 */
const someWords = (n: number, prefix = "كلمة") =>
  Array.from({ length: n }, (_, i) => ({
    id: `voc-${i}`,
    word_arabic:
      prefix +
      String(i)
        .split("")
        .map((digit) => "ابتثجحخدذر"[Number(digit)])
        .join(""),
  }));

/** A tool response answering every word in the batch with the same root. */
const rootsFor = (count: number, root = "ك ت ب") =>
  emitting({ roots: Array.from({ length: count }, (_, i) => ({ index: i + 1, root })) });

Deno.test("enrich-word-roots asks about forty words at a time", async () => {
  const { status, body, calls } = await call(
    "enrich-word-roots",
    { limit: 120 },
    caller({ ...vocabulary(someWords(120)), "ai.gateway.lovable.dev": rootsFor(40) }),
  );

  assertEquals(status, 200);
  // Three calls, not 120. Paying the system prompt once per word is the
  // difference between this being affordable and not.
  assertEquals(calls.filter((url) => url.includes("ai.gateway.lovable.dev")).length, 3);
  assertEquals(body.examined, 120);
});

Deno.test("enrich-word-roots resolves the hopeless cases without asking anyone", async () => {
  const rows = [
    { id: "phrase", word_arabic: "من فضلك" },
    { id: "particle", word_arabic: "في" },
    { id: "latin", word_arabic: "kataba" },
    { id: "digits", word_arabic: "١٢٣" },
    { id: "real", word_arabic: "كتاب" },
  ];
  const { status, body, calls, bodies } = await call(
    "enrich-word-roots",
    {},
    caller({ ...vocabulary(rows), "ai.gateway.lovable.dev": rootsFor(1) }),
  );

  assertEquals(status, 200);
  assertEquals(body.skippedFree, 4);

  // Deciding what *not* to send is where the savings are, so it matters that
  // these never reach a prompt rather than merely being discarded afterwards.
  const prompts = bodies
    .filter((_, i) => calls[i].includes("ai.gateway.lovable.dev"))
    .join("\n");
  assertStringIncludes(prompts, "كتاب");
  assert(!prompts.includes("من فضلك"));
  assert(!prompts.includes("kataba"));
});

Deno.test("enrich-word-roots stores a word with no root as '' so it is never asked about twice", async () => {
  const writes: string[] = [];
  const { status } = await call(
    "enrich-word-roots",
    {},
    caller({
      ...vocabulary([{ id: "voc-0", word_arabic: "كمبيوتر" }], writes),
      "ai.gateway.lovable.dev": emitting({ roots: [{ index: 1, root: "" }] }),
    }),
  );

  assertEquals(status, 200);
  // Left null it would come back on every future run; '' is the record that we
  // asked. The client reads '' as "no root", never as a family.
  assertEquals(writes.length, 1);
});

Deno.test("enrich-word-roots refuses an answer that is not radicals", async () => {
  for (const notARoot of ["من الكتاب", "kataba", "unknown"]) {
    const { status, body } = await call(
      "enrich-word-roots",
      {},
      caller({
        ...vocabulary([{ id: "voc-0", word_arabic: "كتاب" }]),
        "ai.gateway.lovable.dev": emitting({ roots: [{ index: 1, root: notARoot }] }),
      }),
    );

    assertEquals(status, 200);
    // A prose answer written into the column would be indistinguishable from a
    // real root afterwards, and would put a false family in front of a learner.
    assertEquals(body.resolved, 0);
  }
});

Deno.test("enrich-word-roots skips an index it cannot place rather than shifting the rest", async () => {
  const { status, body } = await call(
    "enrich-word-roots",
    {},
    caller({
      ...vocabulary(someWords(3)),
      "ai.gateway.lovable.dev": emitting({
        roots: [
          { index: 1, root: "ك ت ب" },
          { index: 99, root: "د ر س" },
        ],
      }),
    }),
  );

  assertEquals(status, 200);
  // A positional array would have handed word 99's root to word 2. Explicit
  // indices make a short or reordered response a gap, not a silent mix-up.
  assertEquals(body.resolved, 1);
});

Deno.test("enrich-word-roots caps how much one call can chew through", async () => {
  const { status, body } = await call(
    "enrich-word-roots",
    { limit: 100000 },
    caller({ ...vocabulary(someWords(5)), "ai.gateway.lovable.dev": rootsFor(5) }),
  );

  assertEquals(status, 200);
  // The limit reaches PostgREST as a range header rather than being trusted;
  // what matters is that the function never asks for an unbounded page.
  assertEquals(body.examined, 5);
});

Deno.test("enrich-word-roots works through the dialect it was asked for", async () => {
  const requests: string[] = [];
  const { status } = await call(
    "enrich-word-roots",
    { dialect: "Yemeni" },
    caller({
      "/rest/v1/user_vocabulary": (request: Request) => {
        if (request.method !== "PATCH") requests.push(new URL(request.url).search);
        return json([]);
      },
    }),
  );

  assertEquals(status, 200);
  // My Words counts the words missing a root in the deck on screen. If the run
  // ignored that scope, pressing "Find roots for 12 words" while looking at
  // Gulf could spend the batch on the Egyptian deck and leave the number
  // exactly where it was — which reads as the button doing nothing.
  assert(requests.some((search) => search.includes("dialect=eq.Yemeni")));
});

Deno.test("enrich-word-roots covers every dialect when none is named", async () => {
  const requests: string[] = [];
  const { status } = await call(
    "enrich-word-roots",
    {},
    caller({
      "/rest/v1/user_vocabulary": (request: Request) => {
        if (request.method !== "PATCH") requests.push(new URL(request.url).search);
        return json([]);
      },
    }),
  );

  assertEquals(status, 200);
  // This is what My Words' "All dialects" mode counts.
  assert(requests.length > 0);
  assert(!requests.some((search) => search.includes("dialect=")));
});

Deno.test("enrich-word-roots will not touch shared curriculum words for a non-admin", async () => {
  const { status, calls } = await call(
    "enrich-word-roots",
    { scope: "curriculum" },
    caller({
      ...vocabulary(someWords(3)),
      "/rest/v1/vocabulary_words": () => json(someWords(3)),
      "ai.gateway.lovable.dev": rootsFor(3),
    }),
  );

  // A subscriber is not an editor. These rows are read by every learner, so a
  // wrong root written here is wrong for all of them — the paid-tier cap that
  // guards the personal deck is not the right gate.
  assertEquals(status, 403);
  assert(!calls.some((url) => url.includes("ai.gateway.lovable.dev")));
});

Deno.test("enrich-word-roots backfills a lesson's words for an admin", async () => {
  const reads: string[] = [];
  const { status, body } = await call(
    "enrich-word-roots",
    { scope: "curriculum", lessonId: "lesson-1", dialect: "Gulf" },
    caller({
      "/rest/v1/user_roles": () => json([{ role: "admin" }]),
      "/rest/v1/vocabulary_words": (request: Request) => {
        if (request.method === "PATCH") return json({});
        reads.push(new URL(request.url).search);
        return json(someWords(2));
      },
      "ai.gateway.lovable.dev": rootsFor(2),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.resolved, 2);
  // Scoped to the lesson the admin is looking at, and to its dialect module —
  // the curriculum column is `dialect_module`, not `dialect`.
  assert(reads.some((search) => search.includes("lesson_id=eq.lesson-1")));
  assert(reads.some((search) => search.includes("dialect_module=eq.Gulf")));
  // And never scoped by user_id: curriculum rows have no owner.
  assert(!reads.some((search) => search.includes("user_id=")));
});

Deno.test("enrich-word-roots turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    "enrich-word-roots",
    {},
    caller({ ...vocabulary(someWords(3)), "ai.gateway.lovable.dev": rootsFor(3) }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("ai.gateway.lovable.dev")));
});
