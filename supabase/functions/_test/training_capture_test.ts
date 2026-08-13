import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `record-transcript-corrections` — the flywheel's W1 capture point. The admin
 * video form calls it just before overwriting transcript_lines; the server
 * diffs old against new (the diff itself is pure and covered by
 * src/test/transcriptDiffCore.test.ts) and banks each changed line in
 * training_examples with its audio span.
 *
 * The security property under test: training rows come only from content
 * staff, and the "before" side comes from the database, never the browser —
 * so nobody can forge a correction pair by posting a fabricated history.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const VIDEO = "11111111-2222-4333-8444-555555555555";

const STORED_LINES = [
  {
    id: "L1",
    arabic: "الليلة نروح إلى السوق",
    translation: "Tonight we go to the market",
    startMs: 41_200,
    endMs: 44_700,
  },
  { id: "L2", arabic: "شلونك اليوم", translation: "How are you today", startMs: 45_000, endMs: 46_500 },
];

function backend(options: {
  roles?: Array<{ role: string }>;
  video?: Record<string, unknown> | null;
  audioObjects?: Array<{ name: string }>;
} = {}): Record<string, UpstreamHandler> {
  const {
    roles = [{ role: "content_reviewer" }],
    video = {
      id: VIDEO,
      dialect: "Gulf",
      transcript_lines: STORED_LINES,
      engines_used: { asr: ["soniox", "munsit"] },
    },
    audioObjects = [{ name: `${VIDEO}.mp3` }],
  } = options;

  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json(roles),
    "/rest/v1/discover_videos": () => json(video),
    "/rest/v1/training_examples": () => json({}, 201),
    "/storage/v1/object/list/video-audio": () => json(audioObjects),
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  jwt?: string | null,
) {
  const fn = await loadFunction("record-transcript-corrections", { upstreams });
  try {
    const response = await fn.handler(
      jsonRequest("record-transcript-corrections", body, jwt === undefined ? {} : { jwt }),
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

const EDITED = [
  { ...STORED_LINES[0], arabic: "الليلة بنروح السوق" },
  STORED_LINES[1],
];

Deno.test("record-transcript-corrections banks a changed line with its audio span", async () => {
  const { status, body, calls, bodies } = await call({ videoId: VIDEO, lines: EDITED }, backend());

  assertEquals(status, 200);
  assertEquals(body.recorded, 1);
  const insert = calls.findIndex((url) => url.includes("training_examples"));
  assert(insert >= 0, "expected an insert into training_examples");
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.task_type, "asr");
  assertEquals(row.machine_output, "الليلة نروح إلى السوق");
  assertEquals(row.human_output, "الليلة بنروح السوق");
  assertEquals(row.audio_path, `${VIDEO}.mp3`);
  assertEquals(row.audio_start_ms, 41_200);
  assertEquals(row.audio_end_ms, 44_700);
  // A content_reviewer is the native-speaker seat, so the pair is gold.
  assertEquals(row.tier, "gold");
  assertStringIncludes(bodies[insert] ?? "", "soniox");
});

Deno.test("record-transcript-corrections marks an admin's edit silver", async () => {
  const { body, calls, bodies } = await call(
    { videoId: VIDEO, lines: EDITED },
    backend({ roles: [{ role: "admin" }] }),
  );

  assertEquals(body.recorded, 1);
  const insert = calls.findIndex((url) => url.includes("training_examples"));
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.tier, "silver");
  assertEquals(row.corrector_role, "admin");
});

Deno.test("record-transcript-corrections refuses a caller with no content role", async () => {
  const { status, calls } = await call(
    { videoId: VIDEO, lines: EDITED },
    backend({ roles: [] }),
  );

  // A learner must never be able to write training rows, whatever they post.
  assertEquals(status, 403);
  assert(!calls.some((url) => url.includes("training_examples")));
});

Deno.test("record-transcript-corrections refuses an anonymous caller", async () => {
  const { status } = await call({ videoId: VIDEO, lines: EDITED }, backend(), null);

  assertEquals(status, 401);
});

Deno.test("record-transcript-corrections records nothing when nothing changed", async () => {
  const { status, body, calls } = await call(
    { videoId: VIDEO, lines: STORED_LINES },
    backend(),
  );

  assertEquals(status, 200);
  assertEquals(body.recorded, 0);
  assert(!calls.some((url) => url.includes("training_examples")));
});

Deno.test("record-transcript-corrections skips a dialect it cannot map", async () => {
  const { status, body, calls } = await call(
    { videoId: VIDEO, lines: EDITED },
    backend({
      video: { id: VIDEO, dialect: "MSA", transcript_lines: STORED_LINES, engines_used: null },
    }),
  );

  // A skipped capture beats a mislabeled training row.
  assertEquals(status, 200);
  assertEquals(body.recorded, 0);
  assert(!calls.some((url) => url.includes("training_examples")));
});

Deno.test("record-transcript-corrections survives a missing audio object", async () => {
  const { body, calls, bodies } = await call(
    { videoId: VIDEO, lines: EDITED },
    backend({ audioObjects: [] }),
  );

  // Text-only is still a usable pair; the row just carries no audio ref.
  assertEquals(body.recorded, 1);
  const insert = calls.findIndex((url) => url.includes("training_examples"));
  const row = (JSON.parse(bodies[insert] ?? "[]") as Array<Record<string, unknown>>)[0];
  assertEquals(row.audio_path, null);
  assertEquals(row.audio_bucket, null);
});
