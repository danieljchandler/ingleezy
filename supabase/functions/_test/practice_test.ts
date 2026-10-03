import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";
import { GRAMMAR_CATEGORY_IDS } from "../_shared/grammarTaxonomy.ts";

/**
 * The practice generators, and the one function that records a result.
 *
 * `record-grammar-outcome` is the odd one out and the important one: it is the
 * only write here. Grammar had no SRS at all until it existed — a drill's score
 * was rendered once and dropped — so it is what lets the app say which
 * structures a learner is weak on. Its category is an allow-list because the
 * value becomes a `curriculum_concepts` key, and free text would let any
 * authenticated client mint concept rows that leak into the coverage planner
 * and the admin heatmap.
 *
 * `listening-quiz` and `daily-challenge` both build their prompt from what the
 * learner actually knows, and both have a fallback that turns a generation
 * failure into something that *looks* like content. Those fallbacks are where
 * the interesting behaviour is, because a silent one-question quiz is worse
 * than a visible error.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/vocabulary_words": () => json([]),
    "/rest/v1/curriculum_concepts": () => json({ id: "concept-1" }),
    "/rest/v1/user_concept_mastery": () => json({ id: "mastery-1" }),
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
/** Functions that parse JSON out of prose rather than using a tool call. */
const speaking = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(JSON.stringify(payload));

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

// ── record-grammar-outcome ──────────────────────────────────────────────────

const A_CATEGORY = GRAMMAR_CATEGORY_IDS[0];

Deno.test("record-grammar-outcome records one result per question", async () => {
  const { status, body } = await call(
    "record-grammar-outcome",
    { category: A_CATEGORY, outcomes: [true, false, true, true, false] },
    caller(),
  );

  assertEquals(status, 200);
  assertEquals(body.recorded, 5);
  assert(body.conceptId);
});

Deno.test("record-grammar-outcome refuses a category outside the taxonomy", async () => {
  for (const category of ["definitely-not-a-category", "", "../../etc", 42, null]) {
    const { status, body, calls } = await call(
      "record-grammar-outcome",
      { category, outcomes: [true] },
      caller(),
    );

    // The category becomes a `curriculum_concepts` key. Free text here would
    // let any authenticated client mint concept rows that then leak into the
    // coverage planner and the admin heatmap.
    assertEquals(status, 400, `expected ${JSON.stringify(category)} to be refused`);
    assertStringIncludes(String(body.error), "Unknown category");
    assert(!calls.some((url) => url.includes("curriculum_concepts")));
  }
});

Deno.test("record-grammar-outcome accepts every category the drills offer", async () => {
  for (const category of GRAMMAR_CATEGORY_IDS) {
    const { status } = await call(
      "record-grammar-outcome",
      { category, outcomes: [true] },
      caller(),
    );

    // The allow-list comes from the shared taxonomy rather than a hand-kept
    // copy, which is what makes drill mastery and tagged content land on the
    // same key. A drift between the two would show up here.
    assertEquals(status, 200, `expected ${category} to be accepted`);
  }
});

Deno.test("record-grammar-outcome refuses outcomes that are not booleans", async () => {
  for (const outcomes of [[], "true", [1, 0], [true, "false"], undefined]) {
    const { status, calls } = await call(
      "record-grammar-outcome",
      { category: A_CATEGORY, outcomes },
      caller(),
    );

    // A truthy number would record a wrong answer as correct, which is the one
    // mistake this table must not make — it feeds what the learner is shown next.
    assertEquals(status, 400, `expected ${JSON.stringify(outcomes)} to be refused`);
    assert(!calls.some((url) => url.includes("user_concept_mastery")));
  }
});

Deno.test("record-grammar-outcome caps how many outcomes one call can record", async () => {
  const { body } = await call(
    "record-grammar-outcome",
    { category: A_CATEGORY, outcomes: Array.from({ length: 500 }, () => true) },
    caller(),
  );

  // A drill is five questions. The ceiling leaves room without letting a client
  // flood its own mastery score to the top.
  assertEquals(body.recorded, 40);
});

Deno.test("record-grammar-outcome narrows the dialect", async () => {
  for (const dialect of ["Egyptian", "Levantine", undefined, 42]) {
    const { status } = await call(
      "record-grammar-outcome",
      { category: A_CATEGORY, outcomes: [true], dialect },
      caller(),
    );

    // Mastery is per dialect, and an unrecognised one would create a fourth
    // bucket no page ever reads from.
    assertEquals(status, 200);
  }
});

Deno.test("record-grammar-outcome reports a failed write rather than a false success", async () => {
  const { status, body } = await call(
    "record-grammar-outcome",
    { category: A_CATEGORY, outcomes: [true, true] },
    caller({
      "/rest/v1/curriculum_concepts": () => json({ message: "denied" }, 403),
      "/rest/v1/user_concept_mastery": () => json({ message: "denied" }, 403),
    }),
  );

  // `recordConceptOutcomes` never throws, so a null return is the only signal
  // the write did not land. Reporting `recorded: 2` here would be contradicted
  // by the learner's very next drill.
  assertEquals(status, 200);
  assertEquals(body.recorded, 0);
});

Deno.test("record-grammar-outcome refuses an anonymous caller", async () => {
  const { status, calls } = await call(
    "record-grammar-outcome",
    { category: A_CATEGORY, outcomes: [true] },
    caller(),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("user_concept_mastery")));
});

Deno.test("record-grammar-outcome refuses a body that is not an object", async () => {
  const fn = await loadFunction("record-grammar-outcome", { upstreams: caller() });
  try {
    const response = await fn.handler(
      new Request("http://localhost/record-grammar-outcome", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://ingleezy.app",
          authorization: "Bearer fixture",
        },
        body: "not json at all",
      }),
    );

    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "Invalid body");
  } finally {
    fn.restore();
  }
});

// ── listening-quiz ──────────────────────────────────────────────────────────

const aQuizItem = (over: Record<string, unknown> = {}) => ({
  type: "dictation",
  audioText: "الجَوّ حِلو اليوم",
  audioTextTransliteration: "il-jaww hilw il-yoom",
  audioTextEnglish: "The weather is nice today",
  hint: "الجو",
  ...over,
});

Deno.test("listening-quiz returns the generated items", async () => {
  const { status, body } = await call(
    "listening-quiz",
    { mode: "dictation", words: [], count: 3, dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem(), aQuizItem()] }) }),
  );

  assertEquals(status, 200);
  assertEquals((body.questions as unknown[]).length, 2);
});

Deno.test("listening-quiz builds each mode's prompt differently", async () => {
  for (const [mode, marker] of [
    ["dictation", "dictation practice"],
    ["comprehension", "listening comprehension questions"],
    ["speed", "speed listening practice"],
  ] as const) {
    const { bodies, calls } = await call(
      "listening-quiz",
      { mode, words: [] },
      caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem({ type: mode })] }) }),
    );

    const i = calls.findIndex((u) => u.includes("ai.gateway"));
    assertStringIncludes(bodies[i] ?? "", marker);
  }
});

Deno.test("listening-quiz falls through to speed for an unknown mode", async () => {
  const { bodies, calls } = await call(
    "listening-quiz",
    { mode: "telepathy", words: [] },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assertStringIncludes(bodies[i] ?? "", "speed listening practice");
});

Deno.test("listening-quiz seeds the prompt from the learner's own words", async () => {
  const { bodies, calls } = await call(
    "listening-quiz",
    {
      mode: "dictation",
      words: [
        { word_arabic: "بيت", word_english: "house" },
        { word_arabic: "ولد", word_english: "boy" },
      ],
    },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // A listening exercise is only useful if the learner can decode the rest of
  // the sentence — the words they know are what the sentence is built from.
  assertStringIncludes(bodies[i] ?? "", "بيت (house)");
});

Deno.test("listening-quiz caps how much vocabulary it puts in the prompt", async () => {
  const { bodies, calls } = await call(
    "listening-quiz",
    {
      mode: "dictation",
      words: Array.from({ length: 60 }, (_, i) => ({
        word_arabic: `كلمة${i}`,
        word_english: `word ${i}`,
      })),
    },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  assert(sent.includes("كلمة19"));
  assert(!sent.includes("كلمة20"));
});

Deno.test("listening-quiz asks for English audio with an Arabic-letter phonetic line", async () => {
  const { bodies, calls } = await call(
    "listening-quiz",
    { mode: "dictation", words: [] },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // The direction flipped: audioText is the ENGLISH the learner hears, the
  // gloss rides in the dialect, and the phonetic line is English in Arabic
  // letters so the learner can read how it sounds.
  assertStringIncludes(bodies[i] ?? "", "audioText is the ENGLISH");
  assertStringIncludes(bodies[i] ?? "", "phonetically in ARABIC letters");
});

Deno.test("listening-quiz scales its guidance to the difficulty", async () => {
  const { bodies, calls } = await call(
    "listening-quiz",
    { mode: "dictation", words: [], difficulty: "advanced" },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assertStringIncludes(bodies[i] ?? "", "natural-speed sentences");
});

Deno.test("listening-quiz preserves 402 and 429", async () => {
  for (const upstream of [402, 429]) {
    const { status } = await call(
      "listening-quiz",
      { mode: "dictation", words: [] },
      caller({
        "ai.gateway.lovable.dev": () => json({ error: "no" }, upstream),
        "openrouter.ai": () => json({ error: "no" }, upstream),
      }),
    );

    assertEquals(status, upstream);
  }
});

Deno.test("listening-quiz answers a generation failure with a single greeting", async () => {
  const { status, body } = await call(
    "listening-quiz",
    { mode: "dictation", words: [], dialect: "Egyptian" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 500),
      "openrouter.ai": () => json({ error: "boom" }, 500),
    }),
  );

  // Pinned, not endorsed. Any non-402/429 failure produces one hardcoded
  // greeting rather than an error, so a learner who asked for five dictation
  // items gets a one-item quiz saying "Hello" and no indication anything went
  // wrong. The English is the audio; the dialect shapes only the gloss —
  // أهلاً for Egyptian, هلا for Gulf.
  assertEquals(status, 200);
  const questions = body.questions as Array<Record<string, unknown>>;
  assertEquals(questions.length, 1);
  assertEquals(questions[0].audioText, "Hello");
  assertEquals(questions[0].audioTextEnglish, "أهلاً");
});

Deno.test("listening-quiz fails outright when no words array is sent", async () => {
  const { status } = await call(
    "listening-quiz",
    { mode: "dictation" },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
  );

  // Pinned. `words` is destructured with no default and immediately `.slice`d,
  // so a request without it throws before any validation and comes back as a
  // bare 500 — unlike every other input on this function, which has a default.
  assertEquals(status, 500);
});

Deno.test("listening-quiz turns an anonymous caller away", async () => {
  const { status } = await call(
    "listening-quiz",
    { mode: "dictation", words: [] },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [aQuizItem()] }) }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── daily-challenge ─────────────────────────────────────────────────────────

/** What the model returns for a translate day: the dialect asks, English answers. */
const aChallenge = {
  questions: [
    { prompt: "كيف تقول «هلا» بالإنجليزي؟", answer: "Hello", options: ["Hello", "Hallo", "Hello you"] },
  ],
};

/** The system and user prompts as sent, decoded so Arabic reads as Arabic. */
function sentPrompt(calls: string[], bodies: (string | undefined)[]): string {
  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const messages = (JSON.parse(bodies[i] ?? "{}").messages ?? []) as { content: unknown }[];
  return messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

Deno.test("daily-challenge returns a challenge", async () => {
  const { status, body } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "translate" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
  );

  assertEquals(status, 200);
  const challenge = body.challenge as { type: string; title: string; questions: { answer: string }[] };
  assertEquals(challenge.type, "translate");
  assertEquals(challenge.title, "Say it in English");
  assertEquals(challenge.questions[0].answer, "Hello");
});

Deno.test("daily-challenge practises English, with the dialect as the scaffold", async () => {
  const { calls, bodies } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "translate" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
  );

  const sent = sentPrompt(calls, bodies);
  // Until 2026-10-03 this prompt began "You are a Gulf Arabic language
  // challenge generator": Hakiya's exercise, served to people learning English.
  assertStringIncludes(sent, "learning English");
  assertStringIncludes(sent, "The English is what is being practised");
  assert(!sent.includes("language challenge generator"));
});

Deno.test("daily-challenge sources its words from the learner's deck", async () => {
  const { bodies, calls } = await call(
    "daily-challenge",
    // challengeType pinned: the weekday default rotates through "culture",
    // which is the one prompt that interpolates no vocabulary — without the
    // pin this test fails every Friday.
    { dialect: "Gulf", challengeType: "translate", userVocab: [{ word_arabic: "كتاب", word_english: "book" }] },
    caller({
      "ai.gateway.lovable.dev": emitting(aChallenge),
      "/rest/v1/user_vocabulary": () =>
        json([
          {
            word_arabic: "بيت",
            word_english: "house",
            next_review_at: new Date(Date.now() - 86_400_000).toISOString(),
            ease_factor: 1.3,
            lapses: 5,
          },
        ]),
    }),
  );

  // The client used to send `userVocab` as the whole curriculum shuffled, so
  // the "daily challenge" routinely quizzed words the learner had never
  // studied. The learner's own deck wins over whatever the client supplies,
  // and the English leads: it is the word being learned.
  const sent = sentPrompt(calls, bodies);
  assertStringIncludes(sent, "house (بيت)");
  assert(!sent.includes("book (كتاب)"));
});

Deno.test("daily-challenge falls back to the client's words when the deck is empty", async () => {
  const { bodies, calls } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "translate", userVocab: [{ word_arabic: "كتاب", word_english: "book" }] },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
  );

  // A learner on their first day has no deck; a challenge built from nothing
  // is not a challenge.
  assertStringIncludes(sentPrompt(calls, bodies), "book (كتاب)");
});

Deno.test("daily-challenge uses the dialect's own examples when there is nothing else", async () => {
  const { status, bodies, calls } = await call(
    "daily-challenge",
    { dialect: "Yemeni", challengeType: "translate" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
  );

  assertEquals(status, 200);
  // Third fallback in the chain. Without it the prompt interpolates an empty
  // string and the model invents words from any dialect it likes. The shared
  // examples are written dialect-first; the prompt turns them English-first.
  assertStringIncludes(sentPrompt(calls, bodies), "good (زين)");
});

Deno.test("daily-challenge sets culture day in English-speaking life, glossed in the dialect", async () => {
  const { bodies, calls } = await call(
    "daily-challenge",
    { dialect: "Yemeni", challengeType: "culture" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
  );

  const sent = sentPrompt(calls, bodies);
  // Hakiya's culture day quizzed Yemeni traditions. For someone learning
  // English the culture worth a question is English-speaking manners, asked
  // in their own dialect.
  assertStringIncludes(sent, "English-speaking life");
  assertStringIncludes(sent, "Yemeni");
  assert(!sent.includes("قات"));
});

Deno.test("daily-challenge shuffles an unscramble from the answer's own words", async () => {
  const { status, body } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "unscramble" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        // The model's own scramble is ignored: a model that drops or adds a
        // word makes a puzzle nobody can solve.
        questions: [{ answer: "I went to the market.", scrambled: "market went I", hint: "رحت السوق" }],
      }),
    }),
  );

  assertEquals(status, 200);
  const [q] = (body.challenge as { questions: { scrambled: string; answer: string; options?: string[] }[] }).questions;
  assertEquals(q.answer, "I went to the market.");
  assertEquals(q.scrambled.split(" ").sort(), ["I", "went", "to", "the", "market"].sort());
  assert(q.scrambled !== "I went to the market");
  // Tapped back into order, not picked from a list.
  assertEquals(q.options, undefined);
});

Deno.test("daily-challenge keeps only questions a learner can answer", async () => {
  const { status, body } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "fill_blank" },
    caller({
      "ai.gateway.lovable.dev": emitting({
        questions: [
          // The answer missing from its own options: put back, not dropped.
          { sentence: "She is good ___ math.", sentenceEnglish: "هي شاطرة بالرياضيات", answer: "at", options: ["in", "on"] },
          // A gap sentence with no gap.
          { sentence: "She is good at math.", answer: "at", options: ["at", "in"] },
          // No answer at all.
          { sentence: "I ___ from Kuwait.", options: ["am", "is"] },
        ],
      }),
    }),
  );

  assertEquals(status, 200);
  const questions = (body.challenge as { questions: { sentence: string; options: string[] }[] }).questions;
  assertEquals(questions.length, 1);
  assertEquals(questions[0].sentence, "She is good ___ math.");
  assertEquals([...questions[0].options].sort(), ["at", "in", "on"]);
});

Deno.test("daily-challenge says so rather than inventing a quiz when nothing is usable", async () => {
  const { status, body } = await call(
    "daily-challenge",
    { dialect: "Gulf", challengeType: "translate" },
    caller({ "ai.gateway.lovable.dev": emitting({ questions: [{ prompt: "كيف تقول «هلا»؟" }] }) }),
  );

  // A stand-in "hello / thank you" quiz once filled this gap, and a learner
  // could keep a streak alive on it. The page shows an error and a retry.
  assertEquals(status, 502);
  assert(body.error);
  assertEquals(body.challenge, undefined);
});

Deno.test("daily-challenge survives an unreadable learner profile", async () => {
  const { status } = await call(
    "daily-challenge",
    // challengeType pinned: the weekday default rotates through "culture",
    // which is the one prompt that interpolates no vocabulary — without the
    // pin this test fails every Friday.
    { dialect: "Gulf", challengeType: "translate", userVocab: [{ word_arabic: "كتاب", word_english: "book" }] },
    caller({
      "ai.gateway.lovable.dev": emitting(aChallenge),
      "/rest/v1/user_vocabulary": () => json({ message: "denied" }, 403),
      "/rest/v1/word_reviews": () => json({ message: "denied" }, 403),
    }),
  );

  // The profile is an optimisation, not a requirement. A learner whose deck
  // cannot be read still gets a challenge.
  assertEquals(status, 200);
});

Deno.test("daily-challenge says so when its key is missing", async () => {
  const { status } = await call(
    "daily-challenge",
    { dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
    { env: { LOVABLE_API_KEY: undefined } },
  );

  assertEquals(status, 500);
});

Deno.test("daily-challenge turns an anonymous caller away", async () => {
  const { status } = await call(
    "daily-challenge",
    { dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting(aChallenge) }),
    { jwt: null },
  );

  assertEquals(status, 401);
});

// ── reading-qa ──────────────────────────────────────────────────────────────

const anAnswer = {
  lines: [{ arabic: "الجو حلو", english: "The weather is nice" }],
  vocabulary: [{ arabic: "الجو", english: "weather", inContext: "the weather today" }],
  followUp: "What is the weather like in summer?",
};

Deno.test("reading-qa answers a question in the learner's dialect", async () => {
  const { status, body } = await call(
    "reading-qa",
    { question: "What is the weather like?", dialect: "Gulf", difficulty: "beginner" },
    caller({ "ai.gateway.lovable.dev": speaking(anAnswer) }),
  );

  assertEquals(status, 200);
  const answer = body.answer as Record<string, unknown>;
  assertEquals((answer.lines as unknown[]).length, 1);
  assertEquals(answer.followUp, "What is the weather like in summer?");
});

Deno.test("reading-qa keeps the conversation history", async () => {
  const { bodies, calls } = await call(
    "reading-qa",
    {
      question: "And in winter?",
      history: [
        { role: "user", content: "What is the weather like?" },
        { role: "assistant", content: "الجو حلو" },
      ],
    },
    caller({ "ai.gateway.lovable.dev": speaking(anAnswer) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ role: string }> };
  // System, two history turns, then the new question. A follow-up like "and in
  // winter?" is meaningless without the turn before it.
  assertEquals(sent.messages.length, 4);
  assertEquals(sent.messages.at(-1)?.role, "user");
});

Deno.test("reading-qa recovers a JSON body wrapped in prose", async () => {
  const { status, body } = await call(
    "reading-qa",
    { question: "What is the weather like?" },
    caller({
      "ai.gateway.lovable.dev": () =>
        chatCompletion("Here you go!\n```json\n" + JSON.stringify(anAnswer) + "\n```\nHope that helps."),
    }),
  );

  // The prompt says "no markdown code blocks" and the model does it anyway.
  // Extracting the first brace-delimited run is what makes that survivable.
  assertEquals(status, 200);
  const answer = body.answer as Record<string, unknown>;
  assertEquals((answer.lines as unknown[]).length, 1);
});

Deno.test("reading-qa apologises in Arabic rather than crashing on unparsable output", async () => {
  const { status, body } = await call(
    "reading-qa",
    { question: "What is the weather like?" },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("I refuse to answer that.") }),
  );

  // Pinned as-is. The fallback is a normal-looking answer in Arabic saying it
  // could not answer — so the failure is at least in the language the learner
  // is reading, and the panel does not blank out. It is indistinguishable from
  // a real answer to the caller, which is the cost.
  assertEquals(status, 200);
  const answer = body.answer as { lines: Array<{ english: string }> };
  assertStringIncludes(answer.lines[0].english, "couldn't answer");
});

Deno.test("reading-qa preserves 402 and 429", async () => {
  for (const upstream of [402, 429]) {
    const { status } = await call(
      "reading-qa",
      { question: "What is the weather like?" },
      caller({ "ai.gateway.lovable.dev": () => json({ error: "no" }, upstream) }),
    );

    assertEquals(status, upstream);
  }
});

Deno.test("reading-qa flattens any other gateway failure to 500", async () => {
  const { status } = await call(
    "reading-qa",
    { question: "What is the weather like?" },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503) }),
  );

  assertEquals(status, 500);
});
