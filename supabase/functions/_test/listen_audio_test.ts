import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-listen-line-audio` — one line of a Listen episode, spoken.
 *
 * It is a cache in front of three TTS providers. The cache is the point: a
 * podcast episode is dozens of lines and every learner who plays it would
 * otherwise pay for the same synthesis, so a hit must not reach a provider at
 * all — and a miss must write the result back under a key the next request
 * will find.
 *
 * Which provider it picks is dialect-dependent and degrades: Gulf prefers
 * Munsit and falls back to Azure when the voice list cannot be read, Egyptian
 * prefers ElevenLabs, and everything else is Azure.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const EPISODE = "cccccccc-0000-4000-8000-000000000000";

const script = [
  { arabic: "مرحبا بالجميع", speaker: "Layla", speaker_role: "host_a" },
  { arabic: "أهلا فيك", speaker: "Omar", speaker_role: "host_b" },
];

/**
 * The two tables plus storage.
 *
 * `cached` is what the line-audio table answers on the first read; passing null
 * is the cache miss that drives the synthesis path.
 */
function backend(
  options: {
    cached?: string | null;
    episode?: Record<string, unknown> | null;
    extra?: Record<string, UpstreamHandler>;
  } = {},
): Record<string, UpstreamHandler> {
  const { cached = null, episode = { dialect: "Gulf", script }, extra = {} } = options;
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/listen_line_audio": (request) =>
      request.method === "GET" ? json(cached ? { audio_url: cached } : null) : json([], 201),
    "/rest/v1/listen_episodes": () => json(episode),
    "/storage/v1": () => json({ Key: "listen-audio/episodes/line.mp3" }),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("generate-listen-line-audio", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(
        "generate-listen-line-audio",
        body,
        opts.jwt === undefined ? {} : { jwt: opts.jwt },
      ),
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

Deno.test("generate-listen-line-audio answers the preflight", async () => {
  const fn = await loadFunction("generate-listen-line-audio", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("generate-listen-line-audio"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-listen-line-audio refuses a request with no session", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 0 }, backend(), { jwt: null });

  assertEquals(result.status, 401);
  assertEquals(result.body.error, "Unauthorized");
});

Deno.test("generate-listen-line-audio refuses a token the auth server rejects", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ extra: { "/auth/v1/user": () => json({ error: "bad token" }, 401) } }),
  );

  assertEquals(result.status, 401);
});

Deno.test("generate-listen-line-audio needs an episode and a line number", async () => {
  const noEpisode = await call({ lineIndex: 0 }, backend());
  assertEquals(noEpisode.status, 400);
  assertEquals(noEpisode.body.error, "bad_request");

  const noLine = await call({ episodeId: EPISODE }, backend());
  assertEquals(noLine.status, 400);
});

Deno.test("generate-listen-line-audio rejects a line number sent as a string", async () => {
  // `typeof lineIndex !== "number"` rather than a truthiness check, which is
  // also what keeps line 0 from being rejected as falsy.
  const result = await call({ episodeId: EPISODE, lineIndex: "0" }, backend());

  assertEquals(result.status, 400);
});

Deno.test("generate-listen-line-audio accepts the first line", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 0 }, backend());

  assertEquals(result.status, 200);
});

Deno.test("generate-listen-line-audio returns a cached line without synthesising", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ cached: "https://cdn.test/line-0.mp3" }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.audio_url, "https://cdn.test/line-0.mp3");
  assertEquals(result.body.cached, true);
  // Neither the episode nor any provider is touched on a hit.
  assertEquals(result.calls.some((url) => url.includes("listen_episodes")), false);
  assertEquals(result.calls.some((url) => url.includes("munsit")), false);
  assertEquals(result.calls.some((url) => url.includes("speech.microsoft.com")), false);
});

Deno.test("generate-listen-line-audio looks the cache up by episode and line", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 3 }, backend({ episode: null }));

  const read = result.calls.find((url) => url.includes("listen_line_audio")) ?? "";
  assertStringIncludes(read, `episode_id=eq.${EPISODE}`);
  assertStringIncludes(read, "line_index=eq.3");
});

Deno.test("generate-listen-line-audio says so when the episode is gone", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 0 }, backend({ episode: null }));

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "episode_not_found");
});

Deno.test("generate-listen-line-audio says so when the line is past the end", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 9 }, backend());

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "line_not_found");
});

Deno.test("generate-listen-line-audio says so when the line has no Arabic", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ episode: { dialect: "Gulf", script: [{ speaker: "Layla" }] } }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "line_not_found");
});

Deno.test("generate-listen-line-audio treats a missing script as an empty one", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ episode: { dialect: "Gulf", script: null } }),
  );

  assertEquals(result.status, 404);
  assertEquals(result.body.error, "line_not_found");
});

Deno.test("generate-listen-line-audio synthesises an uncached line", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 0 }, backend());

  assertEquals(result.status, 200);
  assertEquals(result.body.cached, false);
  assert(String(result.body.audio_url).includes("listen-audio"));
});

Deno.test("generate-listen-line-audio uses Azure when ElevenLabs is not configured", async () => {
  // English episodes: ElevenLabs first, Azure en-US neural voices as the
  // no-key fallback. Munsit (Arabic-only) is out of this path entirely.
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend(),
    { env: { ELEVENLABS_API_KEY: undefined } },
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.provider, "azure");
});

Deno.test("generate-listen-line-audio uses ElevenLabs for an Egyptian episode", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ episode: { dialect: "Egyptian", script } }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.provider, "elevenlabs");
});

Deno.test("generate-listen-line-audio uses the same English voice plan for every dialect", async () => {
  // The dialect is the learner's L1, not the episode's language — the spoken
  // lines are English, so a Yemeni learner's episode uses the same voices.
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ episode: { dialect: "Yemeni", script } }),
  );

  assertEquals(result.status, 200);
  assertEquals(result.body.provider, "elevenlabs");
});

Deno.test("generate-listen-line-audio stores the clip under a per-line key", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 1 }, backend());

  assertEquals(result.status, 200);
  const upload = result.calls.find((url) => url.includes("/storage/v1/object")) ?? "";
  // Episode and line in the path, so re-synthesising overwrites rather than
  // piling up a second copy.
  assertStringIncludes(upload, `episodes/${EPISODE}/line-1.`);
});

Deno.test("generate-listen-line-audio names the file after the provider's format", async () => {
  const azure = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ episode: { dialect: "Yemeni", script } }),
  );
  assert(
    azure.calls.find((url) => url.includes("/storage/v1/object"))?.endsWith(".mp3"),
    "Azure returns MP3",
  );
});

Deno.test("generate-listen-line-audio caches the result for the next listener", async () => {
  const result = await call({ episodeId: EPISODE, lineIndex: 1 }, backend());

  assertEquals(result.status, 200);
  const write = result.calls
    .map((url, i) => ({ url, method: result.methods[i], body: result.bodies[i] }))
    .find((c) => c.url.includes("listen_line_audio") && c.method === "POST");
  assert(write, "expected the synthesised line to be cached");
  const row = JSON.parse(write?.body ?? "{}") as Record<string, unknown>;
  assertEquals(row.episode_id, EPISODE);
  assertEquals(row.line_index, 1);
  assertEquals(row.speaker, "Omar");
  assert(String(row.audio_url).includes("listen-audio"));
});

Deno.test("generate-listen-line-audio upserts on the episode and line pair", async () => {
  // Two listeners hitting the same uncached line must not create two rows.
  const result = await call({ episodeId: EPISODE, lineIndex: 0 }, backend());

  const write = result.calls
    .map((url, i) => ({ url, method: result.methods[i], headers: i }))
    .find((c) => c.url.includes("listen_line_audio") && c.method === "POST");
  assertStringIncludes(write?.url ?? "", "on_conflict=episode_id%2Cline_index");
});

Deno.test("generate-listen-line-audio reports a failed upload", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({ extra: { "/storage/v1": () => json({ message: "bucket missing" }, 400) } }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "internal");
  assertStringIncludes(String(result.body.detail), "upload");
});

// ── Munsit, last ─────────────────────────────────────────────────────────────
//
// `listenTts` caches the resolved Munsit voice list at module scope, and Deno
// caches the module itself — so the first test that succeeds with Munsit makes
// every later Gulf request use it regardless of what its own fixtures say. The
// two tests that need Munsit to work therefore come last, after every fallback
// assertion has already run.

Deno.test("generate-listen-line-audio reports a TTS outage", async () => {
  const result = await call(
    { episodeId: EPISODE, lineIndex: 0 },
    backend({
      extra: {
        "api.elevenlabs.io": () => json({ error: "down" }, 503),
        "tts.speech.microsoft.com": () => json({ error: "down" }, 503),
      },
    }),
  );

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "internal");
});
