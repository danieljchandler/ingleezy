import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The four admin-only story functions behind the reading library:
 * `suggest-stories`, `generate-suggested-story-text`, `import-authentic-story`
 * and `translate-story-dialect`.
 *
 * They are a pipeline — suggest an idea, write its text, import it into lines
 * and vocabulary, then translate those lines into a dialect — and each stage
 * hands its output to the next as a request body. The interesting part is that
 * three of the four check the caller's *role* rather than a subscription tier,
 * which no learner-facing function does, and the fourth does not check a role
 * at all.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const STORY = "bbbbbbbb-0000-4000-8000-000000000000";

/** An admin caller: authenticated, and `user_roles` answers with the admin row. */
function admin(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    ...extra,
  };
}

/** The same caller with no privileged role. */
function plainUser(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return admin({ "/rest/v1/user_roles": () => json([]), ...extra });
}

const emitting = (payload: unknown): UpstreamHandler => () => chatCompletion("", payload);

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null } = {},
) {
  const fn = await loadFunction(name, { upstreams });
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

/** The prompt sent to whichever gateway the brain picked. */
function promptOf(bodies: Array<string | null>, calls: string[]): string {
  const index = calls.findIndex((url) => url.includes("gateway") || url.includes("openrouter"));
  return bodies[index] ?? "";
}

// ── suggest-stories ──────────────────────────────────────────────────────────

Deno.test("suggest-stories answers the preflight", async () => {
  const fn = await loadFunction("suggest-stories", { upstreams: admin() });
  try {
    const response = await fn.handler(optionsRequest("suggest-stories"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("suggest-stories turns away an anonymous caller", async () => {
  const result = await call(
    "suggest-stories",
    {},
    admin({ "/auth/v1/user": () => json({ error: "no session" }, 401) }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "unauthorized");
});

Deno.test("suggest-stories turns away a signed-in learner", async () => {
  const result = await call("suggest-stories", {}, plainUser());

  assertEquals(result.status, 403);
  assertEquals(result.body.error, "forbidden");
});

Deno.test("suggest-stories returns what the model proposed", async () => {
  const suggestion = {
    title: "The Generous Host",
    title_arabic: "المضيف الكريم",
    description: "A folktale about hospitality.",
    description_arabic: "حكاية عن الكرم.",
    source_type: "folktale",
    estimated_length: "medium",
    themes: ["generosity", "wisdom"],
  };

  const result = await call(
    "suggest-stories",
    { dialect: "Egyptian", difficulty: "beginner" },
    admin({
      "/rest/v1/authentic_stories": () => json([]),
      "/rest/v1/interactive_stories": () => json([]),
      "ai.gateway.lovable.dev": emitting({ suggestions: [suggestion] }),
      "openrouter.ai": emitting({ suggestions: [suggestion] }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals((result.body.suggestions as unknown[]).length, 1);
  assertEquals((result.body.suggestions as Array<{ title: string }>)[0].title, "The Generous Host");
});

Deno.test("suggest-stories asks for English texts, not Arabic ones", async () => {
  // First stage of the pipeline. The other three were flipped with the library
  // and this one was not, so an admin was offered Arabic folktales that the
  // next stage then wrote out in English. Every stage still returned 200 —
  // the mismatch is only visible in the prompt.
  const result = await call(
    "suggest-stories",
    { dialect: "Egyptian", difficulty: "beginner" },
    admin({
      "/rest/v1/authentic_stories": () => json([]),
      "/rest/v1/interactive_stories": () => json([]),
      "ai.gateway.lovable.dev": emitting({ suggestions: [] }),
      "openrouter.ai": emitting({ suggestions: [] }),
    }),
  );

  const prompt = promptOf(result.bodies, result.calls);
  assertStringIncludes(prompt, "curator of ENGLISH reading material");
  assertStringIncludes(prompt, "public domain English literature");
  // The dialect names the reader's first language, not the text's register.
  assertStringIncludes(prompt, "native Egyptian Arabic speakers learning English");
});

Deno.test("suggest-stories tells the model what the library already has", async () => {
  const result = await call(
    "suggest-stories",
    {},
    admin({
      "/rest/v1/authentic_stories": () =>
        json([{ title: "Kalila and Dimna", title_arabic: "كليلة ودمنة" }]),
      "/rest/v1/interactive_stories": () => json([{ title: "The Lost Camel" }]),
      "ai.gateway.lovable.dev": emitting({ suggestions: [] }),
      "openrouter.ai": emitting({ suggestions: [] }),
    }),
  );

  assertEquals(result.status, 200);
  const prompt = promptOf(result.bodies, result.calls);
  assertStringIncludes(prompt, "Kalila and Dimna");
  // Interactive stories are listed too, so a suggestion cannot duplicate a
  // story that exists in the other library.
  assertStringIncludes(prompt, "The Lost Camel");
});

Deno.test("suggest-stories answers an empty proposal with an empty list", async () => {
  const result = await call(
    "suggest-stories",
    {},
    admin({
      "/rest/v1/authentic_stories": () => json([]),
      "/rest/v1/interactive_stories": () => json([]),
      "ai.gateway.lovable.dev": emitting({ suggestions: [] }),
      "openrouter.ai": emitting({ suggestions: [] }),
    }),
  );

  // Pinned, not fixed: a model that proposed nothing is reported as a
  // successful request with zero suggestions, which reads to the admin as "the
  // library is already complete".
  assertEquals(result.status, 200);
  assertEquals(result.body.suggestions, []);
});

// ── generate-suggested-story-text ────────────────────────────────────────────

Deno.test("generate-suggested-story-text needs a title", async () => {
  // The dialect title was required back when the body it produced was Arabic.
  // What it writes now is English, so the English title is the only input it
  // cannot work without.
  const result = await call("generate-suggested-story-text", {}, admin());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing_fields");
});

Deno.test("generate-suggested-story-text works from an English title alone", async () => {
  const result = await call(
    "generate-suggested-story-text",
    { title: "The Generous Host" },
    admin({
      "ai.gateway.lovable.dev": emitting({ body_english: "text" }),
      "openrouter.ai": emitting({ body_english: "text" }),
    }),
  );

  assertEquals(result.status, 200);
});

Deno.test("generate-suggested-story-text turns away a signed-in learner", async () => {
  const result = await call(
    "generate-suggested-story-text",
    { title: "T" },
    plainUser(),
  );

  assertEquals(result.status, 403);
});

Deno.test("generate-suggested-story-text returns ENGLISH and any author", async () => {
  const result = await call(
    "generate-suggested-story-text",
    { title: "The Generous Host", estimated_length: "short" },
    admin({
      "ai.gateway.lovable.dev": emitting({
        body_english: "Once upon a time",
        author: "Traditional",
      }),
      "openrouter.ai": emitting({ body_english: "Once upon a time" }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.body_english, "Once upon a time");
  assertEquals(result.body.author, "Traditional");
  // This is the empty-shelf path and it feeds the importer, which is what
  // builds the Arabic. Emitting a scaffold here too would give a generated
  // story a second route to one, free to drift from the imported route.
  assertEquals(result.body.body_arabic, undefined);
});

Deno.test("generate-suggested-story-text nulls an author the model did not know", async () => {
  const result = await call(
    "generate-suggested-story-text",
    { title: "T" },
    admin({
      "ai.gateway.lovable.dev": emitting({ body_english: "text" }),
      "openrouter.ai": emitting({ body_english: "text" }),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.author, null);
});

Deno.test("generate-suggested-story-text asks for the requested length and level", async () => {
  const result = await call(
    "generate-suggested-story-text",
    {
      title: "The Generous Host",
      estimated_length: "long",
      difficulty: "advanced",
      themes: ["generosity"],
    },
    admin({
      "ai.gateway.lovable.dev": emitting({ body_english: "text" }),
      "openrouter.ai": emitting({ body_english: "text" }),
    }),
  );

  const prompt = promptOf(result.bodies, result.calls);
  assertStringIncludes(prompt, "long");
  assertStringIncludes(prompt, "advanced");
  assertStringIncludes(prompt, "generosity");
  // And that what it is being asked for is English at all.
  assertStringIncludes(prompt, "ENGLISH reading material");
});

Deno.test("generate-suggested-story-text reports a model that wrote nothing", async () => {
  const result = await call(
    "generate-suggested-story-text",
    { title: "T" },
    admin({
      // A tool call that carried an author but no text. A reply with no tool
      // call at all is a different failure — askBrain throws, and the function
      // answers 500 `internal` rather than 500 `generation_failed`.
      "ai.gateway.lovable.dev": emitting({ author: "Traditional" }),
      "openrouter.ai": emitting({ author: "Traditional" }),
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "generation_failed");
});

// ── import-authentic-story ───────────────────────────────────────────────────

const processed = {
  title_arabic: "المضيف الكريم",
  lines: [
    {
      english: "Once upon a time",
      arabic: "كان يا ما كان",
      literal: "كان مرة على زمن",
    },
    // No `literal` — the gloss is the part a model is most likely to skip.
    { english: "in the old days", arabic: "في قديم الزمان" },
  ],
  vocabulary: [{ english: "time", arabic: "زمان" }],
};

function importUpstreams(extra: Record<string, UpstreamHandler> = {}) {
  return admin({
    "ai.gateway.lovable.dev": emitting(processed),
    "openrouter.ai": emitting(processed),
    "/rest/v1/authentic_stories": () => json({ id: STORY, title: "The Generous Host" }),
    "/rest/v1/authentic_story_lines": () => json([], 201),
    ...extra,
  });
}

Deno.test("import-authentic-story needs a title and an English body", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "The Generous Host", title_arabic: "المضيف الكريم" },
    importUpstreams(),
  );

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing_fields");
});

Deno.test("import-authentic-story imports without a dialect title", async () => {
  // An admin pasting a real English article is not necessarily an Arabic
  // writer, so the dialect title is derived rather than demanded.
  const result = await call(
    "import-authentic-story",
    { title: "The Generous Host", body_english: "Once upon a time. In the old days." },
    importUpstreams(),
  );

  assertEquals(result.status, 200);
  const saved = JSON.parse(
    result.bodies[
      result.calls.findIndex(
        (url, i) => url.includes("/rest/v1/authentic_stories") && result.methods[i] === "POST",
      )
    ] ?? "{}",
  ) as Record<string, string>;
  assertEquals(saved.title_arabic, "المضيف الكريم");
});

Deno.test("import-authentic-story turns away a signed-in learner", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    plainUser(),
  );

  assertEquals(result.status, 403);
});

Deno.test("import-authentic-story saves the story as a draft", async () => {
  const result = await call(
    "import-authentic-story",
    {
      title: "The Generous Host",
      title_arabic: "المضيف الكريم",
      body_english: "Once upon a time. In the old days.",
      dialect: "Egyptian",
    },
    importUpstreams(),
  );

  assertEquals(result.status, 200);
  const insert = result.bodies[
    result.calls.findIndex(
      (url, i) => url.includes("/rest/v1/authentic_stories") && result.methods[i] === "POST",
    )
  ];
  const saved = JSON.parse(insert ?? "{}") as Record<string, unknown>;
  // Nothing an admin imports is published straight away, and the licence
  // defaults to public domain rather than to nothing.
  assertEquals(saved.status, "draft");
  assertEquals(saved.license, "public_domain");
  assertEquals(saved.difficulty, "intermediate");
  assertEquals(saved.dialect, "Egyptian");
  assertEquals(saved.created_by, USER);
});

Deno.test("import-authentic-story rebuilds the body from the segmented lines", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "a long text" },
    importUpstreams(),
  );

  const insert = result.bodies[
    result.calls.findIndex(
      (url, i) => url.includes("/rest/v1/authentic_stories") && result.methods[i] === "POST",
    )
  ];
  const saved = JSON.parse(insert ?? "{}") as Record<string, string>;
  // The stored body is the model's segmentation joined back up, not the text
  // the admin pasted — so what is read line by line and what is read as prose
  // cannot drift apart.
  assertEquals(saved.body_english, "Once upon a time\nin the old days");
  // The Arabic lands in the scaffold column. The Fusha pair belonged to the
  // Arabic-source era; writing to them would put Arabic back where the reader
  // used to look for the primary text.
  assertEquals(saved.body_dialect, "كان يا ما كان\nفي قديم الزمان");
  assertEquals(saved.body_fusha, undefined);
  assertEquals(saved.body_fusha_vocalized, undefined);
});

Deno.test("import-authentic-story writes a row per line, in order", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams(),
  );

  const insert = result.bodies[
    result.calls.findIndex((url) => url.includes("/rest/v1/authentic_story_lines"))
  ];
  const rows = JSON.parse(insert ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows.length, 2);
  assertEquals(rows[0].line_index, 0);
  assertEquals(rows[0].story_id, STORY);
  // English is the line; Arabic is the help beside it.
  assertEquals(rows[0].english, "Once upon a time");
  assertEquals(rows[0].arabic, "كان يا ما كان");
  assertEquals(rows[0].literal_arabic, "كان مرة على زمن");
  // The second line's gloss is optional and the model omitted it.
  assertEquals(rows[1].literal_arabic, null);
});

Deno.test("import-authentic-story keeps the pasted English out of the model's hands", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams(),
  );

  // The one instruction holding the direction in place: a model handed English
  // and asked to "process" it will otherwise translate it into Arabic and
  // leave the library reading the wrong way round again.
  const prompt = promptOf(result.bodies, result.calls);
  assertStringIncludes(prompt, "do not translate it");
});

Deno.test("import-authentic-story drops a line the model left unglossed", async () => {
  // `authentic_story_lines.arabic` is NOT NULL, so one skipped gloss would
  // fail the whole insert and lose an import the admin already waited on.
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams({
      "ai.gateway.lovable.dev": emitting({
        ...processed,
        lines: [processed.lines[0], { english: "in the old days", arabic: "  " }],
      }),
      "openrouter.ai": emitting({
        ...processed,
        lines: [processed.lines[0], { english: "in the old days", arabic: "  " }],
      }),
    }),
  );

  assertEquals(result.status, 200);
  const rows = JSON.parse(
    result.bodies[result.calls.findIndex((url) => url.includes("/rest/v1/authentic_story_lines"))] ?? "[]",
  ) as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
});

Deno.test("import-authentic-story reports a model that segmented nothing", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams({
      "ai.gateway.lovable.dev": emitting({ lines: [], vocabulary: [] }),
      "openrouter.ai": emitting({ lines: [], vocabulary: [] }),
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "processing_failed");
});

Deno.test("import-authentic-story reports a rejected save", async () => {
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams({
      "/rest/v1/authentic_stories": () => json({ message: "permission denied" }, 403),
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "save_failed");
});

Deno.test("import-authentic-story keeps the story when its lines fail to save", async () => {
  // Pinned, not fixed. A failed line insert is logged and swallowed, so the
  // story is returned as imported while the reading view has nothing to show —
  // and re-importing would create a second copy rather than repair the first.
  const result = await call(
    "import-authentic-story",
    { title: "T", body_english: "text" },
    importUpstreams({
      "/rest/v1/authentic_story_lines": () => json({ message: "permission denied" }, 403),
    }),
  );

  assertEquals(result.status, 200);
  assertEquals((result.body.story as Record<string, unknown>).id, STORY);
});

// ── translate-story-dialect ──────────────────────────────────────────────────

const translated = {
  lines: [
    { arabic: "كان في مرة", literal: "كان مرة على زمن" },
    { arabic: "من زمان", literal: "من الأيام القديمة" },
  ],
};

const storyLines = [
  {
    id: "line-0",
    story_id: STORY,
    line_index: 0,
    english: "Once upon a time",
    arabic: "كان يا ما كان",
  },
  {
    id: "line-1",
    story_id: STORY,
    line_index: 1,
    english: "in the old days",
    arabic: "في قديم الزمان",
  },
];

function translateUpstreams(extra: Record<string, UpstreamHandler> = {}) {
  return admin({
    "ai.gateway.lovable.dev": emitting(translated),
    "openrouter.ai": emitting(translated),
    "/rest/v1/authentic_story_lines": () => json(storyLines),
    "/rest/v1/authentic_stories": () => json([]),
    ...extra,
  });
}

Deno.test("translate-story-dialect needs a story and a dialect", async () => {
  const result = await call("translate-story-dialect", { story_id: STORY }, translateUpstreams());

  assertEquals(result.status, 400);
  assertEquals(result.body.error, "missing_fields");
});

Deno.test("translate-story-dialect turns away an anonymous caller", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    translateUpstreams({ "/auth/v1/user": () => json({ error: "no session" }, 401) }),
    { jwt: null },
  );

  assertEquals(result.status, 401);
});

Deno.test("translate-story-dialect turns away a signed-in learner", async () => {
  // Previously pinned as a live gap: its three siblings all checked for the
  // admin role and this one did not, so any authenticated account could
  // re-gloss every line of a published story out from under the learners
  // reading it. Closed when the function was flipped.
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    plainUser({
      "ai.gateway.lovable.dev": emitting(translated),
      "openrouter.ai": emitting(translated),
      "/rest/v1/authentic_story_lines": () => json(storyLines),
      "/rest/v1/authentic_stories": () => json([]),
    }),
  );

  assertEquals(result.status, 403);
});

Deno.test("translate-story-dialect says so when the story has no lines", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    translateUpstreams({ "/rest/v1/authentic_story_lines": () => json([]) }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "story_not_found");
});

Deno.test("translate-story-dialect writes the new scaffold back to each line", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Egyptian" },
    translateUpstreams(),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.lines_translated, 2);

  const patches = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .filter((c) => c.url.includes("/rest/v1/authentic_story_lines") && c.method === "PATCH");

  assertEquals(patches.length, 2);
  assertEquals(JSON.parse(patches[0].body ?? "{}").arabic, "كان في مرة");
  assertEquals(JSON.parse(patches[1].body ?? "{}").literal_arabic, "من الأيام القديمة");
});

Deno.test("translate-story-dialect re-glosses from the English, not the old Arabic", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Egyptian" },
    translateUpstreams(),
  );

  // Going dialect-to-dialect would compound whatever the first pass got wrong.
  // The English is the source of truth and is what does not change.
  const prompt = promptOf(result.bodies, result.calls);
  assertStringIncludes(prompt, "Once upon a time");
  assertStringIncludes(prompt, "Egyptian");
});

Deno.test("translate-story-dialect stamps the dialect on the story too", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Egyptian" },
    translateUpstreams(),
  );

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/authentic_stories") && c.method === "PATCH");

  const saved = JSON.parse(patch?.body ?? "{}") as Record<string, string>;
  assertEquals(saved.dialect, "Egyptian");
  assertEquals(saved.body_dialect, "كان في مرة\nمن زمان");
});

Deno.test("translate-story-dialect refuses to relabel a half-converted story", async () => {
  // A model that returns fewer lines than the story has still leaves the tail
  // untouched rather than shifting every later line onto the wrong gloss — but
  // the story must not then be badged with the new dialect, because the label
  // is what a learner picks it by. Half Egyptian and half Gulf under an
  // "Egyptian" badge is worse than a run that plainly failed.
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    translateUpstreams({
      "ai.gateway.lovable.dev": emitting({ lines: [translated.lines[0]] }),
      "openrouter.ai": emitting({ lines: [translated.lines[0]] }),
    }),
  );

  assertEquals(result.status, 502);
  assertEquals(result.body.error, "partial_translation");
  assertEquals(result.body.lines_translated, 1);
  assertEquals(result.body.lines_expected, 2);

  const patches = result.calls.filter(
    (url, i) => url.includes("/rest/v1/authentic_story_lines") && result.methods[i] === "PATCH",
  );
  assertEquals(patches.length, 1);

  const storyPatch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/authentic_stories") && c.method === "PATCH");
  assertEquals(JSON.parse(storyPatch?.body ?? "{}").dialect, undefined);
});

Deno.test("translate-story-dialect reports a run that translated nothing", async () => {
  // Previously pinned as a live bug: a model that returned no lines still
  // answered `success: true`, so a failed run looked like a completed one —
  // having erased the previous scaffold on the way. It now fails loudly and
  // leaves the story's dialect label alone.
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    translateUpstreams({
      "ai.gateway.lovable.dev": emitting({ lines: [] }),
      "openrouter.ai": emitting({ lines: [] }),
    }),
  );

  assertEquals(result.status, 502);
  assertEquals(result.body.error, "partial_translation");
  assertEquals(result.body.lines_translated, 0);

  const patch = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("/rest/v1/authentic_stories") && c.method === "PATCH");
  assertEquals(JSON.parse(patch?.body ?? "{}").dialect, undefined);
});

Deno.test("translate-story-dialect says so when the story has no English to work from", async () => {
  const result = await call(
    "translate-story-dialect",
    { story_id: STORY, dialect: "Gulf" },
    translateUpstreams({
      "/rest/v1/authentic_story_lines": () =>
        json([{ id: "line-0", story_id: STORY, line_index: 0, english: "", arabic: "قديم" }]),
    }),
  );

  assertEquals(result.status, 422);
  assertEquals(result.body.error, "no_english_lines");
});
