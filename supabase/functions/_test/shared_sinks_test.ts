import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * The four write-side sinks in `_shared`, tested directly.
 *
 * All four are deliberately silent: `logEdgeError`, `logMetric`,
 * `recordLearnerErrors` and `logMsaViolations` each wrap their whole body in a
 * try/catch that swallows everything, because none of them may be allowed to
 * fail the learner-facing request they are attached to. That design is right,
 * and it is exactly why a test at the edge-function level cannot see them: a
 * function whose sink writes nothing at all responds identically to one whose
 * sink works. The only place the difference is observable is here, against the
 * outbound request.
 *
 * Three of them are also fire-and-forget at the call site, so "did it write"
 * has to be answered by waiting for the request rather than by awaiting the
 * return value — `logMsaViolations` returns `void` while two inserts are still
 * in flight.
 */

const REST = "/rest/v1/";
const USER_ID = "00000000-0000-4000-8000-000000000001";

/** Wait for an outbound request whose URL contains `match`. */
async function waitForCall(up: StubbedUpstreams, match: string, count = 1) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (up.callsTo(match).length >= count) return up.callsTo(match);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `No request to ${match} after 500ms. Saw:\n  ` +
      up.calls.map((call) => `${call.method} ${call.url}`).join("\n  "),
  );
}

/**
 * Give a fire-and-forget sink every chance to write before asserting it didn't.
 *
 * A bare assertion on an empty array passes instantly and would pass just as
 * happily against a sink that writes a moment later.
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 5));
}

const bodyOf = (call: { body: string | null }) => JSON.parse(call.body ?? "null");

// ── logError ────────────────────────────────────────────────────────────────

interface LogErrorModule {
  logEdgeError: (
    functionName: string,
    err: unknown,
    meta?: { userId?: string | null; route?: string | null; extra?: Record<string, unknown> },
  ) => Promise<void>;
}

async function withLogError(
  run: (mod: LogErrorModule, up: StubbedUpstreams) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const up = stubUpstreams({ env });
  try {
    await run(await loadSharedModule<LogErrorModule>("logError"), up);
  } finally {
    up.restore();
  }
}

Deno.test("an edge error lands in the same table as a client error", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("generate-story", new Error("upstream exploded"), {
      userId: USER_ID,
      route: "/stories/42",
    });

    const [call] = await waitForCall(up, "client_errors");
    const row = bodyOf(call);
    // One table for both sides is the point: the admin errors page shows a
    // learner's crash and the function that failed them in the same list.
    assertEquals(row.source, "edge");
    assertEquals(row.function_name, "generate-story");
    assertEquals(row.message, "upstream exploded");
    assertEquals(row.user_id, USER_ID);
    assertEquals(row.route, "/stories/42");
    assert(typeof row.stack === "string" && row.stack.length > 0);
  });
});

Deno.test("a thrown non-Error is still recorded, with no stack", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("free-chat", "rate limited");

    const row = bodyOf((await waitForCall(up, "client_errors"))[0]);
    // `throw "string"` happens, and so does a rejected promise carrying an
    // object. Recording those as "[object Object]" beats recording nothing.
    assertEquals(row.message, "rate limited");
    assertEquals(row.stack, null);
    assertEquals(row.user_id, null);
    assertEquals(row.route, null);
  });
});

Deno.test("an error with no message still produces a row worth reading", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("translate", new Error(""));

    const row = bodyOf((await waitForCall(up, "client_errors"))[0]);
    // An empty string in a NOT NULL column that the admin page renders as a
    // blank line is worse than a placeholder saying there was nothing to say.
    assertEquals(row.message, "(empty)");
  });
});

Deno.test("a long message, stack and route are truncated rather than rejected", async () => {
  await withLogError(async (mod, up) => {
    const error = new Error("m".repeat(5000));
    error.stack = "s".repeat(20000);

    await mod.logEdgeError("transcribe", error, { route: "/r".repeat(1000) });

    const row = bodyOf((await waitForCall(up, "client_errors"))[0]);
    // A runaway stack from a recursive failure would otherwise be the thing
    // that makes the error logger itself fail.
    assertEquals(row.message.length, 2000);
    assertEquals(row.stack.length, 8000);
    assertEquals(row.route.length, 500);
  });
});

Deno.test("the extra context is carried as structured meta", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("download-media", new Error("nope"), {
      extra: { provider: "cobalt", attempt: 3 },
    });

    const row = bodyOf((await waitForCall(up, "client_errors"))[0]);
    assertEquals(row.meta, { provider: "cobalt", attempt: 3 });
  });
});

Deno.test("meta defaults to an object rather than null", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("download-media", new Error("nope"));

    const row = bodyOf((await waitForCall(up, "client_errors"))[0]);
    // The column is jsonb and the admin page spreads it; null would be a
    // different shape for every caller that omitted the field.
    assertEquals(row.meta, {});
  });
});

Deno.test("nothing is written when the service role is missing", async () => {
  await withLogError(async (mod, up) => {
    await mod.logEdgeError("generate-story", new Error("boom"));

    await settle();
    // A function running without secrets is already broken; the logger must not
    // add a second failure on top of the first.
    assertEquals(up.callsTo("client_errors").length, 0);
  }, { SUPABASE_SERVICE_ROLE_KEY: undefined });
});

Deno.test("a rejected insert never reaches the caller", async () => {
  await withLogError(async (mod, up) => {
    up.stub("/rest/v1/client_errors", () => json({ message: "permission denied" }, 403));

    // Pinned as the contract: the logger resolves. Callers `await` this inside
    // their own catch block, so a throw here would replace the real error with
    // the logger's.
    await mod.logEdgeError("generate-story", new Error("boom"));
    await waitForCall(up, "client_errors");
  });
});

// ── featureMetrics ──────────────────────────────────────────────────────────

interface MetricInput {
  feature: string;
  event: string;
  dialect?: string | null;
  status?: "ok" | "warn" | "error";
  durationMs?: number | null;
  count?: number | null;
  score?: number | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
}

interface FeatureMetricsModule {
  logMetric: (input: MetricInput) => Promise<void>;
  emitMetric: (input: MetricInput) => void;
}

async function withMetrics(
  run: (mod: FeatureMetricsModule, up: StubbedUpstreams) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const up = stubUpstreams({ env });
  try {
    await run(await loadSharedModule<FeatureMetricsModule>("featureMetrics"), up);
  } finally {
    up.restore();
  }
}

Deno.test("a metric carries the fields the admin dashboard slices on", async () => {
  await withMetrics(async (mod, up) => {
    await mod.logMetric({
      feature: "souq-news",
      event: "firecrawl_search",
      dialect: "Gulf",
      status: "warn",
      durationMs: 1234,
      count: 3,
      score: 0.42,
      userId: USER_ID,
      meta: { query: "أخبار" },
    });

    const row = bodyOf((await waitForCall(up, "feature_metrics"))[0]);
    assertEquals(row, {
      feature: "souq-news",
      event: "firecrawl_search",
      dialect: "Gulf",
      status: "warn",
      duration_ms: 1234,
      count: 3,
      score: 0.42,
      user_id: USER_ID,
      meta: { query: "أخبار" },
    });
  });
});

Deno.test("a metric with only a feature and an event defaults the rest", async () => {
  await withMetrics(async (mod, up) => {
    await mod.logMetric({ feature: "ai-brain", event: "json_parse" });

    const row = bodyOf((await waitForCall(up, "feature_metrics"))[0]);
    // "ok" rather than null: an unstatused row would drop out of every
    // status-filtered chart, which is where the successes are supposed to show.
    assertEquals(row.status, "ok");
    assertEquals(row.dialect, null);
    assertEquals(row.duration_ms, null);
    assertEquals(row.count, null);
    assertEquals(row.score, null);
    assertEquals(row.user_id, null);
    assertEquals(row.meta, {});
  });
});

Deno.test("a zero duration is recorded rather than nulled", async () => {
  await withMetrics(async (mod, up) => {
    await mod.logMetric({ feature: "listen", event: "tts", durationMs: 0, count: 0, score: 0 });

    const row = bodyOf((await waitForCall(up, "feature_metrics"))[0]);
    // `?? null` rather than `|| null` is what makes this true, and a cache hit
    // that took no measurable time is a real and interesting data point.
    assertEquals(row.duration_ms, 0);
    assertEquals(row.count, 0);
    assertEquals(row.score, 0);
  });
});

Deno.test("emitMetric returns before the write and still writes", async () => {
  await withMetrics(async (mod, up) => {
    // The whole reason it exists: call sites on the hot path must not await a
    // diagnostic insert.
    assertEquals(mod.emitMetric({ feature: "discover", event: "feed_build" }), undefined);
    assertEquals(up.callsTo("feature_metrics").length, 0);

    await waitForCall(up, "feature_metrics");
  });
});

Deno.test("metrics are dropped silently when there is no service role", async () => {
  await withMetrics(async (mod, up) => {
    await mod.logMetric({ feature: "ai-brain", event: "json_parse" });
    mod.emitMetric({ feature: "ai-brain", event: "json_parse" });

    await settle();
    assertEquals(up.callsTo("feature_metrics").length, 0);
  }, { SUPABASE_URL: undefined });
});

Deno.test("a rejected metric insert never reaches the caller", async () => {
  await withMetrics(async (mod, up) => {
    up.stub("/rest/v1/feature_metrics", () => json({ message: "no such table" }, 404));

    await mod.logMetric({ feature: "ai-brain", event: "json_parse" });
    await waitForCall(up, "feature_metrics");
  });
});

// ── learnerErrors ───────────────────────────────────────────────────────────

interface LearnerErrorInput {
  source: string;
  dialect?: string;
  targetArabic: string;
  producedArabic?: string | null;
  errorKind?: string;
  detail?: Record<string, unknown>;
  wordId?: string | null;
  userVocabularyId?: string | null;
}

interface LearnerErrorsModule {
  resolveUserId: (req: Request) => Promise<string | null>;
  recordLearnerErrors: (
    userId: string | null | undefined,
    entries: LearnerErrorInput[],
  ) => Promise<void>;
  recordLearnerErrorsForRequest: (req: Request, entries: LearnerErrorInput[]) => Promise<void>;
  resolveLearnerErrors: (
    userId: string | null | undefined,
    targetArabic: string | string[],
    dialect?: string,
  ) => Promise<void>;
  resolveLearnerErrorsForRequest: (
    req: Request,
    targetArabic: string | string[],
    dialect?: string,
  ) => Promise<void>;
}

async function withLearnerErrors(
  run: (mod: LearnerErrorsModule, up: StubbedUpstreams) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const up = stubUpstreams({ env });
  try {
    await run(await loadSharedModule<LearnerErrorsModule>("learnerErrors"), up);
  } finally {
    up.restore();
  }
}

const anError = (over: Partial<LearnerErrorInput> = {}): LearnerErrorInput => ({
  source: "pronunciation",
  targetArabic: "شخبارك",
  ...over,
});

const scoringRequest = (jwt: string | null = fixtureJwt()) =>
  new Request("https://e2e.supabase.co/functions/v1/score", {
    method: "POST",
    headers: jwt === null ? {} : { authorization: `Bearer ${jwt}` },
  });

Deno.test("a mistake is recorded against the learner who made it", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [
      anError({
        dialect: "Egyptian",
        producedArabic: "شخبارج",
        errorKind: "phoneme",
        detail: { phoneme: "k" },
        wordId: "word-1",
        userVocabularyId: "voc-1",
      }),
    ]);

    const [row] = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    assertEquals(row, {
      user_id: USER_ID,
      dialect: "Egyptian",
      source: "pronunciation",
      target_arabic: "شخبارك",
      produced_arabic: "شخبارج",
      error_kind: "phoneme",
      detail: { phoneme: "k" },
      word_id: "word-1",
      user_vocabulary_id: "voc-1",
    });
  });
});

Deno.test("an entry with no dialect or kind gets the defaults the read side expects", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [anError()]);

    const [row] = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    // The `weak` bucket that feeds generated content filters by dialect, so a
    // null there would make the row invisible to the thing it exists to drive.
    assertEquals(row.dialect, "Gulf");
    assertEquals(row.error_kind, "other");
    assertEquals(row.detail, {});
    assertEquals(row.produced_arabic, null);
  });
});

Deno.test("surrounding whitespace is trimmed off both sides of the pair", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [
      anError({ targetArabic: "  شخبارك  ", producedArabic: "  شخبارج  " }),
    ]);

    const [row] = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    // Resolution matches on the exact string later, so an untrimmed row could
    // never be cleared.
    assertEquals(row.target_arabic, "شخبارك");
    assertEquals(row.produced_arabic, "شخبارج");
  });
});

Deno.test("a produced form that is only whitespace is stored as nothing", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [anError({ producedArabic: "   " })]);

    const [row] = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    // Silence from the recogniser is a real outcome; storing it as an empty
    // string would render as an invisible "you said" line in review.
    assertEquals(row.produced_arabic, null);
  });
});

Deno.test("entries with no target are dropped, not written blank", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [
      anError({ targetArabic: "  " }),
      anError({ targetArabic: "كتاب" }),
    ]);

    const rows = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].target_arabic, "كتاب");
  });
});

Deno.test("a request that produces only blank targets writes nothing at all", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(USER_ID, [anError({ targetArabic: "" })]);

    await settle();
    // Not an empty insert: PostgREST would accept `[]` and the round trip would
    // be pure cost on the learner's scoring request.
    assertEquals(up.callsTo("learner_errors").length, 0);
  });
});

Deno.test("a long utterance cannot write more than twelve rows", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(
      USER_ID,
      Array.from({ length: 40 }, (_, index) => anError({ targetArabic: `كلمة${index}` })),
    );

    const rows = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    // A learner reading a paragraph badly would otherwise write a row per word,
    // and the weak set becomes noise the moment it is that large.
    assertEquals(rows.length, 12);
    assertEquals(rows[0].target_arabic, "كلمة0");
    assertEquals(rows[11].target_arabic, "كلمة11");
  });
});

Deno.test("nothing is recorded without a user", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrors(null, [anError()]);
    await mod.recordLearnerErrors(undefined, [anError()]);

    await settle();
    // Anonymous scoring is allowed on some routes; there is nobody to attribute
    // the mistake to and no profile it could ever feed.
    assertEquals(up.callsTo("learner_errors").length, 0);
  });
});

Deno.test("a rejected insert never reaches the scoring request", async () => {
  await withLearnerErrors(async (mod, up) => {
    up.stub("/rest/v1/learner_errors", () => json({ message: "denied" }, 403));

    await mod.recordLearnerErrors(USER_ID, [anError()]);
    await waitForCall(up, "learner_errors");
  });
});

Deno.test("a correct answer clears the matching unresolved errors", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.resolveLearnerErrors(USER_ID, ["شخبارك", "كتاب"], "Gulf");

    const [call] = await waitForCall(up, "learner_errors");
    assertEquals(call.method, "PATCH");
    assert(typeof bodyOf(call).resolved_at === "string");
    const url = decodeURIComponent(call.url);
    assert(url.includes(`user_id=eq.${USER_ID}`), url);
    assert(url.includes("target_arabic=in."), url);
    // Only the ones still open: re-stamping an already-resolved row would move
    // its resolution date every time the learner got it right again.
    assert(url.includes("resolved_at=is.null"), url);
    assert(url.includes("dialect=eq.Gulf"), url);
  });
});

Deno.test("resolution without a dialect clears the target in every dialect", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.resolveLearnerErrors(USER_ID, "كتاب");

    const [call] = await waitForCall(up, "learner_errors");
    assert(!decodeURIComponent(call.url).includes("dialect=eq."), call.url);
  });
});

Deno.test("repeated targets are collapsed into one filter", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.resolveLearnerErrors(USER_ID, ["كتاب", " كتاب ", "كتاب"]);

    const [call] = await waitForCall(up, "learner_errors");
    const list = decodeURIComponent(call.url).split("target_arabic=in.")[1].split("&")[0];
    // One `in` over N round trips is the stated reason the list form exists;
    // duplicates would defeat it on exactly the utterance that repeats a word.
    assertEquals(list.replace(/[()"]/g, "").split(",").length, 1);
  });
});

Deno.test("nothing is resolved for a blank target or a missing user", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.resolveLearnerErrors(USER_ID, ["", "   "]);
    await mod.resolveLearnerErrors(null, "كتاب");

    await settle();
    // A resolve with no target filter would clear the learner's entire error
    // history, which is the worst thing this module could do.
    assertEquals(up.callsTo("learner_errors").length, 0);
  });
});

Deno.test("the caller can be identified from the bearer token", async () => {
  await withLearnerErrors(async (mod) => {
    assertEquals(await mod.resolveUserId(scoringRequest()), USER_ID);
  });
});

Deno.test("an unauthenticated request resolves to nobody", async () => {
  await withLearnerErrors(async (mod, up) => {
    assertEquals(await mod.resolveUserId(scoringRequest(null)), null);
    // Not even a lookup: there is no token to look up.
    assertEquals(up.callsTo("/auth/v1/").length, 0);
  });
});

Deno.test("a rejected token resolves to nobody rather than throwing", async () => {
  await withLearnerErrors(async (mod, up) => {
    up.stub("/auth/v1/", () => json({ message: "invalid claim" }, 401));

    assertEquals(await mod.resolveUserId(scoringRequest()), null);
  });
});

Deno.test("recording for a request resolves the user first", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrorsForRequest(scoringRequest(), [anError()]);

    const [row] = bodyOf((await waitForCall(up, "learner_errors"))[0]);
    assertEquals(row.user_id, USER_ID);
  });
});

Deno.test("recording for a request skips the auth lookup when there is nothing to record", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.recordLearnerErrorsForRequest(scoringRequest(), []);

    await settle();
    // A clean attempt is the common case, and it should cost nothing.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("resolving for a request skips the auth lookup when every target is blank", async () => {
  await withLearnerErrors(async (mod, up) => {
    await mod.resolveLearnerErrorsForRequest(scoringRequest(), ["", "  "]);

    await settle();
    assertEquals(up.calls.length, 0);
  });
});

// ── msaViolationLogger ──────────────────────────────────────────────────────

interface MsaLeakResult {
  leaks: string[];
  severity: "low" | "medium" | "high";
  ruleHits?: Record<string, string>;
}

interface MsaViolationLoggerModule {
  logMsaViolations: (args: {
    dialect: string;
    leaks: MsaLeakResult;
    offendingText: string;
    sourceFunction: string;
    metadata?: Record<string, unknown>;
    enqueueReview?: boolean;
    validator?: { ok: boolean; verdict: "pass" | "rewrite" | "unknown"; score: number };
  }) => void;
  logValidatorResult: (args: {
    dialect: string;
    result: {
      ok: boolean;
      verdict: "pass" | "rewrite" | "unknown";
      score: number;
      leaks: Array<{ token: string; suggestion?: string; reason?: string }>;
      notes?: string;
      latencyMs: number;
    };
    offendingText: string;
    sourceFunction: string;
    metadata?: Record<string, unknown>;
    enqueueReview?: boolean;
  }) => void;
}

async function withMsaLogger(
  run: (mod: MsaViolationLoggerModule, up: StubbedUpstreams) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const up = stubUpstreams({ env });
  try {
    await run(await loadSharedModule<MsaViolationLoggerModule>("msaViolationLogger"), up);
  } finally {
    up.restore();
  }
}

const VIOLATIONS = `${REST}dialect_rule_violations`;
const REVIEWS = `${REST}dialect_native_reviews`;

Deno.test("a detected MSA leak is recorded per offending token", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا", "كيف"], severity: "low", ruleHits: { "ماذا": "rule-7" } },
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
      metadata: { lessonId: "l-1" },
    });

    const rows = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(rows.length, 2);
    // A row per token, not per text: the admin rulebook page is a list of words
    // that leaked, and which rule caught each one is what makes it fixable.
    assertEquals(rows[0].msa_token, "ماذا");
    assertEquals(rows[0].rule_id, "rule-7");
    assertEquals(rows[1].msa_token, "كيف");
    assertEquals(rows[1].rule_id, null);
    assertEquals(rows[0].detected_by, "msa_leak_detector");
    assertEquals(rows[0].source_function, "generate-story");
    assertEquals(rows[0].offending_text, "ماذا تفعل؟");
    assertEquals(rows[0].metadata.lessonId, "l-1");
  });
});

Deno.test("a clean text writes nothing", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: [], severity: "low" },
      offendingText: "شخبارك؟",
      sourceFunction: "generate-story",
    });

    await settle();
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a medium-severity leak is queued for a native speaker to look at", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Yemeni",
      leaks: { leaks: ["ماذا"], severity: "medium" },
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
    });

    const [call] = await waitForCall(up, REVIEWS);
    const [row] = bodyOf(call);
    assertEquals(row.dialect, "Yemeni");
    assertEquals(row.status, "pending");
    assertEquals(row.source, "msa_leak_detector");
    assertEquals(row.content_type, "generate-story");
    assertEquals(row.metadata.leaks, ["ماذا"]);
  });
});

Deno.test("a low-severity leak is logged but not queued", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "low" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
    });

    await waitForCall(up, VIOLATIONS);
    await settle();
    // Native review is a human's time. A single low-confidence hit is not worth
    // it; the violation row still accumulates for the rulebook.
    assertEquals(up.callsTo(REVIEWS).length, 0);
  });
});

Deno.test("a caller can force review of a low-severity leak", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "low" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
      enqueueReview: true,
    });

    await waitForCall(up, REVIEWS);
  });
});

Deno.test("a text the native validator cleared is downgraded and not queued", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
      validator: { ok: true, verdict: "pass", score: 5 },
    });

    const [row] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    // The detector is a word list and over-fires on spelling variants. When a
    // native-speaker model has already read the whole sentence and called it
    // authentic, it is the more reliable of the two.
    assertEquals(row.metadata.severity, "low");
    assertEquals(row.metadata.original_severity, "high");
    assertEquals(row.metadata.validator_passed, true);
    assertEquals(row.metadata.validator_score, 5);

    await settle();
    assertEquals(up.callsTo(REVIEWS).length, 0);
  });
});

Deno.test("a validator that only just passed does not downgrade anything", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
      // Score 3 is "would feel off to a native" — agreeing with the detector,
      // not overruling it.
      validator: { ok: true, verdict: "pass", score: 3 },
    });

    const [row] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(row.metadata.severity, "high");
    assertEquals(row.metadata.validator_passed, false);
    await waitForCall(up, REVIEWS);
  });
});

Deno.test("a validator that itself failed does not downgrade anything", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
      validator: { ok: false, verdict: "pass", score: 5 },
    });

    const [row] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    // An errored validator returns score 0 with verdict unknown, but a caller
    // passing a stale `pass` alongside `ok: false` must not silence the gate.
    assertEquals(row.metadata.validator_passed, false);
  });
});

Deno.test("a long offending text is truncated in both tables", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ا".repeat(5000),
      sourceFunction: "generate-story",
    });

    const [violation] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(violation.offending_text.length, 2000);
    const [review] = bodyOf((await waitForCall(up, REVIEWS))[0]);
    assertEquals(review.original_text.length, 2000);
  });
});

Deno.test("a text that leaked everywhere writes at most twenty rows", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: {
        leaks: Array.from({ length: 50 }, (_, index) => `token${index}`),
        severity: "low",
      },
      offendingText: "…",
      sourceFunction: "generate-story",
    });

    const rows = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(rows.length, 20);
  });
});

Deno.test("a violation insert that fails does not stop the review being queued", async () => {
  await withMsaLogger(async (mod, up) => {
    up.stub(VIOLATIONS, () => json({ message: "denied" }, 403));

    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
    });

    // Pinned. The review row is enqueued from the insert's success callback and
    // is written even when the violation row was rejected, so it carries
    // `violation_id: null` and the admin page cannot link it back to the token
    // that caused it.
    const [row] = bodyOf((await waitForCall(up, REVIEWS))[0]);
    assertEquals(row.violation_id, null);
  });
});

Deno.test("nothing is logged without a service role", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logMsaViolations({
      dialect: "Gulf",
      leaks: { leaks: ["ماذا"], severity: "high" },
      offendingText: "ماذا",
      sourceFunction: "generate-story",
    });

    await settle();
    assertEquals(up.calls.length, 0);
  }, { SUPABASE_SERVICE_ROLE_KEY: undefined });
});

const aValidatorResult = (over: Record<string, unknown> = {}) => ({
  ok: true,
  verdict: "rewrite" as const,
  score: 2,
  leaks: [{ token: "ماذا", suggestion: "شنو", reason: "MSA interrogative" }],
  notes: "reads as fusha",
  latencyMs: 900,
  ...over,
});

Deno.test("a validator rewrite verdict is logged and queued", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult(),
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
    });

    const [violation] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(violation.detected_by, "native_validator");
    assertEquals(violation.msa_token, "ماذا");
    // The suggestion is the whole value of the model over the word list: it
    // says what to write instead.
    assertEquals(violation.suggested_replacement, "شنو");
    assertEquals(violation.metadata.reason, "MSA interrogative");
    assertEquals(violation.metadata.score, 2);

    const [review] = bodyOf((await waitForCall(up, REVIEWS))[0]);
    assertEquals(review.source, "native_validator");
    assertEquals(review.metadata.notes, "reads as fusha");
  });
});

Deno.test("a validator result that errored is ignored entirely", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ ok: false, score: 0, verdict: "unknown" }),
      offendingText: "ماذا",
      sourceFunction: "generate-story",
    });

    await settle();
    // A failed validator scores 0, and logging that as a violation would fill
    // the rulebook with rows about the gateway being down.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a clean pass is not logged", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ verdict: "pass", score: 5, leaks: [] }),
      offendingText: "شخبارك؟",
      sourceFunction: "generate-story",
    });

    await settle();
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a pass that still found something is logged but not queued", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ verdict: "pass", score: 4 }),
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
    });

    await waitForCall(up, VIOLATIONS);
    await settle();
    // Worth a row so the rulebook sees the near-miss; not worth a human's time.
    assertEquals(up.callsTo(REVIEWS).length, 0);
  });
});

Deno.test("a pass with a leak can still be forced to review", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ verdict: "pass", score: 4 }),
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
      enqueueReview: true,
    });

    await waitForCall(up, REVIEWS);
  });
});

Deno.test("a rewrite with no named token is still queued for review", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ leaks: [] }),
      offendingText: "ماذا تفعل؟",
      sourceFunction: "generate-story",
    });

    // "It reads as fusha overall" is a real verdict with no single offending
    // word, and it is exactly the case a word list cannot catch.
    const [row] = bodyOf((await waitForCall(up, REVIEWS))[0]);
    assertEquals(row.metadata.verdict, "rewrite");
    assertEquals(up.callsTo(VIOLATIONS).length, 0);
  });
});

Deno.test("a validator result that named fifty tokens writes at most twenty", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({
        leaks: Array.from({ length: 50 }, (_, index) => ({ token: `token${index}` })),
      }),
      offendingText: "…",
      sourceFunction: "generate-story",
    });

    assertEquals(bodyOf((await waitForCall(up, VIOLATIONS))[0]).length, 20);
  });
});

Deno.test("a leak with no suggestion is recorded with a null replacement", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult({ leaks: [{ token: "ماذا" }] }),
      offendingText: "ماذا",
      sourceFunction: "generate-story",
    });

    const [row] = bodyOf((await waitForCall(up, VIOLATIONS))[0]);
    assertEquals(row.suggested_replacement, null);
    assertEquals(row.metadata.reason, null);
  });
});

Deno.test("a source function with no name falls back to manual", async () => {
  await withMsaLogger(async (mod, up) => {
    mod.logValidatorResult({
      dialect: "Gulf",
      result: aValidatorResult(),
      offendingText: "ماذا",
      sourceFunction: "",
    });

    const [row] = bodyOf((await waitForCall(up, REVIEWS))[0]);
    // The admin review queue groups by content type; an empty string would be
    // its own unlabelled group.
    assertEquals(row.content_type, "manual");
  });
});

// ── logRepairPair (trainingExampleLogger) ───────────────────────────────────
// The flywheel's bronze lane: when the Brain's MSA repair pass actually shifts
// a leak, the before/after pair lands in training_examples as automated
// (auto_repair) distillation data. Same silent-sink contract as the others.

interface TrainingExampleLoggerModule {
  logRepairPair: (args: {
    dialect: string;
    machineOutput: string;
    repairedOutput: string;
    sourceFunction: string;
    leaks: string[];
    metadata?: Record<string, unknown>;
  }) => void;
}

async function withRepairLogger(
  run: (mod: TrainingExampleLoggerModule, up: StubbedUpstreams) => Promise<void>,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const up = stubUpstreams({
    upstreams: { "/rest/v1/training_examples": () => json({}, 201) },
    env,
  });
  try {
    await run(await loadSharedModule<TrainingExampleLoggerModule>("trainingExampleLogger"), up);
  } finally {
    up.restore();
  }
}

Deno.test("a shifted repair lands as a bronze auto_repair pair", async () => {
  await withRepairLogger(async (mod, up) => {
    mod.logRepairPair({
      dialect: "Gulf",
      machineOutput: "ماذا تريد الآن؟",
      repairedOutput: "وش تبي الحين؟",
      sourceFunction: "generate-story",
      leaks: ["ماذا", "الآن"],
    });

    const [call] = await waitForCall(up, "training_examples");
    const [row] = bodyOf(call);
    assertEquals(row.tier, "bronze");
    assertEquals(row.corrector_role, "auto_repair");
    assertEquals(row.machine_output, "ماذا تريد الآن؟");
    assertEquals(row.human_output, "وش تبي الحين؟");
    assertEquals(row.source_function, "generate-story");
    assertEquals(row.context.leaks, ["ماذا", "الآن"]);
  });
});

Deno.test("an unchanged repair writes nothing — there is no correction to learn", async () => {
  await withRepairLogger(async (mod, up) => {
    mod.logRepairPair({
      dialect: "Gulf",
      machineOutput: "وش تبي الحين؟",
      repairedOutput: "وش تبي الحين؟",
      sourceFunction: "generate-story",
      leaks: [],
    });

    await settle();
    assertEquals(up.callsTo("training_examples").length, 0);
  });
});

Deno.test("a repair pair is silent when the service role is missing", async () => {
  await withRepairLogger(
    async (mod, up) => {
      mod.logRepairPair({
        dialect: "Gulf",
        machineOutput: "ماذا تريد",
        repairedOutput: "وش تبي",
        sourceFunction: "generate-story",
        leaks: ["ماذا"],
      });

      await settle();
      assertEquals(up.callsTo("training_examples").length, 0);
    },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
  );
});

// ── contributeLearnerAudio (learnerAudioContribution) ───────────────────────
// W5: opt-in retention of a learner's scored clips. The consent flag is read
// fresh per contribution, and everything is silent — a scoring response never
// waits on this bookkeeping.

interface LearnerAudioModule {
  contributeLearnerAudio: (args: {
    userId: string;
    dialect: string;
    audioBytes: Uint8Array;
    mimeType: string;
    referenceText: string;
    recognizedText: string | null;
    score: number | null;
    sourceFunction: string;
  }) => void;
}

const CLIP = new Uint8Array([1, 2, 3, 4]);

function contributionArgs(over: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    dialect: "Yemeni",
    audioBytes: CLIP,
    mimeType: "audio/webm",
    referenceText: "ايش تبغى ذحين؟",
    recognizedText: "ايش تبا ذحين",
    score: 82,
    sourceFunction: "azure-pronunciation",
    ...over,
  } as Parameters<LearnerAudioModule["contributeLearnerAudio"]>[0];
}

async function withLearnerAudio(
  optedIn: boolean,
  run: (mod: LearnerAudioModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({
    upstreams: {
      "/rest/v1/profiles": () => json({ contribute_audio: optedIn }),
      "/storage/v1/object/learner-audio": () => json({ Key: "stored" }),
      "/rest/v1/training_examples": () => json({}, 201),
    },
  });
  try {
    await run(await loadSharedModule<LearnerAudioModule>("learnerAudioContribution"), up);
  } finally {
    up.restore();
  }
}

Deno.test("an opted-in learner's clip is stored and banked with its target text", async () => {
  await withLearnerAudio(true, async (mod, up) => {
    mod.contributeLearnerAudio(contributionArgs());

    const [upload] = await waitForCall(up, "/storage/v1/object/learner-audio");
    // Keyed {user_id}/{uuid}.webm so a deletion request is one prefix removal.
    assertStringIncludes(upload.url, `learner-audio/${USER_ID}/`);
    assertStringIncludes(upload.url, ".webm");

    const [insert] = await waitForCall(up, "training_examples");
    const [row] = bodyOf(insert);
    assertEquals(row.task_type, "pronunciation");
    assertEquals(row.human_output, "ايش تبغى ذحين؟");
    assertEquals(row.machine_output, "ايش تبا ذحين");
    assertEquals(row.corrector_role, "learner");
    assertEquals(row.source_license, "learner_contributed");
    assertEquals(row.pii_reviewed, false);
    assertEquals(row.context.score, 82);
  });
});

Deno.test("without consent, nothing is stored — not even the metadata row", async () => {
  await withLearnerAudio(false, async (mod, up) => {
    mod.contributeLearnerAudio(contributionArgs());

    await settle();
    assertEquals(up.callsTo("learner-audio").length, 0);
    assertEquals(up.callsTo("training_examples").length, 0);
  });
});

Deno.test("an oversized clip is dropped rather than stored", async () => {
  await withLearnerAudio(true, async (mod, up) => {
    mod.contributeLearnerAudio(
      contributionArgs({ audioBytes: new Uint8Array(3 * 1024 * 1024) }),
    );

    await settle();
    // Two megabytes bounds a single practice utterance; beyond that it is not
    // one — and the storage bill is real.
    assertEquals(up.callsTo("learner-audio").length, 0);
  });
});

Deno.test("a failed upload never writes a dangling metadata row", async () => {
  const up = stubUpstreams({
    upstreams: {
      "/rest/v1/profiles": () => json({ contribute_audio: true }),
      "/storage/v1/object/learner-audio": () => json({ error: "bucket full" }, 500),
      "/rest/v1/training_examples": () => json({}, 201),
    },
  });
  try {
    const mod = await loadSharedModule<LearnerAudioModule>("learnerAudioContribution");
    mod.contributeLearnerAudio(contributionArgs());

    await waitForCall(up, "/storage/v1/object/learner-audio");
    await settle();
    // A training row pointing at audio that never landed poisons the export.
    assertEquals(up.callsTo("training_examples").length, 0);
  } finally {
    up.restore();
  }
});
