import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { chatCompletion, json, type UpstreamHandler } from "./upstreams.ts";

/**
 * `generate-word-jingle` — a sung mnemonic for a saved word.
 *
 * Two model calls in series and a binary conversion at the end, which is where
 * the substance is. Google's Lyria returns raw PCM (`audio/L16`) as often as
 * it returns MP3, and a browser will not play headerless PCM — so the function
 * synthesises a RIFF/WAVE header around it. Get that wrong and the learner
 * downloads a file that plays as silence or as white noise, with nothing
 * upstream reporting a failure.
 *
 * It answers base64 in JSON rather than raw bytes for a related reason:
 * `functions.invoke` coerces a binary body through UTF-8 in some environments,
 * which corrupts the audio in exactly the same undetectable way.
 */

const USER = "00000000-0000-4000-8000-000000000001";

function caller(extra: Record<string, UpstreamHandler> = {}): Record<string, UpstreamHandler> {
  return {
    "/auth/v1/user": () => json({ id: USER, aud: "authenticated", role: "authenticated" }),
    "/rest/v1/dialect_prompts": () => json([]),
    "/rest/v1/dialect_rules": () => json([]),
    ...extra,
  };
}

/** The prompt-writing model, which answers `{ lyrics, prompt }` as prose. */
const promptWriter = (payload: unknown): UpstreamHandler => () =>
  chatCompletion(typeof payload === "string" ? payload : JSON.stringify(payload));

/** Lyria's answer: audio as base64 inline data. */
const lyria = (bytes: Uint8Array, mimeType: string): UpstreamHandler => () =>
  json({
    candidates: [
      {
        content: {
          parts: [
            { inlineData: { data: btoa(String.fromCharCode(...bytes)), mimeType } },
          ],
        },
      },
    ],
  });

/** Sixteen bytes of "PCM": eight 16-bit samples. */
const PCM = new Uint8Array(16).fill(7);

async function call(
  body: unknown,
  upstreams: Record<string, UpstreamHandler>,
  env?: Record<string, string | undefined>,
) {
  const fn = await loadFunction("generate-word-jingle", { upstreams, env });
  try {
    const response = await fn.handler(jsonRequest("generate-word-jingle", body));
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

/** Decode the base64 audio the function returned. */
const decode = (base64: unknown) =>
  Uint8Array.from(atob(String(base64)), (c) => c.charCodeAt(0));

const aWord = { word_arabic: "كتاب", word_english: "book", dialect: "Gulf" };

Deno.test("generate-word-jingle returns base64 audio with its type and extension", async () => {
  const { status, body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب كتاب", prompt: "Khaliji pop" }),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([1, 2, 3, 4]), "audio/mpeg"),
    }),
  );

  assertEquals(status, 200);
  // The caller uploads this to storage, so it needs all three: the bytes, the
  // content type to store them under, and the extension to name the file.
  assertEquals(body.mimeType, "audio/mpeg");
  assertEquals(body.extension, "mp3");
  assertEquals(decode(body.audioBase64), new Uint8Array([1, 2, 3, 4]));
  assertEquals(body.lyrics, "كتاب كتاب");
});

Deno.test("generate-word-jingle wraps raw PCM in a WAV header", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "generativelanguage.googleapis.com": lyria(PCM, "audio/L16;rate=24000"),
    }),
  );

  const out = decode(body.audioBase64);
  // Lyria returns headerless PCM as often as MP3, and no browser plays that.
  // Without the header the learner gets a file that fails silently.
  assertEquals(body.mimeType, "audio/wav");
  assertEquals(body.extension, "wav");
  assertEquals(String.fromCharCode(...out.slice(0, 4)), "RIFF");
  assertEquals(String.fromCharCode(...out.slice(8, 12)), "WAVE");
  assertEquals(out.length, 44 + PCM.length);
});

Deno.test("generate-word-jingle takes the sample rate from the mime type", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "generativelanguage.googleapis.com": lyria(PCM, "audio/L16;rate=24000"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Wrong sample rate plays the jingle at the wrong pitch and speed — which
  // for a *pronunciation* mnemonic is worse than not playing at all.
  assertEquals(view.getUint32(24, true), 24000);
  // Byte rate = rate × channels × bytes per sample.
  assertEquals(view.getUint32(28, true), 24000 * 2);
});

Deno.test("generate-word-jingle assumes 48kHz when the rate is not stated", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "generativelanguage.googleapis.com": lyria(PCM, "audio/L16"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assertEquals(view.getUint32(24, true), 48000);
});

Deno.test("generate-word-jingle trims an odd trailing byte off the PCM", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "generativelanguage.googleapis.com": lyria(new Uint8Array(15).fill(7), "audio/L16;rate=48000"),
    }),
  );

  const out = decode(body.audioBase64);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // 16-bit samples come in pairs. A declared data size with a half sample in it
  // makes some players reject the file outright.
  assertEquals(view.getUint32(40, true), 14);
  assertEquals(out.length, 44 + 14);
});

Deno.test("generate-word-jingle leaves MP3 alone", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "كتاب", prompt: "pop" }),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([0xff, 0xfb, 1, 2]), "audio/mpeg"),
    }),
  );

  // Only L16/PCM gets a header. Prepending RIFF to an MP3 would corrupt it.
  assertEquals(decode(body.audioBase64), new Uint8Array([0xff, 0xfb, 1, 2]));
  assertEquals(body.extension, "mp3");
});

Deno.test("generate-word-jingle sings the lyrics it wrote", async () => {
  const { bodies, calls } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({
        lyrics: "كِتاب كِتاب، بَين إيديّ",
        prompt: "Khaliji pop, upbeat",
      }),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  const i = calls.findIndex((u) => u.includes("generativelanguage"));
  const sent = bodies[i] ?? "";
  // Two calls in series: the first writes lyrics and a style, the second sings
  // them. Sending only the style produces a tune with no word in it, which is
  // not a mnemonic.
  assertStringIncludes(sent, "كِتاب كِتاب، بَين إيديّ");
  assertStringIncludes(sent, "Khaliji pop, upbeat");
});

Deno.test("generate-word-jingle falls back to the raw text when the plan is unparsable", async () => {
  const { status, body, bodies, calls } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter("Just make it sound Khaliji and cheerful."),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  // Prose instead of JSON still describes a song. Better a jingle with no
  // written lyrics than no jingle.
  assertEquals(status, 200);
  assertEquals(body.lyrics, null);
  const i = calls.findIndex((u) => u.includes("generativelanguage"));
  assertStringIncludes(bodies[i] ?? "", "Khaliji and cheerful");
});

Deno.test("generate-word-jingle strips markdown fences from the plan", async () => {
  const { body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter(
        '```json\n{"lyrics":"كتاب","prompt":"pop"}\n```',
      ),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  assertEquals(body.lyrics, "كتاب");
});

Deno.test("generate-word-jingle picks a style per dialect", async () => {
  for (
    const [dialect, marker] of [
      ["Gulf", "Khaliji"],
      ["Egyptian", "shaabi"],
      ["Yemeni", "Yemeni folk-pop"],
    ] as const
  ) {
    const { bodies, calls } = await call(
      { ...aWord, dialect },
      caller({
        "ai.gateway.lovable.dev": promptWriter({ lyrics: "x", prompt: "p" }),
        "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
    );

    const i = calls.findIndex((u) => u.includes("chat/completions"));
    // A Gulf word sung in shaabi teaches the wrong prosody along with the word.
    assertStringIncludes(bodies[i] ?? "", marker);
  }
});

Deno.test("generate-word-jingle refuses a request missing either half", async () => {
  for (const body of [{ word_english: "book" }, { word_arabic: "كتاب" }, {}]) {
    const { status, calls } = await call(
      body,
      caller({
        "ai.gateway.lovable.dev": promptWriter({ lyrics: "x", prompt: "p" }),
        "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
    );

    assertEquals(status, 400);
    assert(!calls.some((u) => u.includes("chat/completions")));
  }
});

Deno.test("generate-word-jingle refuses an empty music prompt", async () => {
  const { status, body, calls } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter(""),
      "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
    }),
  );

  // Lyria given an empty prompt bills for a generation and returns something
  // arbitrary, so the check is in front of it rather than after.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "Empty music prompt");
  assert(!calls.some((u) => u.includes("generativelanguage")));
});

Deno.test("generate-word-jingle names each missing key", async () => {
  for (const key of ["LOVABLE_API_KEY", "GEMINI_API_KEY"]) {
    const { status, body, calls } = await call(
      aWord,
      caller({
        "ai.gateway.lovable.dev": promptWriter({ lyrics: "x", prompt: "p" }),
        "generativelanguage.googleapis.com": lyria(new Uint8Array([1]), "audio/mpeg"),
      }),
      { [key]: undefined },
    );

    // Two providers, two keys, checked before either is called and named
    // separately — a half-configured deployment otherwise fails after paying
    // for the first call.
    assertEquals(status, 500);
    assertStringIncludes(String(body.error), key);
    assert(!calls.some((u) => u.includes("chat/completions")));
  }
});

Deno.test("generate-word-jingle reports a safety-filtered generation", async () => {
  const { status, body } = await call(
    aWord,
    caller({
      "ai.gateway.lovable.dev": promptWriter({ lyrics: "x", prompt: "p" }),
      "generativelanguage.googleapis.com": () =>
        json({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    }),
  );

  // Named, and it suggests the way out. A blocked generation looks identical
  // to an outage otherwise, and the learner can fix this one by trying another
  // word.
  assertEquals(status, 500);
  assertStringIncludes(String(body.error), "safety filter");
  assertStringIncludes(String(body.error), "Try a different word");
});
