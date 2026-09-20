import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `ingest-from-library` — the push half of the content-library bridge, and
 * the first function in this repo gated on `requireRole`'s `hasSharedSecret`
 * rather than on a user session (docs/content-library-bridge.md).
 *
 * The gate is the point. Maktaba is another app with its own identity
 * system, so a JWT proves the wrong thing here — and the publishable key
 * that would satisfy `verify_jwt` ships in every browser bundle. Three
 * properties are pinned: only the shared secret opens the door (and an
 * unconfigured secret closes it rather than opening it); the row carries the
 * attribution nothing else in this app records; and the kickoff into
 * `process-english-video` goes out under the service-role key, because there
 * is no user session on this door to carry.
 */

const SECRET = "fixture-library-bridge-secret";
const ITEM = "11111111-2222-4333-8444-555555555555";
const BRIDGE_USER = "00000000-0000-4000-8000-0000000000aa";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function bridgeUpstreams(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/rest/v1/discover_videos": (request) =>
      request.method === "POST" ? json({ id: "dv-fixture-lib" }, 201) : json(null),
    "/functions/v1/process-english-video": () => json({ success: true }, 202),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  headers: Record<string, string> = {},
  env: Record<string, string | undefined> = {},
) {
  const fn = await loadFunction("ingest-from-library", {
    upstreams,
    env: { LIBRARY_BRIDGE_SECRET: SECRET, LIBRARY_BRIDGE_USER_ID: BRIDGE_USER, ...env },
  });
  try {
    const response = await fn.handler(
      jsonRequest("ingest-from-library", body, { jwt: null, headers }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed, requests: fn.calls };
  } finally {
    fn.restore();
  }
}

const payload = {
  library_item_id: ITEM,
  source_url: YOUTUBE_URL,
  platform: "youtube",
  title: "How to complain politely at work",
  language: "en",
  dialect: "gulf",
  creator_name: "Some Teacher",
  creator_handle: "@someteacher",
  note: "workplace register, clear speech",
};

Deno.test("ingest-from-library opens only to the shared secret", async () => {
  const noHeader = await call(payload, bridgeUpstreams());
  assertEquals(noHeader.status, 401);

  const wrong = await call(payload, bridgeUpstreams(), { "x-library-secret": "nope" });
  assertEquals(wrong.status, 401);

  // Absent configuration disables the path rather than allowing it — the
  // property `hasSharedSecret` is written around.
  const unset = await call(payload, bridgeUpstreams(), { "x-library-secret": SECRET }, { LIBRARY_BRIDGE_SECRET: undefined });
  assertEquals(unset.status, 401);

  assertEquals(noHeader.requests.filter((c) => c.url.includes("discover_videos")).length, 0);
});

Deno.test("ingest-from-library creates an attributed row and kicks the English pipeline", async () => {
  const { status, body, requests } = await call(payload, bridgeUpstreams(), { "x-library-secret": SECRET });

  assertEquals(status, 200);
  assertEquals(body.remote_id, "dv-fixture-lib");
  assertEquals(body.status, "processing");
  assertEquals(body.remote_url, "/admin/videos/dv-fixture-lib/edit");

  const insert = requests.find((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST");
  assert(insert, "expected a discover_videos insert");
  const record = JSON.parse(insert.body ?? "{}") as Record<string, unknown>;
  assertEquals(record.library_item_id, ITEM);
  assertEquals(record.creator_name, "Some Teacher");
  // Stored bare, so it joins creator_handles in the library without a prefix.
  assertEquals(record.creator_handle, "someteacher");
  assertEquals(record.source, "maktaba");
  assertEquals(record.published, false);
  assertEquals(record.transcription_status, "pending");
  // Attributed to a real account, never a placeholder id.
  assertEquals(record.created_by, BRIDGE_USER);
  assertEquals(record.platform, "youtube");

  const kickoff = requests.find((c) => c.url.includes("/functions/v1/process-english-video"));
  assert(kickoff, "expected a process-english-video kickoff");
  assertEquals(kickoff.headers["authorization"], "Bearer e2e-service-role-not-a-real-secret");
  assertEquals(JSON.parse(kickoff.body ?? "{}"), { videoId: "dv-fixture-lib" });
});

Deno.test("ingest-from-library is idempotent on the library's id", async () => {
  const { status, body, requests } = await call(
    payload,
    bridgeUpstreams({
      "/rest/v1/discover_videos": (request) =>
        request.method === "POST"
          ? json({ id: "should-not-insert" }, 201)
          : json({ id: "dv-existing", transcription_status: "processing" }),
    }),
    { "x-library-secret": SECRET },
  );

  assertEquals(status, 200);
  assertEquals(body.remote_id, "dv-existing");
  assertEquals(body.status, "exists");
  assertEquals(requests.filter((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST").length, 0);
  assertEquals(requests.filter((c) => c.url.includes("process-english-video")).length, 0);
});

Deno.test("ingest-from-library stages mirrored audio where the pipeline looks first", async () => {
  // process-english-video's acquisition ladder reads the video-audio bucket
  // before it calls download-media, so staging here skips the flakiest step
  // in the chain with no pipeline change at all.
  const { body, requests } = await call(
    { ...payload, audio_url: "https://library.test/storage/v1/object/sign/item-files/x/audio.mp3?token=t" },
    bridgeUpstreams({
      "library.test": () =>
        new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
      "/storage/v1/object/video-audio": () => json({ Key: "video-audio/dv-fixture-lib.mp3" }),
    }),
    { "x-library-secret": SECRET },
  );

  assertEquals(body.audio_staged, true);
  assert(
    requests.find((c) => c.url.includes("/storage/v1/object/video-audio/dv-fixture-lib.mp3")),
    "expected the audio staged under the new row's id",
  );
});

Deno.test("ingest-from-library answers a status query with the transcript's English", async () => {
  // The library copies this into items.transcript_text so a search can find a
  // clip by what was said in it. This repo's line shape is English-first.
  const { status, body } = await call(
    { action: "status", remote_id: "dv-fixture-lib" },
    bridgeUpstreams({
      "/rest/v1/discover_videos": () =>
        json({
          id: "dv-fixture-lib",
          transcription_status: "completed",
          transcription_error: null,
          published: false,
          title: "t",
          duration_seconds: 42,
          transcript_lines: [
            { english: "I wanted to ask about the report", arabic: "أبي أسأل عن التقرير" },
            { english: "no rush at all", arabic: "ما فيه استعجال" },
          ],
        }),
    }),
    { "x-library-secret": SECRET },
  );

  assertEquals(status, 200);
  assertEquals(body.status, "completed");
  assertEquals(body.transcript_text, "I wanted to ask about the report\nno rush at all");
  assertEquals(body.duration_seconds, 42);
});

Deno.test("ingest-from-library refuses rather than attributing a row to nobody", async () => {
  // There is no user session on this door, so `created_by` comes from
  // configuration. Unset, the honest answer is 503 — a placeholder id would
  // leave content in the catalogue owned by an account that does not exist.
  const { status, body, requests } = await call(
    payload,
    bridgeUpstreams(),
    { "x-library-secret": SECRET },
    { LIBRARY_BRIDGE_USER_ID: undefined },
  );

  assertEquals(status, 503);
  assertEquals(body.error, "bridge_not_configured");
  assertEquals(requests.filter((c) => c.url.includes("/rest/v1/discover_videos") && c.method === "POST").length, 0);
});
