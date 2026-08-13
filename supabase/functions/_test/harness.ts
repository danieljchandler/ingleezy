import { takeCapturedHandler, type Handler } from "./serveShim.ts";
import { defaultUpstreams, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * Loads an edge function as a callable handler, with its environment and every
 * outbound `fetch` under the test's control.
 *
 * The 84 functions had no runtime coverage at all — `deno check` proved they
 * compiled and nothing proved they responded. This makes each one's CORS,
 * auth, validation, error-mapping and happy path assertable in about thirty
 * lines, without touching a single production file.
 */

/** Every secret the functions read, set to something obviously fake. */
export const FIXTURE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://e2e.supabase.co",
  SUPABASE_ANON_KEY: "e2e-anon-key-not-a-real-secret",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-not-a-real-secret",

  LOVABLE_API_KEY: "fixture-lovable",
  OPENROUTER_API_KEY: "fixture-openrouter",
  GEMINI_API_KEY: "fixture-gemini",
  OPENAI_API_KEY: "fixture-openai",
  FANAR_API_KEY: "fixture-fanar",
  HUGGINGFACE_API_KEY: "fixture-hf",

  AZURE_SPEECH_KEY: "fixture-azure",
  AZURE_SPEECH_REGION: "westeurope",
  ELEVENLABS_API_KEY: "fixture-elevenlabs",
  ELEVENLABS_TTS_MODEL: "eleven_multilingual_v2",
  ELEVENLABS_STT_MODEL: "scribe_v1",
  DEEPGRAM_API_KEY: "fixture-deepgram",
  SONIOX_API_KEY: "fixture-soniox",
  MUNSIT_API_KEY: "fixture-munsit",
  MUNSIT_ASR_MODEL: "munsit-1",
  MUNSIT_TTS_MODEL_ID: "munsit-tts-1",
  MUNSIT_GULF_VOICE_ID: "gulf-1",
  COHERE_API_KEY: "fixture-cohere",
  COHERE_STT_MODEL: "cohere-stt",
  FARASA_API_KEY: "fixture-farasa",

  STRIPE_SECRET_KEY: "sk_test_fixture",
  YOUTUBE_API_KEY: "fixture-youtube",
  RAPIDAPI_KEY: "fixture-rapidapi",
  COBALT_API_KEY: "fixture-cobalt",
  FIRECRAWL_API_KEY: "fixture-firecrawl",
  JINA_API_KEY: "fixture-jina",

  // A real, throwaway P-256 pair. `web-push` validates the key length before
  // it will send anything — a placeholder string throws
  // "Vapid public key should be 65 bytes long when decoded" at
  // `setVapidDetails`, which is the first thing `notify-due-reviews` does after
  // its auth check. These are generated keys with no counterpart anywhere and
  // are never used to sign a request that leaves the test process.
  VAPID_PUBLIC_KEY: "BBwEM_afvC6pOZbrTLE03u1Z4475caC2IeFoo8TBLo_5gKL-mAu74mR98dAg-Ea9TgTeMM3ddAqt-aULaMLv1_s",
  VAPID_PRIVATE_KEY: "tUQVlrPzzw18X2N_kpvu-T6hIHm0emz9ZzGxkDJQ9aE",
  VAPID_SUBJECT: "mailto:test@example.com",

  ALLOWED_ORIGINS: "https://hakiya.app,https://lahja-arabic.lovable.app",
};

/** A recorded outbound call, so a test can assert what was sent upstream. */
export interface UpstreamCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Environment and outbound `fetch` under a test's control, with no function loaded. */
export interface StubbedUpstreams {
  /** Every outbound fetch made while this stub was installed, in order. */
  calls: UpstreamCall[];
  /** Tasks handed to `EdgeRuntime.waitUntil` while this stub was installed. */
  tasks: Promise<unknown>[];
  /** Route a URL substring to a response, replacing any default. */
  stub: (match: string, handler: UpstreamHandler) => void;
  /** Calls whose URL contains `match`. */
  callsTo: (match: string) => UpstreamCall[];
  /** Undo the env patch and clear the routing table. Always call this in a finally. */
  restore: () => void;
}

export interface LoadedFunction {
  handler: Handler;
  /** Every outbound fetch the function made, in order. */
  calls: UpstreamCall[];
  /** Route a URL substring to a response, replacing any default. */
  stub: (match: string, handler: UpstreamHandler) => void;
  /** Calls whose URL contains `match`. */
  callsTo: (match: string) => UpstreamCall[];
  /**
   * Settle every task the function handed to `EdgeRuntime.waitUntil`.
   *
   * Five functions return early and finish their real work in the background,
   * so the response says "generating" and everything worth asserting — the
   * upstream calls, the segment writes, the terminal status — happens after the
   * handler has already resolved. Awaiting this is what makes that work
   * observable; without it the test tears down mid-flight and the assertions
   * describe a job that had barely started.
   *
   * Rejections are absorbed: a background task that throws is a thing to assert
   * about (the function is expected to catch it and write a failed status), not
   * a reason to fail the await.
   */
  background: () => Promise<void>;
  /** Undo the env and fetch patches. Always call this in a finally. */
  restore: () => void;
}

export interface LoadOptions {
  /** Override or add environment variables. */
  env?: Record<string, string | undefined>;
  /** Override or add upstream routes. */
  upstreams?: Record<string, UpstreamHandler>;
}

/**
 * Import cache buster.
 *
 * Deno caches a module after the first import, so its top-level `serve(...)`
 * runs once. A unique query string per load forces a fresh evaluation, which is
 * what lets each test set up its own env before the module reads it — several
 * shared modules capture `Deno.env.get(...)` at module scope.
 */
let loadCounter = 0;

/**
 * The routing fetch is installed once and never swapped.
 *
 * It has to be, because `_shared/usageCap.ts` builds its Supabase client lazily
 * and caches it at module scope — and Deno caches that module, so the cache
 * survives between tests even though each function module is re-imported. The
 * client captures whatever `fetch` existed when it was constructed, so a stub
 * that is installed and torn down per test leaves the cached client calling a
 * dead one from two tests ago.
 *
 * A single stable wrapper reading mutable state sidesteps that entirely: the
 * captured reference stays valid, and `restore()` only has to swap the table
 * underneath it.
 */
let currentRoutes: Record<string, UpstreamHandler> | null = null;
let currentCalls: UpstreamCall[] | null = null;
let fetchInstalled = false;

function installRoutingFetch(): void {
  if (fetchInstalled) return;
  fetchInstalled = true;

  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!currentRoutes) return realFetch(input as RequestInfo, init);

    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;

    currentCalls?.push({
      url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? null
          : await request.clone().text().catch(() => null),
    });

    // Longest match wins, so a specific route ("/rest/v1/subscribers") beats
    // the catch-all it sits inside ("/rest/v1/"). Matching in insertion order
    // instead would let the defaults shadow every override a test supplies.
    const match = Object.keys(currentRoutes)
      .filter((key) => url.includes(key))
      .sort((a, b) => b.length - a.length)[0];

    if (!match) {
      // Loud rather than silent: an unrouted call means the test is not in
      // control of what the function talks to, so any assertion about the
      // result is describing something else.
      throw new Error(
        `Unrouted upstream request to ${url}\n` +
          `Add a route in supabase/functions/_test/upstreams.ts, or pass one ` +
          `via loadFunction(name, { upstreams: { "${new URL(url).hostname}": ... } }).`,
      );
    }

    return currentRoutes[match](request);
  }) as typeof fetch;
}

/**
 * `EdgeRuntime` is a global the Supabase edge runtime provides and Deno does
 * not, so it has to be installed before any function that touches it is
 * imported. Same single-install-mutable-state shape as the routing fetch, and
 * for the same reason: a module that captured the global at import time must
 * not be left holding a reference from a torn-down test.
 *
 * Note the two shapes in the codebase. Four functions guard with
 * `typeof EdgeRuntime !== "undefined"` and fall back to fire-and-forget;
 * `generate-story-video-full` calls `EdgeRuntime.waitUntil(...)` bare, so
 * without this shim it would answer 500 "EdgeRuntime is not defined" — which
 * says nothing about the function and everything about the harness.
 */
let currentTasks: Promise<unknown>[] | null = null;
let edgeRuntimeInstalled = false;

function installEdgeRuntime(): void {
  if (edgeRuntimeInstalled) return;
  edgeRuntimeInstalled = true;

  (globalThis as unknown as Record<string, unknown>).EdgeRuntime = {
    waitUntil: (task: Promise<unknown>) => {
      currentTasks?.push(task);
    },
  };
}

/**
 * Everything `loadFunction` sets up *except* the function itself: the fixture
 * environment, the routing fetch, the `EdgeRuntime` shim and the background
 * task queue.
 *
 * The `_shared` modules are worth testing directly rather than only through the
 * functions that call them — several of them are deliberately silent (the two
 * logging sinks swallow every error by design), so a function-level test can
 * never distinguish "wrote the row" from "did nothing at all". Reaching them
 * needs the same env and fetch control a function does, and specifically the
 * same *stable* routing fetch: `featureMetrics` and `msaViolationLogger` cache
 * their Supabase client at module scope, and a client built against a
 * per-test fetch that was later torn down would call a dead one.
 */
export function stubUpstreams(options: LoadOptions = {}): StubbedUpstreams {
  const originalEnv = new Map<string, string | undefined>();
  const applyEnv = (key: string, value: string | undefined) => {
    if (!originalEnv.has(key)) originalEnv.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  };

  for (const [key, value] of Object.entries(FIXTURE_ENV)) applyEnv(key, value);
  for (const [key, value] of Object.entries(options.env ?? {})) applyEnv(key, value);

  const routes = { ...defaultUpstreams(), ...(options.upstreams ?? {}) };
  const calls: UpstreamCall[] = [];
  const tasks: Promise<unknown>[] = [];

  installRoutingFetch();
  installEdgeRuntime();
  currentRoutes = routes;
  currentCalls = calls;
  currentTasks = tasks;

  return {
    calls,
    tasks,
    stub: (match, upstream) => {
      routes[match] = upstream;
    },
    callsTo: (match) => calls.filter((call) => call.url.includes(match)),
    restore: () => {
      // The routing fetch itself stays installed — see installRoutingFetch.
      // Only the table it reads is cleared, so a call made after the test (by a
      // cached client, say) falls through to the real fetch rather than a stale
      // route.
      currentRoutes = null;
      currentCalls = null;
      currentTasks = null;
      for (const [key, value] of originalEnv) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    },
  };
}

/**
 * A fresh evaluation of a `_shared` module, with the fixture env already set.
 *
 * Six of these modules read `Deno.env.get(...)` at module scope, so a static
 * import in a test file would capture whatever the environment was when the
 * file loaded — before any test ran. The cache buster forces a re-evaluation
 * per call, which is also what gives each test its own copy of the clients
 * `featureMetrics` and `msaViolationLogger` memoise.
 */
export async function loadSharedModule<T>(name: string): Promise<T> {
  return await import(`../_shared/${name}.ts?load=${++loadCounter}`) as T;
}

export async function loadFunction(
  name: string,
  options: LoadOptions = {},
): Promise<LoadedFunction> {
  const upstreams = stubUpstreams(options);
  const { calls, tasks } = upstreams;

  // Deno.serve is the other half of the interception; the import map covers the
  // std `serve` import, this covers the 28 functions that call Deno.serve.
  const originalDenoServe = Deno.serve;
  let denoServeHandler: Handler | undefined;

  // Deno.serve is overloaded — (handler), (options, handler) and
  // (options-with-handler) are all valid — so the capture accepts either shape
  // and the assignment goes through `unknown` rather than `any`, which keeps
  // test code inside the no-explicit-any rule the lint config holds it to.
  const captureServe = (
    handlerOrOptions: Handler | Record<string, unknown>,
    maybeHandler?: Handler,
  ) => {
    denoServeHandler = typeof handlerOrOptions === "function" ? handlerOrOptions : maybeHandler;
    return {
      finished: new Promise<void>(() => {}),
      shutdown: () => Promise.resolve(),
      ref: () => {},
      unref: () => {},
      addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
    };
  };

  Deno.serve = captureServe as unknown as typeof Deno.serve;

  const restore = () => {
    Deno.serve = originalDenoServe;
    upstreams.restore();
  };

  try {
    await import(`../${name}/index.ts?load=${++loadCounter}`);
  } catch (error) {
    restore();
    throw error;
  }

  const handler = takeCapturedHandler() ?? denoServeHandler;
  if (!handler) {
    restore();
    throw new Error(
      `Importing supabase/functions/${name}/index.ts did not register a handler.\n` +
        `It should call serve(...) from the std http server, or Deno.serve(...). ` +
        `If it imports a std version not listed in _test/import_map.json, add it ` +
        `there — otherwise the real serve() binds a port and the test hangs.`,
    );
  }

  return {
    handler,
    calls,
    stub: upstreams.stub,
    callsTo: upstreams.callsTo,
    background: async () => {
      // Drained in a loop, not a single allSettled: a background task may hand
      // `waitUntil` further tasks of its own while it runs, and those would be
      // appended after the first snapshot was taken.
      for (let round = 0; round < 20 && tasks.length > 0; round++) {
        const pending = tasks.splice(0, tasks.length);
        await Promise.allSettled(pending);
      }
    },
    restore,
  };
}

// ── Request builders ─────────────────────────────────────────────────────────

const FUNCTION_ORIGIN = "https://e2e.supabase.co/functions/v1";

/** An unsigned JWT with the shape the functions' getUser() calls expect. */
export function fixtureJwt(userId = "00000000-0000-4000-8000-000000000001"): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "e2e@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    // A *decodable* signature, not just a plausible-looking one. Nothing here
    // verifies it, but `auth-js`'s `getClaims` base64url-decodes all three
    // segments before it does anything else — and a segment whose length is
    // 1 mod 4 is not valid base64url, so it rejects the token with
    // "JWT not in base64url format" without ever calling the auth server.
    // The previous 17-character placeholder failed exactly that check, which
    // made every function using `getClaims` answer 401 in tests regardless of
    // how it was routed.
    encode({ sig: "fixture" }),
  ].join(".");
}

export interface RequestOptions {
  origin?: string;
  jwt?: string | null;
  headers?: Record<string, string>;
  method?: string;
}

/** A POST with a JSON body, which is how every function is invoked. */
export function jsonRequest(
  name: string,
  body: unknown,
  { origin = "https://hakiya.app", jwt, headers = {}, method = "POST" }: RequestOptions = {},
): Request {
  return new Request(`${FUNCTION_ORIGIN}/${name}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      ...(jwt === null ? {} : { authorization: `Bearer ${jwt ?? fixtureJwt()}` }),
      ...headers,
    },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

/**
 * A POST carrying `multipart/form-data`, which is how the four ASR functions
 * are invoked.
 *
 * Worth a builder of its own rather than a hand-rolled body: each engine reads
 * its file from a *different* part name — `audio` for three of them, `file` for
 * Munsit — and the part's filename is what Munsit dispatches its decoder on. A
 * test that hardcoded one shape would pass against the wrong engine.
 */
export function formRequest(
  name: string,
  parts: Record<string, string | File>,
  { origin = "https://hakiya.app", jwt, headers = {} }: RequestOptions = {},
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(parts)) form.append(key, value);

  return new Request(`${FUNCTION_ORIGIN}/${name}`, {
    method: "POST",
    headers: {
      origin,
      ...(jwt === null ? {} : { authorization: `Bearer ${jwt ?? fixtureJwt()}` }),
      ...headers,
    },
    body: form,
  });
}

/** A stand-in for an uploaded clip. Nothing decodes the bytes. */
export function audioFile(name = "clip.mp3", type = "audio/mpeg"): File {
  return new File([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00])], name, { type });
}

/** The CORS preflight browsers send before the real call. */
export function optionsRequest(name: string, origin = "https://hakiya.app"): Request {
  return new Request(`${FUNCTION_ORIGIN}/${name}`, {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST" },
  });
}

export { json };
