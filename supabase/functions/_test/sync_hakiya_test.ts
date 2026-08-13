import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `sync-hakiya-videos` — the content bridge to the sibling Arabic app.
 *
 * The function is a snapshot copier, so what is worth pinning is its edges:
 * who may run it, how it behaves before the bridge is configured, and — the
 * part that protects learners — that a drifted remote row (no id, no
 * embed_url) is skipped rather than upserted half-empty, while surviving
 * rows land tagged `source: 'hakiya'` under Hakiya's own UUID so a re-sync
 * updates instead of duplicating.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const HAKIYA_URL = "https://hakiya-fixture.supabase.co";

const BRIDGE_ENV = {
  HAKIYA_SUPABASE_URL: HAKIYA_URL,
  HAKIYA_SUPABASE_ANON_KEY: "hakiya-fixture-anon",
};

const remoteVideo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "A day in the souq",
  title_arabic: "يوم في السوق",
  source_url: "https://youtube.com/watch?v=abc",
  platform: "youtube",
  embed_url: "https://www.youtube.com/embed/abc",
  thumbnail_url: null,
  duration_seconds: 61,
  dialect: "Gulf",
  difficulty: "Beginner",
  cefr_level: "A2",
  transcript_lines: [
    { arabic: "شلونك؟", translation: "How are you?", literal: "what-color-yours?", fusha: "كيف حالك؟" },
  ],
  vocabulary: [],
  grammar_points: [],
  cultural_context: null,
  ...over,
});

function admin(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/user_roles": () => json([{ role: "admin" }]),
    ...extra,
  };
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("sync-hakiya-videos", {
    upstreams,
    env: { ...BRIDGE_ENV, ...(opts.env ?? {}) },
  });
  try {
    const response = await fn.handler(
      jsonRequest("sync-hakiya-videos", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // The status assertion carries the failure.
    }
    return { status: response.status, body: parsed, fn };
  } finally {
    fn.restore();
  }
}

Deno.test("rejects a caller with no token", async () => {
  const { status, body } = await call({}, admin(), { jwt: null });
  assertEquals(status, 401);
  assertEquals(body.error, "auth_required");
});

Deno.test("rejects a signed-in non-admin", async () => {
  const { status, body } = await call(
    {},
    admin({ "/rest/v1/user_roles": () => json([]) }),
  );
  assertEquals(status, 403);
  assertEquals(body.error, "forbidden");
});

Deno.test("reports an unconfigured bridge as 503, not a crash", async () => {
  const { status, body } = await call({}, admin(), {
    env: { HAKIYA_SUPABASE_URL: undefined, HAKIYA_SUPABASE_ANON_KEY: undefined },
  });
  assertEquals(status, 503);
  assertEquals(body.error, "bridge_not_configured");
});

Deno.test("maps a Hakiya failure to 502 with the upstream status", async () => {
  const { status, body } = await call(
    {},
    admin({ [`${HAKIYA_URL}/rest/v1/discover_videos`]: () => json({ message: "nope" }, 500) }),
  );
  assertEquals(status, 502);
  assertEquals(body.error, "hakiya_fetch_failed");
  assertEquals(body.status, 500);
});

Deno.test("syncs valid rows tagged hakiya and skips drifted ones", async () => {
  let upserted: Array<Record<string, unknown>> = [];
  const { status, body } = await call(
    { limit: 50 },
    admin({
      [`${HAKIYA_URL}/rest/v1/discover_videos`]: () =>
        json([
          remoteVideo(),
          // Drift casualties: one row lost its embed_url, one has no id.
          remoteVideo({ id: "22222222-2222-4222-8222-222222222222", embed_url: "" }),
          remoteVideo({ id: undefined }),
        ]),
      "/rest/v1/discover_videos": (request) => {
        return (async () => {
          upserted = JSON.parse(await request.text()) as Array<Record<string, unknown>>;
          return json(upserted, 201);
        })();
      },
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(body.synced, 1);
  assertEquals(body.skipped, 2);
  assertEquals(body.fetched, 3);

  assertEquals(upserted.length, 1);
  const row = upserted[0];
  assertEquals(row.id, "11111111-1111-4111-8111-111111111111");
  assertEquals(row.source, "hakiya");
  assertEquals(row.published, true);
  assertEquals(row.created_by, USER);
  // The scaffold payload rides along intact — dialect line, English, Fusha.
  const lines = row.transcript_lines as Array<Record<string, unknown>>;
  assertEquals(lines[0].fusha, "كيف حالك؟");
  assert(typeof row.title === "string");
});
