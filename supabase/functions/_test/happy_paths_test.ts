import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json } from "./upstreams.ts";

/**
 * What the core AI endpoints return when everything works.
 *
 * The existing sweeps establish a floor across all 84 — CORS, auth, a malformed
 * body, an upstream that says no — but a function can pass every one of those
 * and still return a shape the client cannot read. That failure is quiet: the
 * page renders an empty state, or a field reads `undefined`, and nothing is
 * logged anywhere.
 *
 * So these go the other way: a handful of functions the product depends on
 * every day, each driven end to end with a realistic model reply, asserting the
 * contract the client actually consumes. The pairing matters — `useTranslateText`
 * reads `sentences`, `TappableArabicText` reads `definition` and `uses`,
 * `PlacementQuiz` reads `questions` and `cefr_level`. A rename on either side
 * breaks the app and compiles cleanly.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/**
 * The Supabase side of a request that is allowed through.
 *
 * Almost every function here runs `enforceDailyCap` first, which resolves the
 * JWT and checks the subscription before the model is ever called. Subscribed,
 * so the cap is not what the test is about.
 */
function allowed(): Record<string, () => Response> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    // Telemetry tables the functions write to; nothing reads the result.
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/fanar_usage": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
  };
}

/** Answer every LLM gateway with one structured tool call. */
function modelReturns(payload: unknown): Record<string, () => Response> {
  const reply = () => chatCompletion(JSON.stringify(payload), payload);
  return {
    "ai.gateway.lovable.dev": reply,
    "openrouter.ai": reply,
    "api.openai.com": reply,
    "api.fanar.qa": reply,
    "router.huggingface.co": reply,
  };
}

/** Load, call, and always restore. */
async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, () => Response>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(jsonRequest(name, body));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Left empty; the assertion on status will carry the failure, and the
      // raw text is more useful than a parse error nobody can act on.
      parsed = { _unparseable: text.slice(0, 300) };
    }
    return { status: response.status, body: parsed };
  } finally {
    fn.restore();
  }
}

Deno.test("translate-text returns a sentence breakdown the page can render", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "How are you today?", dialect: "Gulf" },
    {
      ...allowed(),
      ...modelReturns({
        sentences: [
          {
            english: "How are you today?",
            arabic: "شخبارك اليوم؟",
            literal: "كيف انت اليوم؟",
            note: "تحية يومية عادية.",
          },
        ],
      }),
    },
  );

  assertEquals(status, 200);
  // src/hooks/useTranslateText.ts reads exactly these.
  assertEquals(body.detected_dialect, "Gulf");
  assertEquals(body.used_dialect, "Gulf");
  const sentences = body.sentences as Array<Record<string, string>>;
  assertEquals(sentences.length, 1);
  assertEquals(sentences[0].arabic, "شخبارك اليوم؟");
  assertEquals(sentences[0].literal, "كيف انت اليوم؟");
});

Deno.test("translate-text keeps the learner's English verbatim", async () => {
  const original = "Wanna grab a coffee?";
  const { body } = await call(
    "translate-text",
    { text: original, dialect: "Gulf" },
    {
      ...allowed(),
      ...modelReturns({
        sentences: [{ english: original, arabic: "تعال نشرب قهوة؟", literal: "تبي تاخذ قهوة؟" }],
      }),
    },
  );

  // The page renders this string as tappable words and saves them to My Words.
  // A model that quietly tidied the English would put words in the learner's
  // deck that they never read.
  const sentences = body.sentences as Array<Record<string, string>>;
  assertEquals(sentences[0].english, original);
});

Deno.test("translate-text refuses an empty passage without calling the model", async () => {
  const fn = await loadFunction("translate-text", { upstreams: allowed() });
  try {
    const response = await fn.handler(jsonRequest("translate-text", { text: "   " }));
    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, "missing_text");
    // Each model call costs money and quota; validation has to come first.
    assertEquals(fn.callsTo("ai.gateway.lovable.dev").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("translate-text refuses a passage past its limit", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "ا".repeat(4001) },
    allowed(),
  );

  assertEquals(status, 400);
  assertEquals(body.error, "text_too_long");
  assertEquals(body.limit, 4000);
});

Deno.test("translate-text reports an answer with no sentences rather than an empty success", async () => {
  const { status, body } = await call(
    "translate-text",
    { text: "شخبارك" },
    { ...allowed(), ...modelReturns({ detected_dialect: "Gulf", sentences: [] }) },
  );

  // A 200 with an empty array renders as a blank page under a "Detected: Gulf"
  // badge, which reads as the passage having contained nothing.
  assertEquals(status, 502);
  assertEquals(body.error, "empty_translation");
});

Deno.test("word-enrichment returns the gloss the popover shows", async () => {
  const { status, body } = await call(
    "word-enrichment",
    { word: "شخبارك", dialect: "Gulf", sentenceArabic: "شخبارك اليوم" },
    {
      ...allowed(),
      ...modelReturns({
        definition: "how are you",
        root: "خ ب ر",
        transliteration: "shakhbarak",
        uses: [{ arabic: "شخبار الأهل", english: "how is the family" }],
      }),
    },
  );

  assertEquals(status, 200);
  // TappableArabicText reads definition, root and transliteration onto the
  // saved flashcard, so these names are a contract with My Words.
  assertEquals(body.definition, "how are you");
  assertEquals(body.root, "خ ب ر");
  assertEquals(body.transliteration, "shakhbarak");
  assertEquals((body.uses as unknown[]).length, 1);
});

Deno.test("word-enrichment answers with nulls rather than missing keys", async () => {
  const { status, body } = await call(
    "word-enrichment",
    { word: "شخبارك", dialect: "Gulf" },
    { ...allowed(), ...modelReturns({ definition: "", root: "", transliteration: "", uses: [] }) },
  );

  assertEquals(status, 200);
  // The client does `out.root || undefined`; an absent key and a null behave
  // the same there, but an absent key would break a strict consumer later.
  assertEquals(body.definition, null);
  assertEquals(body.root, null);
  assertEquals(body.uses, []);
});

Deno.test("word-enrichment caps how many related uses it returns", async () => {
  const { body } = await call(
    "word-enrichment",
    { word: "شخبارك", dialect: "Gulf" },
    {
      ...allowed(),
      ...modelReturns({
        definition: "how are you",
        root: "خ ب ر",
        transliteration: "shakhbarak",
        uses: Array.from({ length: 12 }, (_, index) => ({
          arabic: `مثال${index}`,
          english: `example ${index}`,
        })),
      }),
    },
  );

  // The popover has room for a handful; an unbounded list would push the save
  // button off a phone screen.
  assert((body.uses as unknown[]).length <= 5);
});

Deno.test("grammar-drill returns questions with an answer key", async () => {
  const question = {
    question_arabic: "____ رحت السوق؟",
    question_english: "Did you go to the market?",
    grammar_point: "past tense",
    choices: [
      { text_arabic: "متى", text_english: "when" },
      { text_arabic: "وين", text_english: "where" },
    ],
    correct_index: 0,
    explanation: "متى asks about time.",
  };

  const { status, body } = await call(
    "grammar-drill",
    { dialect: "Gulf", level: "A2", concept: "past tense" },
    { ...allowed(), ...modelReturns({ questions: [question] }) },
  );

  assertEquals(status, 200);
  const questions = body.questions as Array<Record<string, unknown>>;
  assertEquals(questions.length, 1);
  // correct_index is the whole exercise; without it the page cannot mark an
  // answer and every attempt reads as wrong.
  assertEquals(questions[0].correct_index, 0);
  assertEquals(questions[0].explanation, "متى asks about time.");
});

Deno.test("placement-quiz generates a batch of questions", async () => {
  const question = {
    question_arabic: "سؤال",
    question_english: "question",
    skill_type: "vocabulary",
    difficulty: "B1",
    choices: [
      { text: "right", text_arabic: "صح" },
      { text: "wrong", text_arabic: "خطأ" },
    ],
    correct_index: 0,
  };

  const { status, body } = await call(
    "placement-quiz",
    { action: "generate", question_number: 0, history: [], dialect: "Gulf" },
    { ...allowed(), ...modelReturns({ questions: [question, question, question, question, question] }) },
  );

  assertEquals(status, 200);
  // The page requires a non-empty `questions` array to leave its intro screen;
  // anything else strands the learner on "Start Quiz".
  assert(Array.isArray(body.questions));
  assert((body.questions as unknown[]).length > 0);
});

/** `count` answers at one difficulty and skill. */
const answers = (count: number, correct: boolean, difficulty = "B1", skill = "vocabulary") =>
  Array.from({ length: count }, () => ({ correct, difficulty, skill_type: skill }));

/**
 * Scoring is deterministic and local — `calculateCEFR` weights each answer by
 * its difficulty and maps the ratio onto a CEFR band. No model is involved,
 * which is worth pinning on its own: the learner is staring at a spinner after
 * twenty questions, and a needless gateway call would make that slow and
 * subject to the daily cap.
 */
Deno.test("placement-quiz scores a perfect run at the top band", async () => {
  const { status, body } = await call(
    "placement-quiz",
    { action: "score", history: answers(20, true) },
    allowed(),
  );

  assertEquals(status, 200);
  assertEquals(body.cefr_level, "C2");
  assertEquals(body.confidence, 100);
});

Deno.test("placement-quiz scores a run with nothing right at the bottom band", async () => {
  const { body } = await call(
    "placement-quiz",
    { action: "score", history: answers(20, false) },
    allowed(),
  );

  assertEquals(body.cefr_level, "A1");
  assertEquals(body.confidence, 0);
});

Deno.test("placement-quiz puts a mixed run in the middle", async () => {
  // 12 of 20 right at one difficulty is a ratio of 0.6, which lands in B2.
  const { body } = await call(
    "placement-quiz",
    { action: "score", history: [...answers(12, true), ...answers(8, false)] },
    allowed(),
  );

  assertEquals(body.cefr_level, "B2");
  assertEquals(body.confidence, 60);
});

Deno.test("placement-quiz weights harder questions more heavily", async () => {
  // Half right, half wrong — but the right ones are C2 (weight 6) and the wrong
  // ones A1 (weight 1), so the ratio is 60/70 = 0.86 and the learner lands at
  // the top. Counting answers rather than weighting them would put the same run
  // at B1 and tell a strong learner to start over.
  const { body } = await call(
    "placement-quiz",
    {
      action: "score",
      history: [...answers(10, true, "C2"), ...answers(10, false, "A1")],
    },
    allowed(),
  );

  assertEquals(body.cefr_level, "C2");
});

Deno.test("placement-quiz names strengths and weaknesses per skill", async () => {
  const { body } = await call(
    "placement-quiz",
    {
      action: "score",
      history: [
        ...answers(8, true, "B1", "vocabulary"),
        ...answers(2, false, "B1", "vocabulary"),
        ...answers(1, true, "B1", "grammar"),
        ...answers(9, false, "B1", "grammar"),
      ],
    },
    allowed(),
  );

  // 80% on vocabulary is a strength (>= 70%); 10% on grammar is a weakness
  // (< 40%). These drive what the results screen tells the learner to work on.
  assertEquals(body.strengths, ["vocabulary"]);
  assertEquals(body.weaknesses, ["grammar"]);
});

Deno.test("placement-quiz always names at least one strength", async () => {
  // Every skill in the middle band: no strength, no weakness. An empty list
  // renders as a heading with nothing under it.
  const { body } = await call(
    "placement-quiz",
    {
      action: "score",
      history: [...answers(1, true, "B1"), ...answers(1, false, "B1")],
    },
    allowed(),
  );

  assertEquals(body.strengths, ["general_comprehension"]);
  assertEquals(body.weaknesses, []);
});

Deno.test("placement-quiz scores without calling a model", async () => {
  const fn = await loadFunction("placement-quiz", { upstreams: allowed() });
  try {
    const response = await fn.handler(
      jsonRequest("placement-quiz", { action: "score", history: answers(20, true) }),
    );
    assertEquals(response.status, 200);
    assertEquals(fn.callsTo("ai.gateway.lovable.dev").length, 0);
    assertEquals(fn.callsTo("openrouter.ai").length, 0);
  } finally {
    fn.restore();
  }
});

Deno.test("how-do-i-say returns translations wrapped in a success envelope", async () => {
  const { status, body } = await call(
    "how-do-i-say",
    { phrase: "بكم هذا؟", dialect: "Gulf" },
    {
      ...allowed(),
      ...modelReturns({
        translations: [
          {
            english: "How much is this?",
            arabic: "بكم هذا؟",
            phonetic_ar: "هاو متش إز ذس",
            naturalness: 5,
            isPreferred: true,
          },
        ],
        vocabulary: [],
        usageNotes_ar: "شائعة في المحلات.",
      }),
    },
  );

  assertEquals(status, 200);
  // Unlike its neighbours this one nests the payload under `result`, which is
  // the sort of inconsistency a test has to hold still.
  assertEquals(body.success, true);
  const result = body.result as Record<string, unknown>;
  assertEquals(result.phrase, "بكم هذا؟");
  assert(Array.isArray(result.translations));
});

Deno.test("reading-passage returns a passage under the key the page reads", async () => {
  const { status, body } = await call(
    "reading-passage",
    { dialect: "Gulf", difficulty: "beginner" },
    {
      ...allowed(),
      ...modelReturns({
        title: "في السوق",
        title_english: "At the market",
        body: "رحت السوق أمس.",
        translation: "I went to the market yesterday.",
        vocabulary: [],
        questions: [],
      }),
    },
  );

  assertEquals(status, 200);
  // `_timing` is diagnostic; `passage` is the contract.
  assert(body.passage !== undefined, "expected a `passage` key");
});

// ── placement-quiz: the trajectory (C4) ─────────────────────────────────────
// Scoring appends a server-written placement_history row — the Profile chart
// is real assessment history, never self-reported — and the history action
// reads it back for the card.

Deno.test("placement-quiz records the scored level in the trajectory", async () => {
  const fn = await loadFunction("placement-quiz", {
    upstreams: {
      ...allowed(),
      "/rest/v1/placement_history": () => json({}, 201),
    },
  });
  try {
    const response = await fn.handler(
      jsonRequest("placement-quiz", {
        action: "score",
        history: answers(20, true),
        // A regional label must fold onto the training dialect, same as
        // everywhere else in the pipeline.
        dialect: "Saudi",
      }),
    );
    assertEquals(response.status, 200);

    // The write is fire-and-forget (scoring never waits on bookkeeping), so
    // give it a beat to land before asserting.
    let insert: { url: string; body: string | null } | undefined;
    for (let attempt = 0; attempt < 100 && !insert; attempt++) {
      insert = fn.calls.find(
        (c) => c.url.includes("placement_history") && (c.body ?? "").length > 0,
      );
      if (!insert) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert(insert, "expected a placement_history insert");
    const row = (JSON.parse(insert.body ?? "[]") as Array<Record<string, unknown>>)[0];
    assertEquals(row.cefr_level, "C2");
    assertEquals(row.dialect, "Gulf");
    assertEquals(row.user_id, USER);
    assertEquals(row.confidence, 100);
  } finally {
    fn.restore();
  }
});

Deno.test("placement-quiz records no trajectory without a dialect", async () => {
  // The legacy score call (no dialect field) keeps working and writes nothing
  // rather than guessing a dialect for the chart.
  const fn = await loadFunction("placement-quiz", {
    upstreams: { ...allowed(), "/rest/v1/placement_history": () => json({}, 201) },
  });
  try {
    const response = await fn.handler(
      jsonRequest("placement-quiz", { action: "score", history: answers(10, true) }),
    );
    assertEquals(response.status, 200);
    assertEquals(
      fn.calls.filter((c) => c.url.includes("placement_history") && (c.body ?? "").length > 0).length,
      0,
    );
  } finally {
    fn.restore();
  }
});

Deno.test("placement-quiz hands back the caller's own trajectory", async () => {
  const fn = await loadFunction("placement-quiz", {
    upstreams: {
      ...allowed(),
      "/rest/v1/placement_history": () =>
        json([
          { dialect: "Gulf", cefr_level: "A2", confidence: 70, taken_at: "2026-05-01T00:00:00Z" },
          { dialect: "Gulf", cefr_level: "B1", confidence: 85, taken_at: "2026-08-01T00:00:00Z" },
        ]),
    },
  });
  try {
    const response = await fn.handler(jsonRequest("placement-quiz", { action: "history" }));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals((body.history as unknown[]).length, 2);
  } finally {
    fn.restore();
  }
});

Deno.test("placement-quiz refuses an anonymous trajectory read", async () => {
  const fn = await loadFunction("placement-quiz", {
    upstreams: { ...allowed(), "/auth/v1/user": () => json({}, 401) },
  });
  try {
    const response = await fn.handler(
      jsonRequest("placement-quiz", { action: "history" }, { jwt: null }),
    );
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});
