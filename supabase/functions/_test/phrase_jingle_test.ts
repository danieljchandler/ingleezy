import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, jsonRequest, loadFunction, optionsRequest } from "./harness.ts";
import { json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-phrase-jingle` — turns a saved phrase into a twelve-second sung
 * hook, on the theory that a tune sticks where a flashcard does not.
 *
 * Two models in series: a chat model writes the lyrics and the music-generation
 * prompt as JSON, then Lyria sings it. The interesting part is the tail. Lyria
 * answers with raw 16-bit PCM more often than not, which no browser will play,
 * so the function synthesises a 44-byte RIFF/WAVE header around the samples and
 * hands back base64 — never raw bytes, because `functions.invoke` has been seen
 * to coerce a binary body through UTF-8 and turn the clip into white noise.
 */

const PHRASE = { phrase_arabic: "شلونك", phrase_english: "how are you" };

/** Four bytes of "PCM" — two whole 16-bit samples. */
const PCM_B64 = btoa("\x01\x02\x03\x04");
/** An odd number of bytes, so the final sample is incomplete. */
const ODD_PCM_B64 = btoa("\x01\x02\x03\x04\x05");

const aJingle = (over: Record<string, unknown> = {}) => ({
  lyrics: "شَلُونَكْ، شَلُونَكْ، شَلُونَكْ يا صَديقي",
  prompt: "A 12-second upbeat Khaliji pop jingle, oud and handclaps, one bright female voice.",
  ...over,
});

/** The chat model's answer: JSON in the content field. */
const writing = (content: unknown): UpstreamHandler => () =>
  json({
    choices: [
      { message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
    ],
  });

/** Lyria's answer: audio as inline base64 on a candidate part. */
const singing = (
  data: string | null = PCM_B64,
  mimeType = "audio/L16;rate=48000",
): UpstreamHandler =>
() =>
  json({
    candidates: [
      {
        content: {
          parts: data === null
            ? [{ text: "I cannot generate that" }]
            : [{ inlineData: { mimeType, data } }],
        },
      },
    ],
  });

function backend(
  options: { write?: UpstreamHandler; sing?: UpstreamHandler } = {},
): Record<string, UpstreamHandler> {
  return {
    "ai.gateway.lovable.dev": options.write ?? writing(aJingle()),
    "generativelanguage.googleapis.com": options.sing ?? singing(),
  };
}

interface Result {
  status: number;
  body: Record<string, unknown>;
  calls: string[];
  bodies: Array<string | null>;
}

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  opts: { env?: Record<string, string | undefined> } = {},
): Promise<Result> {
  const fn = await loadFunction("generate-phrase-jingle", { upstreams, env: opts.env });
  try {
    const response = await fn.handler(jsonRequest("generate-phrase-jingle", body));
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

/** What was asked of the chat model. */
function writerPrompt(result: Result): { system: string; user: string } {
  const index = result.calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(result.bodies[index] ?? "{}") as {
    messages?: Array<{ role: string; content: string }>;
  };
  return {
    system: sent.messages?.find((m) => m.role === "system")?.content ?? "",
    user: sent.messages?.find((m) => m.role === "user")?.content ?? "",
  };
}

/** The text handed to Lyria. */
function musicPrompt(result: Result): string {
  const index = result.calls.findIndex((u) => u.includes("generativelanguage"));
  const sent = JSON.parse(result.bodies[index] ?? "{}") as {
    contents?: Array<{ parts?: Array<{ text?: string }> }>;
  };
  return sent.contents?.[0]?.parts?.[0]?.text ?? "";
}

const decoded = (result: Result): Uint8Array =>
  Uint8Array.from(atob(String(result.body.audioBase64)), (c) => c.charCodeAt(0));

// ── The way in ───────────────────────────────────────────────────────────────

Deno.test("generate-phrase-jingle answers the preflight", async () => {
  const fn = await loadFunction("generate-phrase-jingle", { upstreams: backend() });
  try {
    const response = await fn.handler(optionsRequest("generate-phrase-jingle"));
    assertEquals(response.status, 200);
    assert(response.headers.get("access-control-allow-origin"));
  } finally {
    fn.restore();
  }
});

Deno.test("generate-phrase-jingle needs both halves of the phrase", async () => {
  for (const body of [{}, { phrase_arabic: "شلونك" }, { phrase_english: "how are you" }]) {
    const result = await call(body, backend());
    assertEquals(result.status, 400);
    assertStringIncludes(String(result.body.error), "are required");
  }
});

Deno.test("generate-phrase-jingle refuses to start with a key missing", async () => {
  // Two models, two keys. Failing up front costs nothing; failing after the
  // lyrics are written wastes the first call.
  for (const key of ["LOVABLE_API_KEY", "GEMINI_API_KEY"]) {
    const result = await call(PHRASE, backend(), { env: { [key]: undefined } });
    assertEquals(result.status, 500);
    assertEquals(result.body.error, "AI keys not configured");
    assertEquals(result.calls.length, 0);
  }
});

// ── Writing the jingle ───────────────────────────────────────────────────────

Deno.test("generate-phrase-jingle asks for the learner's own dialect", async () => {
  const result = await call({ ...PHRASE, dialect: "Egyptian" }, backend());
  const { system, user } = writerPrompt(result);

  // A Gulf tune for an Egyptian learner teaches the phrase in a voice they will
  // not hear again.
  assertStringIncludes(system, "Egyptian Arabic pop/shaabi style");
  assertStringIncludes(user, "Egyptian");
});

Deno.test("generate-phrase-jingle styles a Yemeni jingle as Yemeni folk-pop", async () => {
  const result = await call({ ...PHRASE, dialect: "Yemeni" }, backend());
  assertStringIncludes(writerPrompt(result).system, "Yemeni folk-pop style");
});

Deno.test("generate-phrase-jingle defaults an unspecified dialect to Gulf", async () => {
  const result = await call(PHRASE, backend());
  assertStringIncludes(writerPrompt(result).system, "Khaliji/Gulf Arabic pop style");
});

Deno.test("generate-phrase-jingle asks for tashkeel on the lyrics", async () => {
  const result = await call(PHRASE, backend());
  const { system, user } = writerPrompt(result);

  // The point of the jingle is hearing the vowels; unvocalised lyrics leave the
  // singer to guess them.
  assertStringIncludes(system, "full tashkeel");
  assertStringIncludes(user, "tashkeel");
});

Deno.test("generate-phrase-jingle asks for the phrase to repeat", async () => {
  const result = await call(PHRASE, backend());
  assertStringIncludes(writerPrompt(result).system, "at least 3 times");
});

Deno.test("generate-phrase-jingle constrains the lyrics to family-friendly ground", async () => {
  const result = await call(PHRASE, backend());
  const { system } = writerPrompt(result);

  // Named subjects rather than a vague "be appropriate": the music model
  // refuses outright on some of these, which would surface as a bare 500.
  assertStringIncludes(system, "SAFETY");
  for (const banned of ["violence", "politics", "religion", "alcohol"]) {
    assertStringIncludes(system, banned);
  }
});

Deno.test("generate-phrase-jingle asks the writer for strict JSON", async () => {
  const result = await call(PHRASE, backend());
  const index = result.calls.findIndex((u) => u.includes("chat/completions"));
  const sent = JSON.parse(result.bodies[index] ?? "{}") as { response_format?: { type?: string } };

  assertEquals(sent.response_format?.type, "json_object");
});

Deno.test("generate-phrase-jingle passes a rate limit through as a rate limit", async () => {
  const result = await call(PHRASE, backend({
    write: () => new Response("slow down", { status: 429 }),
  }));

  // 429 and 402 are the two the client can act on — wait, or top up. Flattening
  // them into 500 leaves the learner with "something went wrong".
  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "Rate limited");
});

Deno.test("generate-phrase-jingle passes exhausted credits through as such", async () => {
  const result = await call(PHRASE, backend({
    write: () => new Response("payment required", { status: 402 }),
  }));

  assertEquals(result.status, 402);
  assertStringIncludes(String(result.body.error), "Credits exhausted");
});

Deno.test("generate-phrase-jingle reports any other writer failure as a 500", async () => {
  const result = await call(PHRASE, backend({
    write: () => new Response("upstream down", { status: 503 }),
  }));

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "Failed to generate music prompt");
  assertEquals(result.calls.some((u) => u.includes("generativelanguage")), false);
});

// ── Handing the lyrics to the singer ─────────────────────────────────────────

Deno.test("generate-phrase-jingle sends the lyrics along with the style", async () => {
  const result = await call(PHRASE, backend());
  const prompt = musicPrompt(result);

  // Both halves, and the lyrics labelled — the style prompt alone produces
  // twelve seconds of instrumental with nothing to learn from.
  assertStringIncludes(prompt, "upbeat Khaliji pop jingle");
  assertStringIncludes(prompt, "Lyrics to sing clearly");
  assertStringIncludes(prompt, "شَلُونَكْ");
});

Deno.test("generate-phrase-jingle asks the singer for audio", async () => {
  const result = await call(PHRASE, backend());
  const index = result.calls.findIndex((u) => u.includes("generativelanguage"));
  const sent = JSON.parse(result.bodies[index] ?? "{}") as {
    generationConfig?: { responseModalities?: string[] };
  };

  assertEquals(sent.generationConfig?.responseModalities, ["AUDIO"]);
});

Deno.test("generate-phrase-jingle strips a markdown fence off the writer's JSON", async () => {
  const result = await call(PHRASE, backend({
    // "Return JSON only" is a request, not a guarantee.
    write: writing("```json\n" + JSON.stringify(aJingle()) + "\n```"),
  }));

  assertEquals(result.status, 200);
  assertStringIncludes(String(result.body.lyrics), "شَلُونَكْ");
});

Deno.test("generate-phrase-jingle sings unparseable output as the style prompt", async () => {
  const result = await call(PHRASE, backend({
    write: writing("Here's a fun Gulf pop jingle with handclaps and oud."),
  }));

  // Degrading to an instrumental beats failing outright, but the learner gets
  // no words — and `lyrics` comes back null so the UI knows not to show any.
  assertEquals(result.status, 200);
  assertEquals(result.body.lyrics, null);
  assertEquals(musicPrompt(result), "Here's a fun Gulf pop jingle with handclaps and oud.");
});

Deno.test("generate-phrase-jingle refuses to sing an empty prompt", async () => {
  const result = await call(PHRASE, backend({ write: writing("") }));

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "Empty music prompt");
  assertEquals(result.calls.some((u) => u.includes("generativelanguage")), false);
});

Deno.test("generate-phrase-jingle passes the singer's rate limit through", async () => {
  const result = await call(PHRASE, backend({
    sing: () => new Response("slow down", { status: 429 }),
  }));

  assertEquals(result.status, 429);
  assertStringIncludes(String(result.body.error), "rate limited");
});

Deno.test("generate-phrase-jingle passes the singer's exhausted credits through", async () => {
  const result = await call(PHRASE, backend({
    sing: () => new Response("payment required", { status: 402 }),
  }));

  assertEquals(result.status, 402);
  assertStringIncludes(String(result.body.error), "credits exhausted");
});

Deno.test("generate-phrase-jingle reports any other singer failure as a 500", async () => {
  const result = await call(PHRASE, backend({
    sing: () => new Response("model unavailable", { status: 503 }),
  }));

  assertEquals(result.status, 500);
  assertEquals(result.body.error, "Failed to generate music");
});

Deno.test("generate-phrase-jingle says so when the singer returns no audio", async () => {
  const result = await call(PHRASE, backend({ sing: singing(null) }));

  // A refusal comes back as a 200 carrying a text part, which is the failure
  // mode a status check misses entirely.
  assertEquals(result.status, 500);
  assertEquals(result.body.error, "No audio generated");
});

// ── Making the audio playable ────────────────────────────────────────────────

Deno.test("generate-phrase-jingle wraps raw PCM in a WAV header", async () => {
  const result = await call(PHRASE, backend());
  const bytes = decoded(result);

  // Lyria's L16 is headerless samples; no browser will play it. The 44-byte
  // RIFF header is what makes the clip a file.
  assertEquals(result.body.mimeType, "audio/wav");
  assertEquals(result.body.extension, "wav");
  assertEquals(bytes.length, 44 + 4);
  assertEquals(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assertEquals(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
  assertEquals(String.fromCharCode(...bytes.slice(36, 40)), "data");
});

Deno.test("generate-phrase-jingle takes the sample rate from the mime type", async () => {
  const result = await call(PHRASE, backend({ sing: singing(PCM_B64, "audio/L16;rate=24000") }));
  const view = new DataView(decoded(result).buffer);

  // A header claiming 48 kHz over 24 kHz samples plays the jingle at double
  // speed, an octave up.
  assertEquals(view.getUint32(24, true), 24_000);
  // Byte rate and block align are derived from it: mono, 16-bit.
  assertEquals(view.getUint32(28, true), 24_000 * 2);
  assertEquals(view.getUint16(32, true), 2);
  assertEquals(view.getUint16(22, true), 1);
  assertEquals(view.getUint16(34, true), 16);
});

Deno.test("generate-phrase-jingle assumes 48 kHz when the mime type omits a rate", async () => {
  const result = await call(PHRASE, backend({ sing: singing(PCM_B64, "audio/pcm") }));
  assertEquals(new DataView(decoded(result).buffer).getUint32(24, true), 48_000);
});

Deno.test("generate-phrase-jingle drops a trailing half sample", async () => {
  const result = await call(PHRASE, backend({ sing: singing(ODD_PCM_B64, "audio/L16;rate=48000") }));
  const bytes = decoded(result);
  const view = new DataView(bytes.buffer);

  // An odd byte count means the last 16-bit sample is incomplete; keeping it
  // would put the declared data size out of step with the payload.
  assertEquals(view.getUint32(40, true), 4);
  assertEquals(view.getUint32(4, true), 36 + 4);
  assertEquals(bytes.length, 44 + 4);
});

Deno.test("generate-phrase-jingle leaves an already-encoded clip alone", async () => {
  const mp3 = btoa("\xff\xfb\x90\x00");
  const result = await call(PHRASE, backend({ sing: singing(mp3, "audio/mpeg") }));

  // Only headerless PCM needs the wrapper. Wrapping an MP3 in RIFF would
  // produce a file that is neither.
  assertEquals(result.body.mimeType, "audio/mpeg");
  assertEquals(result.body.extension, "mp3");
  assertEquals(result.body.audioBase64, mp3);
});

Deno.test("generate-phrase-jingle returns base64 rather than raw bytes", async () => {
  const result = await call(PHRASE, backend());

  // The whole reason this endpoint answers JSON: `functions.invoke` has been
  // seen to coerce a binary body through UTF-8, which turns the clip into white
  // noise. Base64 survives that round trip intact.
  assertEquals(typeof result.body.audioBase64, "string");
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(String(result.body.audioBase64)));
});

Deno.test("generate-phrase-jingle hands back the lyrics it had sung", async () => {
  const result = await call(PHRASE, backend());

  // The learner reads along with the clip, so the words have to come back with
  // it rather than being reconstructed client-side.
  assertEquals(result.body.lyrics, aJingle().lyrics);
});

Deno.test("generate-phrase-jingle reports a crash as a message, not an empty body", async () => {
  const fn = await loadFunction("generate-phrase-jingle", { upstreams: backend() });
  try {
    const response = await fn.handler(
      new Request("https://e2e.supabase.co/functions/v1/generate-phrase-jingle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://hakiya.app",
          // Signed in: the daily cap now gates this endpoint, and an anonymous
          // crash would be a 401 before the body was ever parsed.
          authorization: `Bearer ${fixtureJwt()}`,
        },
        body: "{ not json",
      }),
    );
    assertEquals(response.status, 500);
    assert(String((await response.json()).error).length > 0);
  } finally {
    fn.restore();
  }
});
