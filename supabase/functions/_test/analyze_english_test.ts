import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `analyze-english-text` — the analyser behind Learn from X.
 *
 * It replaced `analyze-gulf-arabic` on that page when the app flipped
 * direction, and the swap is more than a prompt change: the two return the
 * same TranscriptResult shape with opposite meanings. Here `english` is the
 * line as it was posted and `arabic` is the scaffold underneath it, which is
 * what makes the transcript components take their English-first path. A line
 * that came back with no English is not something the page can render at all,
 * so it is dropped rather than passed through to be shown blank.
 *
 * The English itself is quoted from the input — the model is told never to
 * rewrite it. That matters more here than in a lesson generator: the whole
 * point is reading a real post, typos and slang included, so a model that
 * tidied the text would be teaching English nobody wrote.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction("analyze-english-text", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-english-text", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

const aLine = (over: Record<string, unknown> = {}) => ({
  english: "The weather is lovely today.",
  arabic: "الجو حلو اليوم",
  fusha: "الطقس جميل اليوم",
  literal: "الـ جو هو حلو اليوم",
  ...over,
});

const result = (body: Record<string, unknown>) => body.result as Record<string, unknown>;

Deno.test("analyze-english-text answers a preflight", async () => {
  const fn = await loadFunction("analyze-english-text", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("analyze-english-text"));
    assert(response.status < 300);
  } finally {
    fn.restore();
  }
});

Deno.test("analyze-english-text returns the post line by line with its scaffold", async () => {
  const { status, body } = await call(
    { text: "The weather is lovely today.", dialect: "Egyptian" },
    caller({ "ai.gateway.lovable.dev": emitting({ lines: [aLine()] }) }),
  );

  assertEquals(status, 200);
  assertEquals(body.success, true);
  const lines = result(body).lines as Array<Record<string, unknown>>;
  assertEquals(lines.length, 1);
  // `english` present is the signal the transcript components read to take the
  // English-first path; `arabic` under it is the scaffold, not the spoken line.
  assertEquals(lines[0].english, "The weather is lovely today.");
  assertEquals(lines[0].arabic, "الجو حلو اليوم");
  assertEquals(lines[0].fusha, "الطقس جميل اليوم");
  assertEquals(lines[0].literal, "الـ جو هو حلو اليوم");
  assertEquals(result(body).dialect, "Egyptian");
});

Deno.test("analyze-english-text drops a line with no English", async () => {
  const { body } = await call(
    { text: "The weather is lovely today." },
    caller({
      "ai.gateway.lovable.dev": emitting({
        lines: [aLine(), { arabic: "مخترع" }, { english: "   ", arabic: "فاضي" }],
      }),
    }),
  );

  // The English is the anchor — the page renders the scaffold *under* it, so a
  // line without one would render as an empty card with a translation of
  // nothing beneath it.
  assertEquals((result(body).lines as unknown[]).length, 1);
});

Deno.test("analyze-english-text reports an analysis with no usable lines", async () => {
  const { status, body } = await call(
    { text: "The weather is lovely today." },
    caller({ "ai.gateway.lovable.dev": emitting({ lines: [] }) }),
  );

  // In-band `success: false` rather than a 2xx with an empty result: the page
  // shows one error surface for this and for a failed scrape, and an empty
  // success would render as a post that analysed to nothing.
  assertEquals(status, 502);
  assertEquals(body.success, false);
  assertEquals(body.error, "empty_analysis");
});

Deno.test("analyze-english-text keeps the vocabulary English-first", async () => {
  const { body } = await call(
    { text: "The weather is lovely today." },
    caller({
      "ai.gateway.lovable.dev": emitting({
        lines: [aLine()],
        vocabulary: [
          { english: "lovely", arabic: "حلو", note: "كلمة بريطانية أكثر" },
          { arabic: "بدون إنجليزي" },
        ],
      }),
    }),
  );

  const vocab = result(body).vocabulary as Array<Record<string, unknown>>;
  // `english` is the item being learned and `arabic` its gloss — the same way
  // round as the deck it gets saved into. An entry with no English is not a
  // flashcard, it is a gloss with nothing to gloss.
  assertEquals(vocab.length, 1);
  assertEquals(vocab[0].english, "lovely");
  assertEquals(vocab[0].arabic, "حلو");
  assertEquals(vocab[0].note, "كلمة بريطانية أكثر");
});

Deno.test("analyze-english-text omits a cultural note there is nothing for", async () => {
  const { body } = await call(
    { text: "The weather is lovely today." },
    caller({
      "ai.gateway.lovable.dev": emitting({ lines: [aLine()], culturalContext: "   " }),
    }),
  );

  // The note is for sarcasm and references. A blank one renders an empty
  // callout on every post, which trains the learner to skip all of them.
  assert(!("culturalContext" in result(body)));
});

Deno.test("analyze-english-text asks for English quoted verbatim, glossed in dialect", async () => {
  const { bodies, calls } = await call(
    { text: "The weather is lovely today.", dialect: "Yemeni" },
    caller({ "ai.gateway.lovable.dev": emitting({ lines: [aLine()] }) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as { messages: Array<{ content: string }> };
  const prompt = sent.messages.map((m) => m.content).join("\n");
  // Both halves of the contract. Rewriting the English defeats the feature —
  // the learner came to read what was actually posted — and glossing it in MSA
  // explains it in a language they do not speak either.
  assertStringIncludes(prompt, "VERBATIM");
  assertStringIncludes(prompt, "NEVER Modern Standard Arabic");
  assertStringIncludes(prompt, "Yemeni");
});

Deno.test("analyze-english-text glosses in Gulf when the dialect is unknown", async () => {
  const { body } = await call(
    { text: "The weather is lovely today.", dialect: "Klingon" },
    caller({ "ai.gateway.lovable.dev": emitting({ lines: [aLine()] }) }),
  );

  // An old client, or a dialect that has since been removed. Falling back
  // beats refusing: some Arabic is readable, none is not.
  assertEquals(result(body).dialect, "Gulf");
});

Deno.test("analyze-english-text refuses an empty post", async () => {
  const { status, body } = await call({ text: "   " }, caller());

  assertEquals(status, 400);
  assertEquals(body.error, "missing_text");
});

Deno.test("analyze-english-text refuses a post past the length cap", async () => {
  const { status, body } = await call({ text: "a".repeat(4001) }, caller());

  // A whole thread pasted in would cost a long model call and come back past
  // what the page can show, so the limit is stated rather than truncated
  // silently.
  assertEquals(status, 400);
  assertEquals(body.error, "text_too_long");
  assertEquals(body.limit, 4000);
});

Deno.test("analyze-english-text reads a post for a signed-out visitor", async () => {
  const { status, body } = await call(
    { text: "The weather is lovely today." },
    caller({ "ai.gateway.lovable.dev": emitting({ lines: [aLine()] }) }),
    { jwt: null },
  );

  // Pinned, and deliberate: /learn-from-x has no route guard and config.toml
  // sets verify_jwt = false, exactly as for the analyze-gulf-arabic it
  // replaced. Reading a post is open; saving a word is the gate. Tightening
  // that is a decision about the whole open-analyser posture.
  assertEquals(status, 200);
  assertEquals(body.success, true);
});
