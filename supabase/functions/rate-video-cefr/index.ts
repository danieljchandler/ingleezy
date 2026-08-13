// Rate a video's difficulty on the CEFR scale (A1-C2) by combining
// objective transcript metrics with an LLM judgement anchored to the
// same descriptors used by the placement quiz.
//
// Two modes, decided by the transcript itself. Lines carrying `english`
// are the app's primary content — English videos rated against an
// English A1/A2 baseline for the Arabic-speaking learner. Lines without
// it are the Hakiya-bridged Arabic immersion clips, rated exactly as the
// Arabic-era function did so bridged content keeps a sane level.
//
// Input:  { videoId: string }  OR  { transcript_lines, duration_seconds, vocabulary, dialect }
// Output: { cefr_level, difficulty, rationale, metrics }
//
// Persists cefr_level/difficulty/difficulty_rationale/difficulty_metrics
// to discover_videos when videoId is provided.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ============================================================
// 1. Pan-dialect A1/A2 baseline (Gulf + Egyptian + Yemeni + MSA).
//    Words OUTSIDE this list count as "rare" lexical items.
//    Each dialect contributes its own everyday core so we don't
//    over-penalise Egyptian/Yemeni transcripts.
// ============================================================
const COMMON_PAN_ARABIC = [
  // ===== Shared / MSA core =====
  // pronouns
  "انا","انت","انتي","هو","هي","نحن","انتم","هم","هما","هذا","هذه","ذلك","تلك","هاد","هاذا","هاي",
  // particles / function words
  "في","من","الى","على","عن","ب","ل","ك","مع","بين","تحت","فوق","قبل","بعد","عند","حتى","يعني","بس","لا","ما","لو","اذا","ان","انه","لكن","او","و","ف","ثم","كمان","برضو","برضه","كده","كذا",
  // shared common verbs
  "كان","صار","يصير","يكون","يجي","جا","راح","يروح","شاف","يشوف","قال","يقول","سمع","يسمع","عرف","يعرف","حب","يحب","عطى","يعطي","اخذ","ياخذ","اكل","ياكل","شرب","يشرب","نام","ينام","قعد","يقعد","عمل","يعمل","فهم","يفهم","قدر","يقدر","لقى","يلقى","طلع","يطلع","دخل","يدخل","خرج","يخرج","رد","يرد","بدا","يبدا","خلص","يخلص","حط","يحط","بقى","يبقى","رجع","يرجع","جاب","يجيب",
  // numbers 1-20
  "واحد","اثنين","ثنين","تنين","اتنين","ثلاث","ثلاثه","تلاته","اربع","اربعه","خمس","خمسه","ست","سته","سبع","سبعه","ثمان","ثمانيه","تمانيه","تسع","تسعه","عشر","عشره",
  // family / people
  "ام","ابو","اب","اخ","اخت","ابن","بنت","ولد","عم","عمه","خال","خاله","جد","جده","صديق","صاحب","رجل","رجال","امراه","طفل","ناس","واحده",
  // home / daily nouns
  "بيت","غرفه","مطبخ","حمام","صاله","باب","شباك","سياره","شارع","سوق","مدرسه","جامعه","شغل","عمل","مكتب","مستشفى","مطعم","فندق","مسجد","بحر","جبل","مدينه","قريه","بلد","دوله","قهوه","عرب","عربي","عربيه",
  // food / drink
  "اكل","طعام","ماء","ماي","ميه","شاي","حليب","لبن","عصير","خبز","عيش","رز","لحم","دجاج","فراخ","سمك","فاكهه","تفاح","موز","برتقال","تمر","سكر","ملح","حلو","شويه",
  // adjectives
  "كبير","صغير","طويل","قصير","حلو","زين","جديد","قديم","حار","بارد","سهل","صعب","غالي","رخيص","قريب","بعيد","سريع","بطيء","مهم","واضح","صحيح","غلط","فاضي","مشغول","تعبان","سعيد","حزين","مرتاح","جوعان","عطشان","كويس","وحش","وحشه","تمام",
  // greetings / interjections / discourse
  "سلام","السلام","عليكم","ورحمه","الله","وبركاته","مرحبا","اهلا","وسهلا","صباح","الخير","مساء","الفل","تسلم","مشكور","شكرا","عفوا","عذرا","يا","هلا","والله","انشاء","ماشاء","استغفر","الحمد","لله","سبحان","تبارك","عيد","مبارك","يلا","تعال","روح","معلوم","اوكي","اوك","اي","ايه","ايوه","ايوا","نعم","لازم","ممكن","يمكن","طب","طيب","خلاص","يلا",
  // pronoun clitics (often appear standalone)
  "هم","هن","نا","كم","كن","ني","ه","ها",

  // ===== Gulf-specific A1/A2 markers =====
  "وش","ايش","شنو","شلون","وين","ليش","الحين","اللحين","شكثر","شكم","يبي","يبغى","بغى","ودي","يسوي","سوى","يبا","الحريم","عيال","شوي","كثير","زين","شين","تو","عشان","لانه","ها","ابا","ابي","اشوف","عاد","تراه","تره","تراني","ها","كل","شي","امس","بكره","بكرا","الليله","الصبح","العصر","المغرب","العشا",

  // ===== Egyptian-specific A1/A2 markers =====
  "ازاي","إزاي","عايز","عايزه","عاوز","عاوزه","عوز","دلوقتي","دلوقت","فين","ليه","كده","كدا","ده","دي","دول","دي","اهو","اهي","ماشي","يلا","بقى","بقا","خالص","قوي","اوي","شويه","حته","حاجه","حاجات","علشان","عشان","لسه","لسا","معلش","معلهش","يعني","بصراحه","صحيح","ابدا","تاني","تانيه","يبقى","عشان","ايوه","لأ","ها","حضرتك","صح","ده","يعني","ابن","بنوته","واحده","واحد","النهارده","امبارح","بكره","بدري","الصبح","بليل","بالليل","ساعه","ساعتين","عربيه","عربيات","حنروح","حنرجع","هانروح","هتروح","حاروح","بيشوف","بيقول","بيعمل","فاكر","فاكره","عارف","عارفه","لازم","ممكن","نفسي","نفسها","معلش","شكلك","ميه","حلاوه","تمام","كويس","كويسه","شوف","شوفي","ابقى","يلا","معايا","معاك","معاه","معاها","عندي","عندك","عنده","عندها","فوق","تحت","قدام","ورا","جنب","علطول",

  // ===== Yemeni-specific A1/A2 markers =====
  "كيف","كيفك","حقي","حقك","حقه","حقها","بزر","بزور","عيال","ولده","ايش","وش","ذي","ذا","تو","شي","شيء","شويه","عاد","معك","معي","معه","معها","بيتنا","ابوي","امي","يبا","ابى","لقاش","فيش","شفش","تعا","تعال","قوام","عقب","عاد","لا تشيل","لا تخاف","يا غالي","يا حبيبي","ذا","هيك","شلون","وين","ليش","حق","بلاش","يلا","معاد","عقبال","كذا","تمام","صح","ابغى","ابي","ودي",
].map(normLemma);

const COMMON_ARABIC = new Set<string>(COMMON_PAN_ARABIC);

// ============================================================
// English A1/A2 baseline for the flipped app's primary content.
// Includes the common inflected forms outright — there is no
// lemmatizer here, so "went" has to be its own entry.
// ============================================================
const COMMON_ENGLISH_LIST = [
  // pronouns + determiners
  "i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","mine","yours","this","that","these","those","a","an","the","some","any","no","every","all","both","each","other","another",
  // function words
  "and","or","but","so","because","if","when","while","then","than","as","of","in","on","at","to","from","with","without","for","about","by","up","down","out","over","under","before","after","between","near","here","there","not","also","too","very","really","just","only","again","now","today","tomorrow","yesterday","always","never","sometimes","often","usually","soon","still","yet","already",
  // question words
  "what","who","where","why","how","which","whose",
  // be/have/do + modals, with forms
  "am","is","are","was","were","be","been","being","have","has","had","having","do","does","did","doing","done","can","could","will","would","shall","should","may","might","must","lets","let",
  // common verbs, with common forms
  "go","goes","went","going","gone","come","comes","came","coming","see","sees","saw","seen","seeing","say","says","said","saying","tell","told","get","gets","got","getting","make","makes","made","making","know","knows","knew","known","think","thinks","thought","take","takes","took","taken","taking","give","gives","gave","given","giving","find","found","want","wants","wanted","need","needs","needed","like","likes","liked","love","loves","loved","help","helps","helped","work","works","worked","working","play","plays","played","playing","eat","eats","ate","eating","drink","drinks","drank","drinking","sleep","slept","live","lives","lived","living","buy","buys","bought","pay","pays","paid","open","opened","close","closed","start","started","stop","stopped","finish","finished","read","reads","reading","write","writes","wrote","written","writing","speak","speaks","spoke","spoken","speaking","talk","talks","talked","talking","listen","listened","listening","hear","hears","heard","look","looks","looked","looking","watch","watched","watching","walk","walked","walking","run","runs","ran","running","sit","sat","stand","stood","wait","waited","waiting","ask","asked","answer","answered","call","called","meet","met","leave","left","stay","stayed","put","puts","use","used","try","tried","feel","felt","turn","turned","keep","kept","bring","brought","show","showed","shown","learn","learned","teach","taught","study","studied","studying",
  // numbers + time
  "one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","twenty","thirty","hundred","thousand","first","second","third","last","next","time","times","day","days","week","weeks","month","months","year","years","hour","hours","minute","minutes","morning","afternoon","evening","night","monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  // people + family
  "man","men","woman","women","boy","girl","child","children","kid","kids","baby","people","person","friend","friends","family","mother","mom","father","dad","brother","sister","son","daughter","husband","wife","uncle","aunt","grandmother","grandfather","name","mr","mrs",
  // places + daily nouns
  "home","house","room","kitchen","bathroom","door","window","car","bus","train","street","road","city","town","country","school","university","class","office","shop","store","market","restaurant","cafe","hotel","hospital","airport","bank","work","job","money","phone","computer","book","books","pen","paper","bag","table","chair","bed","tv","water","sea","beach","mountain","weather","sun","rain","world","thing","things","way","place","side",
  // food + drink
  "food","bread","rice","meat","chicken","fish","fruit","apple","banana","orange","vegetable","egg","milk","juice","tea","coffee","sugar","salt","breakfast","lunch","dinner","cup","glass","plate",
  // adjectives
  "good","bad","big","small","little","new","old","young","long","short","tall","high","low","hot","cold","warm","easy","hard","difficult","cheap","expensive","fast","slow","early","late","near","far","happy","sad","tired","hungry","thirsty","busy","free","nice","great","beautiful","important","right","wrong","same","different","ready","sure","sorry","fine","okay","ok","many","much","more","most","few","less","best","better","favorite",
  // greetings + discourse
  "hello","hi","hey","bye","goodbye","please","thanks","thank","welcome","yes","yeah","yep","maybe","excuse","oh","well","hmm","wow","alright","course","example","mean","means","question","problem",
];

const COMMON_ENGLISH = new Set<string>(COMMON_ENGLISH_LIST);

function normEnglish(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normLemma(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\u0600-\u06FFa-z0-9]/g, "");
}

interface Line {
  english?: string;
  arabic?: string;
  text?: string;
  start_ms?: number;
  end_ms?: number;
}

/**
 * What separates the two rating modes: how a token is normalised, what
 * counts as everyday A1/A2 vocabulary, how long a "long" word is (English
 * spells longer than Arabic writes), and what speech rate reads as fast
 * (English conversation sits around 150 wpm; Arabic transcripts run denser).
 */
interface LanguageProfile {
  norm: (s: string) => string;
  baseline: Set<string>;
  longWordLen: number;
  fastWpm: number;
  briskWpm: number;
  lineText: (line: Line) => string;
}

const ENGLISH_PROFILE: LanguageProfile = {
  norm: normEnglish,
  baseline: COMMON_ENGLISH,
  longWordLen: 8,
  fastWpm: 175,
  briskWpm: 150,
  lineText: (line) => (line.english ?? "").trim(),
};

const ARABIC_PROFILE: LanguageProfile = {
  norm: normLemma,
  baseline: COMMON_ARABIC,
  longWordLen: 7,
  fastWpm: 165,
  briskWpm: 140,
  lineText: (line) => (line.arabic ?? line.text ?? "").trim(),
};

interface Metrics {
  total_tokens: number;
  unique_tokens: number;
  type_token_ratio: number;
  rare_word_ratio: number;          // tokens outside the A1/A2 baseline
  avg_words_per_line: number;
  median_words_per_line: number;
  max_words_per_line: number;
  long_word_ratio: number;          // tokens ≥ 7 chars (morphologically dense)
  words_per_minute: number | null;
  total_lines: number;
  vocab_items_marked_idiomatic: number;
  vocab_items_total: number;
}

function computeMetrics(
  lines: Line[],
  durationSeconds: number | null,
  vocabulary: any[],
  profile: LanguageProfile,
): Metrics {
  const tokensPerLine: number[] = [];
  const allTokens: string[] = [];

  for (const line of lines ?? []) {
    const raw = profile.lineText(line);
    if (!raw) continue;
    const toks = raw
      .split(/\s+/)
      .map(profile.norm)
      .filter((t) => t.length > 0);
    tokensPerLine.push(toks.length);
    allTokens.push(...toks);
  }

  const total = allTokens.length;
  const uniq = new Set(allTokens);
  const rare = allTokens.filter((t) => !profile.baseline.has(t));
  const longWords = allTokens.filter((t) => t.length >= profile.longWordLen);
  const sorted = [...tokensPerLine].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];

  let idiomatic = 0;
  for (const v of vocabulary ?? []) {
    const tags = (v?.tags ?? v?.types ?? []) as string[];
    const note = ((v?.note ?? v?.usage_note ?? "") + "").toLowerCase();
    if (
      (Array.isArray(tags) &&
        tags.some((t) => /idiom|expression|colloquial|slang|saying|proverb/i.test(t))) ||
      /idiom|saying|proverb|expression/.test(note)
    ) {
      idiomatic++;
    }
  }

  return {
    total_tokens: total,
    unique_tokens: uniq.size,
    type_token_ratio: total === 0 ? 0 : +(uniq.size / total).toFixed(3),
    rare_word_ratio: total === 0 ? 0 : +(rare.length / total).toFixed(3),
    avg_words_per_line:
      tokensPerLine.length === 0
        ? 0
        : +(total / tokensPerLine.length).toFixed(2),
    median_words_per_line: median,
    max_words_per_line: tokensPerLine.length ? Math.max(...tokensPerLine) : 0,
    long_word_ratio: total === 0 ? 0 : +(longWords.length / total).toFixed(3),
    words_per_minute:
      durationSeconds && durationSeconds > 0 ? +((total / durationSeconds) * 60).toFixed(1) : null,
    total_lines: tokensPerLine.length,
    vocab_items_marked_idiomatic: idiomatic,
    vocab_items_total: Array.isArray(vocabulary) ? vocabulary.length : 0,
  };
}

// ============================================================
// 2. Deterministic CEFR floor from metrics.
//    The LLM may move up/down by 1 step but cannot ignore the
//    objective signal entirely — this prevents the constant
//    "Intermediate" default the old prompt produced.
// ============================================================
function metricFloor(m: Metrics, profile: LanguageProfile): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" {
  let score = 0;

  // Rare-word density (post-A2 baseline). Heavy weight.
  if (m.rare_word_ratio > 0.65) score += 4;
  else if (m.rare_word_ratio > 0.55) score += 3;
  else if (m.rare_word_ratio > 0.45) score += 2;
  else if (m.rare_word_ratio > 0.30) score += 1;

  // Type/token (lexical variety).
  if (m.type_token_ratio > 0.65) score += 2;
  else if (m.type_token_ratio > 0.50) score += 1;

  // Long words (morphological density).
  if (m.long_word_ratio > 0.30) score += 2;
  else if (m.long_word_ratio > 0.18) score += 1;

  // Avg line length.
  if (m.avg_words_per_line > 11) score += 2;
  else if (m.avg_words_per_line > 8) score += 1;

  // Speech rate (only when known).
  if (m.words_per_minute !== null) {
    if (m.words_per_minute > profile.fastWpm) score += 2;
    else if (m.words_per_minute > profile.briskWpm) score += 1;
  }

  // Idiomatic content.
  if (m.vocab_items_total > 0) {
    const ratio = m.vocab_items_marked_idiomatic / m.vocab_items_total;
    if (ratio > 0.20) score += 2;
    else if (ratio > 0.08) score += 1;
  }

  // Very short audio with almost no rare words → A1
  if (m.total_tokens < 25 && m.rare_word_ratio < 0.30) return "A1";

  if (score <= 1) return "A1";
  if (score <= 3) return "A2";
  if (score <= 5) return "B1";
  if (score <= 8) return "B2";
  if (score <= 11) return "C1";
  return "C2";
}

const CEFR_TO_DIFFICULTY: Record<string, string> = {
  A1: "Beginner",
  A2: "Beginner",
  B1: "Intermediate",
  B2: "Intermediate",
  C1: "Advanced",
  C2: "Expert",
};

// Generic CEFR descriptors — applied identically across dialects.
const CEFR_DESCRIPTORS = `
A1 — Greetings, basic personal info, 1-clause sentences, very common words only, slow clear speech, no idioms.
A2 — Routine topics (family, shopping, work), short connected clauses, mostly common vocabulary, occasional fixed expressions, clear speech.
B1 — Familiar topics handled connectedly, multi-clause sentences, mix of common + less common vocab, some idiomatic dialect markers, normal conversational pace.
B2 — Abstract topics, complex sentences with subordination, dense vocabulary, frequent idiomatic/colloquial compression, fast natural pace.
C1 — Implicit meaning, cultural references, long flexible sentences, specialised vocabulary, heavy dialectal compression, rapid speech.
C2 — Native-level nuance: literature/poetry/technical jargon, very fast informal speech, dense slang, full idiom saturation.
`.trim();

// English descriptors, weighted for what actually trips Arabic-speaking
// learners: phrasal verbs, connected speech, and idiom density.
const CEFR_DESCRIPTORS_EN = `
A1 — Greetings, basic personal info, 1-clause sentences, very common words only, slow clear speech, no phrasal verbs or idioms.
A2 — Routine topics (family, shopping, work), short connected clauses, mostly common vocabulary, a few fixed expressions and simple phrasal verbs, clear speech.
B1 — Familiar topics handled connectedly, multi-clause sentences, mix of common + less common vocab, everyday phrasal verbs and some idiom, normal conversational pace with light connected speech (gonna, wanna).
B2 — Abstract topics, complex sentences with subordination, dense vocabulary, frequent phrasal verbs and idiomatic compression, fast natural pace, regional accent features.
C1 — Implicit meaning, cultural references, long flexible sentences, specialised vocabulary, heavy connected-speech reduction, rapid speech, sarcasm and humour.
C2 — Native-level nuance: wordplay, technical jargon, very fast informal speech, dense slang, full idiom saturation.
`.trim();

// Dialect-specific A1/A2 markers — used to remind the LLM what counts
// as "everyday vocabulary" in each dialect so it doesn't penalise
// normal Egyptian or Yemeni speech as harder than equivalent Gulf.
function dialectHints(dialect: string): string {
  const d = (dialect || "").toLowerCase();
  if (d.includes("egypt"))
    return `Egyptian A1/A2 markers (treat as everyday, not "advanced"): ازاي، عايز، دلوقتي، فين، ليه، كده، ده/دي، يعني، بقى، خالص، اوي، شويه، علشان، لسه، النهارده، امبارح، بكره، كويس، تمام، ايوه، معلش، بيشوف/بيقول/بيعمل، حنروح/هتروح.`;
  if (d.includes("yemen"))
    return `Yemeni A1/A2 markers (treat as everyday): كيف، حق (possessive)، ابغى/ابي، ودي، ايش، وين، ليش، ذا/ذي، بزر/بزور، عيال، شي، شويه، عاد، تعا، قوام، عقب، تو، يا غالي، يا حبيبي.`;
  if (d.includes("gulf") || d.includes("saudi") || d.includes("kuwait") || d.includes("uae") || d.includes("qatar") || d.includes("bahrain") || d.includes("oman"))
    return `Gulf A1/A2 markers (treat as everyday): وش/ايش/شنو، شلون، وين، ليش، الحين، يبي/يبغى/ودي، يسوي، شوي، كثير، زين، شين، عاد، عشان، الحريم، عيال.`;
  return `Standard Arabic A1/A2 markers (treat as everyday): kinship terms, daily greetings, common verbs (راح، شاف، قال، اكل، شرب، نام)، basic adjectives.`;
}


async function llmRate(
  transcript: string,
  metrics: Metrics,
  metricFloorLevel: string,
  dialect: string,
  isEnglish: boolean,
): Promise<{ cefr_level: string; rationale: string }> {
  const intro = isEnglish
    ? `You are rating the difficulty of a short ENGLISH video for Arabic-speaking English learners.`
    : `You are rating the difficulty of a short ${dialect} Arabic video for language learners.`;
  const descriptors = isEnglish ? CEFR_DESCRIPTORS_EN : CEFR_DESCRIPTORS;
  const languageNote = isEnglish
    ? `LEARNER NOTE: The viewers are native Arabic speakers. Weigh the features that cost them most: phrasal verbs, connected-speech reduction (gonna/wanna/lemme), idioms, and fast informal delivery.`
    : `DIALECT NOTE: ${dialectHints(dialect)}`;
  const prompt = `${intro}

Use the CEFR scale (A1-C2) — the same scale the user took the placement quiz on:

${descriptors}

${languageNote}


OBJECTIVE METRICS computed from the full transcript (these are facts, not opinions):
- total tokens: ${metrics.total_tokens}
- unique tokens: ${metrics.unique_tokens}
- type/token ratio: ${metrics.type_token_ratio}
- rare-word ratio (tokens outside common A1/A2 baseline): ${metrics.rare_word_ratio}
- avg words per spoken line: ${metrics.avg_words_per_line}
- max words per line: ${metrics.max_words_per_line}
- long-word ratio (≥7 chars): ${metrics.long_word_ratio}
- speech rate (words/min): ${metrics.words_per_minute ?? "unknown"}
- vocabulary items flagged idiomatic: ${metrics.vocab_items_marked_idiomatic} / ${metrics.vocab_items_total}

A deterministic metric-based floor estimate is: **${metricFloorLevel}**.
You MAY adjust by at most ONE step up or down (e.g. B1 → A2 or B2), but only if the transcript content clearly justifies it.
- Move UP if there are heavy cultural references, specialised topic, sarcasm/implicit meaning, or very rapid speech.
- Move DOWN if despite the metrics the topic is concrete (food, family, greetings) and phrasing is very routine.
Never default to B1 just because you are unsure — pick the level that best matches the rubric.

FULL TRANSCRIPT (the only source of truth for the content):
"""
${transcript.slice(0, 6000)}
"""

Respond ONLY with valid JSON:
{"cefr_level":"A1|A2|B1|B2|C1|C2","rationale":"1-2 sentences referencing concrete evidence from the transcript and metrics"}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const lvl = String(parsed.cefr_level ?? "").toUpperCase();
  if (!["A1", "A2", "B1", "B2", "C1", "C2"].includes(lvl)) {
    return { cefr_level: metricFloorLevel, rationale: "LLM returned invalid level, used metric floor." };
  }
  return { cefr_level: lvl, rationale: String(parsed.rationale ?? "").slice(0, 600) };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const videoId: string | undefined = body.videoId;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let lines: Line[] = body.transcript_lines ?? [];
    let duration: number | null = body.duration_seconds ?? null;
    let vocabulary: any[] = body.vocabulary ?? [];
    let dialect: string = body.dialect ?? "Gulf";

    if (videoId) {
      const { data, error } = await supabase
        .from("discover_videos")
        .select("transcript_lines, duration_seconds, vocabulary, dialect")
        .eq("id", videoId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("video not found");
      lines = (data.transcript_lines as Line[]) ?? [];
      duration = data.duration_seconds ?? null;
      vocabulary = (data.vocabulary as any[]) ?? [];
      dialect = data.dialect ?? "Gulf";
    }

    if (!lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "no transcript lines available" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // English lines mark the app's primary content; a transcript without any
    // is a Hakiya-bridged Arabic clip and keeps the Arabic-era rating path.
    const isEnglish = lines.some((l) => (l.english ?? "").trim().length > 0);
    const profile = isEnglish ? ENGLISH_PROFILE : ARABIC_PROFILE;

    const metrics = computeMetrics(lines, duration, vocabulary, profile);
    const floor = metricFloor(metrics, profile);
    const transcriptText = lines.map((l) => profile.lineText(l)).join(" ");

    let cefr_level = floor;
    let rationale = "Metric-based estimate (LLM unavailable).";
    try {
      const judged = await llmRate(transcriptText, metrics, floor, dialect, isEnglish);
      cefr_level = judged.cefr_level as any;
      rationale = judged.rationale;
    } catch (e) {
      console.error("LLM rating failed, using metric floor:", e);
    }

    const difficulty = CEFR_TO_DIFFICULTY[cefr_level] ?? "Intermediate";

    if (videoId) {
      const { error: updErr } = await supabase
        .from("discover_videos")
        .update({
          cefr_level,
          difficulty,
          difficulty_rationale: rationale,
          difficulty_metrics: metrics as any,
        })
        .eq("id", videoId);
      if (updErr) throw updErr;
    }

    return new Response(
      JSON.stringify({ cefr_level, difficulty, rationale, metrics, metric_floor: floor }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("rate-video-cefr error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
