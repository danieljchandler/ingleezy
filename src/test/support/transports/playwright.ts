import type { Page, Route, Request as PlaywrightRequest } from "@playwright/test";
import { SupabaseBackend, SUPABASE_HOST } from "../server/handler";
import { makeSession, STORAGE_KEY } from "../server/session";

/**
 * Wires the in-memory backend into a Playwright page.
 *
 * The backend is a plain `(Request) => Promise<Response>`, so this transport is
 * only a translation layer between Playwright's route API and the fetch types.
 * The behaviour a spec sees here is identical to what a Vitest component test
 * sees through `installSupabaseFetch`.
 */

/**
 * Convert a Playwright request into a standard `Request`.
 *
 * Body via `postDataBuffer()` rather than `postData()`: the latter decodes as
 * UTF-8 and returns null when that fails, which is exactly what a multipart
 * upload of audio bytes does. Transcribe posts four of those in parallel, and
 * with `postData()` they arrived at the backend with no body at all — the
 * request looked like it had been made but carried nothing.
 */
async function toRequest(request: PlaywrightRequest): Promise<Request> {
  const method = request.method();
  const headers = await request.allHeaders();
  const buffer = method === "GET" || method === "HEAD" ? null : request.postDataBuffer();
  const body = buffer ? new Uint8Array(buffer) : undefined;

  return new Request(request.url(), { method, headers, body });
}

async function fulfill(route: Route, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Buffer, not text. The TTS functions answer with raw audio, and decoding
  // those bytes as UTF-8 replaces every invalid sequence with U+FFFD — the
  // response still arrives, still has a plausible length, and is no longer a
  // playable file.
  const body =
    response.status === 204
      ? undefined
      : Buffer.from(await response.arrayBuffer());

  await route.fulfill({ status: response.status, headers, body });
}

export interface PlaywrightBackendOptions {
  /**
   * Fail the test on any request to a host other than the app and the fake
   * Supabase project.
   *
   * This is the guard that actually catches accidental production traffic: it
   * survives a bad bundle, a stale env var, or a newly hardcoded URL, none of
   * which a config assertion would notice. It also catches analytics, YouTube
   * and font CDNs, which make tests slow and flaky rather than wrong.
   */
  blockForeignHosts?: boolean;
  /** Extra hosts a specific spec legitimately needs. */
  allowHosts?: string[];
}

/**
 * Third parties the app loads that are safe to block without comment.
 *
 * Blocking them still keeps the suite hermetic and fast; the distinction is
 * whether a blocked request means something is *wrong*. A web font failing to
 * load does not. A request to a Supabase project that is not the fake one very
 * much does, which is why nothing here matches `supabase.co`.
 */
const EXPECTED_THIRD_PARTIES = [
  /(^|\.)fonts\.googleapis\.com$/,
  /(^|\.)fonts\.gstatic\.com$/,
  /(^|\.)posthog\.com$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)youtube-nocookie\.com$/,
  /(^|\.)ytimg\.com$/,
  /(^|\.)gstatic\.com$/,
  /(^|\.)googlevideo\.com$/,
];

const isExpectedThirdParty = (hostname: string): boolean =>
  EXPECTED_THIRD_PARTIES.some((pattern) => pattern.test(hostname));

export interface InstalledPlaywrightBackend {
  backend: SupabaseBackend;
  /**
   * Blocked requests that indicate a problem — anything not on the expected
   * third-party list. This is what the fixture fails on.
   */
  blockedRequests: string[];
  /** Blocked, but unremarkable: fonts, analytics, video embeds. */
  blockedThirdParties: string[];
}

export async function installSupabaseRoutes(
  page: Page,
  options: PlaywrightBackendOptions = {},
): Promise<InstalledPlaywrightBackend> {
  const backend = new SupabaseBackend();
  const blockedRequests: string[] = [];
  const blockedThirdParties: string[] = [];
  const { blockForeignHosts = true, allowHosts = [] } = options;

  const allowed = new Set([
    SUPABASE_HOST,
    "127.0.0.1",
    "localhost",
    ...allowHosts,
  ]);

  // Matched by predicate rather than a glob: a glob over the full URL does not
  // reliably catch every scheme and path combination supabase-js emits.
  await page.route(
    (url) => url.hostname === SUPABASE_HOST,
    async (route) => {
      const response = await backend.handle(await toRequest(route.request()));
      await fulfill(route, response);
    },
  );

  if (blockForeignHosts) {
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());

      if (allowed.has(url.hostname)) return route.fallback();
      // data:/blob: never leave the page.
      if (url.protocol === "data:" || url.protocol === "blob:") return route.fallback();

      if (isExpectedThirdParty(url.hostname)) {
        blockedThirdParties.push(route.request().url());
      } else {
        blockedRequests.push(route.request().url());
      }

      await route.abort("blockedbyclient");
    });
  }

  return { backend, blockedRequests, blockedThirdParties };
}

/**
 * Seed an authenticated session so the app boots past ProtectedRoute.
 *
 * The email matters: it is a claim on the access token and the only place the
 * address exists client-side, since `profiles` has no email column. The admin
 * dashboard prints it, so a persona's chosen email has to reach here rather
 * than stopping at the backend's account list.
 */
export async function seedSession(page: Page, userId: string, email?: string): Promise<void> {
  const session = makeSession(userId, email);
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(session) },
  );
}

/**
 * Sign the browser out, undoing any session seeded earlier in the test.
 *
 * Init scripts are cumulative and cannot be removed, so a later
 * `signInAs("anonymous")` cannot simply skip seeding — the earlier script still
 * runs and the page is still signed in. Scripts run in registration order, so
 * removing the key last is what actually makes the sign-out stick.
 *
 * Worth the extra script: a spec asserting that signed-out visitors are
 * redirected would otherwise pass or fail on whether a `beforeEach` happened to
 * sign in first, and the failure reads as a broken guard in the app.
 */
export async function clearSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key }) => window.localStorage.removeItem(key),
    { key: STORAGE_KEY },
  );
}
