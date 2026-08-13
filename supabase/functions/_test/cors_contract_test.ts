import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFunction, optionsRequest } from "./harness.ts";

/**
 * CORS, across every deployed function.
 *
 * These are public HTTPS endpoints; the only thing stopping a page on another
 * origin from calling them with a stolen session is the allow-list in
 * _shared/cors.ts. Nothing tested it, and nothing tested that each of the 84
 * functions actually uses it — a function that hardcodes
 * `Access-Control-Allow-Origin: *` looks identical from the outside until you
 * ask it from a disallowed origin.
 *
 * Data-driven rather than hand-written per function: one loop covers the whole
 * surface, and a new function is included the moment its directory appears.
 */

const ALLOWED_ORIGIN = "https://hakiya.app";
const DENIED_ORIGIN = "https://evil.example";

/** Every deployed function directory. */
async function functionNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(new URL("../", import.meta.url))) {
    if (entry.isDirectory && !entry.name.startsWith("_")) names.push(entry.name);
  }
  return names.sort();
}

const names = await functionNames();

/**
 * Functions that do not answer a preflight themselves.
 *
 * Recorded rather than skipped silently. A function with no OPTIONS branch is
 * unreachable from a browser, so these are only safe because nothing calls them
 * from one — they are cron jobs, ops scripts, or invoked server-to-server.
 * If one of them gains a browser caller it will fail in a confusing way, and
 * this list is where to look.
 */
const NO_PREFLIGHT_BRANCH = new Set<string>([]);

Deno.test("every function directory can be loaded as a handler", async () => {
  // A function that cannot even be imported is one that would fail on deploy,
  // and `deno check` alone does not catch a module-scope throw.
  const failures: string[] = [];

  for (const name of names) {
    try {
      const fn = await loadFunction(name);
      fn.restore();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assertEquals(failures, [], `Functions that could not be loaded:\n${failures.join("\n")}`);
});

Deno.test("every function allows the production origin", async () => {
  const failures: string[] = [];

  for (const name of names) {
    if (NO_PREFLIGHT_BRANCH.has(name)) continue;

    const fn = await loadFunction(name);
    try {
      const response = await fn.handler(optionsRequest(name, ALLOWED_ORIGIN));
      const header = response.headers.get("access-control-allow-origin");
      if (header !== ALLOWED_ORIGIN) {
        failures.push(`${name}: expected ${ALLOWED_ORIGIN}, got ${header ?? "(none)"}`);
      }
    } catch (error) {
      failures.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(
    failures,
    [],
    `Functions that do not allow the production origin — the app cannot call ` +
      `these from a browser:\n${failures.join("\n")}`,
  );
});

Deno.test("no function allows an arbitrary origin", async () => {
  const failures: string[] = [];

  for (const name of names) {
    if (NO_PREFLIGHT_BRANCH.has(name)) continue;

    const fn = await loadFunction(name);
    try {
      const response = await fn.handler(optionsRequest(name, DENIED_ORIGIN));
      const header = response.headers.get("access-control-allow-origin");

      // getCorsHeaders omits the header entirely for an unknown origin, which
      // is what makes the browser block the response. A wildcard here would
      // hand every function to any page on the internet.
      if (header !== null) {
        failures.push(`${name}: returned ${header} for ${DENIED_ORIGIN}`);
      }
    } catch (error) {
      failures.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(
    failures,
    [],
    `Functions that accept requests from any origin:\n${failures.join("\n")}`,
  );
});

Deno.test("a preflight never reaches an upstream service", async () => {
  // A preflight that runs the body would spend a model call, and on a capped
  // function would consume the caller's daily quota before the real request
  // even arrives.
  const failures: string[] = [];

  for (const name of names) {
    if (NO_PREFLIGHT_BRANCH.has(name)) continue;

    const fn = await loadFunction(name);
    try {
      await fn.handler(optionsRequest(name, ALLOWED_ORIGIN));
      if (fn.calls.length > 0) {
        failures.push(`${name}: called ${fn.calls.map((call) => call.url).join(", ")}`);
      }
    } catch {
      // Load/handler errors are reported by the tests above.
    } finally {
      fn.restore();
    }
  }

  assertEquals(failures, [], `Functions doing work during a preflight:\n${failures.join("\n")}`);
});
