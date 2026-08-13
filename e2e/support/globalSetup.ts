import type { FullConfig } from "@playwright/test";

/**
 * Fails the whole e2e run before a single browser starts if the suite is not
 * pointed at the fake Supabase host.
 *
 * This exists because of a specific hazard in vite.config.ts: it sets
 * `envDir: ".vite-env"` (so root .env files are ignored) and injects the client
 * vars through `define` from process.env, **falling back to the real production
 * project ref and a real anon key when they are unset**. A refactor of
 * playwright.config.ts's `webServer.env`, or a move to serving a pre-built
 * bundle, can therefore silently point the entire suite at production — where it
 * would read and write live learner data while still going green.
 *
 * Note this inspects the resolved config rather than `process.env`: the
 * overrides are handed to the spawned dev server, so they are deliberately not
 * visible in the runner's own environment.
 *
 * The catch-all request guard in e2e/support/fixtures.ts is the belt — it
 * catches a bad bundle too. This is the braces, and it fails earlier and reads
 * more clearly when someone edits the config.
 */

const EXPECTED: Record<string, string> = {
  VITE_SUPABASE_URL: "https://e2e.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "e2e",
};

export default function globalSetup(config: FullConfig) {
  const servers = Array.isArray(config.webServer)
    ? config.webServer
    : config.webServer
      ? [config.webServer]
      : [];

  if (servers.length === 0) {
    throw new Error(
      "Refusing to run the e2e suite: playwright.config.ts declares no webServer, " +
        "so nothing overrides the production Supabase fallbacks in vite.config.ts.",
    );
  }

  for (const server of servers) {
    const env = server.env ?? {};

    const wrong = Object.entries(EXPECTED).filter(([key, value]) => env[key] !== value);
    if (wrong.length > 0) {
      const detail = wrong
        .map(([key, value]) => `  ${key}: expected ${value}, got ${env[key] ?? "(unset)"}`)
        .join("\n");

      throw new Error(
        "Refusing to run the e2e suite: the dev server is not pointed at the fake " +
          "Supabase host.\n" +
          detail +
          "\n\nvite.config.ts falls back to the REAL production project when these " +
          "are unset, so running like this would hit live data. Check `webServer.env` " +
          "in playwright.config.ts.",
      );
    }

    if (env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("eyJ")) {
      throw new Error(
        "Refusing to run the e2e suite: VITE_SUPABASE_PUBLISHABLE_KEY looks like a " +
          "real JWT. The suite is hermetic and needs no credentials.",
      );
    }
  }
}
