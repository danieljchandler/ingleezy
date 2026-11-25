import { assert, assertEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction, loadSharedModule, NO_AI_GATEWAY, stubUpstreams } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * Where an LLM call goes when the project is not on Lovable Cloud.
 *
 * Every google/* and openai/* model used to go to the Lovable gateway, so a
 * backend without LOVABLE_API_KEY had no AI at all. aiGateway.ts now picks the
 * destination per call: AI_GATEWAY when set, else the first configured key of
 * Lovable, OpenRouter, Gemini. FIXTURE_ENV sets all three, so each test here
 * unsets the ones it wants missing.
 */

type Gateway = typeof import("../_shared/aiGateway.ts");
type Brain = typeof import("../_shared/aiBrain.ts");

const LOVABLE = "ai.gateway.lovable.dev";
const OPENROUTER = "openrouter.ai";
const GOOGLE = "generativelanguage.googleapis.com";
const GEMINI = "google/gemini-2.5-flash";

const ONLY_OPENROUTER = { LOVABLE_API_KEY: undefined, GEMINI_API_KEY: undefined };
const ONLY_GEMINI = { LOVABLE_API_KEY: undefined, OPENROUTER_API_KEY: undefined };

async function withGateway(
  env: Record<string, string | undefined>,
  run: (gw: Gateway) => void | Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ env });
  try {
    await run(await loadSharedModule<Gateway>("aiGateway"));
  } finally {
    up.restore();
  }
}

// ── Routing ─────────────────────────────────────────────────────────────────

Deno.test("a Lovable-backed project routes exactly as before", async () => {
  await withGateway({}, (gw) => {
    const target = gw.chatTarget(GEMINI);
    assertEquals(target.route, "lovable");
    assertEquals(target.url, gw.LOVABLE_CHAT_URL);
    assertEquals(target.model, GEMINI);
    assertEquals(target.headers.Authorization, "Bearer fixture-lovable");
    assertEquals(gw.routeForModel("anthropic/claude-sonnet-4.5"), "openrouter");
    assertEquals(gw.routeForModel("openai/gpt-5-mini"), "lovable");
  });
});

Deno.test("without a Lovable key, Gemini goes through OpenRouter under its own id", async () => {
  await withGateway(ONLY_OPENROUTER, (gw) => {
    const target = gw.chatTarget(GEMINI);
    assertEquals(target.route, "openrouter");
    assertEquals(target.url, gw.OPENROUTER_CHAT_URL);
    assertEquals(target.model, GEMINI);
    assertEquals(target.headers.Authorization, "Bearer fixture-openrouter");
    assertEquals(target.missingKey, null);
    assertEquals(gw.routeForModel("openai/gpt-5-mini"), "openrouter");
  });
});

Deno.test("with only a Gemini key, Gemini goes to Google without the vendor prefix", async () => {
  await withGateway(ONLY_GEMINI, (gw) => {
    const target = gw.chatTarget(GEMINI);
    assertEquals(target.route, "gemini");
    assertEquals(target.url, gw.GEMINI_CHAT_URL);
    assertEquals(target.model, "gemini-2.5-flash");
    assertEquals(target.headers.Authorization, "Bearer fixture-gemini");

    // Google cannot serve an OpenAI model or Claude; those still need OpenRouter
    // and say so by name.
    assertEquals(gw.chatTarget("openai/gpt-5-mini").missingKey, "OPENROUTER_API_KEY");
    assertEquals(gw.chatTarget("anthropic/claude-sonnet-4.5").missingKey, "OPENROUTER_API_KEY");
  });
});

Deno.test("AI_GATEWAY overrides the key order", async () => {
  await withGateway({ AI_GATEWAY: "gemini" }, (gw) => {
    assertEquals(gw.routeForModel(GEMINI), "gemini");
  });
  await withGateway({ AI_GATEWAY: " OpenRouter " }, (gw) => {
    assertEquals(gw.routeForModel(GEMINI), "openrouter");
  });
});

Deno.test("an unknown AI_GATEWAY fails loudly rather than guessing", async () => {
  await withGateway({ AI_GATEWAY: "vertex" }, (gw) => {
    assertThrows(() => gw.chatTarget(GEMINI), Error, "AI_GATEWAY must be");
  });
});

Deno.test("a named gateway with no key reports that gateway's key", async () => {
  await withGateway({ AI_GATEWAY: "openrouter", OPENROUTER_API_KEY: undefined }, (gw) => {
    assertEquals(gw.missingAiKeyError(GEMINI), "OPENROUTER_API_KEY not configured");
  });
});

Deno.test("with no gateway key at all, the error lists the options", async () => {
  await withGateway(NO_AI_GATEWAY, (gw) => {
    const message = gw.missingAiKeyError(GEMINI) ?? "";
    assertStringIncludes(message, "OPENROUTER_API_KEY");
    assertStringIncludes(message, "GEMINI_API_KEY");
    assertStringIncludes(message, "LOVABLE_API_KEY");
  });
});

// ── Images ──────────────────────────────────────────────────────────────────

Deno.test("image generation reads each gateway's response shape", async () => {
  await withGateway({}, (gw) => {
    assertEquals(gw.extractImageDataUrl({ data: [{ b64_json: "QUJD" }] }), "data:image/png;base64,QUJD");
    assertEquals(
      gw.extractImageDataUrl({ choices: [{ message: { images: [{ image_url: { url: "data:image/webp;base64,QUJD" } }] } }] }),
      "data:image/webp;base64,QUJD",
    );
    assertEquals(
      gw.extractImageDataUrl({
        candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }] } }],
      }),
      "data:image/jpeg;base64,QUJD",
    );
    assertEquals(gw.extractImageDataUrl({ choices: [{ message: { content: "no" } }] }), null);
    assertEquals(Array.from(gw.dataUrlToBytes("data:image/png;base64,QUJD")), [65, 66, 67]);
  });
});

Deno.test("image generation on Gemini uses Google's native API", async () => {
  const up = stubUpstreams({
    env: ONLY_GEMINI,
    upstreams: {
      [GOOGLE]: () =>
        json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] } }] }),
    },
  });
  try {
    const gw = await loadSharedModule<Gateway>("aiGateway");
    const url = await gw.generateImage("google/gemini-3.1-flash-image", "a cat");
    assertEquals(url, "data:image/png;base64,QUJD");
    const [call] = up.callsTo(GOOGLE);
    assertStringIncludes(call.url, "/models/gemini-3.1-flash-image:generateContent");
    assertEquals(call.headers["x-goog-api-key"], "fixture-gemini");
  } finally {
    up.restore();
  }
});

Deno.test("image generation on OpenRouter asks chat completions for an image", async () => {
  const up = stubUpstreams({
    env: ONLY_OPENROUTER,
    upstreams: {
      [OPENROUTER]: () =>
        json({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QUJD" } }] } }] }),
    },
  });
  try {
    const gw = await loadSharedModule<Gateway>("aiGateway");
    assertEquals(await gw.generateImage("google/gemini-3.1-flash-image", "a cat"), "data:image/png;base64,QUJD");
    const body = JSON.parse(up.callsTo(OPENROUTER)[0].body ?? "{}");
    assertEquals(body.modalities, ["image", "text"]);
    assertEquals(body.model, "google/gemini-3.1-flash-image");
  } finally {
    up.restore();
  }
});

// ── The Brain ───────────────────────────────────────────────────────────────

const backend: Record<string, UpstreamHandler> = {
  "/rest/v1/": () => json([]),
};

async function askGemini(env: Record<string, string | undefined>, upstreams: Record<string, UpstreamHandler>) {
  const up = stubUpstreams({ env, upstreams: { ...backend, ...upstreams } });
  try {
    const brain = await loadSharedModule<Brain>("aiBrain");
    const result = await brain.askBrain({
      purpose: "ai-gateway-test",
      dialect: "Gulf",
      target: "english",
      userPrompt: "Say hello.",
      strategy: "solo",
      models: [GEMINI],
      skipRepair: true,
      validateDialect: false,
      enforceDialect: false,
    });
    return { result, up };
  } finally {
    up.restore();
  }
}

Deno.test("the Brain answers with no Lovable key, through OpenRouter", async () => {
  const { result, up } = await askGemini(ONLY_OPENROUTER, {
    [OPENROUTER]: () => chatCompletion("hello"),
  });

  assertEquals(result.raw, "hello");
  assertEquals(up.callsTo(LOVABLE).length, 0);
  const body = JSON.parse(up.callsTo(OPENROUTER)[0].body ?? "{}");
  assertEquals(body.model, GEMINI);
});

Deno.test("the Brain answers with only a Gemini key, through Google", async () => {
  const { result, up } = await askGemini(ONLY_GEMINI, {
    [GOOGLE]: () => chatCompletion("hello"),
  });

  assertEquals(result.raw, "hello");
  const [call] = up.callsTo(GOOGLE);
  assertStringIncludes(call.url, "/v1beta/openai/chat/completions");
  assertEquals(JSON.parse(call.body ?? "{}").model, "gemini-2.5-flash");
  // OpenRouter-only extras stay off Google's endpoint, which rejects unknown fields.
  assert(!("usage" in JSON.parse(call.body ?? "{}")));
});

// ── A function end to end ───────────────────────────────────────────────────

Deno.test("reading-qa works on a project with only an OpenRouter key", async () => {
  const answer = { lines: [{ arabic: "الجو حلو", english: "The weather is nice" }], vocabulary: [], followUp: "?" };
  const fn = await loadFunction("reading-qa", {
    env: ONLY_OPENROUTER,
    upstreams: {
      "/auth/v1/user": () => json({ id: "00000000-0000-4000-8000-000000000001", aud: "authenticated" }),
      "/rest/v1/": () => json([]),
      [OPENROUTER]: () => chatCompletion(JSON.stringify(answer)),
    },
  });
  try {
    const response = await fn.handler(
      jsonRequest("reading-qa", { question: "What is the weather like?", dialect: "Gulf" }, { jwt: fixtureJwt() }),
    );
    assertEquals(response.status, 200);
    assertEquals(fn.callsTo(LOVABLE).length, 0);
    assertEquals(fn.callsTo(OPENROUTER).length, 1);
  } finally {
    fn.restore();
  }
});
