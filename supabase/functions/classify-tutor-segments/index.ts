import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


interface TimestampedSegment {
  text: string;
  startMs: number;
  endMs: number;
}

interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  index: number;
}

interface ClassifiedCandidate {
  word_text: string;
  word_english: string;
  word_standard?: string;
  sentence_text?: string;
  sentence_english?: string;
  word_start_ms: number;
  word_end_ms: number;
  sentence_start_ms?: number;
  sentence_end_ms?: number;
  confidence: number;
  classification: "CONCRETE" | "ACTION" | "ABSTRACT";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      console.error("Auth failed:", userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const { segments, words: rawWords, dialectModule } = await req.json() as { 
      segments: TimestampedSegment[];
      words?: TranscriptWord[];
      dialectModule?: 'Gulf' | 'Egyptian' | 'Yemeni';
    };
    
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return new Response(JSON.stringify({ error: "No segments provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dialect = (dialectModule === 'Egyptian' || dialectModule === 'Yemeni') ? dialectModule : 'Gulf';
    const dialectLabel = dialect === 'Egyptian' ? 'Egyptian Arabic (مصري)' : dialect === 'Yemeni' ? 'Yemeni Arabic (يمني)' : 'Gulf Arabic (Khaliji)';
    console.log('classify-tutor-segments dialect module:', dialect);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build segment list
    const segmentList = segments.map((s, i) => 
      `[S${i}] "${s.text}" (${s.startMs}-${s.endMs}ms)`
    ).join("\n");

    // Build word-level list if available
    const wordList = rawWords?.length 
      ? "\n\nWord-level timestamps:\n" + rawWords.map((w) => 
          `[W${w.index}] "${w.text}" (${w.startMs}-${w.endMs}ms)`
        ).join("\n")
      : "";

    const systemPrompt = `You are an Arabic language teaching assistant for ${dialectLabel}. You are given timestamped transcript segments (and optionally word-level timestamps) from a tutor-student session where a tutor teaches ${dialectLabel} vocabulary.

IMPORTANT CONTEXT: In these recordings, the tutor typically says a word, then the student(s) repeat it. You must identify ONLY the tutor's first utterance of each vocabulary word, NOT the student's repetition.

Your task:
1. Classify each segment as VOCAB_WORD (1-3 tokens, a vocabulary item), EXAMPLE_SENTENCE (a longer utterance demonstrating usage), or OTHER (filler, greetings, instructions, repetitions by students)
2. Pair each VOCAB_WORD with the nearest EXAMPLE_SENTENCE that demonstrates its usage
3. For each vocabulary word, provide:
   - English translation
   - Optional standard Arabic spelling (if the spoken form differs)
   - A confidence score (0.0-1.0)
   - Classification as CONCRETE (object, animal, food, place), ACTION (verb, activity), or ABSTRACT (function word, greeting, abstract concept)
4. CRITICAL: When word-level timestamps are available, specify the exact word indices (word_start_index and word_end_index) for the tutor's utterance of each vocabulary word. Use ONLY the tutor's first utterance, skip any student repetitions that follow.
5. Treat all Arabic transcription as ${dialectLabel}. Translations and any standard-spelling suggestions must reflect ${dialectLabel} usage — do NOT default to Gulf or another dialect.

Return the results using the extract_candidates tool.`;

    const toolProperties: Record<string, any> = {
      word_segment_index: { type: "number", description: "Index of the VOCAB_WORD segment" },
      word_text: { type: "string", description: "The spoken word/phrase in Arabic" },
      word_english: { type: "string", description: "English translation" },
      word_standard: { type: "string", description: "Standard Arabic spelling if different from spoken" },
      sentence_segment_index: { type: "number", description: "Index of the paired EXAMPLE_SENTENCE segment, or -1 if none" },
      sentence_text: { type: "string", description: "The example sentence in Arabic" },
      sentence_english: { type: "string", description: "English translation of the sentence" },
      confidence: { type: "number", description: "Confidence score 0.0-1.0" },
      classification: { type: "string", enum: ["CONCRETE", "ACTION", "ABSTRACT"], description: "Type of vocabulary item" },
    };

    if (rawWords?.length) {
      toolProperties.word_start_index = { type: "number", description: "Index of the first word-level token (W index) for the tutor's utterance of this vocabulary word" };
      toolProperties.word_end_index = { type: "number", description: "Index of the last word-level token (W index) for the tutor's utterance of this vocabulary word" };
    }

    const requestTools = [
      {
        type: "function",
        function: {
          name: "extract_candidates",
          description: "Extract vocabulary candidates with paired example sentences from transcript segments",
          parameters: {
            type: "object",
            properties: {
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: toolProperties,
                  required: ["word_segment_index", "word_text", "word_english", "confidence", "classification"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      },
    ];

    const userMessage = `Here are the transcript segments:\n\n${segmentList}${wordList}`;

    // Use Gemini via Lovable AI gateway
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        tools: requestTools,
        tool_choice: { type: "function", function: { name: "extract_candidates" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call response from AI");
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const rawCandidates = parsed.candidates || [];

    const candidates: ClassifiedCandidate[] = rawCandidates.map((c: any) => {
      const wordSeg = segments[c.word_segment_index];
      const sentSeg = c.sentence_segment_index >= 0 ? segments[c.sentence_segment_index] : null;

      let wordStartMs = wordSeg?.startMs ?? 0;
      let wordEndMs = wordSeg?.endMs ?? 0;

      if (rawWords?.length && typeof c.word_start_index === "number" && typeof c.word_end_index === "number") {
        const startWord = rawWords.find(w => w.index === c.word_start_index);
        const endWord = rawWords.find(w => w.index === c.word_end_index);
        if (startWord && endWord) {
          wordStartMs = startWord.startMs;
          wordEndMs = endWord.endMs;
        }
      }

      return {
        word_text: c.word_text || wordSeg?.text || "",
        word_english: c.word_english || "",
        word_standard: c.word_standard || undefined,
        sentence_text: c.sentence_text || sentSeg?.text || undefined,
        sentence_english: c.sentence_english || undefined,
        word_start_ms: wordStartMs,
        word_end_ms: wordEndMs,
        sentence_start_ms: sentSeg?.startMs ?? undefined,
        sentence_end_ms: sentSeg?.endMs ?? undefined,
        confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
        classification: ["CONCRETE", "ACTION", "ABSTRACT"].includes(c.classification) ? c.classification : "ABSTRACT",
      };
    }).filter((c: ClassifiedCandidate) => c.word_text.length > 0);

    console.log(`Classified ${candidates.length} candidates from ${segments.length} segments`);

    return new Response(JSON.stringify({ success: true, candidates }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-tutor-segments error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
