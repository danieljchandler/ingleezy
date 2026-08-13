import { UnsupportedQueryError } from "../postgrest/errors";
import { execute } from "../postgrest/execute";
import { parseQuery } from "../postgrest/parseQuery";
import { MemoryDb } from "../postgrest/store";
import type { Row } from "../postgrest/types";
import {
  capLimited,
  defaultFunctions,
  normalise,
  unregistered,
  type FunctionCall,
  type FunctionHandler,
  type FunctionResponse,
} from "./functions";
import { callRpc, type RpcHandler } from "./rpc";
import { makeSession, makeUser, userIdFromAuthHeader, TEST_USER_ID } from "./session";

export const SUPABASE_HOST = "e2e.supabase.co";
export const SUPABASE_URL = `https://${SUPABASE_HOST}`;

/**
 * `content-range` carries PostgREST's exact count, and it is not a
 * CORS-safelisted response header. Without expose-headers the browser hides it
 * from supabase-js and every count silently reads as zero — which looks
 * identical to "there is no data" and cost a previous afternoon to find.
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

export interface BackendOptions {
  /** Per-test RPC implementations, layered over the defaults. */
  rpcs?: Record<string, RpcHandler>;
  /** Per-test edge-function responses, layered over the defaults. */
  functions?: Record<string, FunctionHandler>;
  /** Signed-out by default; set to sign the session in. */
  userId?: string | null;
}

/**
 * The in-memory Supabase backend, as a plain request handler.
 *
 * Being a plain `(Request) => Promise<Response>` is the point: Playwright wires
 * it to `page.route`, Vitest swaps it in for `globalThis.fetch`, and both get
 * identical behaviour. A scenario written for a component test transfers to a
 * browser test unchanged.
 */
export class SupabaseBackend {
  readonly db = new MemoryDb();
  readonly functionCalls: FunctionCall[] = [];
  /** Requests that reached the backend for a host it does not serve. */
  readonly foreignRequests: string[] = [];
  /** Queries using PostgREST features this double has not implemented. */
  readonly unsupportedQueries: string[] = [];
  /** Every RPC the app called, with its arguments. */
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown>; at: number }> = [];

  /**
   * Accounts, standing in for `auth.users`.
   *
   * Kept separate from `profiles` because that is where they actually live —
   * `profiles` has no email column, which is why `admin_find_user` exists as an
   * RPC rather than being a query the client could make. Hanging email off a
   * profile fixture would teach a shape the real schema does not have.
   */
  private users = new Map<string, { id: string; email: string }>();

  /** Register an account so it can sign in and be found by email. */
  addUser(id: string, email: string): this {
    this.users.set(id, { id, email });
    return this;
  }

  /** Look an account up by email or id, as admin_find_user does. */
  findUser(identifier: string): { id: string; email: string } | undefined {
    const needle = identifier.trim().toLowerCase();
    return [...this.users.values()].find(
      (user) => user.email.toLowerCase() === needle || user.id.toLowerCase() === needle,
    );
  }

  /** Every registered account. */
  listUsers(): Array<{ id: string; email: string }> {
    return [...this.users.values()];
  }

  private rpcs: Record<string, RpcHandler>;
  private functions: Record<string, FunctionHandler>;
  private sessionUserId: string | null;

  constructor(options: BackendOptions = {}) {
    this.rpcs = { ...options.rpcs };
    this.functions = { ...options.functions };
    this.sessionUserId = options.userId ?? null;
  }

  /** Register or replace an edge-function response for this test. */
  stubFunction(name: string, handler: FunctionHandler | unknown): this {
    this.functions[name] =
      typeof handler === "function" ? (handler as FunctionHandler) : () => handler;
    return this;
  }

  /** Make a capped function answer with the real over-quota 429. */
  stubFunctionCapped(name: string): this {
    this.functions[name] = () => capLimited();
    return this;
  }

  /** Make a function fail, for error-path assertions. */
  stubFunctionFailure(name: string, status = 500, body?: unknown): this {
    this.functions[name] = () => ({
      status,
      body: body ?? { error: "internal_error", message: "boom" },
    });
    return this;
  }

  stubRpc(name: string, handler: RpcHandler | unknown): this {
    this.rpcs[name] = typeof handler === "function" ? (handler as RpcHandler) : () => handler;
    return this;
  }

  setUser(userId: string | null): this {
    this.sessionUserId = userId;
    return this;
  }

  /** Every call to an edge function, in order. */
  callsTo(name: string): FunctionCall[] {
    return this.functionCalls.filter((call) => call.name === name);
  }

  lastCallTo(name: string): FunctionCall | undefined {
    return this.callsTo(name).at(-1);
  }

  /**
   * Fails if the app invoked an edge function nothing had registered.
   *
   * Run at fixture teardown. A 501 alone might be swallowed by a component's
   * error branch and never surface as a failed assertion.
   */
  assertNoUnstubbedCalls(): void {
    const unknownNames = [
      ...new Set(
        this.functionCalls
          .filter((call) => !(call.name in this.functions) && !(call.name in defaultFunctions))
          .map((call) => call.name),
      ),
    ];

    if (unknownNames.length > 0) {
      throw new Error(
        `The app called edge functions with no registered response: ${unknownNames.join(", ")}.\n` +
          `Register them with backend.stubFunction(name, response) so the test states ` +
          `what it expects, rather than depending on an accidental empty result.`,
      );
    }
  }

  /**
   * Fails if the app issued a query this double cannot represent.
   *
   * Run at fixture teardown alongside `assertNoUnstubbedCalls`. A test whose
   * assertions happen to pass while the underlying query was rejected is worse
   * than a failing one — it reports coverage that does not exist.
   */
  assertNoUnsupportedQueries(): void {
    if (this.unsupportedQueries.length > 0) {
      throw new Error(
        `The app issued queries the in-memory PostgREST does not implement:\n` +
          this.unsupportedQueries.map((entry) => `  - ${entry}`).join("\n") +
          `\n\nImplement them in src/test/support/postgrest/ — this test's ` +
          `assertions passed without those queries returning real data.`,
      );
    }
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname !== SUPABASE_HOST) {
      this.foreignRequests.push(request.url);
      return this.json(404, { error: "not_found" });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }

    const { pathname } = url;

    if (pathname.startsWith("/auth/v1")) return this.handleAuth(request, url);
    if (pathname.startsWith("/functions/v1/")) return this.handleFunction(request, url);
    if (pathname.startsWith("/rest/v1/rpc/")) return this.handleRpc(request, url);
    if (pathname.startsWith("/rest/v1/")) return this.handleRest(request, url);
    if (pathname.startsWith("/storage/v1/")) return this.handleStorage(request, url);

    return this.json(404, { error: "not_found", path: pathname });
  }

  // ── REST ───────────────────────────────────────────────────────────────────

  private async handleRest(request: Request, url: URL): Promise<Response> {
    const headers = headerRecord(request);
    const table = url.pathname.replace(/^.*\/rest\/v1\//, "").split("?")[0];

    const delay = this.db.delayFor(table);
    if (delay > 0) await sleep(delay);

    let body: Row | Row[] | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();
      body = text ? (JSON.parse(text) as Row | Row[]) : undefined;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      this.db.recordRead({ table, search: url.search, at: Date.now() });
    }

    let result;
    try {
      const query = parseQuery({ method: request.method, url, headers, body });
      result = execute(this.db, query);
    } catch (error) {
      if (error instanceof UnsupportedQueryError) {
        // Recorded as well as returned. supabase-js turns a thrown fetch into
        // its `error` channel, which a component's catch block can swallow —
        // and then the gap in the double never surfaces. The teardown
        // assertion is what makes it unmissable.
        this.unsupportedQueries.push(`${table}${url.search}: ${error.message}`);
        return this.json(400, {
          code: "PGRST100",
          message: error.message,
          details: null,
          hint: null,
        });
      }
      throw error;
    }

    return new Response(result.body === null ? null : JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS, ...result.headers },
    });
  }

  // ── RPC ────────────────────────────────────────────────────────────────────

  private async handleRpc(request: Request, url: URL): Promise<Response> {
    const name = url.pathname.replace(/^.*\/rest\/v1\/rpc\//, "").split("?")[0];
    const text = await request.text();
    const args = (text ? JSON.parse(text) : {}) as Record<string, unknown>;

    this.rpcCalls.push({ name, args, at: Date.now() });

    const delay = this.db.delayFor(`rpc:${name}`);
    if (delay > 0) await sleep(delay);

    const failure = this.db.takeFailure(`rpc:${name}`, false);
    if (failure) {
      return this.json(
        failure.status,
        failure.body ?? {
          code: String(failure.status),
          message: `Injected failure for rpc ${name}`,
          details: null,
          hint: null,
        },
      );
    }

    const userId = userIdFromAuthHeader(request.headers.get("authorization")) ?? this.sessionUserId;
    const result = callRpc(
      name,
      {
        db: this.db,
        userId,
        args,
        users: { find: (id) => this.findUser(id), list: () => this.listUsers() },
      },
      this.rpcs,
    );

    return this.json(result.status, result.body);
  }

  /** Every call to a given RPC, in order. */
  rpcCallsTo(name: string): Array<{ name: string; args: Record<string, unknown>; at: number }> {
    return this.rpcCalls.filter((call) => call.name === name);
  }

  // ── Edge functions ─────────────────────────────────────────────────────────

  private async handleFunction(request: Request, url: URL): Promise<Response> {
    const name = url.pathname.replace(/^.*\/functions\/v1\//, "").split("?")[0];
    const body = await functionBody(request);

    this.functionCalls.push({
      name,
      body,
      headers: headerRecord(request),
      at: Date.now(),
    });

    const delay = this.db.delayFor(`fn:${name}`);
    if (delay > 0) await sleep(delay);

    const handler = this.functions[name] ?? defaultFunctions[name];
    if (!handler) {
      const response = unregistered(name);
      return this.json(response.status, response.body);
    }

    const userId = userIdFromAuthHeader(request.headers.get("authorization")) ?? this.sessionUserId;
    const response = normalise(handler({ db: this.db, userId, body }));

    if (response.stream) return this.sse(response);
    if (response.bytes) return this.binary(response);

    return this.json(response.status, response.body, response.headers);
  }

  /**
   * The three TTS functions answer with raw audio bytes, not JSON, and their
   * callers read the response with `res.blob()` straight into an `<audio>`
   * element. A JSON body here loads as an unplayable source and the page logs a
   * media error, so the bytes have to survive the round trip intact.
   */
  private binary(response: FunctionResponse): Response {
    return new Response(response.bytes as BodyInit, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/octet-stream",
        ...response.headers,
      },
    });
  }

  /**
   * Several pages consume functions as an SSE stream over raw `fetch` rather
   * than `functions.invoke` — the conversation simulator, culture guide and
   * the ask-about-this-sentence panel all do. They need a real ReadableStream.
   */
  private sse(response: FunctionResponse): Response {
    const chunks = response.stream ?? [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      status: response.status,
      headers: { ...CORS_HEADERS, "content-type": "text/event-stream" },
    });
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  private async handleAuth(request: Request, url: URL): Promise<Response> {
    const { pathname } = url;
    const text = request.method === "GET" ? "" : await request.text();
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;

    if (pathname.endsWith("/token")) {
      const grantType = url.searchParams.get("grant_type");

      if (grantType === "password") {
        const email = String(body.email ?? "");
        const known = this.findUser(email);
        const password = String(body.password ?? "");

        // A deliberately recognisable wrong password, so the failure path is
        // testable without inventing a credential store.
        if (password === "wrong-password" || (known === undefined && email.includes("unknown"))) {
          return this.json(400, {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          });
        }

        const userId = known?.id ?? this.sessionUserId ?? TEST_USER_ID;
        this.sessionUserId = userId;
        return this.json(200, makeSession(userId, email || undefined));
      }

      if (grantType === "refresh_token") {
        return this.json(200, makeSession(this.sessionUserId ?? TEST_USER_ID));
      }
    }

    if (pathname.endsWith("/signup")) {
      const email = String(body.email ?? "");
      const taken = this.findUser(email) !== undefined;
      if (taken) {
        return this.json(422, {
          code: "user_already_exists",
          message: "User already registered",
        });
      }
      const session = makeSession(TEST_USER_ID, email || undefined);
      this.sessionUserId = session.user.id;
      return this.json(200, session);
    }

    if (pathname.endsWith("/logout")) {
      this.sessionUserId = null;
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (pathname.endsWith("/recover")) return this.json(200, {});

    if (pathname.endsWith("/user")) {
      const userId =
        userIdFromAuthHeader(request.headers.get("authorization")) ?? this.sessionUserId;
      if (!userId) return this.json(401, { message: "invalid claim: missing sub claim" });
      return this.json(200, makeUser(userId));
    }

    return this.json(200, {});
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  private storageObjects = new Map<string, string>();

  private async handleStorage(request: Request, url: URL): Promise<Response> {
    const path = url.pathname.replace(/^.*\/storage\/v1\//, "");

    if (request.method === "POST" || request.method === "PUT") {
      const key = path.replace(/^object\//, "");
      this.storageObjects.set(key, "uploaded");
      return this.json(200, { Key: key, Id: key });
    }

    if (path.startsWith("object/sign/")) {
      const key = path.replace("object/sign/", "");
      return this.json(200, { signedURL: `/storage/v1/object/public/${key}?token=fixture` });
    }

    if (request.method === "DELETE") {
      const key = path.replace(/^object\//, "");
      this.storageObjects.delete(key);
      return this.json(200, {});
    }

    return this.json(200, {});
  }

  /** Object keys uploaded during the test. */
  uploads(): string[] {
    return [...this.storageObjects.keys()];
  }

  private json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "content-type": "application/json", ...extra },
    });
  }
}

/**
 * A recorded shape for whatever an edge function was posted.
 *
 * Three encodings are in use and a spec should not have to care which:
 * `functions.invoke` sends JSON, the four ASR engines send `multipart/
 * form-data` with the media as a File, and a couple of callers send raw text.
 *
 * Multipart is flattened to a plain object with files reduced to their
 * metadata. Keeping the bytes would let a spec assert on audio content that no
 * fixture actually has, whereas name/size/type is what the functions dispatch
 * on — munsit-transcribe reads the extension off the part filename to pick a
 * decoder, so "was the part named for the container the bytes really are"
 * is a real question a test can now ask.
 */
async function functionBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      form.forEach((value, key) => {
        fields[key] = value instanceof File
          ? { filename: value.name, size: value.size, type: value.type }
          : value;
      });
      return fields;
    } catch {
      // A malformed or truncated multipart body is worth surfacing as itself
      // rather than as an empty object that reads like "no fields sent".
      return { multipartParseFailed: true };
    }
  }

  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function headerRecord(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
