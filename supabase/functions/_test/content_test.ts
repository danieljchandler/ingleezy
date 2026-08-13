import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `bible-passage` and `phrase-of-the-day` — two content functions with
 * unusually deliberate failure behaviour.
 *
 * Bible is the only function in the app with a *role* check rather than a tier
 * check: `user_has_bible_access` is an RPC, and denial is a 403 rather than a
 * paywall. It also degrades in layers — the Arabic text is required, the
 * English is optional, and the dialect conversion is optional on top of that —
 * so "worked" and "failed" are not the only two outcomes.
 *
 * Phrase of the Day answers a model outage with **200 and a fallback flag**
 * rather than an error status, because it renders in a card on the home screen
 * where a thrown error would blank the page. Both of those are easy to
 * accidentally "fix" into ordinary error handling, which is why they are
 * asserted rather than assumed.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/rpc/user_has_bible_access": () => json(true),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/user_phrases": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    ...extra,
  };
}

/** bolls.life returns a flat verse array per chapter. */
const bolls = (verses: string[]): UpstreamHandler => () =>
  json(verses.map((text, i) => ({ verse: i + 1, text })));

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
      cors: response.headers.get("access-control-allow-origin"),
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

// ── bible-passage ───────────────────────────────────────────────────────────

const aChapter = { arabicVersion: "SVD", bookNumber: 1, chapter: 1, dialect: "Gulf" };

Deno.test("bible-passage returns Arabic, English and dialect side by side", async () => {
  const { status, body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "bolls.life": bolls(["في البدء خلق الله", "وكانت الأرض خربة"]),
      "ai.gateway.lovable.dev": emitting({
        verses: ["أول شي الله خلق", "والأرض كانت فاضية"],
      }),
    }),
  );

  assertEquals(status, 200);
  // Three parallel columns is the whole reading interface: the formal Arabic a
  // learner may already know, the dialect they are studying, and the English to
  // check themselves against.
  assertEquals((body.arabicVerses as string[]).length, 2);
  assertEquals((body.englishVerses as string[]).length, 2);
  assertEquals((body.dialectVerses as string[]).length, 2);
});

Deno.test("bible-passage numbers each verse", async () => {
  const { body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "bolls.life": bolls(["في البدء", "وكانت الأرض"]),
      "ai.gateway.lovable.dev": emitting({ verses: ["أول شي", "والأرض"] }),
    }),
  );

  const arabic = body.arabicVerses as string[];
  // Numbers are how a reader cross-references the three columns and how they
  // find a verse someone quoted at them.
  assertStringIncludes(arabic[0], "1");
  assertStringIncludes(arabic[1], "2");
});

Deno.test("bible-passage keeps going when the English fetch fails", async () => {
  let attempt = 0;
  const { status, body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "bolls.life": () => {
        attempt += 1;
        // Arabic first, English second.
        return attempt === 1
          ? json([{ verse: 1, text: "في البدء خلق الله" }])
          : new Response("gone", { status: 500 });
      },
      "ai.gateway.lovable.dev": emitting({ verses: ["أول شي الله خلق"] }),
    }),
  );

  assertEquals(status, 200);
  // The English is a convenience; the Arabic is the lesson. Blank strings keep
  // the columns aligned so verse 3 stays next to verse 3.
  assertEquals(body.englishVerses, [""]);
  assertEquals(body.fallback, true);
});

Deno.test("bible-passage falls back to the formal Arabic when conversion is unavailable", async () => {
  const { status, body } = await call(
    "bible-passage",
    aChapter,
    caller({ "bolls.life": bolls(["في البدء خلق الله"]) }),
    { env: { LOVABLE_API_KEY: undefined } },
  );

  assertEquals(status, 200);
  // Reading the formal text is still reading. The flag is what lets the page
  // say the dialect column is not really dialect.
  assertEquals(body.fallback, true);
  assertEquals(body.dialectVerses, body.arabicVerses);
});

Deno.test("bible-passage pads a short conversion with the formal verses", async () => {
  const { body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "bolls.life": bolls(["الأولى", "الثانية", "الثالثة"]),
      // The model returned two verses for a three-verse chapter.
      "ai.gateway.lovable.dev": emitting({ verses: ["واحد", "اثنين"] }),
    }),
  );

  const dialect = body.dialectVerses as string[];
  // Length is driven by the *source*, not by what came back — a short answer
  // would otherwise shift every later verse up one and silently misalign the
  // three columns.
  assertEquals(dialect.length, 3);
  assertEquals(dialect[2], (body.arabicVerses as string[])[2]);
});

Deno.test("bible-passage answers an unreachable Arabic source with a CORS-safe fallback", async () => {
  const { status, cors, body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "bolls.life": () => new Response("down", { status: 503 }),
      "ai.gateway.lovable.dev": emitting({ verses: [] }),
    }),
  );

  // 200 with `fallback: true`, and CORS headers on it. Without the headers this
  // response reached the browser un-CORSed, so a recoverable upstream 5xx
  // surfaced as a network error instead of the payload it was meant to deliver.
  assertEquals(status, 200);
  assert(cors);
  assertEquals(body.fallback, true);
  assertStringIncludes(String(body.error), "temporarily unavailable");
});

Deno.test("bible-passage refuses a reader without the role", async () => {
  const { status, body, calls } = await call(
    "bible-passage",
    aChapter,
    caller({
      "/rest/v1/rpc/user_has_bible_access": () => json(false),
      "bolls.life": bolls(["في البدء"]),
    }),
  );

  // 403, not a paywall. Bible access is a granted role rather than a purchased
  // tier, so there is nothing for the learner to buy.
  assertEquals(status, 403);
  assertStringIncludes(String(body.error), "do not have access");
  assert(!calls.some((url) => url.includes("bolls.life")));
});

Deno.test("bible-passage refuses when the access check itself fails", async () => {
  const { status, calls } = await call(
    "bible-passage",
    aChapter,
    caller({
      "/rest/v1/rpc/user_has_bible_access": () => json({ message: "boom" }, 500),
      "bolls.life": bolls(["في البدء"]),
    }),
  );

  // Fails closed. An unreadable permission check is not permission.
  assertEquals(status, 403);
  assert(!calls.some((url) => url.includes("bolls.life")));
});

Deno.test("bible-passage refuses a request with no token", async () => {
  const { status, body } = await call(
    "bible-passage",
    aChapter,
    caller({ "bolls.life": bolls(["في البدء"]) }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assertStringIncludes(String(body.error), "Authentication required");
});

Deno.test("bible-passage refuses a token that resolves to no user", async () => {
  const { status, body } = await call(
    "bible-passage",
    aChapter,
    caller({
      "/auth/v1/user": () => json({ message: "bad jwt" }, 401),
      "bolls.life": bolls(["في البدء"]),
    }),
  );

  assertEquals(status, 401);
  assertStringIncludes(String(body.error), "Invalid or expired token");
});

Deno.test("bible-passage refuses an incomplete reference", async () => {
  for (
    const body of [
      { bookNumber: 1, chapter: 1 },
      { arabicVersion: "SVD", chapter: 1 },
      { arabicVersion: "SVD", bookNumber: 1 },
    ]
  ) {
    const { status, calls } = await call(
      "bible-passage",
      body,
      caller({ "bolls.life": bolls(["في البدء"]) }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(body)} to be refused`);
    assert(!calls.some((url) => url.includes("bolls.life")));
  }
});

Deno.test("bible-passage defaults the English translation", async () => {
  const { calls } = await call(
    "bible-passage",
    { arabicVersion: "SVD", bookNumber: 1, chapter: 1 },
    caller({
      "bolls.life": bolls(["في البدء"]),
      "ai.gateway.lovable.dev": emitting({ verses: ["أول شي"] }),
    }),
  );

  // ESV unless asked otherwise, so a caller only has to name the Arabic edition
  // it wants.
  assert(calls.some((url) => url.includes("/ESV/")));
});

// ── phrase-of-the-day ───────────────────────────────────────────────────────

const aPhrase = {
  phrase_arabic: "الحين نطلع نتقهوى",
  phrase_english: "Let's go grab a coffee now",
  transliteration: "al-heen natla' nitgahwa",
  notes: "Said between friends in the late afternoon.",
};

Deno.test("phrase-of-the-day returns a phrase with its date and category", async () => {
  const { status, body } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );

  assertEquals(status, 200);
  assertEquals(body.phrase_arabic, "الحين نطلع نتقهوى");
  assertEquals(body.date, "2025-06-01");
  assert(body.category);
});

Deno.test("phrase-of-the-day gives the same phrase for the same day", async () => {
  const first = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );
  const second = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );

  // The category is chosen by hashing the seed, so "phrase of the *day*" means
  // the same category all day rather than a new one on every page load.
  assertEquals(first.body.category, second.body.category);
});

Deno.test("phrase-of-the-day gives different days different categories", async () => {
  const categories = new Set<unknown>();
  for (const seed of ["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04", "2025-06-05"]) {
    const { body } = await call(
      "phrase-of-the-day",
      { dialect: "Gulf", seed },
      caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
    );
    categories.add(body.category);
  }

  assert(categories.size > 1, "every day produced the same category");
});

Deno.test("phrase-of-the-day skips categories the learner already saw", async () => {
  // Whatever today's seed would have picked, ask it to avoid that one.
  const first = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );
  const second = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01", avoidCategories: [first.body.category] },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );

  // Refresh is meant to give something new; without this it would re-roll the
  // same hash and return the same category.
  assert(second.body.category !== first.body.category);
});

Deno.test("phrase-of-the-day honours an explicit category", async () => {
  const { body, bodies, calls } = await call(
    "phrase-of-the-day",
    {
      dialect: "Gulf",
      seed: "2025-06-01",
      category: "food_praise",
      avoidCategories: ["food_praise"],
    },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // An explicit request wins over the avoid list — the caller asked for it —
  // and the category's own prompt reaches the model rather than just its key.
  assertEquals(body.category, "food_praise");
  assertStringIncludes(bodies[i] ?? "", "praising or reacting to food");
});

Deno.test("phrase-of-the-day ignores a category it does not have", async () => {
  const { status, body } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf", seed: "2025-06-01", category: "underwater-basket-weaving" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  );

  // Falls back to the day's hash rather than interpolating an unknown key into
  // the prompt, which would ask the model for a phrase about nothing.
  assertEquals(status, 200);
  assert(body.category !== "underwater-basket-weaving");
});

Deno.test("phrase-of-the-day tells the model what not to repeat", async () => {
  const { bodies, calls } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": emitting(aPhrase),
      "/rest/v1/user_phrases": () =>
        json([
          { phrase_arabic: "شخبارك", phrase_english: "how are you" },
          { phrase_arabic: "يعطيك العافية", phrase_english: "thank you" },
        ]),
    }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  // A daily phrase that repeats last week's is worse than no phrase, and the
  // model has no memory of its own output.
  assertStringIncludes(sent, "DO NOT repeat");
  assertStringIncludes(sent, "شخبارك");
});

Deno.test("phrase-of-the-day still answers when the avoid list cannot be read", async () => {
  const { status, body } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": emitting(aPhrase),
      "/rest/v1/user_phrases": () => json({ message: "denied" }, 403),
    }),
  );

  // Repetition is a quality problem, not a correctness one.
  assertEquals(status, 200);
  assertEquals(body.phrase_arabic, "الحين نطلع نتقهوى");
});

Deno.test("phrase-of-the-day answers exhausted credits with 200 and a flag", async () => {
  const { status, body } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402),
      "openrouter.ai": () => json({ error: "no credits" }, 402),
    }),
  );

  // 200, deliberately. This renders in a card on the home screen, and a non-2xx
  // would surface as a thrown query — the home page would blank rather than
  // show one empty card.
  assertEquals(status, 200);
  assertEquals(body.error, "ai_credits_exhausted");
  assertEquals(body.fallback, true);
  assert(body.message);
});

Deno.test("phrase-of-the-day answers a rate limit the same way", async () => {
  const { status, body } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "slow down" }, 429),
      "openrouter.ai": () => json({ error: "slow down" }, 429),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.error, "rate_limited");
  assertEquals(body.fallback, true);
});

Deno.test("phrase-of-the-day reports anything else as a real failure", async () => {
  const { status } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({
      "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503),
      "openrouter.ai": () => json({ error: "boom" }, 503),
    }),
  );

  // The graceful 200 is reserved for the two conditions a learner can wait out.
  assertEquals(status, 500);
});

Deno.test("phrase-of-the-day works with no body at all", async () => {
  const fn = await loadFunction("phrase-of-the-day", {
    upstreams: caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
  });
  try {
    const response = await fn.handler(
      new Request("http://localhost/phrase-of-the-day", {
        method: "POST",
        headers: { origin: "https://ingleezy.app", authorization: "Bearer fixture" },
      }),
    );

    // Called on mount with nothing to say; the body parse is caught and
    // defaulted rather than throwing.
    assertEquals(response.status, 200);
    assertEquals((await response.json()).dialect, "Gulf");
  } finally {
    fn.restore();
  }
});

Deno.test("phrase-of-the-day needs no sign-in", async () => {
  const { status } = await call(
    "phrase-of-the-day",
    { dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": emitting(aPhrase) }),
    { jwt: null },
  );

  // Pinned. No `enforceDailyCap` and no auth check, so the home screen renders
  // it for signed-out visitors — and so can anyone else. One model call per
  // request, on the app's credits.
  assertEquals(status, 200);
});
