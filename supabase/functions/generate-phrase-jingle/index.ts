import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Two models, two keys — a missing one fails here, before the cap's own
  // round-trips, so a config error costs nothing.
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!LOVABLE_API_KEY || !GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI keys not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // This was the one generation endpoint with no cap at all — a music-model
  // call anyone signed in could loop for free. Same ladder as word jingles.
  const cap = await enforceDailyCap(req, "generate-phrase-jingle", 15, corsHeaders, {
    standard: 40,
    allin: 120,
  });
  if (cap.limited) return cap.response;

  try {
    const { phrase_arabic, phrase_english, dialect = "Gulf" } = await req.json();

    if (!phrase_arabic || !phrase_english) {
      return new Response(
        JSON.stringify({ error: "phrase_arabic and phrase_english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectStyle = dialect === "Egyptian"
      ? "Egyptian Arabic pop/shaabi style with Egyptian dialect vocals"
      : dialect === "Yemeni"
      ? "Yemeni folk-pop style with Yemeni dialect vocals"
      : "Khaliji/Gulf Arabic pop style with Gulf dialect vocals";

    const promptGen = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_IDS.GEMINI_FAST,
          messages: [
            {
              role: "system",
              content: `You write short, catchy jingles for memorizing Arabic phrases.

${dialectRules}

Return STRICT JSON only (no markdown, no commentary):
{
  "lyrics": "<sung lyrics in ${dialectLabel} Arabic with full tashkeel. 2-4 short lines. Repeat the target phrase at least 3 times. Tiny bit of simple English is OK if it helps the hook.>",
  "prompt": "<English music-generation prompt: 12-second ${dialectStyle} jingle. Describe mood, tempo, voices, instrumentation. State that the lyrics above must be sung clearly.>"
}

SAFETY: no violence, weapons, politics, religion, romance, alcohol, drugs, body parts, or anything explicit. Keep it cheerful and family-friendly.`,
            },
            {
              role: "user",
              content: `Jingle for the ${dialectLabel} phrase "${phrase_arabic}" (meaning "${phrase_english}"). Arabic must include tashkeel. Return JSON only.`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );

    if (!promptGen.ok) {
      const status = promptGen.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Rate limited, try again later" : "Credits exhausted",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("Prompt gen error:", status, await promptGen.text());
      return new Response(
        JSON.stringify({ error: "Failed to generate music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const promptData = await promptGen.json();
    const rawContent: string = promptData.choices?.[0]?.message?.content?.trim() ?? "";
    let lyrics = "";
    let stylePrompt = "";
    try {
      const cleaned = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      lyrics = String(parsed.lyrics || "").trim();
      stylePrompt = String(parsed.prompt || "").trim();
    } catch (err) {
      console.warn("Failed to parse jingle JSON, using raw content as prompt:", err);
      stylePrompt = rawContent;
    }

    const musicPrompt = lyrics
      ? `${stylePrompt}\n\nLyrics to sing clearly (${dialectLabel} Arabic with tashkeel):\n${lyrics}`
      : stylePrompt;

    if (!musicPrompt) {
      return new Response(
        JSON.stringify({ error: "Empty music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lyriaResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: musicPrompt }] }],
          generationConfig: { responseModalities: ["AUDIO"] },
        }),
      },
    );

    if (!lyriaResp.ok) {
      const status = lyriaResp.status;
      console.error("Lyria error:", status, await lyriaResp.text());
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({
            error: status === 429 ? "Music generation rate limited" : "Music credits exhausted",
          }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to generate music" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lyriaData = await lyriaResp.json();
    const audioPart = lyriaData.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.mimeType?.startsWith("audio/"),
    );

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response");
      return new Response(
        JSON.stringify({ error: "No audio generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const audioBytes = Uint8Array.from(
      atob(audioPart.inlineData.data),
      (c) => c.charCodeAt(0),
    );
    const mimeType: string = audioPart.inlineData.mimeType || "audio/L16;rate=48000";
    console.log("Lyria mime:", mimeType, "bytes:", audioBytes.length);

    // Return JSON/base64 instead of raw binary. supabase.functions.invoke can
    // coerce raw MP3 bytes through UTF-8 in some environments, which corrupts
    // the file into white noise. Base64 preserves the audio exactly.
    let outBytes = audioBytes;
    let outMime = mimeType;
    if (/^audio\/(l16|pcm)/i.test(mimeType)) {
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 48000;
      const pcmBytes = audioBytes;
      const channels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * channels * bitsPerSample / 8;
      const blockAlign = channels * bitsPerSample / 8;
      const dataSize = pcmBytes.length - (pcmBytes.length % 2);
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeStr(36, "data");
      view.setUint32(40, dataSize, true);
      new Uint8Array(buffer, 44).set(pcmBytes.slice(0, dataSize));
      outBytes = new Uint8Array(buffer);
      outMime = "audio/wav";
    }

    let audioBase64 = "";
    for (let i = 0; i < outBytes.length; i += 0x8000) {
      audioBase64 += String.fromCharCode(...outBytes.subarray(i, i + 0x8000));
    }

    return new Response(JSON.stringify({
      audioBase64: btoa(audioBase64),
      mimeType: outMime,
      extension: outMime.includes("mpeg") || outMime.includes("mp3") ? "mp3" : "wav",
      lyrics: lyrics || null,
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("generate-phrase-jingle error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
