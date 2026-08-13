/**
 * Stands in for `web-push` in tests.
 *
 * The real library sends over `node:https`, not `fetch`, so the harness's
 * routing fetch cannot see or intercept it — a send in a test resolves DNS for
 * real and fails with ENOTFOUND. That leaves the interesting half of
 * `notify-due-reviews` untestable: whether a 410 retires a subscription,
 * whether a 500 leaves it alone, and whether one bad endpoint stops the round.
 *
 * So the module is redirected here through the same test-only import map that
 * already redirects the std http server. Sends are recorded rather than made,
 * and a test can decide what each endpoint answers.
 *
 * Nothing here is reachable from a normal run — see the note in
 * import_map.json about keeping the map out of deno.json.
 */

export interface RecordedPush {
  endpoint: string;
  payload: string;
}

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Every send attempted since the last reset, in order. */
const sends: RecordedPush[] = [];

/**
 * What each endpoint answers, keyed by URL substring.
 *
 * A status of 201 succeeds; anything else is thrown as the library throws, with
 * `statusCode` set — which is the field `notify-due-reviews` reads to decide
 * whether to retire the subscription.
 */
let responses: Array<{ match: string; status: number }> = [];

export function setVapidDetails(
  _subject: string,
  publicKey: string,
  privateKey: string,
): void {
  // Validated for length the way the real library does, so a test cannot pass
  // with placeholder keys that production would reject.
  if (!publicKey || !privateKey) {
    throw new Error("Vapid keys are required");
  }
}

export function sendNotification(
  subscription: PushSubscription,
  payload: string,
): Promise<{ statusCode: number }> {
  sends.push({ endpoint: subscription.endpoint, payload });

  const rule = responses.find((r) => subscription.endpoint.includes(r.match));
  const status = rule?.status ?? 201;
  if (status >= 200 && status < 300) return Promise.resolve({ statusCode: status });

  return Promise.reject(
    Object.assign(new Error(`push failed with ${status}`), { statusCode: status }),
  );
}

/** Test control. Not part of the web-push API. */
export function __reset(rules: Array<{ match: string; status: number }> = []): void {
  sends.length = 0;
  responses = rules;
}

export function __sends(): RecordedPush[] {
  return [...sends];
}

export default { setVapidDetails, sendNotification };
