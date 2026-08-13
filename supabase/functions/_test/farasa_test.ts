import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `farasa` — the QCRI NLP passthrough.
 *
 * Almost none of this function is the HTTP call; it is four parsers turning
 * Farasa's line formats into something a learner-facing component can render.
 * Segmentation splits clitics off a stem, POS maps Penn Arabic Treebank tags to
 * English labels, NER decodes BIO tagging into whole entities, and dependency
 * parsing reads CoNLL columns. Each has been written against a format nobody
 * controls, and none of it had ever been run.
 *
 * The other half is failure shape: a rejected key and a dead host must not
 * collapse into the same answer, because only one of them is worth retrying.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** Both hosts the endpoint cascade tries, answering the same thing. */
function farasaHosts(handler: UpstreamHandler): Record<string, UpstreamHandler> {
  return {
    "farasa.qcri.org": handler,
    "farasa-api.qcri.org": handler,
  };
}

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

/** Farasa answers with the analysed string under `text`. */
const answering = (text: string): Record<string, UpstreamHandler> =>
  farasaHosts(() => json({ text }));

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("farasa", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("farasa", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
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

Deno.test("farasa answers the preflight", async () => {
  const fn = await loadFunction("farasa", { upstreams: caller() });
  try {
    const response = await fn.handler(optionsRequest("farasa"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("farasa asks an anonymous caller to sign in", async () => {
  const result = await call({ text: "مرحبا" }, caller(answering("مَرْحَبَا")), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "auth_required");
});

Deno.test("farasa needs text to analyse", async () => {
  const blank = await call({ text: "   " }, caller(answering("")));
  assertEquals(blank.status, 400);
  assertEquals(blank.body.error, "text is required");

  const missing = await call({}, caller(answering("")));
  assertEquals(missing.status, 400);
});

Deno.test("farasa diacritises by default", async () => {
  const result = await call({ text: "مرحبا" }, caller(answering("مَرْحَبَا")));

  assertEquals(result.status, 200);
  assertEquals(result.body.tasks, ["diac"]);
  assertEquals(result.body.diac, { text: "مَرْحَبَا" });
  assertEquals(result.body.diacAvailable, true);
  assertEquals(result.body.inputText, "مرحبا");
});

Deno.test("farasa ignores a task it does not know", async () => {
  const result = await call(
    { text: "مرحبا", tasks: ["diac", "sentiment"] },
    caller(answering("مَرْحَبَا")),
  );

  assertEquals(result.body.tasks, ["diac"]);
});

Deno.test("farasa refuses a request whose every task is unknown", async () => {
  const result = await call({ text: "مرحبا", tasks: ["sentiment"] }, caller(answering("")));

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "No valid tasks requested. Valid: diac, seg, pos, NER, parsing");
});

Deno.test("farasa splits clitics off the stem", async () => {
  const result = await call(
    { text: "بالكتاب", tasks: ["seg"] },
    caller(answering("ب+ال+كتاب+ها")),
  );

  const seg = result.body.seg as { raw: string; tokens: Array<Record<string, unknown>> };
  assertEquals(seg.raw, "ب+ال+كتاب+ها");
  assertEquals(seg.tokens[0].prefixes, ["ب", "ال"]);
  assertEquals(seg.tokens[0].stem, "كتاب");
  assertEquals(seg.tokens[0].suffixes, ["ها"]);
  // `original` is the whole token with the boundaries removed — clitics and
  // all — so the caller can line the analysis up with the text it sent.
  assertEquals(seg.tokens[0].original, "بالكتابها");
});

Deno.test("farasa leaves a word with no clitics whole", async () => {
  const result = await call({ text: "كتاب", tasks: ["seg"] }, caller(answering("كتاب")));

  const seg = result.body.seg as { tokens: Array<Record<string, unknown>> };
  assertEquals(seg.tokens[0].prefixes, []);
  assertEquals(seg.tokens[0].suffixes, []);
  assertEquals(seg.tokens[0].stem, "كتاب");
});

Deno.test("farasa never strips a word down to nothing", async () => {
  // Every part looks like a clitic. The loops stop at `lo < hi`, so the last
  // part survives as the stem rather than the token vanishing.
  const result = await call({ text: "وال", tasks: ["seg"] }, caller(answering("و+ال")));

  const seg = result.body.seg as { tokens: Array<Record<string, unknown>> };
  assertEquals(seg.tokens[0].prefixes, ["و"]);
  assertEquals(seg.tokens[0].stem, "ال");
});

Deno.test("farasa labels part-of-speech tags in English", async () => {
  const result = await call(
    { text: "ذهب الولد", tasks: ["pos"] },
    caller(answering("ذهب/VBD الولد/NN إلى/IN")),
  );

  const pos = result.body.pos as { tokens: Array<Record<string, string>> };
  assertEquals(pos.tokens.length, 3);
  assertEquals(pos.tokens[0], { word: "ذهب", tag: "VBD", label: "Verb (past)" });
  assertEquals(pos.tokens[2].label, "Preposition");
});

Deno.test("farasa passes an unmapped POS tag through as its own label", async () => {
  const result = await call({ text: "كلمة", tasks: ["pos"] }, caller(answering("كلمة/XYZ")));

  const pos = result.body.pos as { tokens: Array<Record<string, string>> };
  assertEquals(pos.tokens[0].label, "XYZ");
});

Deno.test("farasa marks a POS token with no tag as unknown", async () => {
  const result = await call({ text: "كلمة", tasks: ["pos"] }, caller(answering("كلمة")));

  const pos = result.body.pos as { tokens: Array<Record<string, string>> };
  assertEquals(pos.tokens[0], { word: "كلمة", tag: "?", label: "Unknown" });
});

Deno.test("farasa joins a multi-word named entity back together", async () => {
  const result = await call(
    { text: "زار محمد بن راشد دبي", tasks: ["NER"] },
    caller(answering("زار/O محمد/B-PERS بن/I-PERS راشد/I-PERS دبي/B-LOC")),
  );

  const ner = result.body.NER as { entities: Array<Record<string, string>> };
  assertEquals(ner.entities.length, 2);
  assertEquals(ner.entities[0], { text: "محمد بن راشد", type: "PERS", typeLabel: "Person" });
  assertEquals(ner.entities[1], { text: "دبي", type: "LOC", typeLabel: "Location" });
});

Deno.test("farasa starts a new entity when the type changes mid-run", async () => {
  // An I- tag whose type does not match the run in progress ends it rather than
  // silently extending an entity with a word of a different kind.
  const result = await call(
    { text: "x", tasks: ["NER"] },
    caller(answering("محمد/B-PERS دبي/I-LOC")),
  );

  const ner = result.body.NER as { entities: Array<Record<string, string>> };
  assertEquals(ner.entities.length, 1);
  assertEquals(ner.entities[0].text, "محمد");
});

Deno.test("farasa finds no entities in text that has none", async () => {
  const result = await call({ text: "x", tasks: ["NER"] }, caller(answering("ذهب/O إلى/O")));

  const ner = result.body.NER as { entities: unknown[]; raw: string };
  assertEquals(ner.entities, []);
  // The raw tagging is kept regardless, so a caller can re-parse it.
  assertEquals(ner.raw, "ذهب/O إلى/O");
});

Deno.test("farasa reads a CoNLL dependency tree", async () => {
  const conll = [
    "1\tذهب\tذهب\tVBD\t_\t_\t0\tROOT\t_\t_",
    "2\tالولد\t_\tNN\t_\t_\t1\tSBJ\t_\t_",
  ].join("\n");

  const result = await call({ text: "ذهب الولد", tasks: ["parsing"] }, caller(answering(conll)));

  const parsing = result.body.parsing as { tokens: Array<Record<string, unknown>> };
  assertEquals(parsing.tokens.length, 2);
  assertEquals(parsing.tokens[0].index, 1);
  assertEquals(parsing.tokens[0].word, "ذهب");
  assertEquals(parsing.tokens[0].lemma, "ذهب");
  assertEquals(parsing.tokens[0].head, 0);
  assertEquals(parsing.tokens[0].relation, "ROOT");
  assertEquals(parsing.tokens[0].relationLabel, "Root of sentence");
  // A lemma of "_" means "not supplied", not a lemma spelled underscore.
  assertEquals(parsing.tokens[1].lemma, undefined);
  assertEquals(parsing.tokens[1].relationLabel, "Subject");
});

Deno.test("farasa skips a dependency line that is not a token", async () => {
  const conll = ["# comment", "1\tذهب\t_\tVBD\t_\t_\t0\tROOT\t_\t_", "short line"].join("\n");

  const result = await call({ text: "x", tasks: ["parsing"] }, caller(answering(conll)));

  const parsing = result.body.parsing as { tokens: unknown[] };
  assertEquals(parsing.tokens.length, 1);
});

Deno.test("farasa runs several tasks in one request", async () => {
  const result = await call(
    { text: "مرحبا", tasks: ["diac", "pos"] },
    caller(answering("مرحبا/NN")),
  );

  assertEquals(result.body.tasks, ["diac", "pos"]);
  assertEquals(result.body.diacAvailable, true);
  assertEquals(result.body.posAvailable, true);
});

Deno.test("farasa reports a rejected key as a configuration problem", async () => {
  const result = await call(
    { text: "مرحبا" },
    caller(farasaHosts(() => new Response("invalid api key. please register", { status: 200 }))),
  );

  // A 200 carrying prose about the key is still an auth failure — the status
  // alone would have read as success.
  assertEquals(result.status, 200);
  assertEquals(result.body.diac, null);
  assertEquals(result.body.diacAvailable, false);
  assertEquals(result.body.diacError, "invalid_api_key");
  assertEquals(
    result.body.configHint,
    "FARASA_API_KEY is missing or rejected — register at farasa.qcri.org",
  );
});

Deno.test("farasa distinguishes a dead service from a rejected key", async () => {
  const result = await call(
    { text: "مرحبا" },
    caller(farasaHosts(() => json({ error: "gateway timeout" }, 504))),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.diacError, "all_endpoints_failed");
  // No configHint: registering a key would not help here.
  assertEquals(result.body.configHint, undefined);
});

Deno.test("farasa reports each failed task separately", async () => {
  const result = await call(
    { text: "مرحبا", tasks: ["diac", "pos"] },
    caller(farasaHosts(() => json({ error: "down" }, 500))),
  );

  assertEquals(result.body.errors, {
    diac: "all_endpoints_failed",
    pos: "all_endpoints_failed",
  });
});

Deno.test("farasa answers 200 even when everything failed", async () => {
  // Pinned, not fixed. Every task failing still returns 200 with nulls, so a
  // caller that only checks the status renders an empty analysis as though the
  // text had simply had nothing to find.
  const result = await call(
    { text: "مرحبا" },
    caller(farasaHosts(() => json({ error: "down" }, 500))),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.diac, null);
});

Deno.test("farasa stops trying endpoints once one answers", async () => {
  let attempts = 0;
  const result = await call(
    { text: "مرحبا" },
    caller(farasaHosts(() => {
      attempts += 1;
      return json({ text: "مَرْحَبَا" });
    })),
  );

  assertEquals(result.status, 200);
  assertEquals(attempts, 1);
});

Deno.test("farasa keeps trying after an endpoint answers with nothing usable", async () => {
  // The whole point of the cascade: one odd response must not end the attempt.
  let attempts = 0;
  const result = await call(
    { text: "مرحبا" },
    caller(farasaHosts(() => {
      attempts += 1;
      return attempts === 1 ? json({ unexpected: "shape" }) : json({ text: "مَرْحَبَا" });
    })),
  );

  assertEquals((result.body.diac as { text: string }).text, "مَرْحَبَا");
  assertEquals(attempts, 2);
});

Deno.test("farasa counts against the free-tier daily cap", async () => {
  const result = await call(
    { text: "مرحبا" },
    caller({
      ...answering("مَرْحَبَا"),
      "/rest/v1/subscribers": () => json({ subscribed: false, subscription_end: null }),
      "/rest/v1/rpc/increment_usage_counter": () => json(201),
    }),
  );

  assertEquals(result.status, 429);
  assertEquals(result.body.error, "daily_limit_reached");
});
