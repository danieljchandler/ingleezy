import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * Souq News — real regional headlines retold in easy spoken English, plus a
 * quiz on them.
 *
 * `souq-news` is the app's only function that reaches out to the open web. It
 * searches Firecrawl for the learner's own region — familiar events carrying
 * unfamiliar language — then rewrites up to four articles in parallel through
 * the model into simple English with a dialect-Arabic scaffold. Because the
 * articles are independent, *partial* success is the normal outcome: one
 * article failing to parse must not cost the other three, but every article
 * failing for the same reason has to surface as that reason rather than as an
 * empty feed.
 *
 * The JSON repair pass survives the flip. The English is the story now, but
 * the model is still writing Arabic scaffold values and still reaches for an
 * Arabic comma `،` as a JSON separator, which is a parse error — so a failed
 * parse is retried with those characters swapped for their ASCII equivalents
 * before the article is given up on.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

/** Firecrawl's search result, in the shape the function reads. */
const firecrawl = (titles: string[]): UpstreamHandler => () =>
  json({
    success: true,
    data: titles.map((title, i) => ({
      title,
      url: `https://news.test/${i}`,
      markdown: `Full text of ${title}.`,
    })),
  });

const aRetelling = (over: Record<string, unknown> = {}) => ({
  title_english: "Prices are up again",
  body_english: "Did you see the prices today? They went up again.",
  sentences: [
    {
      english: "Did you see the prices today?",
      arabic: "شفت الأسعار اليوم؟",
      literal: "هل شفت الأسعار اليوم؟",
    },
    {
      english: "They went up again.",
      arabic: "طلعت مرة ثانية.",
      literal: "هم طلعوا فوق مرة ثانية.",
    },
  ],
  title_arabic: "الأسعار طالعة مرة ثانية",
  summary_arabic: "الأسعار ارتفعت مرة ثانية هالأسبوع.",
  vocabulary: [{ english: "prices", arabic: "أسعار" }],
  ...over,
});

/** The rewrite model, which answers a JSON object as prose. */
const retelling = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(typeof payload === "string" ? payload : JSON.stringify(payload));

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  env?: Record<string, string | undefined>,
) {
  const fn = await loadFunction(name, { upstreams, env });
  try {
    const response = await fn.handler(jsonRequest(name, body));
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

// ── souq-news ───────────────────────────────────────────────────────────────

Deno.test("souq-news retells the headlines it found", async () => {
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["Prices rise across the Gulf"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  assertEquals(status, 200);
  const articles = body.articles as Array<Record<string, unknown>>;
  assertEquals(articles.length, 1);
  assertEquals(articles[0].title_english, "Prices are up again");
  // The source is carried through, because a retelling without a link back is
  // a rumour rather than news.
  assertEquals(articles[0].source_url, "https://news.test/0");
});

Deno.test("souq-news widens its time window until it finds something", async () => {
  let attempt = 0;
  const { status, calls, bodies } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": () => {
        attempt += 1;
        // Nothing today, nothing this week, something eventually.
        return attempt < 3
          ? json({ success: true, data: [] })
          : json({ success: true, data: [{ title: "Older news", url: "https://news.test/0", markdown: "Text." }] });
      },
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  assertEquals(status, 200);
  const searches = calls
    .map((url, i) => ({ url, body: bodies[i] }))
    .filter((c) => c.url.includes("firecrawl"));
  assertEquals(searches.length, 3);
  // Today first, then this week, then unrestricted — a quiet news day should
  // still produce a feed rather than an empty page.
  assertStringIncludes(searches[0].body ?? "", "qdr:d");
  assertStringIncludes(searches[1].body ?? "", "qdr:w");
  assert(!(searches[2].body ?? "").includes("qdr:"));
});

Deno.test("souq-news stops searching once it has articles", async () => {
  const { calls } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["Today's news"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  assertEquals(calls.filter((u) => u.includes("firecrawl")).length, 1);
});

Deno.test("souq-news answers an empty feed rather than an error on a quiet day", async () => {
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": () => json({ success: true, data: [] }),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  // Genuinely finding nothing is not a failure, and the page has an empty
  // state for it.
  assertEquals(status, 200);
  assertEquals(body.articles, []);
});

Deno.test("souq-news reads whichever envelope Firecrawl used", async () => {
  for (
    const payload of [
      { data: [{ title: "A", url: "u", markdown: "m" }] },
      { data: { web: [{ title: "A", url: "u", markdown: "m" }] } },
      { web: [{ title: "A", url: "u", markdown: "m" }] },
    ]
  ) {
    const { body } = await call(
      "souq-news",
      { dialect: "Gulf" },
      caller({
        "api.firecrawl.dev": () => json(payload),
        "ai.gateway.lovable.dev": retelling(aRetelling()),
      }),
    );

    // Firecrawl has moved its results between three shapes across API
    // versions. Reading one leaves the feed permanently empty after an
    // upstream change nobody here controls.
    assertEquals((body.articles as unknown[]).length, 1, JSON.stringify(payload));
  }
});

Deno.test("souq-news rewrites at most four stories", async () => {
  const { body, calls } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A", "B", "C", "D", "E", "F"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  // One model call per article. The cap is what keeps a good news day from
  // costing six rewrites for a page that shows four.
  assertEquals(calls.filter((u) => u.includes("chat/completions")).length, 4);
  assertEquals((body.articles as unknown[]).length, 4);
});

Deno.test("souq-news keeps the articles that worked when one fails to parse", async () => {
  let attempt = 0;
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A", "B"]),
      "ai.gateway.lovable.dev": () => {
        attempt += 1;
        return attempt === 1
          ? chatCompletion("I would rather not.")
          : chatCompletion(JSON.stringify(aRetelling()));
      },
    }),
  );

  // The articles are independent. One unparsable rewrite costing the other
  // three would turn a common model hiccup into an empty feed.
  assertEquals(status, 200);
  assertEquals((body.articles as unknown[]).length, 1);
});

Deno.test("souq-news repairs Arabic punctuation used as JSON separators", async () => {
  const withArabicCommas = JSON.stringify(aRetelling()).replace(/","/g, '"،"');
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A"]),
      "ai.gateway.lovable.dev": retelling(withArabicCommas),
    }),
  );

  // The model is writing Arabic and reaches for `،` where JSON needs `,`. It is
  // the single most common way a perfectly good retelling is thrown away, so
  // the parse is retried with the Arabic punctuation swapped out.
  assertEquals(status, 200);
  assertEquals((body.articles as unknown[]).length, 1);
});

Deno.test("souq-news strips markdown fences from the rewrite", async () => {
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A"]),
      "ai.gateway.lovable.dev": retelling("```json\n" + JSON.stringify(aRetelling()) + "\n```"),
    }),
  );

  assertEquals(status, 200);
  assertEquals((body.articles as unknown[]).length, 1);
});

Deno.test("souq-news asks for spoken English with a dialect scaffold", async () => {
  const { bodies, calls } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  const prompt = bodies[i] ?? "";
  // The retelling is the learner's reading task, so its register is a prompt
  // requirement: natural spoken English, never textbook stiffness, with each
  // sentence's dialect translation and a word-order gloss riding along — and
  // the scaffold must be dialect, not the MSA a model defaults to.
  assertStringIncludes(prompt, "spoken English");
  assertStringIncludes(prompt, "literal");
  assertStringIncludes(prompt, "NEVER Modern Standard Arabic");
  assert(!prompt.includes("fully vocalized"));
});

Deno.test("souq-news searches the region matching the dialect", async () => {
  const gulf = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );
  const egyptian = await call(
    "souq-news",
    { dialect: "Egyptian" },
    caller({
      "api.firecrawl.dev": firecrawl(["A"]),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  const queryOf = (r: typeof gulf) =>
    r.bodies[r.calls.findIndex((u) => u.includes("firecrawl"))] ?? "";
  // An Egyptian learner reading Gulf headlines is being taught the wrong place
  // as well as the wrong dialect.
  assert(queryOf(gulf) !== queryOf(egyptian));
});

Deno.test("souq-news reports exhausted credits even when some articles worked", async () => {
  let attempt = 0;
  const { status, body } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A", "B"]),
      "ai.gateway.lovable.dev": () => {
        attempt += 1;
        return attempt === 1
          ? json({ error: "no credits" }, 402)
          : chatCompletion(JSON.stringify(aRetelling()));
      },
    }),
  );

  // Credits are an all-or-nothing operator problem: a partial feed today
  // becomes no feed tomorrow, so it is surfaced rather than papered over with
  // whatever happened to succeed.
  assertEquals(status, 402);
  assertStringIncludes(String(body.error), "credits exhausted");
});

Deno.test("souq-news reports a rate limit only when nothing survived", async () => {
  let attempt = 0;
  const partial = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A", "B"]),
      "ai.gateway.lovable.dev": () => {
        attempt += 1;
        return attempt === 1
          ? json({ error: "slow down" }, 429)
          : chatCompletion(JSON.stringify(aRetelling()));
      },
    }),
  );

  const total = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": firecrawl(["A", "B"]),
      "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429),
    }),
  );

  // Unlike credits, a rate limit clears on its own. One article getting
  // through is a usable page; none is not.
  assertEquals(partial.status, 200);
  assertEquals((partial.body.articles as unknown[]).length, 1);
  assertEquals(total.status, 429);
});

Deno.test("souq-news passes a failed search's status through", async () => {
  const { status, body, calls } = await call(
    "souq-news",
    { dialect: "Gulf" },
    caller({
      "api.firecrawl.dev": () => new Response("quota", { status: 429 }),
      "ai.gateway.lovable.dev": retelling(aRetelling()),
    }),
  );

  assertEquals(status, 429);
  assertStringIncludes(String(body.error), "Failed to fetch news articles");
  // Given up on immediately rather than retried through the widening windows —
  // a refused search will refuse the next one too.
  assertEquals(calls.filter((u) => u.includes("firecrawl")).length, 1);
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("souq-news names each missing key", async () => {
  for (
    const [key, message] of [
      ["FIRECRAWL_API_KEY", "Firecrawl not configured"],
      ["LOVABLE_API_KEY", "AI gateway not configured"],
    ] as const
  ) {
    const { status, body, calls } = await call(
      "souq-news",
      { dialect: "Gulf" },
      caller({
        "api.firecrawl.dev": firecrawl(["A"]),
        "ai.gateway.lovable.dev": retelling(aRetelling()),
      }),
      { [key]: undefined },
    );

    // Both are checked before anything is fetched, and they are named
    // separately — this feature has two independent third-party dependencies
    // and "not configured" alone would not say which.
    assertEquals(status, 500);
    assertEquals(body.error, message);
    assert(!calls.some((u) => u.includes("firecrawl")));
  }
});

// ── souq-news-quiz ──────────────────────────────────────────────────────────

const aQuestion = (over: Record<string, unknown> = {}) => ({
  question_english: "What happened to the prices?",
  question_arabic: "وش صار للأسعار؟",
  choices: [
    { english: "they rose", arabic: "طالعة", correct: true },
    { english: "they fell", arabic: "نازلة", correct: false },
    { english: "unchanged", arabic: "ثابتة", correct: false },
    { english: "unknown", arabic: "ما أدري", correct: false },
  ],
  explanation: "المقال يقول إن الأسعار طلعت مرة ثانية.",
  ...over,
});

const anArticle = {
  title_english: "Prices are up",
  body_english: "Did you see the prices today? They went up again.",
  title_arabic: "الأسعار طالعة",
  summary_arabic: "الأسعار ارتفعت مرة ثانية.",
  dialect: "Gulf",
};

Deno.test("souq-news-quiz builds questions from the article", async () => {
  const { status, body, bodies, calls } = await call(
    "souq-news-quiz",
    anArticle,
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", { questions: [aQuestion()] }),
    }),
  );

  assertEquals(status, 200);
  assertEquals((body.questions as unknown[]).length, 1);
  const i = calls.findIndex((u) => u.includes("chat/completions"));
  // Both the English body and the Arabic summary go in: the questions are in
  // English but the dialect glosses need the Arabic the learner already saw.
  assertStringIncludes(bodies[i] ?? "", "Did you see the prices today");
  assertStringIncludes(bodies[i] ?? "", "الأسعار ارتفعت مرة ثانية");
});

Deno.test("souq-news-quiz refuses a request with no article body", async () => {
  const { status, body, calls } = await call(
    "souq-news-quiz",
    { ...anArticle, body_english: undefined },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", { questions: [aQuestion()] }),
    }),
  );

  // There is nothing to comprehend. A quiz generated from a headline alone
  // tests guessing.
  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "body_english is required");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("souq-news-quiz asks for English questions with dialect glosses", async () => {
  const { bodies, calls } = await call(
    "souq-news-quiz",
    anArticle,
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("", { questions: [aQuestion()] }),
    }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  const prompt = bodies[i] ?? "";
  // The learner just read the article in English, so the questions are the
  // same reading task — and the Arabic riding along must be their dialect,
  // not the MSA a model defaults to.
  assertStringIncludes(prompt, "ENGLISH");
  assertStringIncludes(prompt, "never MSA");
});

Deno.test("souq-news-quiz preserves a rate limit", async () => {
  const { status, body } = await call(
    "souq-news-quiz",
    anArticle,
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "slow" }, 429),
      "openrouter.ai": () => json({ error: "slow" }, 429),
    }),
  );

  assertEquals(status, 429);
  assertStringIncludes(String(body.error), "Rate limit exceeded");
});

Deno.test("souq-news-quiz reports any other failure as a generation failure", async () => {
  const { status, body } = await call(
    "souq-news-quiz",
    anArticle,
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  assertEquals(status, 503);
  assertEquals(body.error, "Quiz generation failed");
});
