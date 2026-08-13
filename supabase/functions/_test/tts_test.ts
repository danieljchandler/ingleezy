import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * The three text-to-speech functions.
 *
 * One per dialect, because no single provider covers all three: Gulf goes to
 * Munsit, Egyptian to ElevenLabs' native ar-EG voices, Yemeni to Azure's real
 * ar-YE neural voices. They share a contract — POST `{ text }`, get audio bytes
 * — and nothing else. Every caller reads the body with `res.blob()` and hands
 * it to an `<audio>` element, so *bytes with the right content type* is the
 * whole interface; a JSON body on a 200 is an unplayable source.
 *
 * All three run `verify_jwt = false` with `enforceDailyCap` as the only access
 * control, and all three spend money per call, so the anonymous path matters
 * more here than almost anywhere else in the app.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
    ...extra,
  };
}

/** Audio bytes, as every one of these providers actually answers. */
const audioBytes = (): UpstreamHandler => () =>
  new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
    status: 200,
    headers: { "content-type": "audio/wav" },
  });

async function call(
  name: string,
  body: unknown,
  upstreams: Record<string, UpstreamHandler> = caller(),
  opts: { jwt?: string | null; env?: Record<string, string | undefined> } = {},
) {
  const fn = await loadFunction(name, { upstreams, env: opts.env });
  try {
    const response = await fn.handler(
      jsonRequest(name, body, opts.jwt === undefined ? {} : { jwt: opts.jwt }),
    );
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Audio, not JSON — which is the success case.
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: buffer.byteLength,
      body: parsed,
      calls: fn.calls.map((c) => c.url),
      bodies: fn.calls.map((c) => c.body),
      headers: fn.calls.map((c) => c.headers),
    };
  } finally {
    fn.restore();
  }
}

// ── azure-tts (Yemeni) ──────────────────────────────────────────────────────

Deno.test("azure-tts returns audio bytes, not JSON", async () => {
  const { status, contentType, bytes } = await call(
    "azure-tts",
    { text: "مرحبا", voice: "ar-YE-SalehNeural" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  assertEquals(status, 200);
  // The content type is what decides whether the blob plays. Callers pipe the
  // body straight into `URL.createObjectURL` without inspecting it.
  assertEquals(contentType, "audio/mpeg");
  assert(bytes > 0);
});

Deno.test("azure-tts derives the language from the voice name", async () => {
  const { bodies, calls } = await call(
    "azure-tts",
    { text: "مرحبا", voice: "ar-YE-SalehNeural" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  const i = calls.findIndex((url) => url.includes("tts.speech.microsoft.com"));
  // `xml:lang` comes from the first two segments of the voice name. Getting it
  // wrong makes Azure read Arabic with another language's phonology.
  assertStringIncludes(bodies[i] ?? "", "xml:lang='ar-YE'");
  assertStringIncludes(bodies[i] ?? "", "name='ar-YE-SalehNeural'");
});

Deno.test("azure-tts defaults to an Emirati voice", async () => {
  const { bodies, calls } = await call(
    "azure-tts",
    { text: "مرحبا" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  const i = calls.findIndex((url) => url.includes("tts.speech.microsoft.com"));
  assertStringIncludes(bodies[i] ?? "", "ar-AE-HamdanNeural");
});

Deno.test("azure-tts escapes XML metacharacters in the text", async () => {
  const { bodies, calls } = await call(
    "azure-tts",
    { text: `Tom & Jerry <say>"it's"</say>` },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  const i = calls.findIndex((url) => url.includes("tts.speech.microsoft.com"));
  const ssml = bodies[i] ?? "";
  // The text is interpolated into an SSML document, so an unescaped `<` closes
  // the voice element and Azure rejects the whole request — or worse, honours
  // whatever tag the text opened.
  assertStringIncludes(ssml, "Tom &amp; Jerry");
  assertStringIncludes(ssml, "&lt;say&gt;");
  assertStringIncludes(ssml, "&quot;it&apos;s&quot;");
});

Deno.test("azure-tts asks for mp3 output", async () => {
  const { calls, headers } = await call(
    "azure-tts",
    { text: "مرحبا" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  const i = calls.findIndex((url) => url.includes("tts.speech.microsoft.com"));
  // Has to agree with the `audio/mpeg` the function declares on the way out,
  // or the browser is told one thing and handed another.
  assertStringIncludes(headers[i]["x-microsoft-outputformat"], "mp3");
});

Deno.test("azure-tts accepts any voice string it is handed", async () => {
  const { status, bodies, calls } = await call(
    "azure-tts",
    { text: "مرحبا", voice: "en-US-JennyNeural" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
  );

  const i = calls.findIndex((url) => url.includes("tts.speech.microsoft.com"));
  // Pinned, not endorsed. `SUPPORTED_VOICES` is declared in this file and never
  // read — there is no allow-list check — so the caller-supplied voice goes
  // straight into the SSML and out to Azure. `elevenlabs-tts` does gate its
  // voice ids ("an attacker can't select arbitrary/premium voices by injecting
  // a voiceId"), so the two functions disagree about whether this matters. The
  // voice is also interpolated into an XML attribute without the escaping the
  // text gets.
  assertEquals(status, 200);
  assertStringIncludes(bodies[i] ?? "", "en-US-JennyNeural");
  assertStringIncludes(bodies[i] ?? "", "xml:lang='en-US'");
});

Deno.test("azure-tts refuses empty text", async () => {
  for (const text of ["", "   ", undefined]) {
    const { status, calls } = await call(
      "azure-tts",
      { text },
      caller({ "tts.speech.microsoft.com": audioBytes() }),
    );

    assertEquals(status, 400, `expected ${JSON.stringify(text)} to be refused`);
    // Nothing billable happens for a blank request.
    assert(!calls.some((url) => url.includes("speech.microsoft.com")));
  }
});

Deno.test("azure-tts says so when its key is missing", async () => {
  const { status, body } = await call(
    "azure-tts",
    { text: "مرحبا" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
    { env: { AZURE_SPEECH_KEY: undefined } },
  );

  assertEquals(status, 503);
  assertStringIncludes(String(body.error), "AZURE_SPEECH_KEY");
});

Deno.test("azure-tts reports an upstream failure as 502", async () => {
  const { status, body } = await call(
    "azure-tts",
    { text: "مرحبا" },
    caller({
      "tts.speech.microsoft.com": () => new Response("voice not found", { status: 400 }),
    }),
  );

  assertEquals(status, 502);
  assertStringIncludes(String(body.error), "Azure TTS API error 400");
  assertStringIncludes(String(body.detail), "voice not found");
});

Deno.test("azure-tts turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    "azure-tts",
    { text: "مرحبا" },
    caller({ "tts.speech.microsoft.com": audioBytes() }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("speech.microsoft.com")));
});

// ── elevenlabs-tts (Egyptian) ───────────────────────────────────────────────

Deno.test("elevenlabs-tts returns audio bytes", async () => {
  const { status, contentType, bytes } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  assertEquals(status, 200);
  assertEquals(contentType, "audio/mpeg");
  assert(bytes > 0);
});

Deno.test("elevenlabs-tts defaults to a native Egyptian voice", async () => {
  const { calls } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  const url = calls.find((u) => u.includes("api.elevenlabs.io")) ?? "";
  // Ahmed Yahia, ar-EG. This function previously allowed only a generic English
  // premade voice, so the conversation simulator spoke Egyptian through an
  // English speaker.
  assertStringIncludes(url, "rMheqEfwsIJckq2yCdb5");
});

Deno.test("elevenlabs-tts honours an allowed voice id", async () => {
  const { calls } = await call(
    "elevenlabs-tts",
    { text: "ازيك", voiceId: "6aXW46RTUz6Y2lkBGQ1a" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  const url = calls.find((u) => u.includes("api.elevenlabs.io")) ?? "";
  assertStringIncludes(url, "6aXW46RTUz6Y2lkBGQ1a");
});

Deno.test("elevenlabs-tts ignores a voice id that is not allow-listed", async () => {
  const { status, calls } = await call(
    "elevenlabs-tts",
    { text: "ازيك", voiceId: "some-premium-voice" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  const url = calls.find((u) => u.includes("api.elevenlabs.io")) ?? "";
  // Falls back rather than refusing, and the injected id never reaches
  // ElevenLabs — the allow-list is what stops a caller selecting arbitrary or
  // premium voices on the app's account.
  assertEquals(status, 200);
  assert(!url.includes("some-premium-voice"));
  assertStringIncludes(url, "rMheqEfwsIJckq2yCdb5");
});

Deno.test("elevenlabs-tts sends the multilingual model and Arabic-tuned settings", async () => {
  const { bodies, calls } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  const i = calls.findIndex((u) => u.includes("api.elevenlabs.io"));
  const sent = JSON.parse(bodies[i] ?? "{}") as {
    model_id: string;
    voice_settings: Record<string, unknown>;
  };
  assertEquals(sent.model_id, "eleven_multilingual_v2");
  // Low stability, high style: Arabic carries more prosodic variation than the
  // defaults assume, and a flat read is the usual complaint about TTS Arabic.
  assertEquals(sent.voice_settings.stability, 0.3);
  assertEquals(sent.voice_settings.style, 0.7);
});

Deno.test("elevenlabs-tts refuses empty text", async () => {
  const { status, calls } = await call(
    "elevenlabs-tts",
    { text: "" },
    caller({ "api.elevenlabs.io": audioBytes() }),
  );

  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("elevenlabs.io")));
});

Deno.test("elevenlabs-tts says so when its key is missing", async () => {
  const { status, body } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": audioBytes() }),
    { env: { ELEVENLABS_API_KEY: undefined } },
  );

  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "ElevenLabs API key not configured");
});

Deno.test("elevenlabs-tts passes the upstream status through", async () => {
  const { status, body } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": () => json({ detail: "quota" }, 429) }),
  );

  // Pinned as a difference, not a bug: this one forwards ElevenLabs' status
  // verbatim where azure-tts translates everything to 502 and munsit-tts
  // answers 200 with a fallback flag. Three providers, three failure contracts,
  // and the callers treat them all as "not ok".
  assertEquals(status, 429);
  assertStringIncludes(String(body.error), "429");
});

Deno.test("elevenlabs-tts turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    "elevenlabs-tts",
    { text: "ازيك" },
    caller({ "api.elevenlabs.io": audioBytes() }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("elevenlabs.io")));
});

// ── munsit-tts (Gulf) ───────────────────────────────────────────────────────

/** Munsit's discovery endpoints plus synthesis, routed by path. */
function munsit(
  { voices, models }: {
    voices?: unknown;
    models?: unknown;
  } = {},
): UpstreamHandler {
  return (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/voices")) {
      return json(
        voices ?? [
          { voice_id: "generic-1", name: "Generic", dialect: ["masri"], type: "neural" },
          { voice_id: "najdi-1", name: "Najdi", dialect: ["najdi"], type: "neural" },
        ],
      );
    }
    if (path.endsWith("/models")) {
      return json(models ?? [{ model_id: "munsit-tts-v1" }, { model_id: "munsit-tts-mini" }]);
    }
    return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });
  };
}

/** Clear the overrides so voice and model discovery actually runs. */
const discovering = { MUNSIT_GULF_VOICE_ID: undefined, MUNSIT_TTS_MODEL_ID: undefined };

Deno.test("munsit-tts returns audio bytes", async () => {
  const { status, contentType, bytes } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
  );

  assertEquals(status, 200);
  assertEquals(contentType, "audio/wav");
  assert(bytes > 0);
});

Deno.test("munsit-tts uses the configured voice", async () => {
  const { calls, bodies } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
  );

  // The fixture env sets `MUNSIT_GULF_VOICE_ID`, and it wins.
  const i = calls.findIndex((u) => u.includes("text-to-speech"));
  assertStringIncludes(bodies[i] ?? "", "gulf-1");
});

Deno.test("munsit-tts lists voices even when one is configured", async () => {
  const { calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
  );

  // Pinned, not endorsed. The file's own docblock says `MUNSIT_GULF_VOICE_ID`
  // "skips auto-pick", and it does — but `pickGulfVoice` fires `GET /voices`
  // and `pickModelId` in parallel *before* it reads the override, so the
  // request is made and its result thrown away. On a cold start that is a
  // wasted round trip on the first word a learner taps; it does not repeat,
  // because the result is cached either way.
  assert(calls.some((url) => url.includes("/voices")));
});

Deno.test("munsit-tts picks a Gulf voice when none is configured", async () => {
  const { bodies, calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
    { env: discovering },
  );

  const i = calls.findIndex((u) => u.includes("text-to-speech"));
  // Picked by dialect tag, not by position: the Egyptian voice is listed first,
  // so taking `voices[0]` would give a Gulf learner a Cairo accent.
  assertStringIncludes(bodies[i] ?? "", "najdi-1");
});

Deno.test("munsit-tts recognises every Gulf dialect tag", async () => {
  for (const dialect of ["najdi", "emirati", "khaleeji", "gulf", "saudi", "kuwaiti", "qatari", "bahraini"]) {
    const { bodies, calls } = await call(
      "munsit-tts",
      { text: "شلونك" },
      caller({
        "api.munsit.com": munsit({
          voices: [
            { voice_id: "other-1", dialect: ["masri"], type: "neural" },
            { voice_id: "wanted", dialect: [dialect.toUpperCase()], type: "neural" },
          ],
        }),
      }),
      { env: discovering },
    );

    const i = calls.findIndex((u) => u.includes("text-to-speech"));
    // Matched case-insensitively, because Munsit's own casing is not stable.
    assertStringIncludes(bodies[i] ?? "", "wanted", `expected ${dialect} to match`);
  }
});

Deno.test("munsit-tts falls back to a neural voice when no Gulf one exists", async () => {
  const { bodies, calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({
      "api.munsit.com": munsit({
        voices: [
          { voice_id: "basic-1", dialect: ["masri"], type: null },
          { voice_id: "neural-1", dialect: ["masri"], type: "neural" },
        ],
      }),
    }),
    { env: discovering },
  );

  const i = calls.findIndex((u) => u.includes("text-to-speech"));
  // A wrong-dialect neural voice beats a wrong-dialect basic one — the accent
  // is already lost, so the remaining choice is quality.
  assertStringIncludes(bodies[i] ?? "", "neural-1");
});

Deno.test("munsit-tts prefers the mini model for latency", async () => {
  const { calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
    { env: discovering },
  );

  const url = calls.find((u) => u.includes("text-to-speech")) ?? "";
  // These are single words played on tap, so time-to-first-byte matters more
  // than fidelity.
  assertStringIncludes(url, "munsit-tts-mini");
});

Deno.test("munsit-tts caches the picked voice across requests", async () => {
  const fn = await loadFunction("munsit-tts", {
    upstreams: caller({ "api.munsit.com": munsit() }),
    env: discovering,
  });
  try {
    await fn.handler(jsonRequest("munsit-tts", { text: "شلونك" }));
    const afterFirst = fn.calls.filter((c) => c.url.endsWith("/voices")).length;
    await fn.handler(jsonRequest("munsit-tts", { text: "زين" }));
    const afterSecond = fn.calls.filter((c) => c.url.endsWith("/voices")).length;

    // Discovery is a cold-start cost. Repeating it per request would add two
    // round trips to every word a learner taps.
    assertEquals(afterFirst, 1);
    assertEquals(afterSecond, 1);
  } finally {
    fn.restore();
  }
});

Deno.test("munsit-tts sends default stability and speed", async () => {
  const { bodies, calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
  );

  const i = calls.findIndex((u) => u.includes("text-to-speech"));
  const sent = JSON.parse(bodies[i] ?? "{}") as Record<string, unknown>;
  assertEquals(sent.stability, 0.6);
  assertEquals(sent.speed, 1.0);
  // Non-streaming: the caller wants a complete blob for an `<audio>` element,
  // not a stream it would have to assemble.
  assertEquals(sent.streaming, false);
});

Deno.test("munsit-tts honours caller-supplied stability and speed", async () => {
  const { bodies, calls } = await call(
    "munsit-tts",
    { text: "شلونك", stability: 0.2, speed: 0.75 },
    caller({ "api.munsit.com": munsit() }),
  );

  const i = calls.findIndex((u) => u.includes("text-to-speech"));
  const sent = JSON.parse(bodies[i] ?? "{}") as Record<string, unknown>;
  assertEquals(sent.stability, 0.2);
  assertEquals(sent.speed, 0.75);
});

Deno.test("munsit-tts refuses empty text", async () => {
  const { status, calls } = await call(
    "munsit-tts",
    { text: "   " },
    caller({ "api.munsit.com": munsit() }),
  );

  assertEquals(status, 400);
  assert(!calls.some((url) => url.includes("text-to-speech")));
});

Deno.test("munsit-tts says so when its key is missing", async () => {
  const { status, body, calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
    { env: { MUNSIT_API_KEY: undefined } },
  );

  assertEquals(status, 503);
  assertStringIncludes(String(body.error), "MUNSIT_API_KEY");
  assert(!calls.some((url) => url.includes("munsit.com")));
});

Deno.test("munsit-tts gives up when no voice can be resolved", async () => {
  const { status, body } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({
      "api.munsit.com": (request) =>
        new URL(request.url).pathname.endsWith("/models")
          ? json([])
          : json([]),
    }),
    { env: discovering },
  );

  // 502 rather than a synthesis attempt with `undefined` in the URL, which
  // Munsit would answer with an opaque 404.
  assertEquals(status, 502);
  assertEquals(body.error, "Could not resolve a Munsit voice");
});

Deno.test("munsit-tts asks the client to fall back on a rate limit", async () => {
  for (const upstreamStatus of [429, 402, 500, 503]) {
    const { status, body } = await call(
      "munsit-tts",
      { text: "شلونك" },
      caller({
        "api.munsit.com": (request) =>
          new URL(request.url).pathname.includes("text-to-speech")
            ? new Response("busy", { status: upstreamStatus })
            : munsit()(request),
      }),
    );

    // Pinned as-is. A recoverable upstream failure comes back as **200** with
    // `{ error: "SERVICE_UNAVAILABLE", fallback: true }` so a client can switch
    // provider. No caller in the app reads it: every one of them checks
    // `res.ok` and then calls `res.blob()`, so this 200 becomes an unplayable
    // blob and the page logs a generic TTS error. The signal is emitted and
    // nothing listens.
    assertEquals(status, 200, `expected ${upstreamStatus} to be flagged for fallback`);
    assertEquals(body.error, "SERVICE_UNAVAILABLE");
    assertEquals(body.fallback, true);
    assertEquals(body.status, upstreamStatus);
  }
});

Deno.test("munsit-tts reports an unrecoverable failure as 502", async () => {
  const { status, body } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({
      "api.munsit.com": (request) =>
        new URL(request.url).pathname.includes("text-to-speech")
          ? new Response("bad voice", { status: 400 })
          : munsit()(request),
    }),
  );

  // A 4xx that is not a quota problem will not be fixed by trying another
  // provider, so it is a real failure rather than a fallback hint.
  assertEquals(status, 502);
  assertEquals(body.fallback, false);
});

Deno.test("munsit-tts turns an anonymous caller away", async () => {
  const { status, calls } = await call(
    "munsit-tts",
    { text: "شلونك" },
    caller({ "api.munsit.com": munsit() }),
    { jwt: null },
  );

  assertEquals(status, 401);
  assert(!calls.some((url) => url.includes("munsit.com")));
});

// ── CORS ────────────────────────────────────────────────────────────────────

for (const name of ["azure-tts", "elevenlabs-tts", "munsit-tts"]) {
  Deno.test(`${name} answers a preflight without touching the cap`, async () => {
    const fn = await loadFunction(name, { upstreams: caller() });
    try {
      const response = await fn.handler(optionsRequest(name));

      assertEquals(response.status, 200);
      assert(response.headers.get("access-control-allow-origin"));
      assertEquals(fn.calls.length, 0);
    } finally {
      fn.restore();
    }
  });
}
