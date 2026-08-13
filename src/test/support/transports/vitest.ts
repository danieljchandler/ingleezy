import { vi } from "vitest";
import { SupabaseBackend, SUPABASE_HOST, type BackendOptions } from "../server/handler";
import { makeSession, STORAGE_KEY } from "../server/session";

/**
 * Installs the in-memory backend as `globalThis.fetch` for a Vitest test.
 *
 * This is what lets unit tests exercise the *real* `@supabase/supabase-js`
 * client instead of a hand-mocked query builder. It matters because a mocked
 * builder returns whatever the test told it to, so it can never catch the most
 * common real failure — a column that no longer exists, or a filter applied to
 * the wrong one. Running the genuine client means the URL it constructs is the
 * thing under test.
 */

export interface InstallOptions extends BackendOptions {
  /** Seed an authenticated session in localStorage before the client reads it. */
  signedInAs?: string | null;
}

export interface InstalledBackend {
  backend: SupabaseBackend;
  restore: () => void;
}

export function installSupabaseFetch(options: InstallOptions = {}): InstalledBackend {
  const backend = new SupabaseBackend(options);

  if (options.signedInAs) {
    backend.setUser(options.signedInAs);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(makeSession(options.signedInAs)));
  }

  const previous = globalThis.fetch;

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(toUrl(input), init);
    const url = new URL(request.url);

    if (url.hostname !== SUPABASE_HOST) {
      throw new Error(
        `Unstubbed network request to ${request.url}\n` +
          `The in-memory Supabase backend only serves ${SUPABASE_HOST}. If this ` +
          `request is expected, stub it explicitly for this test.`,
      );
    }

    return backend.handle(request);
  };

  vi.stubGlobal("fetch", vi.fn(fetchImpl));

  return {
    backend,
    restore: () => {
      vi.stubGlobal("fetch", previous);
      window.localStorage.removeItem(STORAGE_KEY);
    },
  };
}

function toUrl(input: string | URL): string {
  if (input instanceof URL) return input.href;
  // supabase-js always sends absolute URLs; a relative one means something else
  // reached fetch, and the guard above should report it with its real value.
  return input;
}
