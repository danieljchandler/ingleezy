import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-listen-script` — where a Listen episode comes from.
 *
 * The page sends four choices (format, length, audio mode, topic) and gets back
 * a row. Three of the four are closed sets, and the function validates them
 * itself rather than trusting the client — worth pinning, because these values
 * are written straight into columns carrying CHECK constraints, and a bad one
 * would fail at the database with a message nobody can act on.
 *
 * The other thing the tests cover is the handoff at the end: an episode created
 * with `audioMode: "full"` has to leave behind a queued synthesis job, because
 * the row's `pending` status is a promise that something else is working. If
 * that invocation is skipped, the episode sits at `pending` forever and the
 * page's stale-job watchdog is the only thing that ever notices.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const EPISODE = "bbbbbbbb-1111-4000-8000-000000000000";

/**
 * A script the model might return.
 *
 * `script`, not `lines` — that is the property the `emit_episode` tool schema
 * declares and the only one the function reads. A payload using any other name
 * is treated as an empty script and rejected, which is exactly what happened
 * the first time these tests ran.
 */
const aScript = {
  title: "قهوة الصباح",
  summary: "Two friends talk about morning coffee",
  // Four lines is the floor the function enforces, not a stylistic choice —
  // see the "refuses a script too short to be an episode" test below.
  script: [
    { speaker: "A", speaker_role: "host", arabic: "صباح الخير", english: "Good morning" },
    { speaker: "B", speaker_role: "guest", arabic: "صباح النور", english: "Morning light" },
    { speaker: "A", speaker_role: "host", arabic: "تحب قهوة؟", english: "Would you like coffee?" },
    { speaker: "B", speaker_role: "guest", arabic: "أكيد", english: "Of course" },
  ],
  key_vocabulary: [{ arabic: "صباح", english: "morning" }],
};

function allowed(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    "/rest/v1/listen_episodes": () =>
      json({ id: EPISODE, title: aScript.title, audio_status: "pending" }, 201),
    ...extra,
  };
}

/** Answer every LLM gateway with the script as a structured tool call. */
function modelReturns(payload: unknown): Record<string, UpstreamHandler> {
  const reply = () => chatCompletion(JSON.stringify(payload), payload);
  return {
    "ai.gateway.lovable.dev": reply,
    "openrouter.ai": reply,
    "api.openai.com": reply,
    "api.fanar.qa": reply,
    "router.huggingface.co": reply,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler> = allowed(),
): Promise<{ status: number; body: Record<string, unknown>; calls: string[] }> {
  const fn = await loadFunction("generate-listen-script", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("generate-listen-script", body));
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed, calls: fn.calls.map((c) => c.url) };
  } finally {
    fn.restore();
  }
}

Deno.test("refuses a request with no topic before calling a model", async () => {
  const { status, body, calls } = await call({ format: "podcast", length: "short" });

  assertEquals(status, 400);
  assertEquals(body.error, "topic_required");
  // An episode about nothing is not something a model can be asked for; the
  // guard is in front of the spend.
  assertEquals(calls.filter((url) => url.includes("gateway")).length, 0);
});

Deno.test("treats a whitespace topic as no topic", async () => {
  const { status, body } = await call({ topic: "   ", format: "podcast", length: "short" });

  assertEquals(status, 400);
  assertEquals(body.error, "topic_required");
});

Deno.test("refuses a format outside the four it knows", async () => {
  const { status, body } = await call({ topic: "coffee", format: "dialogue", length: "short" });

  // `listen_episodes.format` carries a CHECK constraint over exactly
  // podcast/ted/interview/story. Validating here turns a database error nobody
  // can act on into a named one.
  assertEquals(status, 400);
  assertEquals(body.error, "invalid_format");
});

Deno.test("refuses a length outside the three it knows", async () => {
  const { status, body } = await call({ topic: "coffee", format: "podcast", length: "epic" });

  assertEquals(status, 400);
  assertEquals(body.error, "invalid_length");
});

Deno.test("accepts each of the four formats", async () => {
  for (const format of ["podcast", "ted", "interview", "story"]) {
    const { status } = await call(
      { topic: "coffee", format, length: "short" },
      { ...allowed(), ...modelReturns(aScript) },
    );
    assert(status !== 400, `${format} was rejected`);
  }
});

Deno.test("accepts each of the three lengths", async () => {
  for (const length of ["short", "medium", "long"]) {
    const { status } = await call(
      { topic: "coffee", format: "podcast", length },
      { ...allowed(), ...modelReturns(aScript) },
    );
    assert(status !== 400, `${length} was rejected`);
  }
});

Deno.test("returns the saved episode row", async () => {
  const { status, body } = await call(
    { topic: "coffee", format: "podcast", length: "short" },
    { ...allowed(), ...modelReturns(aScript) },
  );

  // The page navigates to `/listen/${ep.id}` on success, so the row — not the
  // script — is the contract. An answer with no `episode` sends the learner to
  // `/listen/undefined`.
  assertEquals(status, 200);
  assert(body.episode, "no episode in the response");
  assertEquals((body.episode as Record<string, unknown>).id, EPISODE);
});

Deno.test("queues a synthesis job for a full-audio episode", async () => {
  const { calls } = await call(
    { topic: "coffee", format: "podcast", length: "short", audioMode: "full" },
    { ...allowed(), ...modelReturns(aScript) },
  );

  // The row is saved as `pending`, which is a promise that something else is
  // working on it. Without this handoff the episode sits at pending forever
  // and only the page's stale-job watchdog ever notices.
  assert(
    calls.some((url) => url.includes("generate-listen-audio")),
    "no synthesis job was queued",
  );
});

Deno.test("queues nothing for an on-demand episode", async () => {
  const { calls } = await call(
    { topic: "coffee", format: "podcast", length: "short", audioMode: "on_demand" },
    { ...allowed(), ...modelReturns(aScript) },
  );

  // On-demand renders a line when the learner taps it. Pre-rendering the whole
  // thing would spend the synthesis budget on episodes nobody finishes.
  assertEquals(calls.filter((url) => url.includes("generate-listen-audio")).length, 0);
});

Deno.test("defaults to on-demand when the caller says nothing", async () => {
  const { calls } = await call(
    { topic: "coffee", format: "podcast", length: "short" },
    { ...allowed(), ...modelReturns(aScript) },
  );

  // The cheaper default, matching the page's own.
  assertEquals(calls.filter((url) => url.includes("generate-listen-audio")).length, 0);
});

Deno.test("reports an empty script rather than saving one", async () => {
  const { status, body, calls } = await call(
    { topic: "coffee", format: "podcast", length: "short" },
    { ...allowed(), ...modelReturns({ title: "", summary: "", script: [], key_vocabulary: [] }) },
  );

  // A row with no lines is an episode that opens to a blank page. Refusing to
  // save it keeps the library free of dead entries.
  assert(status >= 400, `expected a failure, got ${status}`);
  assertEquals(body.error, "empty_script");
  assertEquals(calls.filter((url) => url.includes("generate-listen-audio")).length, 0);
});

Deno.test("refuses a script too short to be an episode", async () => {
  const { status, body } = await call(
    { topic: "coffee", format: "podcast", length: "short" },
    {
      ...allowed(),
      ...modelReturns({
        title: "قهوة",
        summary: "s",
        script: [
          { speaker: "A", speaker_role: "host", arabic: "صباح الخير", english: "Good morning" },
          { speaker: "B", speaker_role: "guest", arabic: "صباح النور", english: "Morning light" },
          { speaker: "A", speaker_role: "host", arabic: "مع السلامة", english: "Goodbye" },
        ],
        key_vocabulary: [],
      }),
    },
  );

  // Three lines, and the floor is four. A two-exchange "episode" is not worth
  // the synthesis budget or the library slot, so a thin generation is thrown
  // away rather than saved — reported under `empty_script` either way, which
  // is why the distinction is easy to miss from the outside.
  assertEquals(status, 502);
  assertEquals(body.error, "empty_script");
});

Deno.test("ignores lines the model returned with no Arabic in them", async () => {
  const { status } = await call(
    { topic: "coffee", format: "podcast", length: "short" },
    {
      ...allowed(),
      ...modelReturns({
        title: "قهوة",
        summary: "s",
        script: [
          { speaker: "A", speaker_role: "host", arabic: "صباح الخير", english: "Good morning" },
          { speaker: "B", speaker_role: "guest", arabic: "", english: "(silence)" },
          { speaker: "A", speaker_role: "host", arabic: "تحب قهوة؟", english: "Coffee?" },
          { speaker: "B", speaker_role: "guest", arabic: "أكيد", english: "Of course" },
        ],
        key_vocabulary: [],
      }),
    },
  );

  // The filter runs before the count, so an Arabic-less line does not pad a
  // script up to the floor. Four lines, one empty, is a three-line episode.
  assertEquals(status, 502);
});

Deno.test("turns away a request with no credentials", async () => {
  const fn = await loadFunction("generate-listen-script", { upstreams: allowed() });
  try {
    const response = await fn.handler(
      jsonRequest("generate-listen-script", { topic: "coffee" }, { jwt: null }),
    );

    // Generation is metered per user, so an unauthenticated call would be an
    // uncapped one.
    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});
