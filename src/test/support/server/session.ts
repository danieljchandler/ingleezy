/**
 * Fixture sessions.
 *
 * supabase-js does not treat the access token as opaque — it base64-decodes the
 * payload to read `sub` and `exp` rather than trusting the `expires_at` field
 * beside it. A placeholder string is therefore rejected outright, and the token
 * has to be a structurally valid (if unsigned) JWT. Only the shape matters; no
 * signature is ever verified, because nothing here verifies anything.
 */

export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
export const TEST_EMAIL = "e2e@example.com";

/** supabase-js derives this from the first hostname label of the Supabase URL. */
export const STORAGE_KEY = "sb-e2e-auth-token";

const encodeSegment = (value: object): string => {
  const json = JSON.stringify(value);
  // btoa exists in the browser; Buffer in Node. Both transports need this.
  const base64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function makeAccessToken(userId: string, expiresAtSeconds: number, email = TEST_EMAIL): string {
  const header = encodeSegment({ alg: "HS256", typ: "JWT" });
  const payload = encodeSegment({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAtSeconds,
  });
  return `${header}.${payload}.e2e-signature`;
}

export interface FixtureUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string;
  phone: string;
  confirmed_at: string;
  last_sign_in_at: string;
  app_metadata: { provider: string; providers: string[] };
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
}

export function makeUser(userId = TEST_USER_ID, email = TEST_EMAIL): FixtureUser {
  const now = new Date().toISOString();
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

export interface FixtureSession {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: FixtureUser;
}

export function makeSession(userId = TEST_USER_ID, email = TEST_EMAIL): FixtureSession {
  // A year out, so supabase-js never attempts a refresh over the network — a
  // refresh mid-test would race with whatever the test is asserting.
  const expiresIn = 60 * 60 * 24 * 365;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  return {
    access_token: makeAccessToken(userId, expiresAt, email),
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: "e2e-refresh-token",
    user: makeUser(userId, email),
  };
}

/** Read the `sub` claim without verifying anything. */
export function userIdFromAuthHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalised = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(normalised)))
        : Buffer.from(normalised, "base64").toString("utf8");
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
