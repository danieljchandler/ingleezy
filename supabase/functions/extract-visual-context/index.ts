import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";


interface VideoFrame {
  dataUri: string;
  timestampSeconds: number;
}

interface OnScreenTextSegment {
  text: string;
  translation: string;
  transliteration?: string;
  startSeconds: number;
  endSeconds: number;
  confidence: 'high' | 'medium' | 'low';
}

interface VisualContextResult {
  onScreenTextSegments: OnScreenTextSegment[];
  sceneContext: string;
  culturalContext: string;
  detectedDialectCues: string[];
}

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

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

function safeJsonParse<T>(content: string): T | null {
  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch {
    console.error('JSON parse error, content preview:', content.slice(0, 300));
    return null;
  }
}

const VISUAL_CONTEXT_PROMPT = `You are analyzing video frames from an Arabic social media meme (TikTok, Instagram, YouTube Shorts) to help with transcription and translation accuracy.

Output ONLY valid JSON matching this schema:
{
  "onScreenTextSegments": [
    {
      "text": "exact text visible on screen (Arabic or Latin)",
      "translation": "English translation",
      "transliteration": "romanized pronunciation (Arabic only, omit for Latin text)",
      "startSeconds": 0.0,
      "endSeconds": 5.0,
      "confidence": "high"
    }
  ],
  "sceneContext": "1-2 sentence description of the setting and what is happening",
  "culturalContext": "Cultural notes relevant to understanding this content (empty string if nothing notable)",
  "detectedDialectCues": ["visual cues that suggest a specific Gulf country or dialect"]
}

Rules for onScreenTextSegments:
- Include ALL text overlays: POV captions (e.g. "POV: طالب في الجامعة"), subtitles, title cards, stickers, lower thirds, graphics
- "POV:" text is extremely common on TikTok/Instagram — always capture it
- Include BOTH Arabic-script text AND Latin-script text (English, romanized Arabic, etc.)
- Only include text actually visible in the frames — do not infer or guess
- If you are unsure about a word, include the visible characters with confidence "low" rather than omitting the whole overlay
- Estimate timestamps based on which frame(s) the text appears in
- confidence: "high" if text is clear and readable, "medium" if partially visible, "low" if uncertain
- If the same text spans multiple consecutive frames, use a single segment with broader time range
- Exclude platform UI (like/share buttons, app chrome) and invisible watermarks

For sceneContext: describe ONLY what is visibly present in the frames: location, number of people, activity, formal/informal tone. Do not infer relationships, dialogue, location/country, or the joke.
For culturalContext: explain only directly visible cultural signals or the literal role of the on-screen text. If the image alone is insufficient, use an empty string instead of guessing.
For detectedDialectCues: national flags, license plates, TV channel logos, brand signs, architecture, clothing patterns, or any geographic markers suggesting a specific Gulf country.

No additional text outside JSON.`;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
    const { frames, audioDuration, videoTitle, videoId, kickoffProcessing } = body as {
      frames: VideoFrame[];
      audioDuration?: number;
      videoTitle?: string;
      videoId?: string;
      kickoffProcessing?: boolean;
    };

    if (!Array.isArray(frames) || frames.length === 0) {
      return new Response(
        JSON.stringify({ error: 'frames array is required and must not be empty' }),
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

    // Keep the full client sample set. Meme punchlines/captions often appear
    // on the final frame, so do not silently drop the end sample.
    const cappedFrames = frames.slice(0, 16);
    console.log(`extract-visual-context: analyzing ${cappedFrames.length} frames (duration: ${audioDuration}s)`);

    // Build multimodal message: one image_url block per frame + a text block
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    cappedFrames.forEach((frame) => {
      const dataUri = frame.dataUri.startsWith('data:')
        ? frame.dataUri
        : `data:image/jpeg;base64,${frame.dataUri}`;
      userContent.push({ type: 'image_url', image_url: { url: dataUri } });
    });

    const durationNote = audioDuration ? ` (total duration: ${audioDuration}s)` : '';
    const titleNote = videoTitle ? ` titled "${videoTitle}"` : '';
    const timestampList = cappedFrames
      .map((f, i) => `Frame ${i + 1}: ${f.timestampSeconds}s`)
      .join(', ');

    userContent.push({
      type: 'text',
      text: `Analyze these ${cappedFrames.length} sampled frames from an Arabic social media meme${titleNote}${durationNote}.\n\nFrame timestamps: ${timestampList}\n\nPrimary task: OCR every visible on-screen text overlay. Secondary task: describe only visible scene facts. Do not explain the meme or infer context beyond what is visible in these frames.`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    let rawResponse: string;
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: VISUAL_CONTEXT_PROMPT },
            { role: 'user', content: userContent },
          ],
          max_tokens: 4096,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Gemini vision error:', response.status, errText.slice(0, 400));
        if (response.status === 402) throw new Error('AI credits exhausted');
        if (response.status === 429) throw new Error('Rate limit exceeded');
        throw new Error(`AI service error (${response.status})`);
      }

      const data = await response.json();
      rawResponse = data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeout);
    }

    if (!rawResponse) {
      throw new Error('AI returned empty response');
    }

    const parsed = safeJsonParse<VisualContextResult>(rawResponse);
    if (!parsed) {
      throw new Error('Failed to parse AI response');
    }

    // Normalise the result
    const result: VisualContextResult = {
      onScreenTextSegments: Array.isArray(parsed.onScreenTextSegments)
        ? parsed.onScreenTextSegments
            .filter((s: any) => s?.text && String(s.text).trim().length > 0)
            .map((s: any) => ({
              text: String(s.text).trim(),
              translation: String(s.translation ?? '').trim(),
              transliteration: s.transliteration ? String(s.transliteration).trim() : undefined,
              startSeconds: Number(s.startSeconds ?? 0),
              endSeconds: Number(s.endSeconds ?? cappedFrames[cappedFrames.length - 1]?.timestampSeconds ?? 0),
              confidence: (['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium') as 'high' | 'medium' | 'low',
            }))
        : [],
      sceneContext: String(parsed.sceneContext ?? '').trim(),
      culturalContext: String(parsed.culturalContext ?? '').trim(),
      detectedDialectCues: Array.isArray(parsed.detectedDialectCues)
        ? parsed.detectedDialectCues.map(String).filter(Boolean)
        : [],
    };

    console.log(`extract-visual-context: found ${result.onScreenTextSegments.length} on-screen text segments`);

    let processingQueued = false;
    if (videoId) {
      const { data: isAdmin, error: adminError } = await supabaseAuth.rpc('is_admin');
      if (adminError || !isAdmin) {
        return new Response(JSON.stringify({ error: 'Admin access required' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceRoleKey);

      await admin.storage
        .from('video-audio')
        .upload(`${videoId}.visual.json`, JSON.stringify(result), {
          contentType: 'application/json',
          upsert: true,
        });

      const onScreenSummary = result.onScreenTextSegments
        .map((s) => `[${s.startSeconds}s-${s.endSeconds}s] ${s.text}${s.translation ? ` — ${s.translation}` : ''}`)
        .join('\n');
      const visualCulturalContext = [
        onScreenSummary ? `On-screen text:\n${onScreenSummary}` : '',
        result.sceneContext ? `Scene: ${result.sceneContext}` : '',
        result.culturalContext ? `Cultural context: ${result.culturalContext}` : '',
      ].filter(Boolean).join('\n\n');

      await admin
        .from('discover_videos')
        .update({
          cultural_context: visualCulturalContext || 'Meme screen-text extraction found no readable on-screen text. Review the source video manually before publishing.',
          transcription_error: result.onScreenTextSegments.length === 0
            ? 'Meme screen-text extraction found no readable on-screen text.'
            : null,
        })
        .eq('id', videoId);

      if (kickoffProcessing) {
        const kickoff = async () => {
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/process-approved-video`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ videoId }),
            });

            if (!response.ok) {
              const detail = await response.text().catch(() => '');
              await admin.from('discover_videos').update({
                transcription_status: 'failed',
                transcription_error: `Processing kickoff failed (${response.status}): ${detail.slice(0, 500)}`,
              }).eq('id', videoId);
              console.error(`extract-visual-context: processing kickoff failed for ${videoId}`, response.status, detail.slice(0, 300));
            } else {
              await response.text().catch(() => '');
              console.log(`extract-visual-context: processing kicked off for ${videoId}`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await admin.from('discover_videos').update({
              transcription_status: 'failed',
              transcription_error: `Processing kickoff error: ${message}`,
            }).eq('id', videoId);
            console.error(`extract-visual-context: processing kickoff error for ${videoId}`, message);
          }
        };

        processingQueued = true;
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
          EdgeRuntime.waitUntil(kickoff());
        } else {
          kickoff();
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, result, processingQueued }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('extract-visual-context error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
