/**
 * Stands in for `serve()` from the Deno std http server.
 *
 * 56 of the 84 edge functions call `serve(handler)` at module scope and export
 * nothing, so there is no way to get at the handler from a test. Rather than
 * editing 84 production files to add an export, a test-only import map
 * (import_map.json) points the std URL at this module: importing a function now
 * hands its handler over instead of binding a port.
 *
 * The remaining 28 call `Deno.serve` directly; harness.ts monkey-patches that
 * before importing, for the same effect.
 *
 * This file must never be reachable from a normal run — see the note in
 * import_map.json about keeping it out of deno.json.
 */

export type Handler = (request: Request) => Response | Promise<Response>;

let captured: Handler | undefined;

/** Matches the std signature closely enough for the call sites in this repo. */
export function serve(handler: Handler, _options?: unknown): { finished: Promise<void> } {
  captured = handler;
  // The real serve() never resolves while the server is up. Returning a promise
  // that never settles matches that without actually listening.
  return { finished: new Promise<void>(() => {}) };
}

export function takeCapturedHandler(): Handler | undefined {
  const handler = captured;
  captured = undefined;
  return handler;
}

export function clearCapturedHandler(): void {
  captured = undefined;
}
