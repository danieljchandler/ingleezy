import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat, SseChatError } from "./sseChat";

/**
 * The shared SSE transport under the chat surfaces. Two things matter here:
 * the parser has to survive frames split across chunk boundaries (real
 * networks do this constantly), and the Authorization header has to carry the
 * signed-in session token — the bug this helper exists to fix was every caller
 * sending the anon key, which the capped edge functions reject with 401.
 */

const session = vi.hoisted(() => ({ current: null as { access_token: string } | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: session.current } }),
    },
  },
}));

const frame = (delta: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n`;

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

let requests: Array<{ url: string; headers: Record<string, string>; body: unknown }>;
let respond: () => Response;

beforeEach(() => {
  session.current = null;
  requests = [];
  respond = () =>
    new Response(sse([frame("hello "), frame("world"), "data: [DONE]\n"]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return respond();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChat", () => {
  it("streams deltas and resolves to the accumulated reply", async () => {
    const seen: string[] = [];
    const full = await streamChat({
      functionName: "assistant-chat",
      body: { messages: [] },
      onDelta: (delta) => seen.push(delta),
    });

    expect(full).toBe("hello world");
    expect(seen).toEqual(["hello ", "world"]);
    expect(requests[0].url).toContain("/functions/v1/assistant-chat");
  });

  it("survives a frame split across chunk boundaries", async () => {
    const whole = frame("مرحبا");
    const mid = Math.floor(whole.length / 2);
    respond = () =>
      new Response(sse([whole.slice(0, mid), whole.slice(mid), "data: [DONE]\n"]), {
        status: 200,
      });

    const full = await streamChat({
      functionName: "assistant-chat",
      body: {},
      onDelta: () => {},
    });

    expect(full).toBe("مرحبا");
  });

  it("sends the session JWT when signed in, anon key otherwise", async () => {
    await streamChat({ functionName: "x", body: {}, onDelta: () => {} });
    expect(requests[0].headers.Authorization).toBe(
      `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    );

    session.current = { access_token: "user-jwt-123" };
    await streamChat({ functionName: "x", body: {}, onDelta: () => {} });
    expect(requests[1].headers.Authorization).toBe("Bearer user-jwt-123");
    expect(requests[1].headers.apikey).toBe(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  });

  it("throws a typed error carrying status and body on failure", async () => {
    respond = () =>
      new Response(
        JSON.stringify({ error: "daily_limit_reached", message: "Limit hit", limit: 40 }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );

    const err = await streamChat({ functionName: "x", body: {}, onDelta: () => {} }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(SseChatError);
    expect(err.status).toBe(429);
    expect(err.message).toBe("Limit hit");
    expect((err.body as { error: string }).error).toBe("daily_limit_reached");
  });

  it("stops at [DONE] and ignores non-data lines", async () => {
    respond = () =>
      new Response(
        sse([": keepalive\n", frame("a"), "data: [DONE]\n", frame("never")]),
        { status: 200 },
      );

    const full = await streamChat({ functionName: "x", body: {}, onDelta: () => {} });
    expect(full).toBe("a");
  });
});
