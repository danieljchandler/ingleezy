import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `report-content` — the learner's door into the flywheel. A thumbs-down or
 * "this looks wrong" lands in dialect_native_reviews as source 'user_report';
 * it only becomes a training pair after a native speaker corrects it there.
 * What matters: reports are capped, attributed, clipped, and never write
 * training_examples directly.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function backend(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json(null),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/dialect_native_reviews": () => json({}, 201),
    ...extra,
  };
}

async function call(body: unknown, upstreams: Record<string, UpstreamHandler>, jwt?: string | null) {
  const fn = await loadFunction("report-content", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("report-content", body, jwt === undefined ? {} : { jwt }),
    );
    return {
      status: response.status,
      body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

Deno.test("report-content queues a report for native review, attributed to its reporter", async () => {
  const { status, body, calls, bodies } = await call(
    { kind: "assistant_message", dialect: "Gulf", text: "هذا لا يبدو خليجياً", note: "sounds fusha" },
    backend(),
  );

  assertEquals(status, 200);
  assertEquals(body.ok, true);
  const insert = calls.findIndex((url) => url.includes("dialect_native_reviews"));
  assert(insert >= 0, "expected an insert into dialect_native_reviews");
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.source, "user_report");
  assertEquals(row.status, "pending");
  assertEquals(row.dialect, "Gulf");
  assertEquals((row.metadata as Record<string, unknown>).reported_by, USER);
  assertStringIncludes(String(row.original_text), "خليجي");
});

Deno.test("report-content never writes training_examples directly", async () => {
  const { calls } = await call(
    { kind: "phrase", dialect: "Yemeni", text: "ماذا تريد" },
    backend(),
  );

  // Learners flag; natives decide. The gold tier stays trustworthy because
  // the only path from a report to training data runs through a correction.
  assert(!calls.some((url) => url.includes("training_examples")));
});

Deno.test("report-content collapses a regional dialect label", async () => {
  const { bodies, calls } = await call(
    { kind: "phrase", dialect: "Saudi", text: "ماذا تريد" },
    backend(),
  );

  const insert = calls.findIndex((url) => url.includes("dialect_native_reviews"));
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.dialect, "Gulf");
});

Deno.test("report-content refuses an empty report and an unknown dialect", async () => {
  const empty = await call({ kind: "phrase", dialect: "Gulf", text: "   " }, backend());
  assertEquals(empty.status, 400);

  const unknown = await call({ kind: "phrase", dialect: "Klingon", text: "نص" }, backend());
  assertEquals(unknown.status, 400);
});

Deno.test("report-content clips a runaway report", async () => {
  const { bodies, calls } = await call(
    { kind: "content", dialect: "Egyptian", text: "ا".repeat(5000) },
    backend(),
  );

  const insert = calls.findIndex((url) => url.includes("dialect_native_reviews"));
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(String(row.original_text).length, 2000);
});

Deno.test("report-content turns anonymous callers away", async () => {
  const { status, calls } = await call(
    { kind: "phrase", dialect: "Gulf", text: "نص" },
    { ...backend(), "/auth/v1/user": () => json({}, 401) },
    null,
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("dialect_native_reviews")));
});

Deno.test("report-content stops at the daily cap", async () => {
  const { status } = await call(
    { kind: "phrase", dialect: "Gulf", text: "نص" },
    backend({ "/rest/v1/rpc/increment_usage_counter": () => json(11) }),
  );

  // Ten a day is plenty of signal from one learner; past that it's queue spam.
  assertEquals(status, 429);
});
