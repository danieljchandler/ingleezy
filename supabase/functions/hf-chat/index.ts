import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, 'hf-chat', 40, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { prompt, dialect = 'Gulf', strategy } = await req.json() as {
      prompt: string;
      dialect?: string;
      strategy?: 'solo' | 'ensemble' | 'draft_critic' | 'council';
    };

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await askBrain<string>({
      purpose: 'chat',
      dialect,
      userPrompt: prompt,
      strategy: strategy ?? 'ensemble',
      maxTokens: 1024,
      temperature: 0.3,
      systemPromptExtra: 'You are an expert tutor. Respond accurately using the requested dialect, focusing on authenticity and cultural nuance.',
    });

    const content = typeof result.output === 'string' ? result.output : result.raw;
    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Empty response from model' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        content,
        _meta: { strategy: result.strategy, models: result.models, msaRepairs: result.msaRepairs, msaLeaks: result.msaLeaks.leaks },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[hf-chat] Error:', err);
    if (err instanceof BrainHttpError) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: err.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
