import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `embed-content` — fills the semantic index (content_embeddings) from the
 * app's own content. The shared client lives in _shared/embeddings.ts.
 *
 * The properties that matter: admin-only (it spends embedding tokens on the
 * whole library), incremental (already-embedded rows are skipped, so looping
 * until `embedded: 0` is a safe backfill), and bilingual content (Arabic plus
 * translation embedded together, so English queries land on Arabic lines).
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "11111111-2222-4333-8444-555555555555";
const WORD = "22222222-3333-4444-8555-666666666666";

/** A fixed-dimension fake vector per input, index-tagged like OpenAI's reply. */
const embeddings = (): UpstreamHandler => async (request) => {
  const body = JSON.parse((await request.text()) || "{}");
  const inputs: string[] = Array.isArray(body.input) ? body.input : [];
  return json({
    data: inputs.map((_, index) => ({ index, embedding: [index, 0.5, -0.5] })),
    model: body.model,
  });
};

function backend(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    "/rest/v1/discover_videos": () =>
      json([
        {
          id: VIDEO,
          dialect: "Gulf",
          transcript_lines: [
            { arabic: "وش تبي تاكل الليله؟", translation: "What do you want to eat tonight?" },
            { arabic: "ابي كبسه", translation: "I want kabsa" },
          ],
        },
      ]),
    "/rest/v1/vocabulary_words": () =>
      json([{ id: WORD, word_arabic: "كبسه", word_english: "kabsa", dialect_module: "Gulf" }]),
    "/rest/v1/content_embeddings": (request) =>
      request.method === "GET" ? json([]) : json({}, 201),
    "api.openai.com": embeddings(),
    ...extra,
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, jwt?: string | null) {
  const fn = await loadFunction("embed-content", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("embed-content", body, jwt === undefined ? {} : { jwt }),
    );
    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("embed-content embeds every new line and word, bilingually", async () => {
  const { status, body, calls, bodies } = await call({ kind: "all" }, backend());

  assertEquals(status, 200);
  assertEquals(body.embedded, 3); // two video lines + one vocabulary word

  // The embedding request carries Arabic and English together.
  const embed = calls.findIndex((url) => url.includes("api.openai.com"));
  assertStringIncludes(bodies[embed] ?? "", "وش تبي تاكل الليله؟\\nWhat do you want to eat tonight?");

  // The insert carries kind, chunk, dialect and the vector.
  const insert = calls.findIndex(
    (url, i) => url.includes("content_embeddings") && (bodies[i] ?? "").length > 0,
  );
  const rows = JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>;
  assertEquals(rows.length, 3);
  assertEquals(rows[0].kind, "video_line");
  assertEquals(rows[0].chunk_index, 0);
  assertEquals(rows[0].dialect, "Gulf");
  assert(Array.isArray(rows[0].embedding));
});

Deno.test("embed-content skips lines that are already indexed", async () => {
  const { body, calls } = await call(
    { kind: "video_line" },
    backend({
      "/rest/v1/content_embeddings": (request) =>
        request.method === "GET"
          ? json([
              { source_id: VIDEO, chunk_index: 0 },
              { source_id: VIDEO, chunk_index: 1 },
            ])
          : json({}, 201),
    }),
  );

  // Incremental is the contract: looping a backfill must converge, not
  // re-embed (and re-pay for) the whole library every run.
  assertEquals(body.embedded, 0);
  assert(!calls.some((url) => url.includes("api.openai.com")));
});

Deno.test("embed-content requires the admin role", async () => {
  const { status, calls } = await call(
    { kind: "all" },
    backend({ "/rest/v1/user_roles": () => json([]) }),
  );

  assertEquals(status, 403);
  assert(!calls.some((url) => url.includes("api.openai.com")));
});

Deno.test("embed-content turns anonymous callers away", async () => {
  const { status } = await call(
    { kind: "all" },
    { ...backend(), "/auth/v1/user": () => json({}, 401) },
    null,
  );

  assertEquals(status, 401);
});

Deno.test("embed-content reports a missing index table instead of pretending", async () => {
  const { status, body } = await call(
    { kind: "all" },
    backend({
      "/rest/v1/content_embeddings": (request) =>
        request.method === "GET"
          ? json([])
          : json({ message: 'relation "content_embeddings" does not exist' }, 404),
    }),
  );

  // The likeliest cause: pgvector absent, the guarded migration created
  // nothing. The caller learns the real state; nothing throws.
  assertEquals(status, 200);
  assertEquals(body.embedded, 0);
  assertStringIncludes(String(body.error), "content_embeddings");
});

Deno.test("embed-content skips a video whose dialect it cannot map", async () => {
  const { body } = await call(
    { kind: "video_line" },
    backend({
      "/rest/v1/discover_videos": () =>
        json([{ id: VIDEO, dialect: "MSA", transcript_lines: [{ arabic: "نص", translation: "text" }] }]),
    }),
  );

  assertEquals(body.embedded, 0);
});
