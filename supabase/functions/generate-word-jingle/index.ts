import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectLabel, getDialectVocabRules } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap: 5 jingle generations / user / day (Lyria is expensive).
  // Music generation (Lyria) costs real money per call. The free allowance
  // comes down from 50 — which was uncapped-in-practice — and paid tiers get
  // a ladder instead of a bypass.
  const cap = await enforceDailyCap(req, "generate-word-jingle", 15, corsHeaders, {
    standard: 40,
    allin: 120,
  });
  if (cap.limited) return cap.response;

  try {
    const { word_arabic, word_english, dialect = "Gulf" } = await req.json();

    if (!word_arabic || !word_english) {
      return new Response(
        JSON.stringify({ error: "word_arabic and word_english are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate a dialect-specific music prompt using Lovable AI
    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const dialectStyle = dialect === "Egyptian"
      ? "Egyptian Arabic pop/shaabi style with Egyptian dialect vocals"
      : dialect === "Yemeni"
      ? "Yemeni folk-pop style with Yemeni dialect vocals"
      : "Khaliji/Gulf Arabic pop style with Gulf dialect vocals";

    const promptGenResponse = await fetch(
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
              content: `You are a creative music director for Arabic educational jingles.

${dialectRules}

Return STRICT JSON only (no markdown fences, no commentary), shape:
{
  "lyrics": "<the actual sung lyrics in ${dialectLabel} Arabic with full tashkeel (harakat). 2-4 short lines. Repeat the target word at least 3 times. A tiny bit of simple English is OK if it helps the hook.>",
  "prompt": "<English music-generation prompt: 10-second ${dialectStyle} jingle, describe mood, tempo, voices, instrumentation. Emphasize that the lyrics above must be sung clearly and prominently.>"
}

STRICT SAFETY RULES (the music model has a strict safety filter — violations cause generation to fail):
- NEVER mention violence, war, weapons, captivity, prison, oppression, blood, death, hate, politics, religion, romance, alcohol, drugs, body parts, or anything explicit.
- Even if the target word literally means something heavy (e.g. "captivity", "kill", "fight"), express it in a soft, abstract, child-friendly way.
- Lyrics must be cheerful, wholesome, suitable for a children's TV show.
- Use happy imagery: sunshine, friends, dancing, colors, markets, food, nature.`,
            },
            {
              role: "user",
              content: `Create a wholesome 10-second jingle that teaches the ${dialectLabel} word "${word_arabic}" (meaning "${word_english}"). Arabic must include tashkeel. Return JSON only.`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!promptGenResponse.ok) {
      const status = promptGenResponse.status;
      if (status === 429 || status === 402) {
        return new Response(
          JSON.stringify({ error: status === 429 ? "Rate limited, try again later" : "Credits exhausted" }),
          { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await promptGenResponse.text();
      console.error("Prompt generation error:", status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to generate music prompt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const promptData = await promptGenResponse.json();
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
        JSON.stringify({ error: "Empty music prompt generated" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generated music prompt:", musicPrompt);

    // Step 2: Call Google Lyria 3 Clip to generate the actual song
    const callLyria = async (text: string) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ["AUDIO"] },
          }),
        },
      );

    const safeFallbackPrompt = `A cheerful, family-friendly 10-second ${dialectLabel} children's jingle. ${dialectStyle}. A happy group of kids sings the Arabic word "${word_arabic}" three times in a playful, sing-song way over bright, bouncy percussion and a simple melodic hook. Sunny, wholesome, market-day vibe. No lyrics other than the repeated Arabic word and gentle "la la la" vocables.`;

    let lyriaResponse = await callLyria(musicPrompt);
    let lyriaData: any = null;
    let audioPart: any = null;

    const extractAudio = (data: any) =>
      data?.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("audio/"),
      );

    if (lyriaResponse.ok) {
      lyriaData = await lyriaResponse.json();
      audioPart = extractAudio(lyriaData);
    }

    // If blocked by safety filter (or any other "no audio") — retry once with safe prompt.
    if (!audioPart?.inlineData?.data) {
      const blockReason = lyriaData?.promptFeedback?.blockReason;
      const statusText = lyriaResponse.ok ? `no-audio (${blockReason ?? "unknown"})` : `http ${lyriaResponse.status}`;
      console.warn("Lyria first attempt failed:", statusText, "— retrying with safe fallback prompt.");

      if (!lyriaResponse.ok) {
        const status = lyriaResponse.status;
        const errText = await lyriaResponse.text().catch(() => "");
        console.error("Lyria error body:", status, errText);
        if (status === 429) {
          return new Response(
            JSON.stringify({ error: "Music generation rate limited, try again later" }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (status === 402) {
          return new Response(
            JSON.stringify({ error: "Music generation credits exhausted" }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      lyriaResponse = await callLyria(safeFallbackPrompt);
      if (!lyriaResponse.ok) {
        const errText = await lyriaResponse.text().catch(() => "");
        console.error("Lyria fallback error:", lyriaResponse.status, errText);
        return new Response(
          JSON.stringify({ error: "Music generation was blocked by safety filter. Try a different word." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      lyriaData = await lyriaResponse.json();
      audioPart = extractAudio(lyriaData);
    }

    if (!audioPart?.inlineData?.data) {
      console.error("No audio in Lyria response (after retry):", JSON.stringify(lyriaData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Music generation was blocked by safety filter. Try a different word." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Decode base64 to binary
    const audioBytes = Uint8Array.from(
      atob(audioPart.inlineData.data),
      (c) => c.charCodeAt(0)
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
      view.setUint16(20, 1, true); // PCM
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
    console.error("generate-word-jingle error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
