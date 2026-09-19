/**
 * Authorization for edge functions that write content nobody owns.
 *
 * `usageCap.ts` answers "who is this, and may they spend?". This answers the
 * different question the pipeline functions actually need: "may this caller
 * rewrite a row that belongs to the catalogue rather than to them?".
 *
 * The distinction matters because `verify_jwt` does not draw it. Supabase's
 * gateway checks that the bearer is a JWT signed by this project, and the
 * publishable/anon key is exactly such a JWT — it ships in the browser bundle.
 * So `verify_jwt = true` means "reachable by anyone who views source", and a
 * bare `auth.getUser()` means "reachable by anyone who can complete a free
 * signup". Neither is a permission to overwrite a published transcript, a
 * story's audio, or the curriculum concept table.
 *
 * Three callers are legitimate for that kind of write, and this module is the
 * one place that decides between them:
 *
 *   - a staff member (`admin` / `content_reviewer`), read from `user_roles`
 *     server-side, never from the request body;
 *   - the pipeline calling itself with the service-role key;
 *   - a scheduled job holding a configured shared secret.
 *
 * Modelled on `reextract-on-screen-text`, which had this right before the rest
 * of the pipeline did.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** One client per isolate — see the same note in `usageCap.ts`. */
let cached: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Staff roles allowed to edit catalogue content — the audience the RLS uses. */
export const CONTENT_MANAGER_ROLES = ["admin", "content_reviewer"] as const;

/**
 * Who may work on a transcript. Wider than the content managers by exactly one
 * role: a `transcriber` is a native speaker whose whole job is this page, and
 * the transcript editor renders for them. Kept in step with `REVIEWER_ROLES` in
 * `transcript-review`, which is the other half of the same permission.
 */
export const TRANSCRIPT_EDITOR_ROLES = ["admin", "content_reviewer", "transcriber"] as const;

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so the comparison is over two fixed-length
 * digests: a plain byte loop over the raw strings leaks the secret's length,
 * and an early `length` check leaks it outright. A remote timing attack across
 * the internet is not the realistic threat here — this is cheap enough that
 * there is no reason to leave the question open.
 */
export async function secretEquals(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** The bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Is this the pipeline calling itself?
 *
 * Only ever true for the service-role key. It is deliberately not true for the
 * anon or publishable key: those are public, and a check that accepts them is
 * not a check.
 */
export async function isServiceRoleCall(req: Request): Promise<boolean> {
  return await secretEquals(bearerToken(req), SERVICE_ROLE);
}

/**
 * A configured shared secret in a named header, for scheduled automation that
 * holds no user session. Absent configuration disables the path entirely
 * rather than allowing it.
 */
export async function hasSharedSecret(req: Request, header: string, envVar: string): Promise<boolean> {
  const secret = Deno.env.get(envVar);
  if (!secret) return false;
  return await secretEquals(req.headers.get(header), secret);
}

export type RoleCheck =
  | { denied: false; userId: string | null; viaServiceRole: boolean }
  | { denied: true; response: Response };

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Gate a handler on the caller holding one of `roles`, with the service-role
 * key as the internal bypass.
 *
 * Same result shape as `usageCap`'s `CapResult` so call sites branch
 * identically: check the discriminant, return the prepared response, otherwise
 * carry on with a `userId` that came from the token.
 */
export async function requireRole(
  req: Request,
  roles: readonly string[],
  corsHeaders: Record<string, string>,
  options: { allowServiceRole?: boolean } = {},
): Promise<RoleCheck> {
  const { allowServiceRole = true } = options;

  const token = bearerToken(req);
  if (!token) {
    return {
      denied: true,
      response: json({ error: "auth_required", message: "Please sign in." }, 401, corsHeaders),
    };
  }

  if (allowServiceRole && (await isServiceRoleCall(req))) {
    return { denied: false, userId: null, viaServiceRole: true };
  }

  const { data: userData, error } = await admin().auth.getUser(token);
  const userId = userData?.user?.id;
  if (error || !userId) {
    return {
      denied: true,
      response: json({ error: "auth_required", message: "Please sign in." }, 401, corsHeaders),
    };
  }

  const { data: held } = await admin()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", [...roles]);

  if (!Array.isArray(held) || held.length === 0) {
    return {
      denied: true,
      response: json(
        {
          error: "forbidden",
          message: "This action is limited to the content team.",
          required_roles: [...roles],
        },
        403,
        corsHeaders,
      ),
    };
  }

  return { denied: false, userId, viaServiceRole: false };
}

/** `admin` or `content_reviewer` — the usual gate for catalogue writes. */
export function requireContentManager(
  req: Request,
  corsHeaders: Record<string, string>,
  options?: { allowServiceRole?: boolean },
): Promise<RoleCheck> {
  return requireRole(req, CONTENT_MANAGER_ROLES, corsHeaders, options);
}

/** `admin` only — for the destructive and the bulk. */
export function requireAdmin(
  req: Request,
  corsHeaders: Record<string, string>,
  options?: { allowServiceRole?: boolean },
): Promise<RoleCheck> {
  return requireRole(req, ["admin"], corsHeaders, options);
}
