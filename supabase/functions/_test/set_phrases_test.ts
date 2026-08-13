import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `seed-set-phrases` and `generate-set-phrase-quiz` — the two halves of the
 * set-phrase deck, flipped: the phrases are ENGLISH, the scenario the learner
 * reads is their own dialect Arabic, and every choice carries a dialect gloss.
 *
 * Seeding is admin-only and generates ten drafts per occasion, one model call
 * at a time, and keeps going when one occasion fails. Quiz building is the
 * learner-facing half: it mixes due SRS cards with new phrases, picks a
 * question type per phrase, and synthesises distractors when the phrase has
 * none cached — then writes them back so the next learner does not pay for the
 * same generation.
 *
 * Both lean on `Math.random`, so the tests that care about which branch was
 * taken pin it rather than seeding around it.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const OCCASION = "f1f1f1f1-0000-4000-8000-000000000000";
const PHRASE = "88888888-0000-4000-8000-000000000000";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    ...extra,
  };
}

/** Fix `Math.random` so the branch a test is describing is the one it takes. */
async function withRandom<T>(value: number, run: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await run();
  } finally {
    Math.random = original;
  }
}

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction(name, { upstreams });
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
      methods: fn.calls.map((c) => c.method),
    };
  } finally {
    fn.restore();
  }
}

// ── seed-set-phrases ─────────────────────────────────────────────────────────

const generated = {
  phrases: [
    {
      phrase_english: "Good morning!",
      phrase_arabic: "صباح الخير",
      phrase_transliteration: "قود مورنينق",
      reply_english: "Morning! How are you?",
      reply_arabic: "صباح النور! شلونك؟",
      reply_transliteration: "مورنينق! هاو ار يو؟",
      scenario_english: "تسلم على زميلك أول ما توصل الدوام.",
      formality: "neutral",
      difficulty: "A1",
    },
  ],
};

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

Deno.test("seed-set-phrases answers the preflight", async () => {
  const fn = await loadFunction("seed-set-phrases", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("seed-set-phrases"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("seed-set-phrases turns away an anonymous caller", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({ "/auth/v1/user": () => json({ error: "no session" }, 401) }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthenticated");
});

Deno.test("seed-set-phrases turns away a signed-in learner", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({ "/rest/v1/user_roles": () => json([]) }),
  );

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "admin required");
});

Deno.test("seed-set-phrases needs an occasion to seed into", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({ "/rest/v1/set_phrase_occasions": () => json([]) }),
  );

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "no occasions found");
});

Deno.test("seed-set-phrases writes the generated phrases as drafts", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Egyptian" },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "/rest/v1/set_phrases": () => json([], 201),
      "ai.gateway.lovable.dev": emitting(generated),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.summary, [{ occasion: "Greetings", inserted: 1 }]);

  const insert = result.bodies[
    result.calls.findIndex((url) => url.includes("/rest/v1/set_phrases"))
  ];
  const rows = JSON.parse(insert ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows[0].status, "draft");
  assertEquals(rows[0].dialect, "Egyptian");
  assertEquals(rows[0].occasion_id, OCCASION);
  assertEquals(rows[0].created_by, USER);
  // English is the phrase, the Arabic its gloss, the transliteration the
  // English pronounced in Arabic letters.
  assertEquals(rows[0].phrase_english, "Good morning!");
  assertEquals(rows[0].phrase_arabic, "صباح الخير");
  assertEquals(rows[0].phrase_transliteration, "قود مورنينق");
  // The gloss columns are optional in the tool schema, so a phrase without
  // them lands as null rather than as undefined.
  assertEquals(rows[0].phrase_literal, null);
  assertEquals(rows[0].reply_literal, null);
});

Deno.test("seed-set-phrases fills in the defaults the model omitted", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "/rest/v1/set_phrases": () => json([], 201),
      "ai.gateway.lovable.dev": emitting({
        phrases: [{ phrase_english: "hi", phrase_arabic: "هلا" }],
      }),
    }),
  );

  assertEquals(result.status, 200);
  const insert = result.bodies[
    result.calls.findIndex((url) => url.includes("/rest/v1/set_phrases"))
  ];
  const rows = JSON.parse(insert ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows[0].formality, "neutral");
  assertEquals(rows[0].difficulty, "A1");
});

Deno.test("seed-set-phrases seeds only the occasions asked for", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf", occasionIds: [OCCASION] },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "/rest/v1/set_phrases": () => json([], 201),
      "ai.gateway.lovable.dev": emitting(generated),
    }),
  );

  assertEquals(result.status, 200);
  const occasionsQuery = result.calls.find((url) => url.includes("set_phrase_occasions"));
  assertStringIncludes(occasionsQuery ?? "", "id=in.");
});

Deno.test("seed-set-phrases carries the dialect rules into the prompt", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Yemeni" },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "/rest/v1/set_phrases": () => json([], 201),
      "ai.gateway.lovable.dev": emitting(generated),
    }),
  );

  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  // The rules guard the scaffold now: English phrases, glossed only in the
  // learner's own dialect.
  assertStringIncludes(prompt, "ENGLISH situational-phrase libraries");
  assertStringIncludes(prompt, "authentic Yemeni Arabic only");
  assertStringIncludes(prompt, "Occasion: Greetings");
});

Deno.test("seed-set-phrases reports a failed occasion without abandoning the run", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "/rest/v1/set_phrases": () => json({ message: "permission denied" }, 403),
      "ai.gateway.lovable.dev": emitting(generated),
    }),
  );

  assertEquals(result.status, 200);
  const summary = result.body.summary as Array<Record<string, unknown>>;
  assertEquals(summary[0].inserted, 0);
  assert(typeof summary[0].error === "string");
});

Deno.test("seed-set-phrases records a model outage per occasion", async () => {
  const result = await call(
    "seed-set-phrases",
    { dialect: "Gulf" },
    caller({
      "/rest/v1/set_phrase_occasions": () => json([{ id: OCCASION, name: "Greetings" }]),
      "ai.gateway.lovable.dev": () => json({ error: "upstream down" }, 503),
    }),
  );

  assertEquals(result.status, 200);
  const summary = result.body.summary as Array<Record<string, string | number>>;
  assertEquals(summary[0].inserted, 0);
  assertStringIncludes(String(summary[0].error), "AI 503");
});

// ── generate-set-phrase-quiz ─────────────────────────────────────────────────

/** A published phrase with no reply, so the question type is always scenario. */
const scenarioPhrase = (over: Record<string, unknown> = {}) => ({
  id: PHRASE,
  phrase_english: "You're doing a great job",
  phrase_arabic: "الله يعطيك العافية",
  phrase_transliteration: null,
  phrase_audio_url: null,
  reply_english: null,
  reply_arabic: null,
  reply_transliteration: null,
  reply_audio_url: null,
  // scenario_english carries the dialect-Arabic scenario since the retarget.
  scenario_english: "واحد خلص شغل طويل وتبي تشجعه.",
  cultural_note: null,
  formality: "neutral",
  difficulty: "A2",
  cached_distractors: [
    { english: "Congratulations!", arabic: "مبروك" },
    { english: "My condolences.", arabic: "البقاء لله" },
    { english: "Enjoy your meal.", arabic: "بالعافية" },
  ],
  set_phrase_occasions: { name: "Encouragement", icon_name: "Coffee" },
  ...over,
});

function quizUpstreams(extra: Record<string, UpstreamHandler> = {}) {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_set_phrases": () => json([]),
    "/rest/v1/set_phrases": () => json([scenarioPhrase()]),
    ...extra,
  };
}

interface QuizItem {
  phrase_id: string;
  question_type: string;
  prompt: { arabic?: string; english?: string; audio_url?: string | null };
  expected_english: string;
  choices: Array<{ english: string; correct: boolean }>;
  is_due_review: boolean;
  occasion: { name: string } | null;
}

Deno.test("generate-set-phrase-quiz answers the preflight", async () => {
  const fn = await loadFunction("generate-set-phrase-quiz", { upstreams: quizUpstreams() });
  try {
    const response = await fn.handler(optionsRequest("generate-set-phrase-quiz"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("generate-set-phrase-quiz turns away an anonymous caller", async () => {
  const result = await call(
    "generate-set-phrase-quiz",
    { dialect: "Gulf" },
    quizUpstreams({ "/auth/v1/user": () => json({ error: "no session" }, 401) }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthenticated");
});

Deno.test("generate-set-phrase-quiz builds a scenario question from a cached phrase", async () => {
  const result = await withRandom(0.9, () =>
    call("generate-set-phrase-quiz", { dialect: "Gulf", length: 2 }, quizUpstreams()));

  assertEquals(result.status, 200);
  const items = result.body.items as QuizItem[];
  assertEquals(items.length, 1);
  assertEquals(items[0].question_type, "scenario");
  // The situation arrives in the learner's dialect; the production is English.
  assertEquals(items[0].prompt.arabic, "واحد خلص شغل طويل وتبي تشجعه.");
  assertEquals(items[0].expected_english, "You're doing a great job");
  assertEquals(items[0].is_due_review, false);
  assertEquals(items[0].occasion?.name, "Encouragement");
  // Exactly one right answer, and four choices in total.
  assertEquals(items[0].choices.length, 4);
  assertEquals(items[0].choices.filter((c) => c.correct).length, 1);
});

Deno.test("generate-set-phrase-quiz skips a phrase with no English on it", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf" },
      quizUpstreams({
        "/rest/v1/set_phrases": () =>
          json([
            scenarioPhrase({ id: "88888888-0000-4000-8000-000000000002", phrase_english: null }),
            scenarioPhrase(),
          ]),
      }),
    ));

  // A pre-flip row whose English was never filled in cannot be practised —
  // serving it would put an unanswerable card in the session.
  const items = result.body.items as QuizItem[];
  assertEquals(items.length, 1);
  assertEquals(items[0].expected_english, "You're doing a great job");
});

Deno.test("generate-set-phrase-quiz does not call the model when distractors are cached", async () => {
  const result = await withRandom(0.9, () =>
    call("generate-set-phrase-quiz", { dialect: "Gulf" }, quizUpstreams()));

  assertEquals(result.status, 200);
  assertEquals(result.calls.filter((url) => url.includes("gateway")).length, 0);
});

Deno.test("generate-set-phrase-quiz generates and caches missing distractors", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf" },
      quizUpstreams({
        "/rest/v1/set_phrases": (request) =>
          request.method === "PATCH"
            ? json([], 204)
            : json([scenarioPhrase({ scenario_english: null, cached_distractors: [] })]),
        "ai.gateway.lovable.dev": emitting({
          scenario_arabic: "زميلك تعب على مشروع كامل الأسبوع.",
          distractors: [
            { english: "Congratulations!", arabic: "مبروك" },
            { english: "My condolences.", arabic: "البقاء لله" },
            { english: "Enjoy your meal.", arabic: "بالعافية" },
          ],
        }),
      }),
    ));

  assertEquals(result.status, 200);
  const items = result.body.items as QuizItem[];
  assertEquals(items[0].prompt.arabic, "زميلك تعب على مشروع كامل الأسبوع.");

  // The generated set is written back, so the next learner reuses it.
  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/set_phrases") && c.method === "PATCH");
  assert(patch, "expected the generated distractors to be cached");
  const cached = JSON.parse(patch?.body ?? "{}") as Record<string, unknown>;
  assertEquals((cached.cached_distractors as unknown[]).length, 3);
});

Deno.test("generate-set-phrase-quiz asks for an Arabic scenario and English distractors", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Yemeni" },
      quizUpstreams({
        "/rest/v1/set_phrases": (request) =>
          request.method === "PATCH"
            ? json([], 204)
            : json([scenarioPhrase({ scenario_english: null, cached_distractors: [] })]),
        "ai.gateway.lovable.dev": emitting({
          scenario_arabic: "موقف.",
          distractors: [
            { english: "a", arabic: "أ" },
            { english: "b", arabic: "ب" },
            { english: "c", arabic: "ج" },
          ],
        }),
      }),
    ));

  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  // The learner reads the situation in their own language and produces the
  // English; the model must be told both halves of that.
  assertStringIncludes(prompt, "ENGLISH-phrase quizzes");
  assertStringIncludes(prompt, "authentic Yemeni Arabic only");
  assertStringIncludes(prompt, "REAL English phrases");
});

Deno.test("generate-set-phrase-quiz falls back to other phrases when generation fails", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf" },
      quizUpstreams({
        "/rest/v1/set_phrases": () =>
          json([
            scenarioPhrase({ scenario_english: null, cached_distractors: [] }),
            scenarioPhrase({
              id: "88888888-0000-4000-8000-000000000001",
              phrase_english: "Congratulations!",
              cached_distractors: [],
              scenario_english: null,
            }),
          ]),
        // No tool call, so the generator gives up and returns null.
        "ai.gateway.lovable.dev": () => chatCompletion("prose"),
      }),
    ));

  assertEquals(result.status, 200);
  const items = result.body.items as QuizItem[];
  // Distractors come from the other real phrases rather than from nothing, so
  // the question still has choices even with the model unavailable — and the
  // prompt degrades to a generic Arabic instruction rather than to nothing.
  assert(items[0].choices.length >= 2);
  assertEquals(items[0].choices.filter((c) => c.correct).length, 1);
  assertEquals(items[0].prompt.arabic, "اختر العبارة المناسبة.");
});

Deno.test("generate-set-phrase-quiz asks a reply question when the phrase has one", async () => {
  const result = await withRandom(0.1, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf" },
      quizUpstreams({
        "/rest/v1/set_phrases": () =>
          json([
            scenarioPhrase({
              reply_english: "Thanks, that means a lot",
              reply_arabic: "تسلم، هالكلام يفرح",
            }),
          ]),
      }),
    ));

  const items = result.body.items as QuizItem[];
  assertEquals(items[0].question_type, "reply");
  // The learner is shown the English opener and must produce the English reply.
  assertEquals(items[0].prompt.english, "You're doing a great job");
  assertEquals(items[0].expected_english, "Thanks, that means a lot");
});

Deno.test("generate-set-phrase-quiz marks a due card as a review", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf", length: 4 },
      quizUpstreams({
        "/rest/v1/user_set_phrases": () =>
          json([{ phrase_id: PHRASE, set_phrases: scenarioPhrase() }]),
        "/rest/v1/set_phrases": () => json([scenarioPhrase()]),
      }),
    ));

  const items = result.body.items as QuizItem[];
  // The same phrase is due and also in the candidate pool; it must appear once,
  // as a review, rather than twice.
  assertEquals(items.length, 1);
  assertEquals(items[0].is_due_review, true);
});

Deno.test("generate-set-phrase-quiz halves the session between review and new", async () => {
  const result = await withRandom(0.9, () =>
    call("generate-set-phrase-quiz", { dialect: "Gulf", length: 8 }, quizUpstreams()));

  assertEquals(result.status, 200);
  const dueQuery = result.calls.find((url) => url.includes("user_set_phrases")) ?? "";
  // Half the length, and only cards whose next_review_at has passed.
  assertStringIncludes(dueQuery, "limit=4");
  assertStringIncludes(dueQuery, "next_review_at=lte.");
});

Deno.test("generate-set-phrase-quiz narrows to one occasion when asked", async () => {
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf", occasionId: OCCASION },
      quizUpstreams(),
    ));

  assertEquals(result.status, 200);
  const candidates = result.calls.find(
    (url) => url.includes("/rest/v1/set_phrases") && url.includes("occasion_id"),
  );
  assertStringIncludes(candidates ?? "", `occasion_id=eq.${OCCASION}`);
});

Deno.test("generate-set-phrase-quiz asks only for published phrases in the dialect", async () => {
  const result = await withRandom(0.9, () =>
    call("generate-set-phrase-quiz", { dialect: "Egyptian" }, quizUpstreams()));

  const candidates = result.calls.find(
    (url) => url.includes("/rest/v1/set_phrases") && url.includes("dialect"),
  ) ?? "";
  assertStringIncludes(candidates, "dialect=eq.Egyptian");
  assertStringIncludes(candidates, "status=eq.published");
});

Deno.test("generate-set-phrase-quiz returns an empty session rather than an error", async () => {
  // Pinned, not fixed. With no published phrases for the dialect the function
  // answers 200 and `items: []` — the caller has to notice the empty array to
  // tell "nothing to practise" from "the deck has not been seeded".
  const result = await withRandom(0.9, () =>
    call(
      "generate-set-phrase-quiz",
      { dialect: "Gulf" },
      quizUpstreams({ "/rest/v1/set_phrases": () => json([]) }),
    ));

  assertEquals(result.status, 200);
  assertEquals(result.body.items, []);
});
