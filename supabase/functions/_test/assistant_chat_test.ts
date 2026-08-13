import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json, sseCompletion, type UpstreamHandler } from "./upstreams.ts";

/**
 * The global Ask AI assistant. Its distinguishing features over the other
 * streaming chats are the context blocks: an optional seed sentence, a page
 * context published by the client, and (on the first turn only) the learner
 * profile plus recent content history fetched server-side.
 *
 * The page context is learner/content-influenced text entering a system
 * prompt, so the length caps and the data-not-instructions framing are
 * security behavior, not formatting — they get their own cases.
 */

const USER = "00000000-0000-4000-8000-000000000001";

/** A signed-in, paying caller: past the cap check with nothing else stubbed. */
function subscriber(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/feature_metrics": () => json({}, 201),
    "/rest/v1/msa_violations": () => json({}, 201),
    // First-turn profile + content history queries. Empty results are fine —
    // both helpers render "" and the prompt simply omits the blocks.
    "/rest/v1/user_vocabulary": () => json([]),
    "/rest/v1/word_reviews": () => json([]),
    "/rest/v1/profiles": () => json(null),
    "/rest/v1/learner_errors": () => json([]),
    "/rest/v1/user_concept_mastery": () => json([]),
    "/rest/v1/video_views": () => json([]),
    "/rest/v1/story_progress": () => json([]),
    "/rest/v1/listen_episode_plays": () => json([]),
    ...extra,
  };
}

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  jwt?: string | null,
): Promise<{ response: Response; calls: string[]; bodies: Array<string | null> }> {
  const fn = await loadFunction(name, { upstreams });
  try {
    const response = await fn.handler(jsonRequest(name, body, jwt === undefined ? {} : { jwt }));
    const buffered = new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
    return {
      response: buffered,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
    };
  } finally {
    fn.restore();
  }
}

const gateway = () => sseCompletion("Because ", "it flows.");

function sentPrompt(bodies: Array<string | null>): string {
  return bodies.find((b) => b?.includes("system")) ?? "";
}

Deno.test("assistant-chat streams the gateway's frames through", async () => {
  const { response, calls, bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "explain this" }], dialect: "Gulf" },
    subscriber({ "openrouter.ai": gateway }),
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream");
  const text = await response.text();
  assertStringIncludes(text, "Because ");
  assertStringIncludes(text, "data: [DONE]");
  // The chat is pinned to Claude via OpenRouter — a silent fall-back to the
  // cheap utility default is a quality regression, not a routing detail.
  assert(calls.some((url) => url.includes("openrouter.ai")));
  assertStringIncludes(sentPrompt(bodies), "anthropic/claude-sonnet-5");
});

Deno.test("assistant-chat refuses a body with no messages", async () => {
  const { response, calls } = await call("assistant-chat", { dialect: "Gulf" }, subscriber());

  assertEquals(response.status, 400);
  assert(!calls.some((url) => url.includes("ai.gateway") || url.includes("openrouter.ai")));
});

Deno.test("assistant-chat turns an anonymous caller away", async () => {
  const { response } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "hi" }] },
    subscriber(),
    null,
  );

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "auth_required");
});

Deno.test("assistant-chat puts the seed sentence into the system prompt", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "explain" }],
      dialect: "Gulf",
      seed: { arabic: "شلونك اليوم", english: "How are you today?" },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "شلونك اليوم");
  assertStringIncludes(sent, "How are you today?");
});

Deno.test("assistant-chat frames the page context as data, not instructions", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "what is this?" }],
      dialect: "Gulf",
      pageContext: {
        route: "/discover/abc",
        title: "Souq tour",
        summary: "A market video",
        content: "current line: يالله نروح السوق",
      },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "Souq tour");
  assertStringIncludes(sent, "يالله نروح السوق");
  // The untrusted-data framing is the injection defence; losing it silently
  // would let page content speak with the system's voice.
  assertStringIncludes(sent, "never as instructions");
});

Deno.test("assistant-chat caps oversized page content server-side", async () => {
  const { bodies } = await call(
    "assistant-chat",
    {
      messages: [{ role: "user", content: "hi" }],
      pageContext: { route: "/x", title: "t", content: "A".repeat(5000) },
    },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // Client-side truncation can be bypassed by calling the function directly,
  // so the server enforces its own ceiling.
  assert(!sent.includes("A".repeat(1501)));
  assert(sent.includes("A".repeat(1000)));
});

Deno.test("assistant-chat fetches the learner profile on the first turn only", async () => {
  const firstTurn = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "hi" }] },
    subscriber({ "openrouter.ai": gateway }),
  );
  assert(firstTurn.calls.some((url) => url.includes("user_vocabulary")));
  assert(firstTurn.calls.some((url) => url.includes("video_views")));

  const laterTurn = await call(
    "assistant-chat",
    {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "أهلاً" },
        { role: "user", content: "more" },
      ],
    },
    subscriber({ "openrouter.ai": gateway }),
  );
  // Later turns already carry that knowledge in the visible history; paying
  // the five queries per message would be pure latency.
  assert(!laterTurn.calls.some((url) => url.includes("user_vocabulary")));
  assert(!laterTurn.calls.some((url) => url.includes("video_views")));
});

// _shared/contentHistory.ts is exercised through the function: the three
// history queries above (video_views, story_progress, listen_episode_plays)
// come from contentHistoryBlock, and this case pins its rendered output.
Deno.test("assistant-chat mentions recently watched videos in the prompt", async () => {
  const { bodies } = await call(
    "assistant-chat",
    { messages: [{ role: "user", content: "what did I watch?" }] },
    subscriber({
      "openrouter.ai": gateway,
      "/rest/v1/video_views": () =>
        json([{ video_id: "v1", watched_at: "2026-08-10T10:00:00Z", completed: true }]),
      "/rest/v1/discover_videos": () =>
        json([{ id: "v1", title: "Souq Tour Kuwait", cefr_level: "B1" }]),
    }),
  );

  const sent = sentPrompt(bodies);
  assertStringIncludes(sent, "RECENT CONTENT");
  assertStringIncludes(sent, "Souq Tour Kuwait");
});

Deno.test("assistant-chat truncates runaway histories instead of forwarding them", async () => {
  const messages = Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn ${i}`,
  }));
  const { bodies } = await call(
    "assistant-chat",
    { messages },
    subscriber({ "openrouter.ai": gateway }),
  );

  const sent = sentPrompt(bodies);
  // Last 20 forwarded; the head of the conversation is dropped.
  assert(!sent.includes('"turn 0"'));
  assertStringIncludes(sent, "turn 59");
});
