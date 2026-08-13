import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `phrase-of-the-day` — a content function with unusually deliberate failure
 * behaviour.
 *
 * It answers a model outage with **200 and a fallback flag** rather than an
 * error status, because it renders in a card on the home screen where a thrown
 * error would blank the page. That is easy to accidentally "fix" into ordinary
 * error handling, which is why it is asserted rather than assumed.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
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
