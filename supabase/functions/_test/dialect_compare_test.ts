import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `dialect-compare` — one word across five Arabic varieties.
 *
 * Everything the page renders comes back in one tool call, and the function
 * validates it hard before answering. That validation is the whole substance:
 * a comparison missing its Arabic, or carrying variants with no word in them,
 * renders as a row of blanks that looks like the dialects have no word for the
 * thing — which is precisely the wrong lesson. So an unusable answer is a 502
 * the page can report rather than a 200 it would draw.
 *
 * It also falls back from the tool call to salvaging JSON out of the message
 * content, because a model told to use a tool sometimes writes the JSON in prose
 * instead, and throwing that away costs the learner a request for no reason.
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

const aVariant = (over: Record<string, unknown> = {}) => ({
  dialect: "Gulf Arabic",
  country: "UAE",
  word: "شلونك",
  transliteration: "shlonak",
  pronunciation_notes: "Soft ش.",
  usage_context: "Casual greeting.",
  formality: "casual",
  ...over,
});

const aComparison = (over: Record<string, unknown> = {}) => ({
  word_arabic: "كيف حالك",
  word_english: "How are you?",
  common_root: "ح و ل",
  cultural_notes: "Gulf speakers answer with a blessing.",
  dialects: [aVariant(), aVariant({ dialect: "Egyptian Arabic", word: "ازيك" })],
  ...over,
});

/** The model answers through the tool call. */
const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("dialect-compare", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("dialect-compare", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

Deno.test("dialect-compare returns the comparison under a singular key", async () => {
  const { status, body } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
  );

  assertEquals(status, 200);
  // `comparison`, not `comparisons`. The page stores it whole, so a plural or
  // a list would set the result to undefined and render as if nothing had been
  // asked.
  const comparison = body.comparison as Record<string, unknown>;
  assertEquals(comparison.word_arabic, "كيف حالك");
  assertEquals((comparison.dialects as unknown[]).length, 2);
});

Deno.test("dialect-compare asks for all five varieties in a fixed order", async () => {
  const { bodies, calls } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  const prompt = bodies[i] ?? "";
  // The order is what makes two comparisons readable side by side, and MSA
  // last is deliberate — the point is what people say, with the textbook form
  // as the contrast rather than the anchor.
  for (const variety of ["Gulf Arabic", "Egyptian Arabic", "Levantine", "Yemeni", "Modern Standard"]) {
    assertStringIncludes(prompt, variety);
  }
});

Deno.test("dialect-compare tells the model which row matters most", async () => {
  const { bodies, calls } = await call(
    { word: "كيف حالك", source_dialect: "Egyptian" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  // The learner's own dialect is the row they will actually use; the rest is
  // context.
  assertStringIncludes(bodies[i] ?? "", "The learner's own dialect is Egyptian");
});

Deno.test("dialect-compare warns the model off repeating the MSA form", async () => {
  const { bodies, calls } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
  );

  const i = calls.findIndex((u) => u.includes("chat/completions"));
  // The characteristic failure of this feature: five rows that all say the
  // same MSA word, which teaches that the dialects are identical.
  assertStringIncludes(bodies[i] ?? "", "do NOT just repeat the MSA form");
});

Deno.test("dialect-compare drops variants with no word in them", async () => {
  const { body } = await call(
    { word: "كيف حالك" },
    caller({
      "ai.gateway.lovable.dev": emitting(
        aComparison({
          dialects: [
            aVariant(),
            { dialect: "Levantine Arabic", country: "Lebanon" },
            { word: "ازيك" },
            "not an object",
          ],
        }),
      ),
    }),
  );

  const comparison = body.comparison as { dialects: unknown[] };
  // A row with a name and no word renders as a dialect that apparently has no
  // way to say this — the opposite of the point.
  assertEquals(comparison.dialects.length, 1);
});

Deno.test("dialect-compare fills the optional fields rather than leaving them undefined", async () => {
  const { body } = await call(
    { word: "كيف حالك" },
    caller({
      "ai.gateway.lovable.dev": emitting(
        aComparison({
          dialects: [{ dialect: "Gulf Arabic", word: "شلونك" }],
        }),
      ),
    }),
  );

  const comparison = body.comparison as {
    dialects: Array<Record<string, unknown>>;
  };
  // Country and transliteration are rendered unconditionally, so an absent one
  // would print "undefined" under the word.
  assertEquals(comparison.dialects[0].country, "");
  assertEquals(comparison.dialects[0].transliteration, "");
  // The genuinely optional ones stay absent, so the page can omit their rows.
  assertEquals(comparison.dialects[0].pronunciation_notes, undefined);
  assertEquals(comparison.dialects[0].usage_context, undefined);
});

Deno.test("dialect-compare omits a non-string cultural note", async () => {
  const { body } = await call(
    { word: "كيف حالك" },
    caller({
      "ai.gateway.lovable.dev": emitting(
        aComparison({ cultural_notes: { text: "wrong shape" }, common_root: 42 }),
      ),
    }),
  );

  const comparison = body.comparison as Record<string, unknown>;
  assertEquals(comparison.cultural_notes, undefined);
  assertEquals(comparison.common_root, undefined);
});

Deno.test("dialect-compare salvages JSON the model wrote as prose", async () => {
  const { status, body } = await call(
    { word: "كيف حالك" },
    caller({
      "ai.gateway.lovable.dev": () =>
        chatCompletion("Here you go:\n" + JSON.stringify(aComparison())),
    }),
  );

  // A model told to use a tool sometimes writes the JSON in the message
  // instead. Throwing that away costs the learner a request for no reason.
  assertEquals(status, 200);
  assertEquals((body.comparison as { dialects: unknown[] }).dialects.length, 2);
});

Deno.test("dialect-compare refuses an answer with no usable dialects", async () => {
  for (
    const payload of [
      aComparison({ dialects: [] }),
      aComparison({ dialects: [{ dialect: "Gulf Arabic" }] }),
      aComparison({ word_arabic: undefined }),
      aComparison({ dialects: "not an array" }),
      { nothing: true },
    ]
  ) {
    const { status, body } = await call(
      { word: "كيف حالك" },
      caller({ "ai.gateway.lovable.dev": emitting(payload) }),
    );

    // 502 rather than a 200 the page would draw as a row of blanks. A learner
    // seeing empty cells reads it as "these dialects have no word for this".
    assertEquals(status, 502, JSON.stringify(payload).slice(0, 80));
    assertStringIncludes(String(body.error), "Couldn't build a reliable comparison");
  }
});

Deno.test("dialect-compare refuses a request with no word", async () => {
  for (const word of [undefined, "", 42, null]) {
    const { status, body, calls } = await call(
      { word },
      caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(word)} to be refused`);
    assertEquals(body.error, "Word or phrase required");
    assert(!calls.some((u) => u.includes("chat/completions")));
  }
});

Deno.test("dialect-compare preserves a rate limit", async () => {
  const { status, body } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "slow" }, 429) }),
  );

  assertEquals(status, 429);
  assertStringIncludes(String(body.error), "Rate limited");
});

Deno.test("dialect-compare preserves exhausted credits", async () => {
  const { status, body } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "no credits" }, 402) }),
  );

  assertEquals(status, 402);
  assertStringIncludes(String(body.error), "AI credits exhausted");
});

Deno.test("dialect-compare flattens any other gateway failure to 500", async () => {
  const { status } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": () => json({ error: "boom" }, 503) }),
  );

  assertEquals(status, 500);
});

Deno.test("dialect-compare says so when its key is missing", async () => {
  const { status, body, calls } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
    { env: { LOVABLE_API_KEY: undefined } },
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "LOVABLE_API_KEY");
  assert(!calls.some((u) => u.includes("chat/completions")));
});

Deno.test("dialect-compare turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    { word: "كيف حالك" },
    caller({ "ai.gateway.lovable.dev": emitting(aComparison()) }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((u) => u.includes("chat/completions")));
});
