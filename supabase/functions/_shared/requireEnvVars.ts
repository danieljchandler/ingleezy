/**
 * Validate that required environment variables are present.
 *
 * Usage:
 *   const { OPENAI_API_KEY, SUPABASE_URL } = requireEnvVars('OPENAI_API_KEY', 'SUPABASE_URL');
 *
 * Throws a descriptive error listing all missing vars so operators can fix
 * deployment configuration in one go.
 */
export function requireEnvVars<T extends string>(
  ...names: T[]
): Record<T, string> {
  const missing: string[] = [];
  const result = {} as Record<T, string>;

  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) {
      missing.push(name);
    } else {
      result[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set them in your Supabase project secrets.`,
    );
  }

  return result;
}
