import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getDialectVocabRules, getDialectLabel, getDialectExamples } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { buildLearnerProfile } from "../_shared/learnerProfile.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Free-tier daily cap (anonymous → 401, paid/admin unlimited).
  const cap = await enforceDailyCap(req, "daily-challenge", 20, corsHeaders);
  if (cap.limited) return cap.response;

  try {
    const { userVocab = [], streakDays = 0, dialect = "Gulf", difficulty = "beginner" } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const dialectLabel = getDialectLabel(dialect);
    const dialectRules = getDialectVocabRules(dialect);
    const defaultExamples = getDialectExamples(dialect);

    const dayOfWeek = new Date().getDay();
    const challengeTypes = ["translate", "fill_blank", "unscramble", "match", "dictation", "culture", "speed"];
    const todayType = challengeTypes[dayOfWeek];

    // Source the challenge words from the learner's own deck rather than the
    // client-supplied `userVocab`, which was the whole curriculum shuffled
    // (useAllWords) — so the "daily challenge" routinely quizzed words the
    // learner had never studied. Weak and in-progress words come first: those
    // are the ones worth spending a daily challenge on.
    const learnerWords: string[] = [];
    try {
      const profile = await buildLearnerProfile({
        userId: cap.userId,
        dialect,
        budget: { known: 10, learning: 10, weak: 8 },
      });
      // Weak words also appear in known/learning by design, so dedupe on the
      // Arabic form — otherwise duplicates eat the 15 prompt slots.
      const seen = new Set<string>();
      for (const w of [...profile.weak, ...profile.learning, ...profile.known]) {
        if (seen.has(w.arabic)) continue;
        seen.add(w.arabic);
        learnerWords.push(`${w.arabic} (${w.english})`);
      }
    } catch (e) {
      console.warn("daily-challenge: learner profile unavailable, using defaults:", e);
    }

    const vocabContext = learnerWords.length > 0
      ? learnerWords.slice(0, 15).join(", ")
      : userVocab.length > 0
      ? userVocab.slice(0, 15).map((w: any) => `${w.word_arabic} (${w.word_english})`).join(", ")
      : defaultExamples;

    const streakMultiplier = streakDays >= 7 ? 2.0 : streakDays >= 3 ? 1.5 : 1.0;

    const levelGuidance = difficulty === "advanced"
      ? "Use complex sentences, idioms, and nuanced vocabulary appropriate for advanced learners."
      : difficulty === "intermediate"
      ? "Use moderately complex sentences and vocabulary. Include some challenging words but keep it accessible."
      : "Use simple, common vocabulary and short sentences suitable for beginners.";

    const systemPrompt = `You are a ${dialectLabel} language challenge generator for a daily challenge feature.

${dialectRules}

Student level: ${difficulty}. ${levelGuidance}

IMPORTANT: Return valid JSON only, no markdown.`;

    const cultureContext = dialect === "Egyptian"
      ? "Egyptian culture questions about traditions, food, customs from Egypt (Cairo, Alexandria, Upper Egypt)."
      : dialect === "Yemeni"
      ? "Yemeni culture questions about traditions, food, customs from Yemen (Sana'a, Aden, Hadramaut, Ta'izz). Include قات culture, جنبية, سلتة, بنت الصحن, مفرج traditions."
      : "Gulf Arabic culture questions about traditions, food, customs from the UAE, Saudi, Kuwait, Qatar, Bahrain, and Oman.";

    const prompts: Record<string, string> = {
      translate: `Generate 5 translation challenges using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Translation", "titleArabic": "ترجمة اليوم", "questions": [{"prompt": "English phrase", "answer": "${dialectLabel} answer", "options": ["option 1", "option 2", "option 3"]}] }
Options should include the correct answer plus 2 wrong ones. Shuffle the positions.`,

      fill_blank: `Generate 5 fill-in-the-blank sentences using these words: ${vocabContext}
Return JSON: { "type": "fill_blank", "title": "Fill the Gap", "titleArabic": "أكمل الفراغ", "questions": [{"sentence": "${dialectLabel} sentence with ___ blank", "sentenceEnglish": "English translation", "answer": "missing word", "options": ["option1", "option2", "option3"]}] }`,

      unscramble: `Generate 5 word unscramble challenges using these words: ${vocabContext}
Return JSON: { "type": "unscramble", "title": "Word Scramble", "titleArabic": "ترتيب الحروف", "questions": [{"scrambled": "shuffled Arabic letters with spaces", "answer": "correct Arabic word", "hint": "English meaning"}] }`,

      match: `Generate 5 matching pairs using these words: ${vocabContext}
Return JSON: { "type": "match", "title": "Match Pairs", "titleArabic": "وصّل الكلمات", "questions": [{"arabic": "${dialectLabel} word", "english": "English word"}] }`,

      dictation: `Generate 5 short ${dialectLabel} phrases for dictation using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Daily Dictation", "titleArabic": "إملاء اليوم", "questions": [{"prompt": "English phrase to translate", "answer": "Correct ${dialectLabel}", "options": ["option 1", "option 2", "option 3"]}] }`,

      culture: `Generate 5 ${cultureContext}
Return JSON: { "type": "translate", "title": "Culture Quiz", "titleArabic": "اختبار ثقافي", "questions": [{"prompt": "Cultural question in English", "answer": "Correct answer", "options": ["option 1", "option 2", "option 3"]}] }`,

      speed: `Generate 5 quick-fire ${dialectLabel} vocabulary questions using these words: ${vocabContext}
Return JSON: { "type": "translate", "title": "Speed Round", "titleArabic": "جولة سريعة", "questions": [{"prompt": "What does this mean: ${dialectLabel} word", "answer": "Correct English", "options": ["English option 1", "English option 2", "English option 3"]}] }`,
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_IDS.GEMINI_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompts[todayType] || prompts.translate },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Not enough AI credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let challenge;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        challenge = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse challenge:", e, content);
      const fallbackGreeting = dialect === "Egyptian" ? "أهلاً" : dialect === "Yemeni" ? "مرحبا" : "هلا";
      const fallbackThanks = dialect === "Egyptian" ? "شكراً" : dialect === "Yemeni" ? "مشكور" : "مشكور";
      challenge = {
        type: "translate",
        title: "Daily Challenge",
        titleArabic: "تحدي اليوم",
        questions: [
          { prompt: "Hello", answer: fallbackGreeting, options: [fallbackGreeting, "شكراً", "مع السلامة"] },
          { prompt: "Thank you", answer: fallbackThanks, options: ["هلا", fallbackThanks, "إي"] },
        ],
      };
    }

    return new Response(
      JSON.stringify({ challenge, streakMultiplier, baseXP: 15 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("daily-challenge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
