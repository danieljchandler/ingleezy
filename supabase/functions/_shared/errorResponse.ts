/**
 * Standardised JSON error response for Edge Functions.
 *
 * Usage:
 *   return createErrorResponse(400, 'Invalid input', cors, { field: 'count' });
 */
export function createErrorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
  details?: Record<string, unknown>,
): Response {
  const body: Record<string, unknown> = { error: message };
  if (details) body.details = details;

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
