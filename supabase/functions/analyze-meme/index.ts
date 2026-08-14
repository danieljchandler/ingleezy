import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { getDialectIdentity, getDialectVocabRules, getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

interface WordToken {
  id: string;
  surface: string;
  standard?: string;
  gloss?: string;
  compoundRef?: string;
}

interface TranscriptLine {
  id: string;
  arabic: string;
  translation: string;
  literal?: string;
  tokens: WordToken[];
}

interface VocabItem {
  arabic: string;
  english: string;
  root?: string;
}

interface GrammarPoint {
  title: string;
  explanation: string;
  examples?: string[];
}

function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function tryRepairJson(text: string): string {
  let s = text.trim();
  // Balance braces/brackets: append missing closers.
  const opens = (s.match(/[{[]/g) || []).length;
  const closes = (s.match(/[}\]]/g) || []).length;
  if (opens > closes) {
    // Best-effort: strip trailing comma/partial value, then close
    s = s.replace(/,\s*"[^"]*$/g, '').replace(/,\s*$/g, '');
    const stack: string[] = [];
    for (const ch of s) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    while (stack.length) s += stack.pop();
  }
  return s;
}

function safeJsonParse<T>(content: string): T | null {
  const candidate = extractJsonObject(content);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      return JSON.parse(tryRepairJson(candidate)) as T;
    } catch {
      console.error('JSON parse error for content:', content.slice(0, 500));
      return null;
    }
  }
}

/**
 * Tokenise the meme's own line, glossed word by word.
 *
 * Post-flip the line is English and `glosses` maps an English word to its
 * Arabic meaning, so the lookup is keyed lowercase — the model returns
 * "Bruh" in the line and "bruh" in the map often enough that an exact match
 * loses half of them. Punctuation is trimmed off the key for the same reason;
 * the surface keeps it so the line still reads as it was written.
 */
function toWordTokens(line: string, glosses: Record<string, string> = {}): WordToken[] {
  const lookup: Record<string, string> = {};
  for (const [k, v] of Object.entries(glosses)) lookup[k.trim().toLowerCase()] = v;
  const words = line.split(/\s+/).filter(Boolean);
  return words.map((surface, idx) => ({
    id: `tok-${generateId()}-${idx}`,
    surface,
    gloss: lookup[surface.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase()],
  }));
}

async function callQwen(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-235b-a22b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Qwen error:', response.status, errText.slice(0, 500));
      throw new Error(`Qwen service error (${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Qwen returned empty response');
    }
    return content;
  } catch (e) {
    console.error('Qwen fetch failed:', e);
    throw new Error('AI analysis failed. Please try again.');
  } finally {
    clearTimeout(timeout);
  }
}


async function callAI(
  systemPrompt: string,
  userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const messages: Array<{ role: string; content: string | typeof userContent }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI error:', response.status, errText.slice(0, 500));
      if (response.status === 402) {
        throw new Error('Not enough AI credits. Please add credits to your workspace at Settings → Workspace → Usage.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }
      throw new Error(`AI service error (${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response');
    }
    return content;
  } catch (e) {
    if (e instanceof Error && (e.message.includes('credits') || e.message.includes('Rate limit') || e.message.includes('AI service'))) {
      throw e; // Re-throw user-facing errors
    }
    console.error('AI fetch failed:', e);
    throw new Error('AI analysis failed. Please try again.');
  } finally {
    clearTimeout(timeout);
  }
}

// The meme is ENGLISH; the dialect identity and vocab rules still lead because
// everything the model *generates* here is Arabic scaffold — the glosses, the
// explanations, the grammar notes. The English is read off the image, never
// written. Field names are inherited from the Arabic-target era: `english` is
// the meme's own text and `arabic` is its gloss.
function buildMemePrompt(dialect: Dialect): string {
  const label = getDialectLabel(dialect);
  return `${getDialectIdentity(dialect)}

${getDialectVocabRules(dialect)}

You are explaining an ENGLISH meme (image or video frames) to a native ${label} Arabic speaker who is learning English. Memes carry the hardest English there is — sarcasm, slang, abbreviations, references — and a learner who can read every word still misses the joke.

Read ALL English text visible in the image(s). Also consider any audio transcript text provided.

Output ONLY valid JSON matching this schema:
{
  "memeExplanation": {
    "casual": "string - fun, casual explanation of what's funny, written in ${label} Arabic (2-3 sentences)",
    "cultural": "string - deeper breakdown of the humour, the reference and the English being played with, written in ${label} Arabic (3-5 sentences)"
  },
  "onScreenText": {
    "rawTranscriptArabic": "string - all ENGLISH text visible on screen, combined (historical field name)",
    "lines": [
      {
        "english": "string - one line/segment of the on-screen ENGLISH, verbatim: same spelling, same capitals, same typos",
        "arabic": "string - natural ${label} Arabic translation of that line",
        "literal": "string - word-for-word Arabic gloss preserving the ENGLISH word order (may sound stiff; shows how the line is built)"
      }
    ],
    "vocabulary": [
      {"english": "string - the word or phrase as it appears", "arabic": "string - its meaning in ${label} Arabic"}
    ],
    "grammarPoints": [
      {"title": "string - short title in ${label} Arabic", "explanation": "string - 1-3 sentences in ${label} Arabic", "examples": ["string - real ENGLISH lines quoted from the meme"]}
    ]
  },
  "glosses": {
    "englishWord": "its meaning in ${label} Arabic"
  }
}

Rules:
- Read ALL English text in the image carefully, including meme captions, overlaid text and watermarks.
- Quote the English VERBATIM. Never fix spelling, capitalisation or grammar — the broken English is often the joke.
- Every Arabic string you write is authentic spoken ${label} Arabic. NEVER Modern Standard Arabic (فصحى).
- Vocabulary: 3-8 useful English words or phrases from the meme, favouring slang, abbreviations and phrasal verbs over easy nouns.
- Grammar points: 1-3 English patterns the meme demonstrates, favouring what Arabic speakers get wrong (articles, the missing "to be", third-person -s, prepositions, word order).
- Glosses: give the ${label} Arabic meaning of EVERY unique English word found.
- If there's no English text visible, set rawTranscriptArabic to empty string and lines to empty array.
- The casual explanation should be fun and relatable.
- The cultural explanation should teach the reference or the wordplay the learner would otherwise read straight past.

No additional text outside JSON.`;
}

function buildAudioPrompt(dialect: Dialect): string {
  const label = getDialectLabel(dialect);
  return `You are processing the ENGLISH audio transcript of a meme video for a native ${label} Arabic speaker learning English.

Output ONLY valid JSON matching this schema:
{
  "lines": [
    {
      "english": "string - one segment of the spoken ENGLISH, verbatim",
      "arabic": "string - natural ${label} Arabic translation",
      "literal": "string - word-for-word Arabic gloss preserving the ENGLISH word order (may sound stiff; shows how the line is built)"
    }
  ],
  "vocabulary": [
    {"english": "string", "arabic": "string - its meaning in ${label} Arabic"}
  ],
  "grammarPoints": [
    {"title": "string - in ${label} Arabic", "explanation": "string - in ${label} Arabic", "examples": ["string - real ENGLISH lines"]}
  ],
  "glosses": {
    "englishWord": "its meaning in ${label} Arabic"
  }
}

Rules:
- Split into segments of 3-12 words each.
- Quote the English VERBATIM — do not tidy the speech.
- Every Arabic string is authentic spoken ${label} Arabic. NEVER MSA.
- Vocabulary: 3-6 useful English words or phrases.
- Grammar points: 1-2 English patterns Arabic speakers trip on.
- Glosses: the ${label} Arabic meaning of EVERY unique English word.

No additional text outside JSON.`;
}


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'analyze-meme', 15, corsHeaders);
  if (cap.limited) return cap.response;

  // Authenticate user
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const body = await req.json();
    const { imageBase64, audioTranscript, isVideo, dialect: dialectRaw } = body;
    const dialect: Dialect = (dialectRaw || 'Gulf') as Dialect;

    if (!imageBase64 && !audioTranscript) {
      return new Response(
        JSON.stringify({ error: 'Must provide imageBase64 or audioTranscript' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // Build vision content for image analysis
    let onScreenResult: any = null;
    let audioResult: any = null;

    // Analyze image(s) with vision
    if (imageBase64) {
      console.log('Analyzing meme image with vision...');

      // Support multiple frames (video) or single image
      const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
      
      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      
      images.forEach((img: string, idx: number) => {
        // Ensure proper data URI format
        const dataUri = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
        userContent.push({
          type: 'image_url',
          image_url: { url: dataUri },
        });
      });

      if (audioTranscript) {
        userContent.push({
          type: 'text',
          text: `Analyze the Arabic meme in these ${images.length > 1 ? 'video frames' : 'image'}.

The audio transcript below is provided ONLY as background context so you can explain the humor accurately. DO NOT copy audio-only text into "onScreenText.lines" — only text that is visibly written/overlaid on the frames belongs there. The spoken audio will be analyzed separately.

Audio transcript (context only):
${audioTranscript}`,
        });
      } else {
        userContent.push({
          type: 'text',
          text: `Analyze the Arabic meme in ${images.length > 1 ? 'these video frames' : 'this image'}. Read all Arabic text visible and explain the humor.`,
        });
      }

      const rawResponse = await callAI(buildMemePrompt(dialect), userContent, LOVABLE_API_KEY, 6000);
      onScreenResult = safeJsonParse<any>(rawResponse);

      if (!onScreenResult) {
        // Retry once with a stricter reminder appended to the user content.
        // Common failure modes: model returns an Arabic refusal ("أعتذر…") or
        // truncated JSON. Give it one more chance with an explicit instruction.
        console.warn('meme vision returned non-JSON, retrying once with stricter prompt');
        const retryContent = Array.isArray(userContent)
          ? [
              ...userContent,
              {
                type: 'text',
                text: 'IMPORTANT: Respond with ONE valid JSON object matching the schema and nothing else. No prose, no apologies, no markdown fences. If you cannot read the meme, still return the JSON with empty strings/arrays.',
              } as any,
            ]
          : `${userContent}\n\nIMPORTANT: Respond with ONE valid JSON object matching the schema and nothing else. No prose, no apologies, no markdown fences. If you cannot read the meme, still return the JSON with empty strings/arrays.`;
        const retryRaw = await callAI(buildMemePrompt(dialect), retryContent, LOVABLE_API_KEY, 6000);
        onScreenResult = safeJsonParse<any>(retryRaw);
      }

      if (!onScreenResult) {
        // Graceful degradation: return a minimal empty structure so the client
        // can still show the audio analysis (if any) and prompt a retry, rather
        // than 500-ing and wasting the upload.
        console.warn('meme vision unparseable after retry — returning empty on-screen result');
        onScreenResult = {
          memeExplanation: { casual: '', cultural: '' },
          onScreenText: { rawTranscriptArabic: '', lines: [], vocabulary: [], grammarPoints: [] },
          glosses: {},
          _parseError: true,
        };
      }
    }

    
    // Also analyze the audio transcript on its own so users get a dedicated
    // spoken-audio section (lines + vocab + grammar). This runs whenever
    // audio text is present — with OR without images — so meme videos that
    // have both on-screen text AND speech show both.
    const audioTranscriptTrimmed = typeof audioTranscript === 'string' ? audioTranscript.trim() : '';
    if (audioTranscriptTrimmed.length >= 3) {
      console.log(`Analyzing audio transcript via AI Brain (${dialect})...`);
      try {
        const brain = await askBrain<any>({
          purpose: 'meme_audio',
          dialect,
          userPrompt: audioTranscriptTrimmed,
          systemPromptExtra: buildAudioPrompt(dialect),
          strategy: 'ensemble',
          maxTokens: 4096,
          temperature: 0.3,
          arabicTextPath: (p: any) => (p?.lines ?? []).map((l: any) => l?.arabic ?? '').join(' '),
        });
        console.log('meme audio brain', { models: brain.models, leaks: brain.msaLeaks.leaks.length, repairs: brain.msaRepairs });
        audioResult = brain.output && typeof brain.output === 'object' ? brain.output : null;
      } catch (e) {
        console.warn('Audio brain analysis failed (non-fatal):', e instanceof BrainHttpError ? e.message : String(e));
        audioResult = null;
      }
    }

    // Build the final structured result
    const result: any = {
      memeExplanation: onScreenResult?.memeExplanation ?? { casual: '', cultural: '' },
      onScreenText: {
        rawTranscriptArabic: onScreenResult?.onScreenText?.rawTranscriptArabic ?? '',
        lines: [] as TranscriptLine[],
        vocabulary: [] as VocabItem[],
        grammarPoints: [] as GrammarPoint[],
      },
    };

    // Process on-screen text lines with tokens. `english` set is what makes
    // the transcript components render the meme's own words on top with the
    // Arabic underneath; a line without it has nothing to teach and is
    // dropped rather than shown as a blank card. `translation` mirrors the
    // scaffold for the components that predate the English path.
    const onScreenGlosses = onScreenResult?.glosses ?? {};
    if (onScreenResult?.onScreenText?.lines) {
      result.onScreenText.lines = onScreenResult.onScreenText.lines
        .filter((l: Record<string, unknown>) => String(l?.english ?? '').trim())
        .map((l: any, idx: number) => ({
          id: `line-${generateId()}-${idx}`,
          english: String(l.english).trim(),
          arabic: String(l.arabic ?? ''),
          translation: String(l.arabic ?? ''),
          literal: String(l.literal ?? '').trim(),
          tokens: toWordTokens(String(l.english).trim(), onScreenGlosses),
        }));
    }

    if (onScreenResult?.onScreenText?.vocabulary) {
      result.onScreenText.vocabulary = onScreenResult.onScreenText.vocabulary
        // english is the item being learned, so an entry without one is a
        // gloss with nothing to gloss.
        .filter((v: any) => v?.english)
        .map((v: any) => ({
          english: String(v.english),
          arabic: String(v.arabic ?? ''),
        }));
    }

    if (onScreenResult?.onScreenText?.grammarPoints) {
      result.onScreenText.grammarPoints = onScreenResult.onScreenText.grammarPoints
        .filter((g: any) => g?.title)
        .map((g: any) => ({
          title: String(g.title),
          explanation: String(g.explanation ?? ''),
          examples: Array.isArray(g.examples) ? g.examples.map(String) : undefined,
        }));
    }

    // Process audio transcript if separate
    if (audioResult) {
      const audioGlosses = audioResult.glosses ?? {};
      result.audioText = {
        // Historical field name: it now holds the spoken English.
        rawTranscriptArabic: audioResult.lines?.map((l: any) => l.english ?? '').join(' ').trim() ?? '',
        lines: (audioResult.lines ?? [])
          .filter((l: Record<string, unknown>) => String(l?.english ?? '').trim())
          .map((l: any, idx: number) => ({
            id: `audio-line-${generateId()}-${idx}`,
            english: String(l.english).trim(),
            arabic: String(l.arabic ?? ''),
            translation: String(l.arabic ?? ''),
            literal: String(l.literal ?? '').trim(),
            tokens: toWordTokens(String(l.english).trim(), audioGlosses),
          })),
        vocabulary: (audioResult.vocabulary ?? [])
          .filter((v: any) => v?.english)
          .map((v: any) => ({
            english: String(v.english),
            arabic: String(v.arabic ?? ''),
          })),
        grammarPoints: (audioResult.grammarPoints ?? [])
          .filter((g: any) => g?.title)
          .map((g: any) => ({
            title: String(g.title),
            explanation: String(g.explanation ?? ''),
            examples: Array.isArray(g.examples) ? g.examples.map(String) : undefined,
          })),
      };
    }

    console.log('Meme analysis complete:', {
      hasExplanation: !!result.memeExplanation.casual,
      onScreenLines: result.onScreenText.lines.length,
      hasAudio: !!result.audioText,
    });

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('analyze-meme error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
