/**
 * Shared client for the streaming (SSE) edge functions.
 *
 * The streamed replies bypass supabase-js (`functions.invoke` buffers the whole
 * body), so callers used to hand-roll a fetch + SSE parser each — and both
 * copies sent the anon publishable key instead of the signed-in session token,
 * which made `enforceDailyCap` reject every request with 401. This helper owns
 * the transport once: real session JWT when available, OpenAI-style
 * `choices[0].delta.content` frame parsing, and typed errors that carry the
 * status + JSON body so callers can route 401/402/429 to the right UI.
 */
import { supabase } from "@/integrations/supabase/client";

export class SseChatError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.name = "SseChatError";
    this.status = status;
    this.body = body;
  }
}

export interface StreamChatArgs {
  functionName: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  /** Called for every token; `accumulated` is the full reply so far. */
  onDelta: (delta: string, accumulated: string) => void;
}

/** Stream a chat completion from an edge function; resolves to the full reply. */
export async function streamChat({
  functionName,
  body,
  signal,
  onDelta,
}: StreamChatArgs): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? anonKey}`,
        apikey: anonKey,
      },
      signal,
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok || !resp.body) {
    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch {
      /* non-JSON error body */
    }
    const message =
      (parsed as { message?: string; error?: string } | undefined)?.message ??
      (parsed as { error?: string } | undefined)?.error;
    throw new SseChatError(resp.status, parsed, message);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") {
        done = true;
        break;
      }
      try {
        const frame = JSON.parse(json);
        const delta = frame.choices?.[0]?.delta?.content as string | undefined;
        if (delta) {
          accumulated += delta;
          onDelta(delta, accumulated);
        }
      } catch {
        // Partial JSON split across chunks — re-buffer and wait for the rest.
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  return accumulated;
}
