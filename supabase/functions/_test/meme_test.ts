import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `analyze-meme` — vision plus, optionally, audio.
 *
 * The interesting property is that it must never 500 on a model that would not
 * answer in JSON. A meme upload is expensive for the learner (they have already
 * waited for the file) and cheap for the model to refuse — Arabic memes trip
 * safety filters routinely, and the usual failure is an Arabic apology rather
 * than an error. So the function retries once with a stricter instruction and
 * then degrades to an empty structure, which lets the audio half still render.
 *
 * The other thing worth pinning is the separation of on-screen text from
 * spoken text. Both halves feed the same result shape, and the prompt goes out
 * of its way to say that audio-only lines must not be reported as text visible
 * in the frame — a learner reading the "on screen" panel is being told what the
 * image says.
 */

const USER = "00000000-0000-4000-8000-000000000001";
const IMAGE = btoa("fake jpeg bytes");

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    "/rest/v1/llm_usage_logs": () => json({}, 201),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    ...extra,
  };
}

const anAnalysis = (over: Record<string, unknown> = {}) => ({
  memeExplanation: { casual: "It is a joke about traffic.", cultural: "Gulf drivers." },
  onScreenText: {
    rawTranscriptArabic: "الزحمة قاتلة",
    lines: [{ arabic: "الزحمة قاتلة", translation: "The traffic is killing me" }],
    vocabulary: [{ arabic: "زحمة", english: "traffic", root: "ز ح م" }],
    grammarPoints: [{ title: "Nominal sentence", explanation: "No verb needed." }],
  },
  glosses: {},
  ...over,
});

/** The vision model, which answers prose containing JSON rather than a tool call. */
const vision = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(JSON.stringify(payload));

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction("analyze-meme", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest("analyze-meme", body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
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

Deno.test("analyze-meme wraps its result in a success envelope", async () => {
  const { status, body } = await call(
    { imageBase64: IMAGE, dialect: "Gulf" },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  assertEquals(status, 200);
  // The page checks `data?.success` before reading `result`, the same contract
  // `analyze-gulf-arabic` uses.
  assertEquals(body.success, true);
  const result = body.result as {
    memeExplanation: { casual: string };
    onScreenText: { lines: unknown[]; vocabulary: unknown[] };
  };
  assertStringIncludes(result.memeExplanation.casual, "joke about traffic");
  assertEquals(result.onScreenText.lines.length, 1);
  assertEquals(result.onScreenText.vocabulary.length, 1);
});

Deno.test("analyze-meme wraps a bare base64 string as a data URI", async () => {
  const { bodies, calls } = await call(
    { imageBase64: IMAGE },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  // The vision API takes a URL. Callers send raw base64, so the prefix has to
  // be added here or the model receives an unreadable string and describes
  // nothing.
  assertStringIncludes(bodies[i] ?? "", "data:image/jpeg;base64,");
});

Deno.test("analyze-meme leaves an existing data URI alone", async () => {
  const { bodies, calls } = await call(
    { imageBase64: `data:image/png;base64,${IMAGE}` },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  // Double-prefixing would corrupt it, and PNG must not be relabelled as JPEG.
  assertStringIncludes(sent, "data:image/png;base64,");
  assert(!sent.includes("data:image/jpeg;base64,data:"));
});

Deno.test("analyze-meme sends every frame of a video", async () => {
  const { bodies, calls } = await call(
    { imageBase64: [IMAGE, IMAGE, IMAGE], isVideo: true },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = JSON.parse(bodies[i] ?? "{}") as {
    messages: Array<{ content: Array<{ type: string }> }>;
  };
  const images = sent.messages.at(-1)?.content.filter((c) => c.type === "image_url") ?? [];
  // A meme video's joke is usually in the cut between frames, so all of them go
  // in one request rather than one request per frame.
  assertEquals(images.length, 3);
});

Deno.test("analyze-meme tells the model the frames are frames", async () => {
  const { bodies, calls } = await call(
    { imageBase64: [IMAGE, IMAGE] },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  assertStringIncludes(bodies[i] ?? "", "video frames");
});

Deno.test("analyze-meme keeps the audio transcript out of the on-screen panel", async () => {
  const { bodies, calls } = await call(
    { imageBase64: IMAGE, audioTranscript: "شوف الزحمة هذي" },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
  );

  const i = calls.findIndex((u) => u.includes("ai.gateway"));
  const sent = bodies[i] ?? "";
  // The transcript is context so the humour can be explained, not content for
  // the "text visible in the image" panel — a learner reading that panel is
  // being told what the picture says.
  assertStringIncludes(sent, "شوف الزحمة هذي");
  assertStringIncludes(sent, "DO NOT copy audio-only text");
});

Deno.test("analyze-meme retries once when the model will not answer in JSON", async () => {
  let attempt = 0;
  const { status, body, calls } = await call(
    { imageBase64: IMAGE },
    caller({
      "ai.gateway.lovable.dev": () => {
        attempt += 1;
        // An Arabic refusal is the characteristic failure — meme content trips
        // safety filters and the model apologises instead of answering.
        return attempt === 1
          ? chatCompletion("أعتذر، لا أستطيع تحليل هذه الصورة.")
          : chatCompletion(JSON.stringify(anAnalysis()));
      },
    }),
  );

  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(calls.filter((u) => u.includes("chat/completions")).length, 2);
});

Deno.test("analyze-meme adds a stricter instruction to the retry", async () => {
  let attempt = 0;
  const { bodies, calls } = await call(
    { imageBase64: IMAGE },
    caller({
      "ai.gateway.lovable.dev": () => {
        attempt += 1;
        return attempt === 1
          ? chatCompletion("أعتذر")
          : chatCompletion(JSON.stringify(anAnalysis()));
      },
    }),
  );

  const gateway = calls
    .map((url, i) => ({ url, body: bodies[i] }))
    .filter((c) => c.url.includes("chat/completions"));
  // Repeating the identical request would usually produce the identical
  // refusal; the second attempt says explicitly to return the JSON even when
  // it cannot read the meme.
  assertStringIncludes(gateway[1].body ?? "", "no apologies");
});

Deno.test("analyze-meme degrades to an empty structure rather than failing", async () => {
  const { status, body } = await call(
    { imageBase64: IMAGE },
    caller({ "ai.gateway.lovable.dev": () => chatCompletion("أعتذر، لا أستطيع.") }),
  );

  // The learner has already waited for an upload. A 500 here throws that away;
  // an empty structure lets the page render whatever else it has and offer a
  // retry.
  assertEquals(status, 200);
  assertEquals(body.success, true);
  const result = body.result as {
    onScreenText: { lines: unknown[]; vocabulary: unknown[] };
    memeExplanation: { casual: string };
  };
  assertEquals(result.onScreenText.lines, []);
  assertEquals(result.memeExplanation.casual, "");
});

Deno.test("analyze-meme recovers JSON wrapped in markdown fences", async () => {
  const { status, body } = await call(
    { imageBase64: IMAGE },
    caller({
      "ai.gateway.lovable.dev": () =>
        chatCompletion("```json\n" + JSON.stringify(anAnalysis()) + "\n```"),
    }),
  );

  // The prompt forbids fences and the model adds them anyway; stripping them is
  // what keeps a perfectly good answer from being thrown away.
  assertEquals(status, 200);
  const result = body.result as { onScreenText: { lines: unknown[] } };
  assertEquals(result.onScreenText.lines.length, 1);
});

Deno.test("analyze-meme drops vocabulary entries with no Arabic", async () => {
  const { body } = await call(
    { imageBase64: IMAGE },
    caller({
      "ai.gateway.lovable.dev": vision(
        anAnalysis({
          onScreenText: {
            rawTranscriptArabic: "الزحمة",
            lines: [{ arabic: "الزحمة قاتلة", translation: "traffic" }],
            vocabulary: [
              { arabic: "زحمة", english: "traffic" },
              { english: "orphaned entry" },
              {},
            ],
            grammarPoints: [],
          },
        }),
      ),
    }),
  );

  const result = body.result as { onScreenText: { vocabulary: unknown[] } };
  // A vocabulary card with no Arabic on it is a blank card the learner can
  // still tap to save.
  assertEquals(result.onScreenText.vocabulary.length, 1);
});

Deno.test("analyze-meme drops grammar points with no title", async () => {
  const { body } = await call(
    { imageBase64: IMAGE },
    caller({
      "ai.gateway.lovable.dev": vision(
        anAnalysis({
          onScreenText: {
            rawTranscriptArabic: "الزحمة",
            lines: [{ arabic: "الزحمة قاتلة", translation: "traffic" }],
            vocabulary: [],
            grammarPoints: [
              { title: "Nominal sentence", explanation: "No verb." },
              { explanation: "Untitled" },
            ],
          },
        }),
      ),
    }),
  );

  const result = body.result as { onScreenText: { grammarPoints: unknown[] } };
  assertEquals(result.onScreenText.grammarPoints.length, 1);
});

Deno.test("analyze-meme refuses a request with neither image nor transcript", async () => {
  const { status, body, calls } = await call({ dialect: "Gulf" }, caller());

  assertEquals(status, 400);
  assertStringIncludes(String(body.error), "imageBase64 or audioTranscript");
  assert(!calls.some((url) => url.includes("chat/completions")));
});

Deno.test("analyze-meme says so when a key is missing", async () => {
  for (const key of ["LOVABLE_API_KEY", "OPENROUTER_API_KEY"]) {
    const { status, body, calls } = await call(
      { imageBase64: IMAGE },
      caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
      { env: { [key]: undefined } },
    );

    // Both are checked up front. The vision half and the audio half use
    // different providers, so a half-configured deployment would otherwise fail
    // partway through with the upload already spent.
    assertEquals(status, 500, `expected a missing ${key} to be reported`);
    assertEquals(body.error, "AI service not configured");
    assert(!calls.some((url) => url.includes("chat/completions")));
  }
});

Deno.test("analyze-meme turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    { imageBase64: IMAGE },
    caller({ "ai.gateway.lovable.dev": vision(anAnalysis()) }),
    { jwt: null },
  );

  // Vision calls are the most expensive thing this app does per request, and
  // the cap is the only gate — `verify_jwt` is off.
  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("chat/completions")));
});
