import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `hf-chat` and `learn-from-metric` — the two functions that talk to the AI
 * brain about the app itself rather than about a lesson.
 *
 * `hf-chat` is the raw brain endpoint: a capped, learner-facing passthrough
 * that returns the model's prose plus the brain's own telemetry, which is the
 * only place the strategy and MSA-repair counts are exposed to a caller.
 *
 * `learn-from-metric` closes the loop from the metrics dashboard: it takes a
 * flagged event and drafts dialect rules that would have prevented it. Its
 * clamping is the interesting part — priority, lengths and example counts are
 * all bounded before anything reaches the rulebook, because the rows it writes
 * go on to steer every other generation in the app.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/rpc/has_role": () => json(true),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

/**
 * The same tool call from either gateway.
 *
 * aiBrain picks between Lovable and OpenRouter by model, and which one it picks
 * is not the subject of these tests — routing only one of them made an
 * assertion about the clamped output silently read the *other* fixture.
 */
const bothGateways = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": emitting(payload),
  "openrouter.ai": emitting(payload),
});

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
      methods: fn.calls.map((c) => c.method),
    };
  } finally {
    fn.restore();
  }
}

// ── hf-chat ──────────────────────────────────────────────────────────────────

Deno.test("hf-chat answers the preflight", async () => {
  const fn = await loadFunction("hf-chat", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("hf-chat"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("hf-chat asks an anonymous caller to sign in", async () => {
  const result = await call("hf-chat", { prompt: "hello" }, caller(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("hf-chat needs a prompt", async () => {
  const result = await call("hf-chat", {}, caller());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "prompt is required");
});

Deno.test("hf-chat rejects a prompt that is not text", async () => {
  const result = await call("hf-chat", { prompt: { text: "hello" } }, caller());

  assertEquals(result.status, 400);
});

Deno.test("hf-chat returns the reply with the brain's own telemetry", async () => {
  const result = await call(
    "hf-chat",
    { prompt: "How do I say hello?", strategy: "solo" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("قل هلا"),
      "openrouter.ai": () => chatCompletion("قل هلا"),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.content, "قل هلا");
  const meta = result.body._meta as Record<string, unknown>;
  assertEquals(meta.strategy, "solo");
  assert(Array.isArray(meta.models));
  // The repair counters are what make a dialect regression visible from the
  // client rather than only in the function's logs.
  assertEquals(meta.msaRepairs, 0);
  assert(Array.isArray(meta.msaLeaks));
});

Deno.test("hf-chat passes the caller's dialect to the brain", async () => {
  const result = await call(
    "hf-chat",
    { prompt: "How do I say hello?", dialect: "Egyptian", strategy: "solo" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion("قول إزيك"),
      "openrouter.ai": () => chatCompletion("قول إزيك"),
    }),
  );

  assertEquals(result.status, 200);
  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "Egyptian");
});

Deno.test("hf-chat counts against the free-tier daily cap", async () => {
  const result = await call(
    "hf-chat",
    { prompt: "hello", strategy: "solo" },
    caller({
      // Free tier, and already over the 40-a-day allowance.
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(41),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
  assertEquals(result.body.upgrade_url, "/pricing");
});

Deno.test("hf-chat reports an empty reply rather than returning one", async () => {
  const result = await call(
    "hf-chat",
    { prompt: "hello", strategy: "solo" },
    caller({
      "ai.gateway.lovable.dev": () => chatCompletion(""),
      "openrouter.ai": () => chatCompletion(""),
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "Empty response from model");
});

// ── learn-from-metric ────────────────────────────────────────────────────────

const proposal = {
  rules: [
    {
      category: "lexis",
      rule: "Never use دلوقتي in Gulf output; use هالحين.",
      examples: { good: ["هالحين"], bad: ["دلوقتي"] },
      priority: 4,
      notes: "Seen in a leak report.",
    },
  ],
};

Deno.test("learn-from-metric answers the preflight", async () => {
  const fn = await loadFunction("learn-from-metric", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("learn-from-metric"));
    assertEquals(response.status, 200);
  } finally {
    fn.restore();
  }
});

Deno.test("learn-from-metric needs an Authorization header at all", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller(),
    { jwt: null },
  );

  assertEquals(result.status, 401);
});

Deno.test("learn-from-metric turns away a signed-in learner", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({ "/rest/v1/rpc/has_role": () => json(false) }),
  );

  assertEquals(result.status, 403);
});

Deno.test("learn-from-metric rejects a dialect it has no rulebook for", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Levantine" },
    caller(),
  );

  assertEquals(result.status, 400);
  assertStringIncludes(String(result.body.error ?? result.body.message ?? ""), "Gulf");
});

Deno.test("learn-from-metric needs to know which event it is learning from", async () => {
  const result = await call("learn-from-metric", { dialect: "Gulf" }, caller());

  assertEquals(result.status, 400);
});

Deno.test("learn-from-metric drafts rules rather than approving them", async () => {
  const result = await call(
    "learn-from-metric",
    {
      metric_id: "m-1",
      feature: "ai-brain",
      event: "dialect_leak",
      dialect: "Gulf",
      leaks: ["دلوقتي"],
      message: "MSA leaked into the reply",
    },
    caller({
      ...bothGateways(proposal),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.inserted, 1);

  const insert = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/dialect_rules") && c.method === "POST");
  const rows = JSON.parse(insert?.body ?? "[]") as Array<Record<string, unknown>>;
  // Nothing the AI proposes takes effect until a human approves it.
  assertEquals(rows[0].status, "draft");
  assertEquals(rows[0].source, "ai_generated");
  assertEquals(rows[0].dialect, "Gulf");
  assertEquals(rows[0].created_by, USER);
  assertStringIncludes(String(rows[0].notes), "ai-brain/dialect_leak");
  assertStringIncludes(String(rows[0].notes), "id=m-1");
});

Deno.test("learn-from-metric clamps a priority the model made up", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways({
        rules: [
          { ...proposal.rules[0], priority: 99 },
          { ...proposal.rules[0], category: "syntax", priority: 0 },
          { ...proposal.rules[0], category: "tone", priority: "not a number" },
        ],
      }),
    }),
  );

  assertEquals(result.status, 200);
  const insert = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/dialect_rules") && c.method === "POST");
  const rows = JSON.parse(insert?.body ?? "[]") as Array<Record<string, number>>;
  assertEquals(rows[0].priority, 5);
  // Pinned, not fixed. The clamp is `Math.max(1, Math.min(5, Math.round(Number(p) || 3)))`,
  // and `0 || 3` is 3 — so a priority of zero becomes a middling 3 rather than
  // the 1 the clamp reads as if it produced.
  assertEquals(rows[1].priority, 3);
  // A non-numeric priority falls back to the same middle value.
  assertEquals(rows[2].priority, 3);
});

Deno.test("learn-from-metric caps how many examples a rule can carry", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways({
        rules: [
          {
            ...proposal.rules[0],
            examples: {
              good: Array.from({ length: 20 }, (_, i) => `good-${i}`),
              bad: Array.from({ length: 20 }, (_, i) => `bad-${i}`),
            },
          },
        ],
      }),
    }),
  );

  const insert = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/dialect_rules") && c.method === "POST");
  const rows = JSON.parse(insert?.body ?? "[]") as Array<{ examples: { good: string[]; bad: string[] } }>;
  assertEquals(rows[0].examples.good.length, 6);
  assertEquals(rows[0].examples.bad.length, 6);
});

Deno.test("learn-from-metric survives a rule with no examples at all", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways({
        rules: [{ category: "lexis", rule: "Use هالحين.", priority: 3 }],
      }),
    }),
  );

  assertEquals(result.status, 200);
  const insert = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/dialect_rules") && c.method === "POST");
  const rows = JSON.parse(insert?.body ?? "[]") as Array<{ examples: { good: string[]; bad: string[] } }>;
  assertEquals(rows[0].examples, { good: [], bad: [] });
});

Deno.test("learn-from-metric drops a proposal with no rule text", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways({
        rules: [
          { category: "lexis", rule: "   ", priority: 3 },
          { category: "lexis", priority: 3 },
        ],
      }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.inserted, 0);
  assertEquals(result.body.message, "AI returned no proposals");
});

Deno.test("learn-from-metric tells the model which rules already exist", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf", leaks: ["دلوقتي", "الآن"] },
    caller({
      "/rest/v1/dialect_rules": (request) =>
        request.method === "POST"
          ? json([], 201)
          : json([{ category: "lexis", rule: "Prefer هالحين." }]),
      ...bothGateways(proposal),
    }),
  );

  assertEquals(result.status, 200);
  const prompt = result.bodies[result.calls.findIndex((url) => url.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "Prefer هالحين.");
  assertStringIncludes(prompt, "دلوقتي");
});

Deno.test("learn-from-metric only reads rules that are live or pending", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways(proposal),
    }),
  );

  const read = result.calls.find(
    (url, i) => url.includes("/rest/v1/dialect_rules") && result.methods[i] === "GET",
  ) ?? "";
  // A rejected rule is not shown as an existing rule, so the model is free to
  // propose something in that space again.
  assertStringIncludes(read, "status=in.");
  assertStringIncludes(read, "approved");
  assertStringIncludes(read, "draft");
});

Deno.test("learn-from-metric records that it drafted", async () => {
  const result = await call(
    "learn-from-metric",
    { metric_id: "m-1", feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      ...bothGateways(proposal),
    }),
  );

  assertEquals(result.status, 200);
  // aiBrain writes its own feature_metrics row on the way through, so the trace
  // has to be picked out by event rather than by being the only one.
  const trace = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes("/rest/v1/feature_metrics") && c.method === "POST")
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>)
    .find((r) => r.feature === "learn_from_metric");
  assert(trace, "expected a learn_from_metric trace event");
  const row = trace as Record<string, unknown>;
  assertEquals(row.feature, "learn_from_metric");
  assertEquals(row.event, "drafted");
  assertEquals(row.count, 1);
  assertEquals((row.meta as Record<string, unknown>).source_metric_id, "m-1");
});

Deno.test("learn-from-metric reports a rejected insert", async () => {
  const result = await call(
    "learn-from-metric",
    { feature: "ai-brain", event: "dialect_leak", dialect: "Gulf" },
    caller({
      "/rest/v1/dialect_rules": (request) =>
        request.method === "POST" ? json({ message: "permission denied" }, 403) : json([]),
      ...bothGateways(proposal),
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error ?? result.body.message ?? ""), "Insert failed");
});
