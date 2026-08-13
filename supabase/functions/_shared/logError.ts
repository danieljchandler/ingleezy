/**
 * Server-side error sink for edge functions. Writes to the same
 * `public.client_errors` table as the client logger. Fails silently — never
 * throws from inside the logger.
 *
 * Usage:
 *   import { logEdgeError } from "../_shared/logError.ts";
 *   try { ... } catch (e) {
 *     await logEdgeError("generate-flashcard-image", e, { userId });
 *     return new Response(...);
 *   }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export async function logEdgeError(
  functionName: string,
  err: unknown,
  meta: { userId?: string | null; route?: string | null; extra?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) return;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? null : null;
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await supa.from("client_errors").insert({
      user_id: meta.userId ?? null,
      source: "edge",
      function_name: functionName,
      route: truncate(meta.route ?? null, 500),
      message: truncate(message, 2000) ?? "(empty)",
      stack: truncate(stack, 8000),
      meta: (meta.extra ?? {}) as never,
    });
  } catch {
    /* swallow */
  }
}
