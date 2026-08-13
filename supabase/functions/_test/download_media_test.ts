import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `download-media` — the front door of the Transcribe pipeline.
 *
 * It takes a URL from a text box and fetches it, which makes its URL handling a
 * security boundary rather than input validation: an unchecked scheme here
 * turns the function into a fetcher for `file://` and link-local addresses on
 * the app's own network. It also accepts the service-role key as an alternative
 * to a user JWT, because the admin video pipeline calls it server-to-server —
 * so "who may call this" has two answers rather than one.
 *
 * Everything after the guards is a fallback chain. YouTube alone has three
 * strategies in a deliberate order, and the ordering is the design: each one is
 * slower and less reliable than the last, so the tests assert that a working
 * earlier strategy stops the chain rather than merely that *some* strategy
 * produced bytes.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const SERVICE_ROLE = "fixture-service-role";
const YT = "https://www.youtube.com/watch?v=abc12345678";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/processed_videos": () => json(null),
    // The HEAD probe that opens every request. A watch page is HTML, so it
    // fails `looksLikeMedia` and the strategy chain runs — which is the path
    // under test.
    "youtube.com": () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    ...extra,
  };
}

/**
 * The three Cobalt instances, in the order the function tries them.
 *
 * Unauthenticated community instances first, the official key-gated one last —
 * so a deployment with no `COBALT_API_KEY` still works, and one with a key does
 * not spend it before the free instances have been asked.
 */
const COBALT_INSTANCES = ["co.imput.net", "cobalt.canine.tools", "api.cobalt.tools"];

/**
 * Real audio bytes at a CDN, which every strategy ends up downloading.
 *
 * Over 1 KB deliberately: anything smaller is rejected as "file too small",
 * which is how the function tells a real download from an extractor that
 * returned an error page with a media content type.
 */
const MEDIA_SIZE = 4096;
const mediaBytes = (): UpstreamHandler => () => {
  const bytes = new Uint8Array(MEDIA_SIZE);
  bytes.set([0x49, 0x44, 0x33, 0x04]);
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": "audio/mpeg", "content-length": String(MEDIA_SIZE) },
  });
};

/** Cobalt's answer, which is a pointer rather than the bytes. */
const cobalt = (url = "https://cdn.test/media.mp3"): UpstreamHandler => () =>
  json({ status: "stream", url });

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("download-media", {
    upstreams,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE, ...opts.env },
  });
  try {
    const response = await fn.handler(
      jsonRequest("download-media", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

// ── Who may call it ─────────────────────────────────────────────────────────

Deno.test("download-media refuses a caller with no bearer token", async () => {
  const { status, calls } = await call({ url: YT }, caller(), { jwt: null });

  assertEquals(status, 401);
  // Nothing is fetched. This function makes outbound requests on the app's
  // behalf, so an unauthenticated caller must not reach that point at all.
  assert(!calls.some((url) => COBALT_INSTANCES.some((host) => url.includes(host))));
});

Deno.test("download-media refuses a token that resolves to no user", async () => {
  const { status } = await call(
    { url: YT },
    caller({ "/auth/v1/user": () => json({ message: "bad jwt" }, 401) }),
  );

  assertEquals(status, 401);
});

Deno.test("download-media accepts the service-role key from the video pipeline", async () => {
  const { status, calls } = await call(
    { url: YT },
    caller({
      "co.imput.net": cobalt(),
      "cdn.test": mediaBytes(),
    }),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  // The admin video pipeline calls this server-to-server, where there is no
  // user session to present. Recognised by the token itself rather than by a
  // separate endpoint.
  assert(!calls.some((url) => url.includes("/auth/v1/user")));
});

Deno.test("download-media does not treat an unset service key as a match", async () => {
  const { status } = await call(
    { url: YT },
    caller({ "co.imput.net": cobalt(), "cdn.test": mediaBytes() }),
    { jwt: "", env: { SUPABASE_SERVICE_ROLE_KEY: undefined } },
  );

  // The comparison falls back to a NUL sentinel rather than the empty string,
  // so an unconfigured deployment cannot be walked into by sending an empty
  // token. Without it, `"" === ""` would authenticate anyone as the pipeline.
  assertEquals(status, 401);
});

// ── What it will fetch ──────────────────────────────────────────────────────

Deno.test("download-media refuses a request with no URL", async () => {
  for (const url of [undefined, "", 42, null]) {
    const { status, body } = await call({ url }, caller());

    assertEquals(status, 400, `expected ${JSON.stringify(url)} to be refused`);
    assertEquals(body.error, "URL is required");
  }
});

Deno.test("download-media never speaks a non-HTTP scheme", async () => {
  for (const url of ["file:///etc/passwd", "ftp://example.test/x", "data:text/plain,hi"]) {
    const { status, calls } = await call({ url }, caller());

    // The outcome that matters, and it holds: nothing is ever fetched over
    // `file:`, `ftp:` or `data:`.
    assertEquals(status, 400, `expected ${url} to be refused`);
    assert(
      calls.every((c) => c.startsWith("http://") || c.startsWith("https://")),
      `non-HTTP request issued for ${url}`,
    );
  }
});

Deno.test("download-media reaches neither of its own URL guards", async () => {
  // Pinned as dead code. The normaliser runs *before* the checks and prepends
  // `https://` to anything not already starting with `http://` or `https://`,
  // so `file:///etc/passwd` becomes `https://file:///etc/passwd` — which parses
  // fine, with protocol `https:`. Both the "Invalid URL format" branch and the
  // "Only HTTP/HTTPS URLs are supported" branch are therefore unreachable for
  // every input that gets past the `typeof url === "string"` check.
  //
  // The effect is benign — the prefixing neutralises the scheme rather than
  // honouring it, so the guard's *purpose* is still served — but the two error
  // messages can never be produced, and anything that looked like a scheme
  // turns into an HTTPS request to a garbage host instead of a clear refusal.
  for (const url of ["file:///etc/passwd", "ftp://example.test/x", "ht!tp://%%%"]) {
    const { body } = await call({ url }, caller());

    assertEquals(
      body.error,
      "Could not download the media file. Try uploading the file directly instead.",
      `expected ${url} to fall through to the generic failure`,
    );
  }
});

Deno.test("download-media adds a scheme to a bare host", async () => {
  const { status, body } = await call(
    { url: "cdn.test/media.mp3" },
    caller({ "cdn.test": mediaBytes() }),
  );

  // Learners paste what they copied, and that is routinely missing the scheme.
  assertEquals(status, 200);
  assertStringIncludes(String(body.originalUrl), "https://cdn.test/media.mp3");
});

// ── The cache ───────────────────────────────────────────────────────────────

const cachedRow = (ageDays: number) => ({
  content_hash: "youtube:abc12345678",
  transcription_data: { text: "مرحبا" },
  processing_engines: ["deepgram"],
  processed_at: new Date(Date.now() - ageDays * 86_400_000).toISOString(),
});

Deno.test("download-media answers from cache without downloading", async () => {
  const { status, body, calls } = await call(
    { url: YT },
    caller({
      "/rest/v1/processed_videos": () => json(cachedRow(3)),
      "co.imput.net": cobalt(),
      "cdn.test": mediaBytes(),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.cached, true);
  assertEquals(body.transcriptionData, { text: "مرحبا" });
  // The whole point: a video someone already transcribed costs nothing the
  // second time, and downloading it again would also re-spend ASR budget
  // downstream.
  assert(!calls.some((url) => COBALT_INSTANCES.some((host) => url.includes(host))));
});

Deno.test("download-media re-downloads a cache entry older than a month", async () => {
  const { status, body, calls } = await call(
    { url: YT },
    caller({
      "/rest/v1/processed_videos": () => json(cachedRow(45)),
      "co.imput.net": cobalt(),
      "cdn.test": mediaBytes(),
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.cached, undefined);
  assert(calls.some((url) => url.includes("co.imput.net")));
});

Deno.test("download-media skips the cache when asked to", async () => {
  const { body, calls } = await call(
    { url: YT, bypassCache: true },
    caller({
      "/rest/v1/processed_videos": () => json(cachedRow(1)),
      "co.imput.net": cobalt(),
      "cdn.test": mediaBytes(),
    }),
  );

  assertEquals(body.cached, undefined);
  // Not even looked up — the admin pipeline uses this to force a re-process
  // after changing how transcription works.
  assert(!calls.some((url) => url.includes("processed_videos")));
});

Deno.test("download-media downloads anyway when the cache lookup fails", async () => {
  const { status, calls } = await call(
    { url: YT },
    caller({
      "/rest/v1/processed_videos": () => json({ message: "denied" }, 403),
      "co.imput.net": cobalt(),
      "cdn.test": mediaBytes(),
    }),
  );

  // The cache is an optimisation. A learner must not be blocked from
  // transcribing because a lookup table was unreachable.
  assertEquals(status, 200);
  assert(calls.some((url) => url.includes("co.imput.net")));
});

Deno.test("download-media does not cache-check a URL with no video id", async () => {
  const { calls } = await call(
    { url: "https://cdn.test/media.mp3" },
    caller({ "cdn.test": mediaBytes() }),
  );

  // The cache key is `platform:videoId`. A direct file URL has neither, and a
  // lookup on an empty key would match whatever happened to be stored first.
  assert(!calls.some((url) => url.includes("processed_videos")));
});

// ── The download strategies ─────────────────────────────────────────────────

Deno.test("download-media takes a direct media URL without any strategy", async () => {
  const { status, body, calls } = await call(
    { url: "https://cdn.test/clip.mp3" },
    caller({ "cdn.test": mediaBytes() }),
  );

  assertEquals(status, 200);
  assertEquals(body.contentType, "audio/mpeg");
  assertEquals(body.filename, "clip.mp3");
  // Detected by a HEAD request, so a media file is never routed through an
  // extractor that would only fetch the same bytes more slowly.
  assert(!calls.some((url) => COBALT_INSTANCES.some((host) => url.includes(host))));
});

Deno.test("download-media returns base64 the caller can hand to ASR", async () => {
  const { body } = await call(
    { url: "https://cdn.test/clip.mp3" },
    caller({ "cdn.test": mediaBytes() }),
  );

  // Transcribe treats a falsy `audioBase64` as "no audio file found" and
  // aborts, so a zero-length body here reads as a failed download.
  assert(String(body.audioBase64).length > 0);
  assertEquals(body.size, MEDIA_SIZE);
});

Deno.test("download-media tries Cobalt first for YouTube", async () => {
  const { status, calls } = await call(
    { url: YT },
    caller({ "co.imput.net": cobalt(), "cdn.test": mediaBytes() }),
  );

  assertEquals(status, 200);
  // Three strategies in a deliberate order, each slower and less reliable than
  // the last. A working Cobalt has to stop the chain, not merely be tried.
  assert(calls.some((url) => url.includes("co.imput.net")));
  assert(!calls.some((url) => url.includes("rapidapi")));
});

Deno.test("download-media asks the free Cobalt instances before the paid one", async () => {
  const { calls } = await call(
    { url: YT },
    caller({
      "co.imput.net": () => json({ status: "error" }, 500),
      "cobalt.canine.tools": cobalt(),
      "api.cobalt.tools": cobalt(),
      "cdn.test": mediaBytes(),
    }),
  );

  const tried = COBALT_INSTANCES.filter((host) => calls.some((url) => url.includes(host)));
  // The key-gated instance is a fallback, not the default: a deployment with a
  // key should not spend it while a community instance is answering.
  assertEquals(tried, ["co.imput.net", "cobalt.canine.tools"]);
});

Deno.test("download-media falls through to RapidAPI when every Cobalt fails", async () => {
  const { calls } = await call(
    { url: YT },
    caller({
      "co.imput.net": () => json({ status: "error" }, 500),
      "cobalt.canine.tools": () => json({ status: "error" }, 500),
      "api.cobalt.tools": () => json({ status: "error" }, 500),
      "rapidapi.com": () => json({ link: "https://cdn.test/media.mp3" }),
      "cdn.test": mediaBytes(),
    }),
  );

  assert(calls.some((url) => url.includes("rapidapi")));
});

Deno.test("download-media reports a URL nothing could download", async () => {
  const { status, body } = await call(
    { url: "https://www.tiktok.com/@someone/video/123" },
    caller({
      "co.imput.net": () => json({ status: "error" }, 500),
      "cobalt.canine.tools": () => json({ status: "error" }, 500),
      "api.cobalt.tools": () => json({ status: "error" }, 500),
      "tiktok.com": () => new Response("<html></html>", { status: 200 }),
      "tikwm.com": () => json({ code: -1 }),
    }),
  );

  assertEquals(status, 400);
  // Names the way out. Every extractor breaks eventually as the sites change,
  // and a direct upload always works.
  assertStringIncludes(String(body.error), "uploading the file directly");
});

Deno.test("download-media survives an unreachable host", async () => {
  const { status } = await call(
    { url: "https://cdn.test/clip.mp3" },
    caller({
      "cdn.test": () => {
        throw new TypeError("connection refused");
      },
    }),
  );

  // The HEAD check is wrapped precisely because it fails routinely; a thrown
  // fetch must fall through to the strategies rather than 500.
  assertEquals(status, 400);
});
