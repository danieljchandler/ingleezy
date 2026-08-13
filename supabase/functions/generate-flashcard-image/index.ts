import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Free-tier daily cap: 20 image generations / user / day. Paid users bypass.
  // Image generation is one of the priciest per-call features, so paid tiers
  // get a ladder rather than a bypass — this is part of what All-In buys.
  const cap = await enforceDailyCap(req, "generate-flashcard-image", 20, corsHeaders, {
    standard: 60,
    allin: 200,
  });
  if (cap.limited) return cap.response;

  // Authenticate user (auth header presence already verified by usageCap)
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
    console.log(`Authenticated user: ${user.id}`);
    const { word_arabic, word_english, storage_path, custom_instructions } = await req.json();
    
    if (!word_english) {
      return new Response(JSON.stringify({ error: "word_english is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let prompt = `A single realistic, professional photograph of: ${word_english}.
STYLE GUIDE — follow exactly for every image:
- Photo-realistic stock photo style, centered subject
- Warm neutral background: soft beige, cream, or light wood surface
- Soft diffused lighting, slightly warm color temperature
- Clean minimal composition with no clutter or secondary objects
- Subject fills roughly 60-70% of the frame
- Shallow depth of field with gentle bokeh on background
- No text, labels, watermarks, or overlays
- No lens flare, no light shimmer, no sparkles, no glowing dots, no bokeh circles in the foreground
- Consistent color grading: warm highlights, soft shadows
- Matte finish, no glossy or specular highlights on the image surface`;
    
    if (custom_instructions) {
      prompt += `\nAdditional instructions: ${custom_instructions}`;
    }

    console.log(`Generating image for: ${word_english}`);

    // Try Gemini first (chat-completions image shape), then fall back to gpt-image-2
    let imageBase64: string | null = null;

    async function tryGemini(): Promise<string | null> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          }),
        });
        if (response.status === 429) throw new Error("RATE_LIMIT");
        if (!response.ok) {
          console.error(`Gemini attempt ${attempt + 1} HTTP ${response.status}`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        const data = await response.json();
        const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (url) return url;
        console.warn(`Gemini attempt ${attempt + 1}: no image (${data.choices?.[0]?.error?.message ?? "empty"})`);
        await new Promise(r => setTimeout(r, 1500));
      }
      return null;
    }

    async function tryGptImage(): Promise<string | null> {
      try {
        const response = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-image-2",
            prompt,
            size: "1024x1024",
            quality: "low",
            n: 1,
          }),
        });
        if (!response.ok) {
          console.error(`gpt-image-2 fallback HTTP ${response.status}: ${await response.text()}`);
          return null;
        }
        const data = await response.json();
        const b64 = data.data?.[0]?.b64_json;
        return b64 ? `data:image/png;base64,${b64}` : null;
      } catch (err) {
        console.error("gpt-image-2 fallback error:", err);
        return null;
      }
    }

    try {
      imageBase64 = await tryGemini();
    } catch (e) {
      if (e instanceof Error && e.message === "RATE_LIMIT") {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    if (!imageBase64) {
      console.log("Gemini failed, falling back to gpt-image-2");
      imageBase64 = await tryGptImage();
    }

    if (!imageBase64) {
      // Graceful failure so batch callers don't crash on a single word
      return new Response(JSON.stringify({
        success: false,
        error: "IMAGE_GENERATION_FAILED",
        fallback: true,
        message: `Could not generate image for "${word_english}" — please try again or use a custom prompt.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload directly to storage from the edge function
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Decode base64 to binary
    const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryStr = atob(base64Clean);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const finalPath = storage_path || `tutor/${user.id}/${crypto.randomUUID()}.png`;
    
    const { error: uploadError } = await supabaseAdmin.storage
      .from("flashcard-images")
      .upload(finalPath, bytes, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("flashcard-images")
      .getPublicUrl(finalPath);

    console.log(`Successfully generated and uploaded image for: ${word_english} -> ${urlData.publicUrl}`);

    return new Response(JSON.stringify({ success: true, imageUrl: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-flashcard-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
