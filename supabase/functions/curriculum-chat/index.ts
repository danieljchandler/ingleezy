import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { planCoverage, type CoveragePlan } from "../_shared/coveragePlanner.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { detectMsaLeaks } from "../_shared/msaLeakDetector.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const FANAR_ENDPOINT = "https://api.fanar.qa/v1/chat/completions";

interface ModelConfig {
  endpoint: string;
  model: string;
  keyEnv: string;
}

// Model IDs come from _shared/modelRegistry.ts so a registry bump propagates
// here instead of leaving this admin tool pinned to a stale generation. Keys
// are what the ModelSelector sends; the `model` field is what goes over the
// wire. Keep this in sync with MODEL_OPTIONS in
// src/components/admin/curriculum-builder/ModelSelector.tsx — an option the
// selector offers but this map lacks fails with "Unknown model".
const openRouter = (model: string): ModelConfig =>
  ({ endpoint: OPENROUTER_ENDPOINT, model, keyEnv: "OPENROUTER_API_KEY" });
const lovable = (model: string): ModelConfig =>
  ({ endpoint: LOVABLE_GATEWAY, model, keyEnv: "LOVABLE_API_KEY" });

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  [MODEL_IDS.GEMINI_FAST]: lovable(MODEL_IDS.GEMINI_FAST),
  [MODEL_IDS.GEMINI_FLASH]: lovable(MODEL_IDS.GEMINI_FLASH),
  [MODEL_IDS.GEMINI_PRO]: lovable(MODEL_IDS.GEMINI_PRO),
  "google/gemini-2.5-flash": lovable("google/gemini-2.5-flash"),
  // Selector sends the hyphenated id; OpenRouter resolves the dotted one —
  // the hyphen form 404s on that route.
  "anthropic/claude-sonnet-4-5": openRouter(MODEL_IDS.CLAUDE),
  [MODEL_IDS.CLAUDE]: openRouter(MODEL_IDS.CLAUDE),
  [MODEL_IDS.QWEN]: openRouter(MODEL_IDS.QWEN),
  "qwen/qwen3-235b-a22b": openRouter("qwen/qwen3-235b-a22b"),
  [MODEL_IDS.SABA]: openRouter(MODEL_IDS.SABA),
  "google/gemma-3-12b-it": openRouter("google/gemma-3-12b-it"),
  fanar: { endpoint: FANAR_ENDPOINT, model: MODEL_IDS.FANAR, keyEnv: "FANAR_API_KEY" },
};

const DIALECT_CONTEXT: Record<string, string> = {
  Gulf: "general Gulf Arabic (Khaleeji) — covering shared vocabulary and grammar across all six GCC states",
  Saudi: "Saudi Arabian Arabic — Najdi and Hejazi dialects, using Saudi-specific vocabulary (e.g., إيش for 'what', وش for 'what' in Najdi)",
  Kuwaiti: "Kuwaiti Arabic — using Kuwaiti-specific vocabulary (e.g., شنو for 'what', شلونك for 'how are you')",
  Emirati: "Emirati Arabic — UAE dialect with Emirati-specific vocabulary (e.g., شحالك for 'how are you', هيه for 'yes')",
  Bahraini: "Bahraini Arabic — using Bahraini-specific expressions and pronunciation patterns",
  Qatari: "Qatari Arabic — using Qatari-specific vocabulary and expressions",
  Omani: "Omani Arabic — using Omani-specific vocabulary and expressions, noting regional variations within Oman",
  Egyptian: "Egyptian Arabic (مصري) — Cairo dialect as the standard, using Egyptian-specific vocabulary (e.g., إزيك for 'how are you', فين for 'where', دلوقتي for 'now', عايز for 'want', كويس for 'good', ماشي for 'okay', يلا for 'let's go', حاضر for 'ready/sure', بتاع for 'belonging to'). Do NOT use Gulf Arabic vocabulary.",
  Yemeni: "Yemeni Arabic (يمني) — Sana'ani dialect as the standard, using Yemeni-specific vocabulary (e.g., كيفك for 'how are you', وين for 'where', ذحين for 'now', بغيت for 'want', زين for 'good', قات for 'qat', مفرج for 'sitting room', جنبية for 'dagger'). Do NOT use Gulf or Egyptian Arabic vocabulary.",
};

// ─── MODE-SPECIFIC JSON SCHEMAS ─────────────────────────

const MODE_INSTRUCTIONS: Record<string, string> = {
  generate_lesson: `
IMPORTANT: Generate a structured lesson. Include a JSON code block:

\`\`\`json
{
  "type": "lesson_preview",
  "lesson": {
    "title": "Lesson title in English",
    "title_arabic": "عنوان الدرس",
    "description": "Brief description",
    "duration_minutes": 20,
    "cefr_target": "A1",
    "approach": "Teaching approach",
    "icon": "📚",
    "vocabulary": [
      { "word_arabic": "كلمة", "word_english": "word", "transliteration": "kilma", "category": "noun", "teaching_note": "", "image_scene_description": "" }
    ],
    "cultural_notes": "Cultural context",
    "dialect_notes": "Dialect variations"
  }
}
\`\`\``,

  generate_vocab: `
IMPORTANT: Generate vocabulary words. Include a JSON code block:

\`\`\`json
{
  "type": "vocab_preview",
  "vocabulary": [
    { "word_arabic": "كلمة", "word_english": "word", "transliteration": "kilma", "category": "noun", "teaching_note": "", "image_scene_description": "" }
  ],
  "dialect_notes": "How these words vary across Gulf countries"
}
\`\`\``,

  generate_grammar: `
IMPORTANT: Generate grammar drill exercises. Include a JSON code block with 5-10 questions:

\`\`\`json
{
  "type": "grammar_preview",
  "category": "verb-conjugation|pronouns|negation|possessives|questions|sentence-structure",
  "difficulty": "beginner|intermediate|advanced",
  "exercises": [
    {
      "question_arabic": "اختر الإجابة الصحيحة: أنا ___ إلى السوق",
      "question_english": "Choose the correct answer: I ___ to the market",
      "grammar_point": "verb conjugation - past tense",
      "choices": [
        { "text_arabic": "رحت", "text_english": "I went" },
        { "text_arabic": "راح", "text_english": "He went" },
        { "text_arabic": "رحنا", "text_english": "We went" },
        { "text_arabic": "رحتي", "text_english": "You (f) went" }
      ],
      "correct_index": 0,
      "explanation": "For 'I' (أنا) in past tense, we use رحت (ruht)"
    }
  ]
}
\`\`\``,

  generate_listening: `
IMPORTANT: Generate listening exercise content. Include a JSON code block with 3-5 exercises:

\`\`\`json
{
  "type": "listening_preview",
  "mode": "dictation|comprehension|speed",
  "difficulty": "beginner|intermediate|advanced",
  "exercises": [
    {
      "audio_text": "وين تبي تروح اليوم؟",
      "audio_text_english": "Where do you want to go today?",
      "hint": "A question about plans",
      "options": [
        { "text": "He's asking about your destination", "textArabic": "يسأل عن وجهتك", "correct": true },
        { "text": "He's asking about food", "textArabic": "يسأل عن الأكل", "correct": false },
        { "text": "He's asking about the weather", "textArabic": "يسأل عن الطقس", "correct": false }
      ]
    }
  ]
}
\`\`\``,

  generate_reading: `
IMPORTANT: Generate a reading passage with comprehension questions. Include a JSON code block:

\`\`\`json
{
  "type": "reading_preview",
  "difficulty": "beginner|intermediate|advanced",
  "passage": {
    "title": "عنوان القصة",
    "title_english": "Story Title",
    "passage": "النص العربي الكامل...",
    "passage_english": "Full English translation...",
    "vocabulary": [
      { "arabic": "كلمة", "english": "word", "inContext": "الكلمة في جملة" }
    ],
    "questions": [
      {
        "question": "سؤال بالعربي؟",
        "questionEnglish": "Question in English?",
        "options": [
          { "text": "إجابة ١", "textEnglish": "Answer 1", "correct": true },
          { "text": "إجابة ٢", "textEnglish": "Answer 2", "correct": false }
        ]
      }
    ],
    "cultural_note": "Cultural context about the passage"
  }
}
\`\`\``,

  generate_daily_challenge: `
IMPORTANT: Generate a daily challenge set with mixed question types. Include a JSON code block:

\`\`\`json
{
  "type": "daily_challenge_preview",
  "challenge_type": "vocab|grammar|mixed",
  "difficulty": "beginner|intermediate|advanced",
  "title": "Challenge Title",
  "title_arabic": "عنوان التحدي",
  "questions": [
    {
      "type": "translate",
      "prompt": "How do you say 'hello' in Gulf Arabic?",
      "answer": "هلا",
      "options": ["هلا", "مرحبا", "سلام", "أهلاً"],
      "hint": "Common informal greeting"
    },
    {
      "type": "fill-blank",
      "sentence": "أنا ___ من الكويت",
      "sentenceEnglish": "I am ___ from Kuwait",
      "answer": "أكون",
      "hint": "verb 'to be'"
    },
    {
      "type": "unscramble",
      "scrambled": "السوق إلى رحت",
      "answer": "رحت إلى السوق",
      "hint": "I went to the market"
    }
  ]
}
\`\`\``,

  generate_conversation: `
IMPORTANT: Generate a conversation scenario for practice. Include a JSON code block:

\`\`\`json
{
  "type": "conversation_preview",
  "scenario": {
    "title": "Scenario Title",
    "title_arabic": "عنوان السيناريو",
    "description": "Brief description of the scenario",
    "difficulty": "Beginner|Intermediate|Advanced",
    "icon_name": "Coffee|MapPin|ShoppingBag|Users|UtensilsCrossed|Building2|Stethoscope|Phone|Plane|MessageCircle",
    "system_prompt": "You are a [role] at [location]. Speak ONLY in Gulf Arabic ([dialect] dialect). Keep responses short (1-2 sentences). Start by [opening]. After each Arabic response, add a line break then provide the English translation in parentheses.",
    "example_exchanges": [
      { "role": "assistant", "content": "هلا والله! شلونك؟\n(Hello! How are you?)" },
      { "role": "user", "content": "الحمد لله بخير" }
    ]
  }
}
\`\`\``,

  suggest_lessons: `
IMPORTANT: The admin is brainstorming. Do NOT generate full lesson content and do NOT include any \`\`\`json code blocks.
Instead, propose 6-10 distinct LESSON IDEAS appropriate for the target dialect and stage/CEFR.
Format the response as a markdown numbered list. For each idea include:
- **Title** (English) — *Arabic title*
- One short sentence describing the focus and what learners will be able to do
- A "Why" note (1 line) explaining why it fits the stage / learner needs
End with a short prompt telling the admin they can reply with the number (e.g. "Build #3") to generate the full lesson.`,

  suggest_vocab: `
IMPORTANT: The admin is brainstorming vocabulary themes. Do NOT generate full vocab lists and do NOT include any \`\`\`json code blocks.
Instead, propose 6-10 distinct VOCAB SET IDEAS (themes/categories) appropriate for the target dialect and stage/CEFR.
Format as a markdown numbered list. For each idea include:
- **Theme** (English) — *Arabic label*
- A short sentence describing the use case (where/when learners need these words)
- 3-5 example words in the target dialect (Arabic + transliteration + English) as a sub-list
End with a short prompt telling the admin they can reply with the number (e.g. "Generate #2") to produce the full vocab set.`,

  generate_game_set: `
IMPORTANT: Generate a vocabulary game set with word pairs. Include a JSON code block:

\`\`\`json
{
  "type": "game_set_preview",
  "game_type": "matching|memory|fill-blank",
  "title": "Game Set Title",
  "difficulty": "beginner|intermediate|advanced",
  "word_pairs": [
    { "word_arabic": "كتاب", "word_english": "book" },
    { "word_arabic": "قلم", "word_english": "pen" }
  ]
}
\`\`\``,

};

function detectMode(mode: string | undefined, lastUserMessage?: string): string | undefined {
  if (mode && mode !== "chat") return mode;
  if (!lastUserMessage) return mode;
  const msg = lastUserMessage.toLowerCase();
  if (/\b(lesson|create.*lesson|build.*lesson|make.*lesson)\b/.test(msg)) return "generate_lesson";
  if (/\b(vocab|vocabulary|words|flashcard)\b/.test(msg)) return "generate_vocab";
  if (/\b(grammar|drill|conjugat|verb form)\b/.test(msg)) return "generate_grammar";
  if (/\b(listen|dictation|audio exercise)\b/.test(msg)) return "generate_listening";
  if (/\b(reading|passage|read)\b/.test(msg)) return "generate_reading";
  if (/\b(daily.*challenge|challenge set)\b/.test(msg)) return "generate_daily_challenge";
  if (/\b(conversation|scenario|role.?play|simulator)\b/.test(msg)) return "generate_conversation";
  if (/\b(game|matching|memory game)\b/.test(msg)) return "generate_game_set";
  
  return mode;
}

function buildSystemPrompt(
  dialect: string,
  stageContext?: { name?: string; cefr?: string },
  mode?: string,
): string {
  const dialectDesc = DIALECT_CONTEXT[dialect] || DIALECT_CONTEXT["Gulf"];
  const stageInfo = stageContext?.name
    ? `\nThe admin is building content for: Stage "${stageContext.name}" (CEFR: ${stageContext.cefr || "unspecified"}).`
    : "";

  const modeInstructions = mode && MODE_INSTRUCTIONS[mode] ? MODE_INSTRUCTIONS[mode] : "";

  const isEgyptian = dialect === "Egyptian";
  const isYemeni = dialect === "Yemeni";
  const appDesc = isEgyptian ? "an Egyptian Arabic learning module" : isYemeni ? "a Yemeni Arabic learning module" : "a Gulf Arabic learning app";

  const isSuggestMode = mode === "suggest_lessons" || mode === "suggest_vocab";

  // Always include all available JSON schemas so the AI knows the formats
  const allFormats = isSuggestMode ? `
CRITICAL: This is a BRAINSTORM/SUGGESTION request. Do NOT include any \`\`\`json code blocks. Respond with a clean markdown list of ideas only.` : `
CRITICAL INSTRUCTION: When the admin asks you to CREATE, GENERATE, or BUILD any content, you MUST include a properly formatted JSON code block in your response. Without it, the content cannot be saved to the platform.

Available output formats (use the one matching the request):
${Object.entries(MODE_INSTRUCTIONS).filter(([k]) => !k.startsWith('suggest_')).map(([k, v]) => `### When asked to ${k.replace('generate_', '')}:\n${v}`).join('\n\n')}

REMEMBER: Always include the \`\`\`json code block when generating content. The "type" field inside the JSON determines which preview card appears. Without this JSON block, the admin cannot approve and save the content.`;
  
  return `You are an expert ${isEgyptian ? "Egyptian" : isYemeni ? "Yemeni" : "Gulf"} Arabic curriculum designer and language teacher. You are helping an admin build lessons and vocabulary for "Hakiya" (حكية), ${appDesc}.

Target dialect: ${dialectDesc}
${stageInfo}

The Hakiya curriculum has 6 stages:
1. Foundations (Pre-A1 → A1): 50+ survival phrases, Arabic script, Gulf sounds. 4–6 weeks.
2. Building Blocks (A1 → A2): Basic sentences, slow Gulf speech, 500+ words. 8–12 weeks.
3. The Bridge (A2 → B1): Authentic content with scaffolding, familiar topics, 1,500+ words. 8–16 weeks.
4. Immersion (B1 → B2): Primary learning through authentic content, opinions, 3,000+ words. 12–20 weeks.
5. Fluency (B2 → C1): Complex discussions, rapid speech, slang, 5,000+ words. 16–24 weeks.
6. Mastery (C1 → C2): Near-native comprehension, cultural fluency, register shifting. Ongoing.

Guidelines:
- CRITICAL: You are building content EXCLUSIVELY for ${isEgyptian ? "Egyptian Arabic (مصري)" : isYemeni ? "Yemeni Arabic (يمني)" : "Gulf Arabic (خليجي)"}. Do NOT mix dialects.
${isEgyptian ? "- Use ONLY Egyptian Arabic vocabulary and grammar (إزيك، فين، دلوقتي، عايز، كويس، ماشي، بتاع، مش). Do NOT use Gulf Arabic terms like شلونك، وين، هالحين." : isYemeni ? "- Use ONLY Yemeni Arabic vocabulary and grammar (كيفك، وين، ذحين، بغيت، زين، مبسوط). Do NOT use Gulf Arabic terms like شلونك، هالحين or Egyptian terms like إزيك، دلوقتي." : "- Use ONLY Gulf Arabic vocabulary and grammar (شلونك، وين، هالحين، أبي/أبغى). Do NOT use Egyptian Arabic terms like إزيك، فين، دلوقتي، عايز."}
- Always use the target dialect's vocabulary and expressions, NOT Modern Standard Arabic (unless explicitly asked).
- Include transliterations that are easy for English speakers to read.
- ${isEgyptian ? "Note when a word/phrase differs between Upper and Lower Egypt." : isYemeni ? "Note when a word/phrase differs between Sana'a, Aden, Hadramaut, and Ta'izz regions." : "Note when a word/phrase differs significantly between Gulf countries."}
- Provide cultural context and usage notes where helpful.
- Organize vocabulary by practical categories (greetings, food, directions, etc.).
- For each vocabulary word, suggest a category: noun, verb, adjective, phrase, or expression.
- Be creative and practical — focus on what learners actually need in real ${isEgyptian ? "Egyptian" : "Gulf"} conversations.
${modeInstructions}

${allFormats}`;
}

async function callLLM(
  config: ModelConfig,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 4096,
): Promise<string> {
  const apiKey = Deno.env.get(config.keyEnv)?.trim();
  if (!apiKey) {
    throw new Error(`API key ${config.keyEnv} not configured`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const body = JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
    });

    const response = await fetch(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 402) {
        throw new Error("Not enough AI credits. Please add credits to your workspace.");
      }
      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment and try again.");
      }
      throw new Error(`LLM ${config.model} error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const content: string | undefined = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`LLM ${config.model} returned empty response`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function extractStructuredOutput(content: string): {
  type: string;
  data: Record<string, unknown>;
} | null {
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonBlockMatch) return null;

  try {
    const parsed = JSON.parse(jsonBlockMatch[1].trim());
    if (parsed && typeof parsed === "object" && parsed.type) {
      return { type: parsed.type, data: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Free-tier daily cap: 30 curriculum-chat calls / user / day. Paid users bypass.
  const cap = await enforceDailyCap(req, "curriculum-chat", 30, corsHeaders);
  if (cap.limited) return cap.response;


  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: roles } = await supabaseAuth
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = roles?.some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const {
      messages,
      model: modelId,
      dialect = "Gulf",
      stage_context: stageContext,
      mode = "chat",
    } = body as {
      messages: Array<{ role: string; content: string }>;
      model: string;
      dialect?: string;
      stage_context?: { name?: string; cefr?: string };
      mode?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = MODEL_REGISTRY[modelId];
    if (!config) {
      return new Response(
        JSON.stringify({
          error: `Unknown model: ${modelId}. Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cappedMessages = messages.slice(-50);
    const lastUserMsg = [...cappedMessages].reverse().find(m => m.role === 'user')?.content;
    const resolvedMode = detectMode(mode, lastUserMsg);
    const systemPrompt = buildSystemPrompt(dialect, stageContext, resolvedMode);

    // Coverage plan — what's already taught, what's due, what's next
    let coveragePlan: CoveragePlan | null = null;
    if (resolvedMode && resolvedMode.startsWith("generate_")) {
      try {
        coveragePlan = await planCoverage({
          dialect,
          cefr: stageContext?.cefr ?? null,
          contentType: resolvedMode.replace("generate_", ""),
        });
      } catch (e) {
        console.warn("coverage plan failed:", e);
      }
    }

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...(coveragePlan ? [{ role: "system", content: coveragePlan.promptBlock }] : []),
      ...cappedMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    console.log(
      `curriculum-chat: model=${modelId} dialect=${dialect} mode=${mode} msgs=${messages.length} coverage=${coveragePlan ? `${coveragePlan.avoid.length}a/${coveragePlan.reinforce.length}r/${coveragePlan.next_up.length}n` : 'none'}`,
    );

    // For content-generation modes, route through AI Brain (council strategy)
    // so multiple models draft + a judge picks the most authentic dialect output.
    // Chat and suggest_* modes keep the single-model path to preserve UX.
    const useBrain =
      resolvedMode?.startsWith("generate_") &&
      // Brain only works for Lovable-gateway-compatible models. Skip native/Fanar/OpenRouter-only.
      config.endpoint === LOVABLE_GATEWAY;

    let responseContent: string;
    if (useBrain) {
      const conversationText = cappedMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");
      try {
        const brain = await askBrain<string>({
          purpose: "lesson_generation",
          dialect: dialect as Dialect,
          userPrompt: conversationText,
          systemPromptExtra: [systemPrompt, coveragePlan?.promptBlock]
            .filter(Boolean)
            .join("\n\n"),
          strategy: "council",
          // Selected model + two complementary drafters; judge is added by the brain.
          models: Array.from(
            new Set([
              modelId,
              "google/gemini-3-flash-preview",
              "google/gemini-2.5-pro",
            ]),
          ).slice(0, 3),
          maxTokens: 4096,
          temperature: 0.5,
        });
        responseContent = brain.raw;
        console.log("curriculum-chat brain", {
          models: brain.models,
          leaks: brain.msaLeaks.leaks.length,
          repairs: brain.msaRepairs,
          latencyMs: brain.totalLatencyMs,
        });
      } catch (e) {
        if (e instanceof BrainHttpError) {
          if (e.status === 402)
            throw new Error("Not enough AI credits. Please add credits to your workspace.");
          if (e.status === 429)
            throw new Error("Rate limit exceeded. Please wait a moment and try again.");
        }
        // Fallback to single-model path so the admin still gets a response.
        console.warn("curriculum-chat brain failed, falling back to single model:", e);
        responseContent = await callLLM(config, fullMessages, 4096);
      }
    } else {
      responseContent = await callLLM(config, fullMessages, 4096);
    }

    // --- MSA Leak Detection + repair for non-brain paths (#8) ---
    // When content didn't go through askBrain, detect leaks and run a single
    // gateway repair pass. Falls back to the original text on failure.
    if (!useBrain) {
      const leakResult = detectMsaLeaks(responseContent, dialect as Dialect);
      if (leakResult.leaks.length > 0) {
        console.warn(
          `curriculum-chat MSA leaks detected (non-brain path): dialect=${dialect} leaks=${leakResult.leaks.join(",")} severity=${leakResult.severity}`,
        );
        try {
          const repairKey = Deno.env.get("LOVABLE_API_KEY")?.trim();
          if (repairKey) {
            const repairSys = `You are a ${dialect} Arabic editor. The text below leaked MSA tokens: ${leakResult.leaks.join(", ")}. Rewrite it in authentic ${dialect} dialect ONLY, preserving any \`\`\`json code blocks and all field values' structure EXACTLY (only rewrite Arabic strings inside). Return ONLY the corrected text — no commentary.`;
            const repairResp = await fetch(LOVABLE_GATEWAY, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${repairKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: repairSys },
                  { role: "user", content: responseContent },
                ],
                temperature: 0.2,
                max_tokens: 4096,
              }),
            });
            if (repairResp.ok) {
              const repairData = await repairResp.json();
              const repaired = repairData?.choices?.[0]?.message?.content;
              if (typeof repaired === "string" && repaired.trim().length > 0) {
                console.log("curriculum-chat: applied MSA repair pass");
                responseContent = repaired;
              }
            } else {
              console.warn("curriculum-chat repair pass HTTP error", repairResp.status);
            }
          }
        } catch (repairErr) {
          console.warn("curriculum-chat repair pass failed:", repairErr);
        }
      }
    }

    const structured = extractStructuredOutput(responseContent);

    // Log the generation request for auditing
    if (coveragePlan) {
      try {
        const svc = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await svc.from("curriculum_generation_log").insert({
          dialect,
          cefr: stageContext?.cefr ?? null,
          content_type: resolvedMode?.replace("generate_", "") ?? null,
          prompt_summary: lastUserMsg?.slice(0, 500) ?? null,
          excluded_concepts: coveragePlan.avoid.map(c => c.id),
          reinforced_concepts: coveragePlan.reinforce.map(c => c.id),
          model: modelId,
          created_by: user.id,
        });
      } catch (e) {
        console.warn("gen log insert failed:", e);
      }
    }

    try {
      const supabaseService = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabaseService.from("llm_usage_logs").insert({
        function_name: "curriculum-chat",
        llm_used: modelId,
        phrase: `[curriculum-chat] mode=${mode} dialect=${dialect} messages=${messages.length}`,
        user_id: user.id,
      });
    } catch (logErr) {
      console.warn("Failed to log LLM usage:", logErr);
    }

    return new Response(
      JSON.stringify({
        content: responseContent,
        model: modelId,
        structured_output: structured?.data ?? null,
        output_type: structured?.type ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("curriculum-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
