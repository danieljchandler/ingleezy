// generate-listen-script — Creates a podcast/TED/interview/story script in dialect
// and inserts it into listen_episodes. Returns the new episode row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { askBrain } from "../_shared/aiBrain.ts";
import { primeDialectPrompt, measureTashkeelCoverage, getDialectTransliterationRules, type Dialect } from "../_shared/dialectHelpers.ts";
import { enforceDailyCap } from "../_shared/usageCap.ts";
import { literalSchema } from "../_shared/literalGloss.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { learnerPromptBlock } from "../_shared/learnerProfile.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Format = "podcast" | "ted" | "interview" | "story";
type Length = "short" | "medium" | "long";

const LENGTH_TARGETS: Record<Length, { lines: string; words: string }> = {
  short: { lines: "10-14", words: "150-250" },
  medium: { lines: "18-28", words: "400-600" },
  long: { lines: "32-48", words: "800-1200" },
};

const FORMAT_FRAMING: Record<Format, string> = {
  podcast: `Format: a warm, conversational podcast between TWO hosts (Host A and Host B).
Structure: a quick intro/hook → 2-3 segments exploring the topic with personal anecdotes, jokes, light disagreement, and concrete examples → a short outro.
Tone: natural, spontaneous, peppered with discourse markers (يعني، شوف، صح، والله، طيب) appropriate to the dialect.
Alternate speakers naturally; each line is one short turn (no long monologues).`,
  ted: `Format: a SOLO TED-style talk delivered by one speaker (Speaker).
Structure: a striking opening hook → a personal story or vivid example → the core idea/insight → practical implications → a memorable closing line / call to action.
Tone: passionate, intimate, well-crafted; vary sentence rhythm; use rhetorical questions sparingly.
Every line is one beat of the talk (one short paragraph).`,
  interview: `Format: an INTERVIEW between a Host and a Guest expert (Host and Guest).
Structure: short context intro → 4-7 sharp, specific questions → substantive answers with concrete examples, numbers, or stories → a quick wrap.
Alternate Host (question) and Guest (answer). Questions are curious and probing, not generic. Answers feel lived-in.`,
  story: `Format: a NARRATIVE short story.
Structure: setup (character, place, ordinary moment) → inciting moment → escalation → twist or revelation → quiet resolution.
Use a Narrator for prose lines and named character speakers (e.g., "أم سالم", "خالد") for dialogue. Mix narration with vivid dialogue. Concrete sensory detail. Avoid moralizing.`,
};

interface ScriptLine {
  speaker: string;
  speaker_role: string;
  arabic: string;
  english: string;
  literal?: string;
  transliteration?: string;
}

interface BrainPayload {
  title: string;
  summary: string;
  script: ScriptLine[];
  key_vocabulary: Array<{ arabic: string; english: string; note?: string }>;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cap = await enforceDailyCap(req, "listen_generate", 5, corsHeaders);
    if (cap.limited) return cap.response;
    const userId = cap.userId;

    const body = await req.json().catch(() => ({}));
    const dialect = (body?.dialect as Dialect) || "Gulf";
    const format = (body?.format as Format) || "podcast";
    const topic = String(body?.topic ?? "").trim();
    const topicCategory = body?.topicCategory ? String(body.topicCategory) : null;
    const length = (body?.length as Length) || "medium";
    const audioMode = (body?.audioMode as "full" | "on_demand") || "on_demand";

    if (!topic) {
      return new Response(JSON.stringify({ error: "topic_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["podcast", "ted", "interview", "story"].includes(format)) {
      return new Response(JSON.stringify({ error: "invalid_format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["short", "medium", "long"].includes(length)) {
      return new Response(JSON.stringify({ error: "invalid_length" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await primeDialectPrompt(dialect).catch(() => {});

    const target = LENGTH_TARGETS[length];
    const framing = FORMAT_FRAMING[format];

    const YEMENI_FLAVOR = `
YEMENI AUTHENTICITY (CRITICAL — this script is YEMENI, not generic Arabic):
- Use distinctively Yemeni vocabulary and grammar. Avoid Levantine/Gulf/Egyptian fillers.
- Pronouns/forms: use Yemeni forms like "كَيْفْ" / "كِيفْ" (not "شلون"), "أَيْشْ" or "إِيشْ" for "what" (not "إيه" or "شو"), "ذَا/ذِي" for "this", second-person plural "أَنْتُمْ" pronounced colloquially, possessive "حَقّ/حَقَّة" (e.g., "الكِتَابْ حَقِّي").
- Negation: use "مَا ... شْ" pattern is Egyptian — Yemenis usually just say "مَا" before the verb. Use "مُشْ/مَشْ" sparingly, prefer "مَا هُوْشْ" / "مَا هِيْشْ".
- Common Yemeni discourse markers and interjections to sprinkle naturally: "بَسْ", "عَادْ", "خَلَاصْ", "وَاللهْ", "يَا حَيّ", "يَا سَلَامْ", "اللهْ يِسْتُرْ", "اللهْ يِعِينْ", "صَدِّقْ".
- Verb morphology: prefer Yemeni present-tense prefix بِـ is NOT used (that's Levantine/Egyptian). Yemenis say "أَنَا أَرُوحْ" not "أَنَا بَرُوحْ". Future marker is "عَادْ" or just context.
- Cultural texture (use naturally where the topic allows): qat sessions (مَقْيَلْ/تَخْزِينَة), Sana'a old city, Aden, Hadramawt, salta and bint al-sahn food, jambiya, futa, mafraj, Friday gatherings, mountain villages, coffee from Mocha, Yemeni proverbs.
- Names should sound Yemeni: أَحْمَدْ، صَالِحْ، عَبْدُهْ، فَاطِمَةْ، أُمّ عَلِيْ، أَبُو شَوْقِيْ، نَجِيْبَة، حُسَيْنْ.
- DO NOT make it sound like a Gulf khaleeji podcast with Yemeni words sprinkled in. The whole rhythm, references, and worldview should feel Yemeni.
`;

    const EGYPTIAN_FLAVOR = `
EGYPTIAN AUTHENTICITY (CRITICAL — this script is EGYPTIAN, not generic Arabic):
- Use distinctively Egyptian vocabulary and grammar. Avoid Gulf/Levantine/Yemeni patterns.
- Pronouns/forms: use Egyptian forms like "إزَيَّكْ" / "إزَيِّكْ" (not "شلونك" or "كيفك"), "إِيهْ" for "what" (not "شو" or "أيش"), "دَهْ/دِي" for "this/that", "بْتَاعْ/بْتَاعِتْ" for possession.
- Negation: use "مِشْ" or "مَـ...شْ" circumfix (e.g., "مَابِيْعْرَفْشْ", "مِشْ عَارِفْ").
- Present tense: use the بِـ prefix (e.g., "بِيْرُوحْ", "بَتِتْكَلِّمْ") — this is distinctive of Egyptian.
- Common Egyptian discourse markers and fillers: "يَعْنِي", "بَقَى", "أَصْلْ", "طَبْ", "خَلَاصْ", "بَصْ", "كِدَهْ", "مَاشِي", "أَهُوْ", "يَا سَلَامْ".
- Future marker: "هَـ" prefix (e.g., "هَارُوحْ", "هَاتْعَلِّمْ").
- Cultural texture (use naturally where the topic allows): Cairo life, ahwa (coffee shops), koshari, ful and ta3meya, Nile, Upper Egypt (الصَّعِيدْ), Ramadan fanous, Egyptian humor, sha3bi music, football, Alexandria, Egyptian cinema.
- Names should sound Egyptian: مُحَمَّدْ، أَحْمَدْ، فَاطْمَة، نُورْهَانْ، عَمّ حَسَنْ، أُمّ كَرِيمْ، تَامِرْ، هَبَة.
- DO NOT make it sound like a Gulf podcast with Egyptian words sprinkled in. The whole rhythm, humor, references, and worldview should feel genuinely Egyptian.
`;

    const dialectFlavor = dialect === "Yemeni" ? YEMENI_FLAVOR : dialect === "Egyptian" ? EGYPTIAN_FLAVOR : "";

    // Condition the script on what this learner actually knows, so an episode is
    // listenable input rather than a wall of unfamiliar vocabulary. Interests are
    // excluded — the topic is already chosen explicitly by the caller.
    const learnerBlock = await learnerPromptBlock({
      userId: cap.userId,
      dialect,
      includeInterests: false,
    });

    const systemExtra = `You are a creative writer producing engaging spoken-word content in dialect Arabic.

${framing}

LENGTH: Produce ${target.lines} lines, totaling ${target.words} Arabic words across all lines.
TOPIC: "${topic}"

DIALECT RULES (CRITICAL):
- Every Arabic line MUST be in the target dialect (${dialect}) — never Modern Standard Arabic.
- No cross-dialect leakage (e.g., do not use Egyptian forms in a Gulf script).
- Speaker labels should be short and natural in the target culture.
${dialectFlavor}

TASHKEEL (CRITICAL FOR TTS PRONUNCIATION):
- Every Arabic line MUST be FULLY VOCALIZED with tashkeel (fatha, kasra, damma, sukun, shadda, tanween) on every consonant where a vowel applies.
- Example: write "مَرْحَبًا يَا جَمَاعَة، شُو أَخْبَارْكُمْ" — NOT "مرحبا يا جماعة، شو أخباركم".
- This is mandatory so the TTS engine pronounces dialect words correctly. Missing tashkeel = wrong pronunciation.
- Apply tashkeel to the dialect spellings (do NOT force MSA forms just to add diacritics).
- key_vocabulary.arabic must also be fully vocalized.

OUTPUT:
- title: a short, catchy Arabic title (≤ 60 chars), fully vocalized.
- summary: a one-sentence English teaser (≤ 140 chars).
- script: array of lines, each { speaker, speaker_role, arabic, english, literal, transliteration? }.
  - speaker_role: one of "host_a","host_b","speaker","host","guest","narrator","character".
  - arabic: the line in target dialect, FULLY VOCALIZED with tashkeel.
  - english: faithful natural English translation.
  - literal: word-for-word English gloss preserving Arabic word order (may sound stiff; shows how the line is built).
  - transliteration: optional simple Latin transliteration.
- key_vocabulary: 8-15 useful words or short phrases drawn from the script: { arabic, english, note? } — pick learner-valuable items, not function words. arabic must be fully vocalized.

${getDialectTransliterationRules(dialect)}

Return ONLY the structured fields via the provided tool.

${learnerBlock}`;

    const userPrompt = `Write the ${format} now about: ${topic}. Make it genuinely interesting — surprising angles, concrete details, real emotion.`;

    let brain;
    try {
      brain = await askBrain<BrainPayload>({
        purpose: "story",
        dialect,
        strategy: "solo",
        models: ["google/gemini-2.5-flash"],
        systemPromptExtra: systemExtra,
        userPrompt,
        maxTokens: 8000,
        temperature: 0.8,
        arabicTextPath: (p: any) =>
          Array.isArray(p?.script) ? p.script.map((l: any) => l?.arabic ?? "").join("\n") : "",
        tool: {
          name: "emit_episode",
          description: "Return the full dialect-Arabic script with translations and key vocabulary.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              script: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    speaker: { type: "string" },
                    speaker_role: { type: "string" },
                    arabic: { type: "string" },
                    english: { type: "string" },
                    literal: literalSchema("line"),
                    transliteration: { type: "string" },
                  },
                  required: ["speaker", "speaker_role", "arabic", "english"],
                },
              },
              key_vocabulary: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    arabic: { type: "string" },
                    english: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["arabic", "english"],
                },
              },
            },
            required: ["title", "summary", "script", "key_vocabulary"],
          },
        },
      });
    } catch (e: any) {
      console.error("listen-script brain error", e?.status, e?.message);
      return new Response(
        JSON.stringify({ error: "ai_failed", detail: String(e?.message ?? e).slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = brain.output;
    const script = Array.isArray(parsed.script) ? parsed.script.filter((l) => l?.arabic) : [];
    if (script.length < 4) {
      return new Response(
        JSON.stringify({ error: "empty_script", raw: brain.raw.slice(0, 400) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title = String(parsed.title ?? "").slice(0, 200) || topic.slice(0, 200);
    const summary = String(parsed.summary ?? "").slice(0, 500);
    const keyVocab = Array.isArray(parsed.key_vocabulary) ? parsed.key_vocabulary.slice(0, 20) : [];

    // --- Tashkeel Validation (#6) ---
    // Check if Arabic text has sufficient tashkeel for TTS pronunciation.
    const allArabicText = script.map((l: any) => l.arabic).join("\n");
    const tashkeelCoverage = measureTashkeelCoverage(allArabicText);
    const TASHKEEL_THRESHOLD = 0.7;

    if (tashkeelCoverage < TASHKEEL_THRESHOLD) {
      console.log(`Tashkeel coverage ${(tashkeelCoverage * 100).toFixed(1)}% below ${TASHKEEL_THRESHOLD * 100}% — running tashkeel pass`);
      try {
        const tashkeelResult = await askBrain<{ lines: { arabic: string }[] }>({
          purpose: "utility",
          dialect,
          strategy: "solo",
          skipRepair: true,
          models: ["google/gemini-2.5-flash"],
          systemPromptExtra: `You are a tashkeel specialist. Add full Arabic diacritics (fatha, kasra, damma, sukun, shadda, tanween) to every consonant in the provided dialect Arabic lines. Preserve the dialect forms exactly — do NOT convert to MSA. Return the vocalized lines in the same order via the tool.`,
          userPrompt: `Add full tashkeel to these ${dialect} Arabic lines:\n${script.map((l: any, i: number) => `${i + 1}. ${l.arabic}`).join("\n")}`,
          maxTokens: 4000,
          temperature: 0.2,
          tool: {
            name: "emit_vocalized",
            description: "Return vocalized Arabic lines.",
            parameters: {
              type: "object",
              properties: {
                lines: { type: "array", items: { type: "object", properties: { arabic: { type: "string" } }, required: ["arabic"] } },
              },
              required: ["lines"],
            },
          },
        });
        const vocalizedLines = tashkeelResult.output?.lines;
        if (Array.isArray(vocalizedLines) && vocalizedLines.length === script.length) {
          for (let i = 0; i < script.length; i++) {
            if (vocalizedLines[i]?.arabic) script[i].arabic = vocalizedLines[i].arabic;
          }
          console.log("Tashkeel pass applied successfully");
        }
      } catch (e: any) {
        console.warn("Tashkeel pass failed, proceeding with original:", e?.message);
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: episode, error: saveErr } = await admin
      .from("listen_episodes")
      .insert({
        creator_id: userId,
        dialect,
        format,
        topic,
        topic_category: topicCategory,
        length_bucket: length,
        title,
        summary,
        script,
        key_vocabulary: keyVocab,
        audio_mode: audioMode,
        audio_status: audioMode === "full" ? "pending" : "none",
      })
      .select("*")
      .single();

    if (saveErr || !episode) {
      console.error("listen-script save error", saveErr);
      return new Response(
        JSON.stringify({ error: "save_failed", detail: saveErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Kick off full-audio generation as a background task (non-blocking)
    if (audioMode === "full") {
      const authHeader = req.headers.get("Authorization") ?? "";
      // fire and forget
      fetch(`${SUPABASE_URL}/functions/v1/generate-listen-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({ episodeId: episode.id }),
      }).catch((e) => console.warn("listen-audio dispatch failed:", e?.message));
    }

    return new Response(JSON.stringify({ episode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-listen-script fatal", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
