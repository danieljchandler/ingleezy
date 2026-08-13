import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `analyze-gulf-arabic` — the second half of the Transcribe pipeline.
 *
 * It takes up to seven ASR transcripts of the same audio and arbitrates between
 * them, so it is where the four engines' disagreement is actually resolved. At
 * 2,600 lines it is the largest function in the repo, and the tests here are
 * deliberately about its edges rather than its middle: the guards that decide
 * whether the expensive part runs at all, the phrase shortcut that shares the
 * endpoint, and the envelope the page unwraps.
 *
 * The envelope is the part worth pinning hardest. Failure is reported *in band*
 * as `success: false` rather than as a non-2xx, so a caller that only checked
 * the status would treat an error as a result — which is exactly what
 * `Transcribe.tsx` guards against with `if (!data?.success || !data.result)`.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function allowed(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler> = allowed(),
): Promise<{ status: number; body: Record<string, unknown>; calls: string[] }> {
  const fn = await loadFunction("analyze-gulf-arabic", { upstreams });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", body));
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

Deno.test("refuses a request with no transcript before calling a model", async () => {
  const { status, body, calls } = await call({ dialectModule: "Gulf" });

  assertEquals(status, 400);
  assertEquals(body.error, "Missing or invalid transcript");
  // The guard is in front of the ensemble, which is several model calls per
  // request — the expensive thing must not run for a request that cannot
  // produce anything.
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 0);
});

Deno.test("refuses a transcript too short to analyse", async () => {
  const { status, calls } = await call({ transcript: "اب" });

  // Under three characters. A two-letter fragment is a failed transcription,
  // not a passage, and analysing it produces confident nonsense.
  assertEquals(status, 400);
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 0);
});

Deno.test("refuses whitespace dressed up as a transcript", async () => {
  const { status } = await call({ transcript: "     " });

  assertEquals(status, 400);
});

Deno.test("accepts on-screen text alone when analysing a meme", async () => {
  const { status } = await call({
    transcript: "",
    isMeme: true,
    onScreenTextSegments: [{ text: "لما تصحى بدري", startMs: 0, endMs: 2000 }],
  });

  // A meme is often silent; the caption is the whole content. This is the one
  // case where an empty transcript is a legitimate request rather than a
  // failed one.
  assert(status !== 400, `expected the meme path to be accepted, got ${status}`);
});

Deno.test("reports a missing model key rather than pretending to analyse", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { OPENROUTER_API_KEY: undefined },
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم يا صديقي" }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    // 500 and an explicit message. A misconfigured deployment answering 200
    // with an empty result would look like audio nobody could transcribe.
    assertEquals(response.status, 500);
    assertEquals(body.error, "AI service not configured");
  } finally {
    fn.restore();
  }
});

Deno.test("turns away a request with no credentials", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", { upstreams: allowed() });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-gulf-arabic", { transcript: "شلونك اليوم" }, { jwt: null }),
    );

    assertEquals(response.status, 401);
  } finally {
    fn.restore();
  }
});

Deno.test("turns away a JWT the auth server rejects", async () => {
  const { status } = await call(
    { transcript: "شلونك اليوم يا صديقي" },
    allowed({ "/auth/v1/user": () => json({ error: "invalid" }, 401) }),
  );

  assertEquals(status, 401);
});

Deno.test("translates a bare phrase without running the ensemble", async () => {
  const { status, body, calls } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion("how are you") }),
  );

  // The same endpoint serves a one-word lookup from TappableArabicText. It
  // answers `{ translation }` rather than the analysis envelope, and it must
  // stay a single cheap call — this is invoked on every word tap.
  assertEquals(status, 200);
  assertEquals(body.translation, "how are you");
  assertEquals(calls.filter((url) => url.includes("openrouter.ai")).length, 1);
});

Deno.test("strips the punctuation a model wraps a translation in", async () => {
  const { body } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion('"how are you."') }),
  );

  // Asked for 1–5 words and no punctuation, models return quotes and full
  // stops anyway. The word lands in a flashcard, so the cleanup is load-bearing.
  assertEquals(body.translation, "how are you");
});

Deno.test("reports a phrase translation that came back empty as null", async () => {
  const { status, body } = await call(
    { phrase: "شلونك" },
    allowed({ "openrouter.ai": () => chatCompletion("   ") }),
  );

  // `null`, not `""`. The caller renders the translation directly, and an empty
  // string is indistinguishable from a word with no meaning.
  assertEquals(status, 200);
  assertEquals(body.translation, null);
});

Deno.test("needs a model key for the phrase shortcut too", async () => {
  const fn = await loadFunction("analyze-gulf-arabic", {
    env: { OPENROUTER_API_KEY: undefined },
    upstreams: allowed(),
  });
  try {
    const response = await fn.handler(jsonRequest("analyze-gulf-arabic", { phrase: "شلونك" }));

    assertEquals(response.status, 500);
  } finally {
    fn.restore();
  }
});

Deno.test("normalises an unknown dialect module to Gulf", async () => {
  // Settings offers eight dialects where DialectContext knows three, so this
  // function receives values it has never heard of. Falling back rather than
  // failing is what keeps a learner on "Kuwaiti" getting an analysis at all.
  const { status } = await call(
    { phrase: "شلونك", dialectModule: "Kuwaiti" },
    allowed({ "openrouter.ai": () => chatCompletion("how are you") }),
  );

  assertEquals(status, 200);
});
