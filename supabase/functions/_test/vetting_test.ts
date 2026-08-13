import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `vet-corpus-sentences` — the gate in front of the scraped Yemeni corpus.
 *
 * Everything downstream of it (`buildCorpus`, and through that every mined
 * dialect rule) reads `vetted = true`, and no row has that until this runs. So
 * the property that matters is not "does it judge well" but **fail-closed**:
 * anything short of an affirmative pass has to end up rejected, including a
 * model that skipped an index, answered a different index, or crashed.
 *
 * It is also resumable on purpose — one invocation judges up to `limit` rows
 * against a 55-second budget and reports how many remain — so the batching and
 * the wall clock are part of the contract rather than an implementation detail.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function admin(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/rpc/has_role": () => json(true),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

const emitting = (payload: unknown): Record<string, UpstreamHandler> => ({
  "ai.gateway.lovable.dev": () => chatCompletion("", payload),
  "openrouter.ai": () => chatCompletion("", payload),
});

const sentence = (index: number) => ({
  id: `c-${index}`,
  text: `جملة رقم ${index}`,
});

/**
 * The corpus table, answering a GET with `rows` and accepting every write.
 *
 * PATCHes are what the assertions read, so they answer with an empty
 * representation rather than being routed separately.
 */
function corpus(rows: Array<{ id: string; text: string }>): UpstreamHandler {
  return (request: Request) => (request.method === "GET" ? json(rows) : json([], 200));
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("vet-corpus-sentences", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("vet-corpus-sentences", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    const writes = fn.calls
      .filter((c) => c.url.includes("dialect_corpus_sentences") && c.method === "PATCH")
      .map((c) => ({
        url: c.url,
        body: JSON.parse(c.body ?? "{}") as Record<string, unknown>,
      }));
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      writes,
    };
  } finally {
    fn.restore();
  }
}

/**
 * The corpus table where the trailing "how many are left" query answers a count.
 *
 * That query is `head: true`, so supabase-js sends **HEAD** rather than GET and
 * reads the total out of `content-range` — a fixture that only special-cases
 * GET answers it with no header at all, and `remaining` comes back null.
 */
function remainingIs(count: number, rows: Array<{ id: string; text: string }>): UpstreamHandler {
  return (request: Request) => {
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-range": `0-0/${count}`,
          "access-control-expose-headers": "content-range",
        },
      });
    }
    return request.method === "GET" ? json(rows) : json([], 200);
  };
}

/** The id a PATCH targeted, read back out of its filter. */
const targetOf = (url: string) => new URL(url).searchParams.get("id")?.replace("eq.", "");

Deno.test("vet-corpus-sentences answers the preflight", async () => {
  const fn = await loadFunction("vet-corpus-sentences", { upstreams: admin() });
  try {
    const response = await fn.handler(optionsRequest("vet-corpus-sentences"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("vet-corpus-sentences refuses a request with no Authorization", async () => {
  const result = await call({}, admin(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "Missing Authorization header");
});

Deno.test("vet-corpus-sentences refuses a session the auth server rejects", async () => {
  const result = await call(
    {},
    admin({ "/auth/v1/user": () => json({ error: "bad token" }, 401) }),
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "Invalid session");
});

Deno.test("vet-corpus-sentences turns away a signed-in learner", async () => {
  const result = await call({}, admin({ "/rest/v1/rpc/has_role": () => json(false) }));

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "Admin role required");
});

Deno.test("vet-corpus-sentences rejects a dialect it has no corpus for", async () => {
  const result = await call({ dialect: "Levantine" }, admin());

  assertEquals(result.status, 400);
  assertStringIncludes(String(result.body.error), "Gulf, Egyptian, Yemeni");
});

Deno.test("vet-corpus-sentences says so when nothing is left to judge", async () => {
  const result = await call(
    {},
    admin({ "/rest/v1/dialect_corpus_sentences": corpus([]) }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.judged, 0);
  assertEquals(result.body.remaining, 0);
  assertEquals(result.body.note, "nothing left to vet");
});

Deno.test("vet-corpus-sentences writes a verdict per sentence", async () => {
  const result = await call(
    { dialect: "Yemeni" },
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0), sentence(1)]),
      ...emitting({
        verdicts: [
          { i: 0, ok: true, reason: "everyday speech" },
          { i: 1, ok: false, reason: "sectarian" },
        ],
      }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.judged, 2);
  assertEquals(result.body.accepted, 1);
  assertEquals(result.body.rejected, 1);
  assertEquals(result.writes.length, 2);

  assertEquals(targetOf(result.writes[0].url), "c-0");
  assertEquals(result.writes[0].body.vetted, true);
  assertEquals(result.writes[0].body.vet_reason, "everyday speech");
  assert(typeof result.writes[0].body.vetted_at === "string");

  assertEquals(targetOf(result.writes[1].url), "c-1");
  assertEquals(result.writes[1].body.vetted, false);
});

Deno.test("vet-corpus-sentences rejects a sentence the model skipped", async () => {
  // Fail-closed: an index with no verdict is not left pending, it is refused.
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0), sentence(1)]),
      ...emitting({ verdicts: [{ i: 0, ok: true, reason: "fine" }] }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.judged, 2);
  assertEquals(result.body.rejected, 1);
  assertEquals(result.writes[1].body.vetted, false);
});

Deno.test("vet-corpus-sentences reports incomplete coverage as a failure", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0), sentence(1)]),
      ...emitting({ verdicts: [{ i: 0, ok: true, reason: "fine" }] }),
    }),
  );

  const failures = result.body.failures as string[];
  assert(failures?.length, "expected the partial answer to be reported");
  assertStringIncludes(failures[0], "50%");
});

Deno.test("vet-corpus-sentences rejects an out-of-range index rather than trusting it", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0)]),
      ...emitting({
        verdicts: [
          { i: 7, ok: true, reason: "not a real index" },
          { i: 0, ok: true, reason: "fine" },
        ],
      }),
    }),
  );

  assertEquals(result.status, 200);
  // One sentence in, one verdict written — the stray index cannot create a row.
  assertEquals(result.writes.length, 1);
  assertEquals(targetOf(result.writes[0].url), "c-0");
});

Deno.test("vet-corpus-sentences leaves a failed batch pending for a later run", async () => {
  // A model outage must not condemn the batch: the rows stay NULL so the next
  // invocation picks them up.
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0), sentence(1)]),
      "ai.gateway.lovable.dev": () => json({ error: "down" }, 503),
      "openrouter.ai": () => json({ error: "down" }, 503),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.judged, 0);
  assertEquals(result.writes.length, 0);
  assert((result.body.failures as string[])?.length);
});

Deno.test("vet-corpus-sentences splits the pool into batches", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => sentence(i));
  const result = await call(
    { batchSize: 5 },
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus(rows),
      ...emitting({
        verdicts: Array.from({ length: 5 }, (_, i) => ({ i, ok: true, reason: "fine" })),
      }),
    }),
  );

  assertEquals(result.status, 200);
  // 5 + 5 + 2.
  assertEquals(result.body.batches, 3);
  assertEquals(result.writes.length, 12);
});

Deno.test("vet-corpus-sentences clamps an absurd batch size", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => sentence(i));
  const result = await call(
    { batchSize: 5000 },
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus(rows),
      ...emitting({
        verdicts: Array.from({ length: 6 }, (_, i) => ({ i, ok: true, reason: "fine" })),
      }),
    }),
  );

  assertEquals(result.body.batches, 1);
});

Deno.test("vet-corpus-sentences caps how many rows one invocation asks for", async () => {
  const result = await call(
    { limit: 99999 },
    admin({ "/rest/v1/dialect_corpus_sentences": corpus([]) }),
  );

  const read = result.calls.find((url) => url.includes("dialect_corpus_sentences")) ?? "";
  assertStringIncludes(read, "limit=1000");
});

Deno.test("vet-corpus-sentences only looks at rows nobody has judged", async () => {
  const result = await call(
    { dialect: "Yemeni" },
    admin({ "/rest/v1/dialect_corpus_sentences": corpus([]) }),
  );

  const read = result.calls.find((url) => url.includes("dialect_corpus_sentences")) ?? "";
  assertStringIncludes(read, "vetted=is.null");
  assertStringIncludes(read, "dialect=eq.Yemeni");
  // And by default it skips what the cheap keyword pre-pass already condemned.
  assertStringIncludes(read, "keyword_flagged=eq.false");
});

Deno.test("vet-corpus-sentences can re-judge the pre-pass's rejects", async () => {
  const result = await call(
    { includeFlagged: true },
    admin({ "/rest/v1/dialect_corpus_sentences": corpus([]) }),
  );

  const read = result.calls.find((url) => url.includes("dialect_corpus_sentences")) ?? "";
  assertEquals(read.includes("keyword_flagged"), false);
});

Deno.test("vet-corpus-sentences numbers the sentences it sends", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0), sentence(1)]),
      ...emitting({
        verdicts: [
          { i: 0, ok: true, reason: "fine" },
          { i: 1, ok: true, reason: "fine" },
        ],
      }),
    }),
  );

  const prompt = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "0. جملة رقم 0");
  assertStringIncludes(prompt, "1. جملة رقم 1");
  assertStringIncludes(prompt, "2 in total");
});

Deno.test("vet-corpus-sentences tells the model qat is not a drug reference", async () => {
  // The rubric is the whole safety argument: keyword filtering was measured
  // against this corpus and failed, and ordinary Yemeni vocabulary must not be
  // thrown away by an over-eager judge.
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": corpus([sentence(0)]),
      ...emitting({ verdicts: [{ i: 0, ok: true, reason: "fine" }] }),
    }),
  );

  const prompt = result.bodies[result.calls.findIndex((u) => u.includes("gateway"))] ?? "";
  assertStringIncludes(prompt, "قات");
  assertStringIncludes(prompt, "When uncertain, mark ok=false");
});

Deno.test("vet-corpus-sentences carries on when one write is rejected", async () => {
  let patches = 0;
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": (request) => {
        if (request.method === "GET") return json([sentence(0), sentence(1)]);
        patches += 1;
        return patches === 1 ? json({ message: "permission denied" }, 403) : json([], 200);
      },
      ...emitting({
        verdicts: [
          { i: 0, ok: true, reason: "fine" },
          { i: 1, ok: true, reason: "fine" },
        ],
      }),
    }),
  );

  assertEquals(result.status, 200);
  // The second row is still judged, and the first is reported rather than lost.
  assertEquals(result.body.judged, 1);
  assert((result.body.failures as string[])?.length);
});

Deno.test("vet-corpus-sentences reports a failed read as a server error", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": () => json({ message: "permission denied" }, 403),
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "Fetch failed");
});

Deno.test("vet-corpus-sentences tells the caller to come back for the rest", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": remainingIs(57, [sentence(0)]),
      ...emitting({ verdicts: [{ i: 0, ok: true, reason: "fine" }] }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.remaining, 57);
  assertStringIncludes(String(result.body.note), "Re-invoke to continue");
});

Deno.test("vet-corpus-sentences says the pool is done when nothing remains", async () => {
  const result = await call(
    {},
    admin({
      "/rest/v1/dialect_corpus_sentences": remainingIs(0, [sentence(0)]),
      ...emitting({ verdicts: [{ i: 0, ok: true, reason: "fine" }] }),
    }),
  );

  assertEquals(result.body.remaining, 0);
  assertStringIncludes(String(result.body.note), "Spot-check accepted rows");
});

// ── the keyword pre-pass ─────────────────────────────────────────────────────

Deno.test("auto_reject condemns the flagged rows without calling a model", async () => {
  const result = await call(
    { mode: "auto_reject", dialect: "Yemeni" },
    admin({
      "/rest/v1/dialect_corpus_sentences": () => json([{ id: "c-0" }, { id: "c-1" }]),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.mode, "auto_reject");
  assertEquals(result.body.rejected, 2);
  assertEquals(result.calls.some((url) => url.includes("gateway")), false);
});

Deno.test("auto_reject only touches unjudged rows the pre-pass flagged", async () => {
  const result = await call(
    { mode: "auto_reject", dialect: "Yemeni" },
    admin({ "/rest/v1/dialect_corpus_sentences": () => json([]) }),
  );

  const patch = result.calls.find((url) => url.includes("dialect_corpus_sentences")) ?? "";
  assertStringIncludes(patch, "keyword_flagged=eq.true");
  assertStringIncludes(patch, "vetted=is.null");
  assertStringIncludes(patch, "dialect=eq.Yemeni");
});

Deno.test("auto_reject records why it rejected them", async () => {
  const result = await call(
    { mode: "auto_reject" },
    admin({ "/rest/v1/dialect_corpus_sentences": () => json([{ id: "c-0" }]) }),
  );

  const write = result.bodies[
    result.calls.findIndex((url) => url.includes("dialect_corpus_sentences"))
  ];
  const saved = JSON.parse(write ?? "{}") as Record<string, unknown>;
  assertEquals(saved.vetted, false);
  assertEquals(saved.vet_reason, "keyword pre-pass");
});

Deno.test("auto_reject reports a rejected write", async () => {
  const result = await call(
    { mode: "auto_reject" },
    admin({
      "/rest/v1/dialect_corpus_sentences": () => json({ message: "permission denied" }, 403),
    }),
  );

  assertEquals(result.status, 500);
  assertStringIncludes(String(result.body.error), "Auto-reject failed");
});

Deno.test("an unknown mode falls back to vetting rather than rejecting", async () => {
  const result = await call(
    { mode: "something_else" },
    admin({ "/rest/v1/dialect_corpus_sentences": corpus([]) }),
  );

  assertEquals(result.body.mode, "vet");
});
