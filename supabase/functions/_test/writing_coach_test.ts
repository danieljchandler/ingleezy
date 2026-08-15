import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `writing-coach` — written production (C3), post-flip.
 *
 * The learner now writes ENGLISH and is corrected in English, with every
 * explanation in their dialect. Two contracts worth pinning. The review is a
 * correction of what the LEARNER wrote — so the function must refuse input it
 * cannot coach (no English in it, or an essay-sized wall) before spending a
 * model call, and every correction the model returns must land in
 * `learner_errors` with source "writing" so written mistakes drill back like
 * spoken ones. And the cap: this is an AI feature with a free tier, so the
 * ladder is part of the contract.
 */

const USER = "00000000-0000-4000-8000-000000000001";

const review = {
  understandable: true,
  verdict_arabic: "حلو — بس تصحيحين صغار.",
  corrected_english: "I went to the market yesterday.",
  corrected_arabic: "رحت السوق أمس.",
  corrections: [
    {
      original: "I go to market",
      corrected: "I went to the market",
      kind: "verb_tense",
      explanation: "أمس معناها ماضي، فالفعل لازم يكون went.",
    },
    {
      original: "market",
      corrected: "the market",
      kind: "article",
      explanation: "الإنجليزي يبي أداة تعريف هنا، والعربي ما يبيها.",
    },
  ],
  tips: ["خلّها قصيرة مثل رسالة حقيقية."],
};

const prompt = {
  scenario_arabic: "صاحبك يرتب لنهاية الأسبوع.",
  message_english: "hey, what do you think about heading to the beach tomorrow?",
  message_arabic: "هلا، وش رايك نروح البحر بكرة؟",
};

const emitting = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => chatCompletion("", payload),
  "openrouter.ai": () => chatCompletion("", payload),
});

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/learner_errors": () => json({}, 201),
    // learnerPromptBlock's profile queries (prompt action only).
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/profiles": () => json(null),
    "/rest/v1/user_concept_mastery": () => json([]),
    ...emitting(review),
    ...extra,
  };
}

async function call(
  body: unknown,
  routes: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("writing-coach", { upstreams: routes });
  try {
    const response = await fn.handler(
      jsonRequest("writing-coach", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

/** Rows POSTed to learner_errors, parsed. */
function recordedErrors(result: {
  calls: string[];
  methods: string[];
  bodies: Array<string | null>;
}): Array<Record<string, unknown>> {
  const found = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("learner_errors") && c.method === "POST");
  if (!found?.body) return [];
  const parsed = JSON.parse(found.body) as unknown;
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [parsed as Record<string, unknown>];
}

const englishReply = { action: "review", dialect: "Gulf", text: "I go to market yesterday" };

Deno.test("writing-coach answers the preflight", async () => {
  const fn = await loadFunction("writing-coach", { upstreams: upstreams() });
  try {
    const response = await fn.handler(optionsRequest("writing-coach"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("writing-coach asks an anonymous caller to sign in", async () => {
  const result = await call(englishReply, upstreams(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("writing-coach counts against the free-tier daily cap", async () => {
  const result = await call(
    englishReply,
    upstreams({
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(11),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});

// ── Input gates ─────────────────────────────────────────────────────────────

Deno.test("writing-coach refuses a reply with no English in it", async () => {
  // The point of the exercise is producing English. A reply typed entirely in
  // Arabic has nothing to correct, and coaching it would quietly turn the
  // feature back into the Arabic-writing trainer it used to be.
  const result = await call(
    { action: "review", dialect: "Gulf", text: "ماذا رأيك نذهب غدا" },
    upstreams(),
  );

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "not_english");
  // Refused before the model was asked.
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("writing-coach refuses an essay-sized submission", async () => {
  const result = await call(
    { action: "review", dialect: "Gulf", text: "house ".repeat(200) },
    upstreams(),
  );

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "too_long");
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("writing-coach refuses an unknown action", async () => {
  const result = await call({ action: "grade_my_life", dialect: "Gulf" }, upstreams());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "unknown_action");
});

// ── Review ──────────────────────────────────────────────────────────────────

Deno.test("writing-coach returns the structured review", async () => {
  const result = await call(englishReply, upstreams());

  assertEquals(result.status, 200);
  const returned = result.body.review as Record<string, unknown>;
  assertEquals(returned.corrected_english, review.corrected_english);
  assertEquals(returned.corrected_arabic, review.corrected_arabic);
  assertEquals((returned.corrections as unknown[]).length, 2);
});

Deno.test("writing-coach records each correction as a writing error", async () => {
  const result = await call(englishReply, upstreams());

  assertEquals(result.status, 200);
  const rows = recordedErrors(result);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].source, "writing");
  assertEquals(rows[0].user_id, USER);
  assertEquals(rows[0].dialect, "Gulf");
  // target is what it should be; produced is what the learner typed.
  assertEquals(rows[0].target_arabic, "I went to the market");
  assertEquals(rows[0].produced_arabic, "I go to market");
  assertEquals(rows[0].error_kind, "verb_tense");
  assertEquals(rows[1].error_kind, "article");
});

Deno.test("writing-coach records nothing for a clean reply", async () => {
  const result = await call(
    englishReply,
    upstreams(emitting({ ...review, corrections: [] })),
  );

  assertEquals(result.status, 200);
  assertEquals(recordedErrors(result).length, 0);
});

Deno.test("writing-coach folds an off-list correction kind to other", async () => {
  const result = await call(
    englishReply,
    upstreams(
      emitting({
        ...review,
        corrections: [{ original: "go", corrected: "went", kind: "vibes", explanation: "x" }],
      }),
    ),
  );

  assertEquals(recordedErrors(result)[0].error_kind, "other");
});

Deno.test("writing-coach passes the learner's text and the prompt to the model", async () => {
  const result = await call(
    { ...englishReply, promptEnglish: "wanna head to the beach?" },
    upstreams(),
  );

  const gateway = result.calls.findIndex((u) => u.includes("gateway") || u.includes("openrouter"));
  const sent = result.bodies[gateway] ?? "";
  assertStringIncludes(sent, "I go to market yesterday");
  assertStringIncludes(sent, "wanna head to the beach?");
});

Deno.test("writing-coach reports a model failure without leaking a 500", async () => {
  const result = await call(
    englishReply,
    upstreams({
      "ai.gateway.lovable.dev": () => json({ error: "down" }, 503),
      "openrouter.ai": () => json({ error: "down" }, 503),
    }),
  );

  assertEquals(result.status, 502);
  assertEquals(result.body.error, "coach_failed");
});

// ── Prompt ──────────────────────────────────────────────────────────────────

Deno.test("writing-coach hands back a message to reply to", async () => {
  const result = await call(
    { action: "prompt", dialect: "Egyptian" },
    upstreams(emitting(prompt)),
  );

  assertEquals(result.status, 200);
  const returned = result.body.prompt as Record<string, unknown>;
  assertEquals(returned.message_english, prompt.message_english);
  assertEquals(returned.message_arabic, prompt.message_arabic);
  assert(String(returned.scenario_arabic).length > 0);
});

Deno.test("writing-coach asks for a text message, not an essay", async () => {
  const result = await call({ action: "prompt", dialect: "Gulf" }, upstreams(emitting(prompt)));

  const gateway = result.calls.findIndex((u) => u.includes("gateway") || u.includes("openrouter"));
  const sent = result.bodies[gateway] ?? "";
  assertStringIncludes(sent, "WhatsApp");
  assertStringIncludes(sent, "Gulf");
});
