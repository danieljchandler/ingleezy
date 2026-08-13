import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `camel-analyze` — four Arabic NLP tasks behind one endpoint.
 *
 * Three go to Farasa (QCRI) for diacritisation, segmentation and POS tagging;
 * the fourth goes to a CAMeL-Lab model on HuggingFace for dialect
 * identification. They run in parallel and each is optional, which makes
 * *partial* success the interesting state: a caller that asked for four things
 * and got two must be able to tell which two.
 *
 * The segmentation parser is the only real logic here. Farasa marks morpheme
 * boundaries with `+` and says nothing about which side is a clitic, so the
 * split into prefixes, stem and suffixes is done locally against fixed sets —
 * and getting it wrong silently mislabels the part of the word a learner is
 * being taught.
 */

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "farasa.qcri.org": () => json({ text: "الجَوّ" }),
    "api-inference.huggingface.co": () => json([{ label: "MSA", score: 0.9 }]),
    "router.huggingface.co": () => json([{ label: "MSA", score: 0.9 }]),
    ...extra,
  };
}

/** Farasa answers a different field name per task, so route on the path. */
const farasa = (byTask: Record<string, string>): UpstreamHandler => (request) => {
  const path = new URL(request.url).pathname;
  const task = ["diac", "seg", "pos"].find((t) => path.includes(`/${t}/`)) ?? "";
  const value = byTask[task];
  return value === undefined
    ? new Response("no such task", { status: 404 })
    : json({ text: value });
};

async function call(body: unknown, routes: Record<string, UpstreamHandler> = upstreams()) {
  const fn = await loadFunction("camel-analyze", { upstreams: routes });
  try {
    const response = await fn.handler(jsonRequest("camel-analyze", body));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed, calls: fn.calls.map((c) => c.url) };
  } finally {
    fn.restore();
  }
}

Deno.test("camel-analyze diacritises by default", async () => {
  const { status, body, calls } = await call({ text: "الجو" });

  assertEquals(status, 200);
  assertEquals(body.diacritized, "الجَوّ");
  assertEquals(body.diacritizeAvailable, true);
  assertEquals(body.actions, ["diacritize"]);
  // Only the task that was asked for is called. Running all four by default
  // would make the common case four times slower and four times as fragile.
  assertEquals(calls.filter((u) => u.includes("farasa")).length, 1);
});

Deno.test("camel-analyze runs only the tasks it was asked for", async () => {
  const { body, calls } = await call(
    { text: "الجو حلو", actions: ["segment", "pos"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "ال+جو", pos: "الجو/NOUN" }) }),
  );

  assert(!("diacritized" in body));
  assert(!("dialect" in body));
  assertEquals(calls.filter((u) => u.includes("farasa")).length, 2);
});

Deno.test("camel-analyze splits clitics off the stem", async () => {
  const { body } = await call(
    { text: "بالكتاب", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "ب+الكتاب" }) }),
  );

  const segments = body.segments as Array<{
    raw: string;
    prefixes: string[];
    stem: string;
    suffixes: string[];
  }>;
  // Farasa marks boundaries and says nothing about which side is a clitic.
  // Naming the prefix is the whole point for a learner: "with the book" is
  // built from a preposition they can reuse.
  assertEquals(segments[0].prefixes, ["ب"]);
  assertEquals(segments[0].stem, "الكتاب");
  assertEquals(segments[0].suffixes, []);
});

Deno.test("camel-analyze splits a possessive suffix off the stem", async () => {
  const { body } = await call(
    { text: "كتابهم", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "كتاب+هم" }) }),
  );

  const segments = body.segments as Array<{ stem: string; suffixes: string[] }>;
  assertEquals(segments[0].stem, "كتاب");
  assertEquals(segments[0].suffixes, ["هم"]);
});

Deno.test("camel-analyze handles a word with clitics on both ends", async () => {
  const { body } = await call(
    { text: "وبكتابهم", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "و+ب+كتاب+هم" }) }),
  );

  const segments = body.segments as Array<{
    prefixes: string[];
    stem: string;
    suffixes: string[];
  }>;
  assertEquals(segments[0].prefixes, ["و", "ب"]);
  assertEquals(segments[0].stem, "كتاب");
  assertEquals(segments[0].suffixes, ["هم"]);
});

Deno.test("camel-analyze never strips the whole word away", async () => {
  const { body } = await call(
    // Every part is in one of the clitic sets, which is exactly the case a
    // naive loop eats entirely.
    { text: "وك", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "و+ك" }) }),
  );

  const segments = body.segments as Array<{ stem: string }>;
  // A segment with an empty stem renders as a word made of nothing but
  // affixes, which is not a thing.
  assert(segments[0].stem.length > 0);
});

Deno.test("camel-analyze keeps the raw token beside the split", async () => {
  const { body } = await call(
    { text: "بالكتاب", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "ب+الكتاب" }) }),
  );

  const segments = body.segments as Array<{ raw: string }>;
  // The raw form is what a caller shows when it does not trust the split — and
  // the split is a heuristic, so that is a real fallback rather than a debug
  // field.
  assertEquals(segments[0].raw, "ب+الكتاب");
  assertEquals(body.segmentedRaw, "ب+الكتاب");
});

Deno.test("camel-analyze segments every word in the input", async () => {
  const { body } = await call(
    { text: "بالكتاب وكتابهم", actions: ["segment"] },
    upstreams({ "farasa.qcri.org": farasa({ seg: "ب+الكتاب و+كتاب+هم" }) }),
  );

  assertEquals((body.segments as unknown[]).length, 2);
});

Deno.test("camel-analyze reports an identified dialect", async () => {
  const { body } = await call(
    { text: "شلونك", actions: ["dialect"] },
    upstreams({
      "api-inference.huggingface.co": () => json([[{ label: "Riyadh", score: 0.8 }]]),
      "router.huggingface.co": () => json([[{ label: "Riyadh", score: 0.8 }]]),
    }),
  );

  const dialect = body.dialect as Record<string, unknown> | null;
  // Tagged with its source, because the video pipeline used to carry its own
  // narrower copy of this model's label map and the two produced different
  // verdicts for the same text.
  assert(dialect);
  assertEquals(dialect.source, "camel-hf");
});

Deno.test("camel-analyze says why dialect identification failed", async () => {
  const { status, body } = await call(
    { text: "شلونك", actions: ["dialect"] },
    upstreams({
      "api-inference.huggingface.co": () => new Response("loading", { status: 503 }),
      "router.huggingface.co": () => new Response("loading", { status: 503 }),
    }),
  );

  // A 503 from HuggingFace means the model is cold-starting, which is fixed by
  // waiting. Without the reason a caller can only infer "no result" and has no
  // way to tell that from "this text has no identifiable dialect".
  assertEquals(status, 200);
  assertEquals(body.dialect, null);
  assertEquals(body.dialectErrorReason, "http_503");
  assertStringIncludes(String(body.dialectError), "cold-starting");
});

Deno.test("camel-analyze names a missing HuggingFace key", async () => {
  const fn = await loadFunction("camel-analyze", {
    upstreams: upstreams(),
    env: { HUGGINGFACE_API_KEY: undefined },
  });
  try {
    const response = await fn.handler(
      jsonRequest("camel-analyze", { text: "شلونك", actions: ["dialect"] }),
    );
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.dialectErrorReason, "no_api_key");
    // Names the secret, because this one is an operator problem rather than a
    // transient one and the message is what tells them apart.
    assertStringIncludes(body.dialectError, "HUGGINGFACE_API_KEY");
  } finally {
    fn.restore();
  }
});

Deno.test("camel-analyze answers the other tasks when one upstream is down", async () => {
  const { status, body } = await call(
    { text: "الجو", actions: ["diacritize", "dialect"] },
    upstreams({
      "farasa.qcri.org": () => json({ text: "الجَوّ" }),
      "api-inference.huggingface.co": () => new Response("nope", { status: 500 }),
      "router.huggingface.co": () => new Response("nope", { status: 500 }),
    }),
  );

  // Partial success is the normal state with four independent upstreams. A
  // caller that asked for two things and got one has to be able to tell which.
  assertEquals(status, 200);
  assertEquals(body.diacritized, "الجَوّ");
  assertEquals(body.dialect, null);
});

Deno.test("camel-analyze reports an unavailable Farasa as null rather than failing", async () => {
  const { status, body } = await call(
    { text: "الجو", actions: ["diacritize", "segment", "pos"] },
    upstreams({ "farasa.qcri.org": () => new Response("down", { status: 502 }) }),
  );

  assertEquals(status, 200);
  assertEquals(body.diacritized, null);
  // The explicit flag is what lets a caller show the undiacritised text rather
  // than an empty box — `null` alone is ambiguous with "nothing to add".
  assertEquals(body.diacritizeAvailable, false);
  assertEquals(body.segments, null);
  assertEquals(body.posTokens, null);
});

Deno.test("camel-analyze survives Farasa returning something unreadable", async () => {
  const { status, body } = await call(
    { text: "الجو", actions: ["diacritize"] },
    upstreams({
      "farasa.qcri.org": () => new Response("<html>rate limited</html>", { status: 200 }),
    }),
  );

  // A 200 carrying an HTML error page is the usual failure mode for a free
  // public API, and `response.json()` throws on it.
  assertEquals(status, 200);
  assertEquals(body.diacritizeAvailable, false);
});

Deno.test("camel-analyze reads whichever field Farasa used", async () => {
  for (const field of ["text", "output", "result"]) {
    const { body } = await call(
      { text: "الجو", actions: ["diacritize"] },
      upstreams({ "farasa.qcri.org": () => json({ [field]: "الجَوّ" }) }),
    );

    // Farasa names its output differently per task and has changed it between
    // versions; accepting all three is what keeps one task breaking from
    // breaking the others.
    assertEquals(body.diacritized, "الجَوّ", `for field "${field}"`);
  }
});

Deno.test("camel-analyze refuses empty input", async () => {
  for (const text of ["", "   ", undefined, 42]) {
    const { status, body, calls } = await call({ text });

    assertEquals(status, 400, `expected ${JSON.stringify(text)} to be refused`);
    assertEquals(body.error, "text is required");
    assert(!calls.some((url) => url.includes("farasa")));
  }
});

Deno.test("camel-analyze echoes the input and the tasks it ran", async () => {
  const { body } = await call(
    { text: "الجو حلو", actions: ["diacritize", "segment"] },
    upstreams({ "farasa.qcri.org": farasa({ diac: "الجَوّ", seg: "ال+جو" }) }),
  );

  // Both are needed to line the result up with the request when several are in
  // flight, which is how the transcript panel calls this.
  assertEquals(body.inputText, "الجو حلو");
  assertEquals(body.actions, ["diacritize", "segment"]);
});
