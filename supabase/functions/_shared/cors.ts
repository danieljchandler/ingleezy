/**
 * CORS headers for Supabase Edge Functions.
 *
 * In production, set the ALLOWED_ORIGINS secret (comma-separated) to restrict
 * which origins may call your functions.  When the variable is not set the
 * default is to allow only the known production domain.
 */
// ingleezy.app is the current production domain (see index.html's canonical
// link/OG tags); lahja-arabic.lovable.app is kept for the pre-rebrand Lovable
// preview URL in case it's still linked anywhere.
const DEFAULT_ORIGINS = 'https://ingleezy.app,https://lahja-arabic.lovable.app';

function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS;
  return raw.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * Return CORS headers that mirror the request's Origin header only when it
 * matches the allow-list.  For unknown origins the Access-Control-Allow-Origin
 * header is omitted so browsers will block the response.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers?.get('origin') ?? '';
  const allowed = getAllowedOrigins();

  // During local development (localhost / 127.0.0.1) always allow
  const isLocal = origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  // Allow Lovable preview/sandbox subdomains (e.g. id-preview--*.lovable.app, *.lovable.dev)
  const isLovablePreview = /^https:\/\/([a-z0-9-]+\.)*(lovable\.(app|dev)|lovableproject\.com)$/i.test(origin);
  const matchedOrigin = allowed.includes(origin) || isLocal || isLovablePreview ? origin : '';

  return {
    ...(matchedOrigin ? { 'Access-Control-Allow-Origin': matchedOrigin } : {}),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Vary': 'Origin',
  };
}