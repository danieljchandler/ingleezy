import { getCorsHeaders } from "../_shared/cors.ts";
// AI Re-segment Transcript
// Takes existing word-level segments and asks an LLM to restructure them into
// thought-by-thought lines, starting a new line on speaker changes. Word
// timings are preserved by anchoring back to the original word objects.
//
// The words are ENGLISH: AdminVideoForm routes uploads to
// `process-english-video`, so this edits an English transcript. It used to
// hunt Arabic discourse markers ("يا أخوي", "شلون") in them and produce an
// English translation of an Arabic line — heuristics that simply never fire on
// English input, so it degraded to timing-only segmentation without ever
// saying so. Now the cues are English, and the two support columns hold what
// the rest of the app puts in them: `translation` is the dialect Arabic, and
// `literal` is that Arabic rearranged into the English word order.


interface Word {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface Segment {
  id: string;
  video_id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
  literal?: string;
  confidence: number;
  words: Word[];
  speaker?: string;
}

interface AILine {
  start: number;
  end: number;
  text: string;
  translation: string;
  literal?: string;
  speaker?: string;
  wordIndices: number[];
}

/**
 * Which Arabic the gloss comes back in.
 *
 * The segmentation cues are English now — that is the transcript's language —
 * but the dialect still has a job here, because the line's support text is
 * written for one particular learner and MSA is not what any of them speak.
 */
const DIALECT_GLOSS: Record<string, string> = {
  Gulf: `Write the Arabic gloss in GULF (Khaleeji) — شلون, وايد, زين. Never MSA, never Egyptian.`,
  Egyptian: `Write the Arabic gloss in EGYPTIAN (مصري) — إزاي, أوي, كويس. Never MSA, never Gulf.`,
  Yemeni: `Write the Arabic gloss in YEMENI (يمني) — كيف, وين, ذحين. Never MSA, never Gulf or Egyptian.`,
};

const ENGLISH_TURN_CUES = `English turn-start cues:
- Acknowledgements and discourse markers, especially standalone: "yeah", "right", "okay", "mm-hmm", "sure", "exactly", "I mean", "so", "well", "anyway", "actually".
- Question openers: "what", "where", "when", "why", "how", "who", "do you", "did you", "are you", "can you", "have you".
- Direct address and names: "hey", "look", "listen", "you know", a name used vocatively.
- Backchannels overlapping the other speaker: "wow", "no way", "really".`;

function buildSystemPrompt(dialect: string | undefined): string {
  const key = dialect && DIALECT_GLOSS[dialect] ? dialect : "Gulf";
  return `You are an expert English transcript editor for Ingleezy, where native Arabic speakers learn English from real clips.

You receive a flattened list of timestamped ENGLISH words from ASR output and must
group them into clean, learner-friendly subtitle lines.

${ENGLISH_TURN_CUES}

LEARNER'S DIALECT: ${key}
${DIALECT_GLOSS[key]}

RULES (in priority order):
1. PRESERVE every original word and its index. Do NOT invent, drop, rewrite, or reorder words.
   Each word must appear in exactly one output line. Word indices must be contiguous within a line.
2. Start a NEW LINE whenever the speaker changes. Use existing speaker tags when present
   ("[A]", "[B]", etc.). When no tags exist, infer speaker changes from:
   - Long pauses between adjacent words (gap > 0.6s)
   - Question/answer alternation (use the question openers above)
   - Direct address, names, or an attention-getter ("hey", "look")
   - Discourse markers from the cues above (treat them as turn-starts when standalone)
   Label speakers "A", "B", "C"... in order of appearance.
3. Each line should express ONE complete thought or clause. Aim for:
   - 2.5–7 seconds of audio
   - 5–16 English words
   - Avoid lines shorter than ~1.2s UNLESS they are a true short utterance from a different speaker
     (e.g. one of the acknowledgements listed above).
4. Break at natural sentence/clause boundaries — never mid-phrase, never between an
   article and its noun, an auxiliary and its verb, or a preposition and its object.
5. PRESERVE the spoken English exactly as transcribed, contractions, false starts and all.
   Do NOT tidy it into written English: what the speaker actually said is the material.
6. Provide a natural ${key} Arabic translation of each line as "translation" — the
   learner's own dialect, never MSA. This is the scaffold, not the subject.
6b. ALSO provide a "literal" word-for-word ARABIC gloss for each line that keeps the
   ENGLISH word order (e.g. "الـ ولد ذهب إلى الـ مدرسة" for "the boy went to the school").
   It may sound stiff in Arabic — that is expected; it shows learners how the English
   sentence is built.
7. The line's start = first word's start, end = last word's end.

Return your answer by calling the resegment_transcript tool with the structured output.`;
}

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "resegment_transcript",
    description: "Return the re-segmented transcript as a list of lines.",
    parameters: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "English text of the line (concatenation of the included words, unchanged).",
              },
              translation: {
                type: "string",
                description: "Natural dialect-Arabic translation of the line — the learner's dialect, never MSA.",
              },
              literal: {
                type: "string",
                description:
                  "Word-for-word Arabic gloss of the line preserving the ENGLISH word order; may sound stiff in Arabic; reveals how the English is built.",
              },
              speaker: {
                type: "string",
                description: "Speaker label (A, B, C...) when distinguishable, otherwise omit.",
              },
              wordIndices: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                description:
                  "Contiguous indices into the input flat words array that make up this line.",
              },
            },
            required: ["text", "translation", "wordIndices"],
            additionalProperties: false,
          },
        },
      },
      required: ["lines"],
      additionalProperties: false,
    },
  },
} as const;

function flattenWords(segments: Segment[]) {
  const flat: Array<{
    idx: number;
    word: string;
    start: number;
    end: number;
    speaker?: string;
    sourceWord: Word;
  }> = [];
  for (const seg of segments) {
    const words = seg.words?.length
      ? seg.words
      : // Fallback: synthesize one "word" from the whole segment text
        [
          {
            word: seg.text,
            start: seg.start,
            end: seg.end,
            confidence: seg.confidence ?? 1,
          },
        ];
    for (const w of words) {
      flat.push({
        idx: flat.length,
        word: w.word,
        start: w.start || seg.start,
        end: w.end || seg.end,
        speaker: seg.speaker,
        sourceWord: w,
      });
    }
  }
  return flat;
}

async function callGateway(
  flat: ReturnType<typeof flattenWords>,
  apiKey: string,
  dialect: string | undefined,
  signal: AbortSignal,
): Promise<AILine[]> {
  const userPayload = {
    dialect: dialect ?? "Gulf",
    words: flat.map((w) => ({
      i: w.idx,
      w: w.word,
      s: Number(w.start.toFixed(3)),
      e: Number(w.end.toFixed(3)),
      ...(w.speaker ? { spk: w.speaker } : {}),
    })),
  };

  const tryModel = async (model: string) => {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(dialect) },
          {
            role: "user",
            content:
              "Re-segment the following ASR words into thought-by-thought lines.\n\n" +
              "```json\n" +
              JSON.stringify(userPayload) +
              "\n```",
          },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "resegment_transcript" } },
      }),
      signal,
    });

    if (!resp.ok) {
      const body = await resp.text();
      const err: any = new Error(`AI gateway ${resp.status}: ${body}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new Error("AI did not return a tool call");
    }
    const parsed = JSON.parse(call.function.arguments) as { lines: AILine[] };
    return parsed.lines ?? [];
  };

  // Flash is fast enough for re-segmentation and stays well under the 150s
  // edge-function idle timeout. Pro was timing out on long transcripts.
  const primary = "google/gemini-3-flash-preview";
  const fallback = "google/gemini-2.5-flash";

  try {
    return await tryModel(primary);
  } catch (e: any) {
    if (e?.status === 429 || e?.status === 402) throw e;
    console.warn("Primary model failed, falling back:", e?.message);
    return await tryModel(fallback);
  }
}

function rebuildSegments(
  aiLines: AILine[],
  flat: ReturnType<typeof flattenWords>,
  videoId: string,
): Segment[] {
  const used = new Set<number>();
  const out: Segment[] = [];

  for (const line of aiLines) {
    const indices = (line.wordIndices ?? [])
      .filter((i) => Number.isInteger(i) && i >= 0 && i < flat.length && !used.has(i))
      .sort((a, b) => a - b);

    if (indices.length === 0) continue;
    indices.forEach((i) => used.add(i));

    const words: Word[] = indices.map((i) => flat[i].sourceWord);
    const start = words[0].start;
    const end = words[words.length - 1].end;
    const avgConf =
      words.reduce((s, w) => s + (w.confidence ?? 1), 0) / words.length;

    out.push({
      id: crypto.randomUUID(),
      video_id: videoId,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      text: line.text?.trim() || words.map((w) => w.word).join(" "),
      translation: line.translation?.trim() ?? "",
      ...(line.literal?.trim() ? { literal: line.literal.trim() } : {}),
      confidence: Number(avgConf.toFixed(3)),
      words,
      ...(line.speaker ? { speaker: line.speaker } : {}),
    });
  }

  // Append any words the AI dropped, grouped contiguously, so nothing is lost.
  const missing: number[] = [];
  for (let i = 0; i < flat.length; i++) if (!used.has(i)) missing.push(i);

  if (missing.length > 0) {
    let group: number[] = [];
    const flushGroup = () => {
      if (group.length === 0) return;
      const words = group.map((i) => flat[i].sourceWord);
      out.push({
        id: crypto.randomUUID(),
        video_id: videoId,
        start: Number(words[0].start.toFixed(3)),
        end: Number(words[words.length - 1].end.toFixed(3)),
        text: words.map((w) => w.word).join(" "),
        translation: "",
        confidence:
          words.reduce((s, w) => s + (w.confidence ?? 1), 0) / words.length,
        words,
      });
      group = [];
    };
    for (const i of missing) {
      if (group.length === 0 || i === group[group.length - 1] + 1) {
        group.push(i);
      } else {
        flushGroup();
        group.push(i);
      }
    }
    flushGroup();
  }

  // Sort final output by start time.
  out.sort((a, b) => a.start - b.start);
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const segments: Segment[] = Array.isArray(body?.segments) ? body.segments : [];
    const dialect: string | undefined = body?.dialect;

    if (segments.length === 0) {
      return new Response(JSON.stringify({ error: "No segments provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const flat = flattenWords(segments);
    if (flat.length === 0) {
      return new Response(JSON.stringify({ error: "Segments contained no words" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const videoId = segments[0]?.video_id ?? "";

    // Smaller chunks processed in parallel so we stay under the 150s
    // edge-function idle timeout even for long transcripts.
    const CHUNK_SIZE = 200; // words per chunk
    const allLines: AILine[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 140_000); // under 150s idle cap

    try {
      if (flat.length <= CHUNK_SIZE) {
        const lines = await callGateway(flat, apiKey, dialect, controller.signal);
        allLines.push(...lines);
      } else {
        const offsets: number[] = [];
        for (let o = 0; o < flat.length; o += CHUNK_SIZE) offsets.push(o);

        const results = await Promise.all(
          offsets.map(async (offset) => {
            const slice = flat.slice(offset, offset + CHUNK_SIZE);
            const reindexed = slice.map((w, i) => ({ ...w, idx: i }));
            const lines = await callGateway(reindexed, apiKey, dialect, controller.signal);
            return lines.map((line) => ({
              ...line,
              wordIndices: (line.wordIndices ?? []).map((i) => i + offset),
            }));
          }),
        );
        for (const chunkLines of results) allLines.push(...chunkLines);
      }
    } finally {
      clearTimeout(timeout);
    }

    const newSegments = rebuildSegments(allLines, flat, videoId);

    return new Response(JSON.stringify({ segments: newSegments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ai-resegment-transcript error:", e);
    const status = e?.status === 429 ? 429 : e?.status === 402 ? 402 : 500;
    const msg =
      status === 429
        ? "Rate limits exceeded, please try again later."
        : status === 402
          ? "Payment required — please add Lovable AI credits."
          : (e?.message ?? "Unknown error");
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
