import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";
import { __reset, __sends } from "./webPushShim.ts";

/**
 * `notify-due-reviews` — the only function that pushes rather than answers.
 *
 * Everything here is a rule about *not* sending. A push notification is the one
 * thing this app does that reaches a learner who did not open it, and the cost
 * of getting it wrong is not a bad screen — it is notifications switched off
 * permanently. So the tests are mostly about the four filters: the local-time
 * window, the minimum gap between sends, the minimum number of due cards, and
 * who may trigger a round at all.
 *
 * `dryRun` exists precisely so this can be exercised against production data
 * without waking anyone, and it is asserted to count the same subscriptions it
 * would have sent to.
 */

const ADMIN = "00000000-0000-4000-8000-000000000001";
const SERVICE_ROLE = "fixture-service-role";

/** An hour of the day, expressed as a timezone that is currently at it. */
function zoneAtHour(hour: number): string {
  const utcHour = new Date().getUTCHours();
  const offset = ((hour - utcHour) % 24 + 24) % 24;
  // Etc/GMT signs are inverted: Etc/GMT-3 is UTC+3.
  return offset === 0 ? "UTC" : offset <= 12 ? `Etc/GMT-${offset}` : `Etc/GMT+${24 - offset}`;
}

const aSubscription = (over: Record<string, unknown> = {}) => ({
  id: "sub-1",
  user_id: ADMIN,
  endpoint: "https://push.test/endpoint-1",
  // A real P-256 public key and a 16-byte auth secret. `web-push` encrypts the
  // payload against these before it sends anything, so a placeholder throws
  // inside the library and never reaches the transport — which would make
  // every send test look like a delivery failure. Generated for the fixture;
  // no counterpart exists anywhere.
  p256dh: "BKOgZo-EiomOAYP4GUxOyDICDmprJQz99fOOSRXkG91DHL5P7FeIgjljF_EXW12FMHSB_gtQbZbTdFHsywtH86Y",
  auth: "VdoDjPW4kUsiid3Laxl1Ew",
  // 7pm local: inside the 17:00–21:00 window.
  timezone: zoneAtHour(19),
  last_sent_at: null,
  ...over,
});

/** `count: "exact", head: true` answers through the content-range header. */
const counted = (n: number): UpstreamHandler => () =>
  new Response(null, {
    status: 200,
    headers: { "content-range": `0-${Math.max(0, n - 1)}/${n}` },
  });

function upstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: ADMIN, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json({ role: "admin" }),
    "/rest/v1/push_subscriptions": () => json([aSubscription()]),
    "/rest/v1/word_reviews": counted(0),
    "/rest/v1/user_vocabulary": counted(0),
    ...extra,
  };
}

async function call(
  body: unknown,
  routes: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("notify-due-reviews", {
    upstreams: routes,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE, ...opts.env },
  });
  try {
    const response = await fn.handler(
      jsonRequest("notify-due-reviews", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return {
      status: response.status,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

/** Enough cards due to clear the five-card floor. */
const plentyDue = { "/rest/v1/word_reviews": counted(4), "/rest/v1/user_vocabulary": counted(4) };

// ── Who may run a round ─────────────────────────────────────────────────────

Deno.test("notify-due-reviews accepts the scheduler's service-role key", async () => {
  const { status, body } = await call(
    { dryRun: true },
    upstreams(plentyDue),
    { jwt: SERVICE_ROLE },
  );

  assertEquals(status, 200);
  assertEquals(body.sent, 1);
});

Deno.test("notify-due-reviews accepts an admin", async () => {
  const { status } = await call({ dryRun: true }, upstreams(plentyDue));

  assertEquals(status, 200);
});

Deno.test("notify-due-reviews refuses an ordinary learner", async () => {
  const { status, body, calls } = await call(
    { dryRun: true },
    upstreams({ ...plentyDue, "/rest/v1/user_roles": () => json(null) }),
  );

  // Not a data leak — the response is only counts — but without the guard
  // anyone who knows the URL could push a notification to every subscribed
  // learner, which is exactly how an app gets its notifications turned off.
  assertEquals(status, 403);
  assertEquals(body.error, "forbidden");
  assert(!calls.some((u) => u.includes("push_subscriptions")));
});

Deno.test("notify-due-reviews refuses a caller with no token", async () => {
  const { status } = await call({ dryRun: true }, upstreams(plentyDue), { jwt: null });

  assertEquals(status, 403);
});

Deno.test("notify-due-reviews refuses a token that resolves to nobody", async () => {
  const { status } = await call(
    { dryRun: true },
    upstreams({ ...plentyDue, "/auth/v1/user": () => json({ message: "bad jwt" }, 401) }),
    { jwt: fixtureJwt() },
  );

  assertEquals(status, 403);
});

Deno.test("notify-due-reviews refuses to run with no VAPID keys", async () => {
  const { status, body, calls } = await call(
    { dryRun: true },
    upstreams(plentyDue),
    { env: { VAPID_PRIVATE_KEY: undefined } },
  );

  // Loudly, rather than reporting a successful round that sent nothing — a
  // scheduled job that silently does nothing is invisible for months.
  assertEquals(status, 503);
  assertStringIncludes(String(body.error), "VAPID keys not configured");
  assert(!calls.some((u) => u.includes("push_subscriptions")));
});

// ── When it will send ───────────────────────────────────────────────────────

Deno.test("notify-due-reviews only sends inside the evening window", async () => {
  for (const [hour, expected] of [[16, 0], [17, 1], [19, 1], [21, 1], [22, 0], [3, 0]] as const) {
    const { body } = await call(
      { dryRun: true },
      upstreams({
        ...plentyDue,
        "/rest/v1/push_subscriptions": () => json([aSubscription({ timezone: zoneAtHour(hour) })]),
      }),
    );

    // 17:00–21:00 in the learner's own time. A review nudge at 3am is how a
    // learner discovers the notification settings.
    assertEquals(body.sent, expected, `at local hour ${hour}`);
  }
});

Deno.test("notify-due-reviews skips a subscription with no timezone", async () => {
  const { body } = await call(
    { dryRun: true },
    upstreams({
      ...plentyDue,
      "/rest/v1/push_subscriptions": () => json([aSubscription({ timezone: null })]),
    }),
  );

  // Unknown time means unknown hour, and defaulting to "send" would mean
  // sending at any hour at all.
  assertEquals(body.sent, 0);
});

Deno.test("notify-due-reviews skips a subscription with an unrecognised timezone", async () => {
  const { body } = await call(
    { dryRun: true },
    upstreams({
      ...plentyDue,
      "/rest/v1/push_subscriptions": () =>
        json([aSubscription({ timezone: "Mars/Olympus_Mons" })]),
    }),
  );

  // `Intl` throws on an unknown zone; catching it back to "no hour" rather
  // than to a default keeps a garbage value from becoming "always send".
  assertEquals(body.sent, 0);
});

Deno.test("notify-due-reviews waits a day between notifications", async () => {
  const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

  for (const [ago, expected] of [[1, 0], [19, 0], [21, 1], [48, 1]] as const) {
    const { body } = await call(
      { dryRun: true },
      upstreams({
        ...plentyDue,
        "/rest/v1/push_subscriptions": () =>
          json([aSubscription({ last_sent_at: hoursAgo(ago) })]),
      }),
    );

    // 20 hours, not 24: the window is only four hours wide, so a strict day
    // would drift a learner out of it entirely after one send.
    assertEquals(body.sent, expected, `last sent ${ago}h ago`);
  }
});

Deno.test("notify-due-reviews treats an unparsable last-sent as never sent", async () => {
  const { body } = await call(
    { dryRun: true },
    upstreams({
      ...plentyDue,
      "/rest/v1/push_subscriptions": () =>
        json([aSubscription({ last_sent_at: "not a date" })]),
    }),
  );

  assertEquals(body.sent, 1);
});

Deno.test("notify-due-reviews stays quiet when there is little to review", async () => {
  for (const [due, expected] of [[0, 0], [4, 0], [5, 1], [40, 1]] as const) {
    const { body } = await call(
      { dryRun: true },
      upstreams({
        "/rest/v1/word_reviews": counted(0),
        "/rest/v1/user_vocabulary": counted(due),
      }),
    );

    // Below five cards a nudge is noise, and noise is what gets the whole
    // channel muted.
    assertEquals(body.sent, expected, `with ${due} cards due`);
  }
});

Deno.test("notify-due-reviews counts all three decks together", async () => {
  const { body, calls } = await call(
    { dryRun: true },
    upstreams({
      // Two curriculum queries (recognition and production) plus the personal
      // deck: 2 + 2 + 2 clears the floor where none does alone.
      "/rest/v1/word_reviews": counted(2),
      "/rest/v1/user_vocabulary": counted(2),
    }),
  );

  assertEquals(body.sent, 1);
  // Production is counted separately because its schedule is independent — a
  // learner can have nothing to recognise and plenty to produce.
  const reviewQueries = calls.filter((u) => u.includes("word_reviews"));
  assertEquals(reviewQueries.length, 2);
  assert(
    reviewQueries.some((u) => decodeURIComponent(u).includes("production_next_review_at")),
  );
});

Deno.test("notify-due-reviews ignores subscriptions the learner disabled", async () => {
  const { calls } = await call({ dryRun: true }, upstreams(plentyDue));

  const query = decodeURIComponent(calls.find((u) => u.includes("push_subscriptions")) ?? "");
  // Filtered in the query rather than in the loop, so a disabled subscription
  // costs nothing to skip.
  assertStringIncludes(query, "disabled_at=is.null");
});

// ── Sending, and what happens after ─────────────────────────────────────────

Deno.test("notify-due-reviews sends nothing on a dry run", async () => {
  const { body, calls } = await call({ dryRun: true }, upstreams(plentyDue));

  // The whole point of the flag: it counts the same subscriptions a real round
  // would notify, so the filters can be checked against production data
  // without waking anybody.
  assertEquals(body.sent, 1);
  assertEquals(body.dryRun, true);
  assert(!calls.some((u) => u.includes("push.test")));
});

Deno.test("notify-due-reviews sends a real notification and records the time", async () => {
  __reset();
  const { body, calls, bodies } = await call({}, upstreams(plentyDue));

  assertEquals(body.sent, 1);
  const sends = __sends();
  assertEquals(sends.length, 1);
  assertEquals(sends[0].endpoint, "https://push.test/endpoint-1");
  // The payload names the count and points at the deck, so the notification is
  // actionable from the lock screen rather than a prompt to go and look.
  // 12 = four recognition + four production + four personal.
  assertStringIncludes(sends[0].payload, "12 cards due");
  assertStringIncludes(sends[0].payload, '"url":"/review"');

  const update = bodies[calls.findIndex((u, i) =>
    u.includes("push_subscriptions") && (bodies[i] ?? "").includes("last_sent_at")
  )] ?? "";
  // Without this the next scheduled run would notify the same learner again
  // twenty minutes later.
  assertStringIncludes(update, "last_sent_at");
});

Deno.test("notify-due-reviews can never use its singular wording", async () => {
  __reset();
  await call(
    {},
    upstreams({
      "/rest/v1/word_reviews": counted(0),
      "/rest/v1/user_vocabulary": counted(5),
    }),
  );

  // Pinned as dead code. The payload pluralises with
  // `${total} card${total === 1 ? "" : "s"}`, but nothing is sent below five
  // due cards — so `total` is never 1 and the singular branch cannot run. The
  // smallest notification a learner can receive says "5 cards due".
  assertStringIncludes(__sends()[0].payload, "5 cards due");
});

Deno.test("notify-due-reviews retires a subscription the browser dropped", async () => {
  for (const status of [404, 410]) {
    __reset([{ match: "push.test", status }]);
    const { body, calls, bodies } = await call({}, upstreams(plentyDue));

    // A dead endpoint never revives on its own; retrying it every evening
    // forever is wasted work. The row is kept rather than deleted so a
    // re-subscribe can revive it.
    assertEquals(body.retired, 1, `for push status ${status}`);
    assertEquals(body.sent, 0);
    const update = bodies[
      calls.findIndex((u, i) =>
        u.includes("push_subscriptions") && (bodies[i] ?? "").includes("disabled_at")
      )
    ] ?? "";
    assertStringIncludes(update, "disabled_at");
  }
});

Deno.test("notify-due-reviews keeps a subscription that failed for another reason", async () => {
  __reset([{ match: "push.test", status: 500 }]);
  const { body } = await call({}, upstreams(plentyDue));

  // A push service having a bad day is not a reason to unsubscribe a learner.
  assertEquals(body.retired, 0);
  assertEquals(body.sent, 0);
});

Deno.test("notify-due-reviews keeps going after one subscription fails", async () => {
  __reset([{ match: "/broken", status: 500 }]);
  const { body } = await call(
    {},
    upstreams({
      ...plentyDue,
      "/rest/v1/push_subscriptions": () =>
        json([
          aSubscription({ id: "sub-1", endpoint: "https://push.test/broken" }),
          aSubscription({ id: "sub-2", endpoint: "https://push.test/working" }),
        ]),
    }),
  );

  // One learner's dead endpoint must not cost everyone else their nudge.
  assertEquals(body.sent, 1);
  assertEquals(__sends().length, 2);
});

Deno.test("notify-due-reviews reports how many it looked at", async () => {
  const { body } = await call(
    { dryRun: true },
    upstreams({
      "/rest/v1/word_reviews": counted(0),
      "/rest/v1/user_vocabulary": counted(1),
    }),
  );

  // Considered but not sent: the subscription passed the time and gap filters
  // and then failed the card floor. Reporting both numbers is what makes a
  // quiet run diagnosable.
  assertEquals(body.considered, 1);
  assertEquals(body.sent, 0);
});

Deno.test("notify-due-reviews works with no body at all", async () => {
  const fn = await loadFunction("notify-due-reviews", {
    upstreams: upstreams(plentyDue),
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE },
  });
  try {
    const response = await fn.handler(
      new Request("http://localhost/notify-due-reviews", {
        method: "POST",
        headers: {
          origin: "https://hakiya.app",
          authorization: `Bearer ${SERVICE_ROLE}`,
        },
      }),
    );

    // The scheduler posts with no body; the parse is caught and defaulted.
    assertEquals(response.status, 200);
    assertEquals((await response.json()).dryRun, false);
  } finally {
    fn.restore();
  }
});
