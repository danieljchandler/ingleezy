/**
 * enrich-word-roots — fill in the Arabic root on words that have none.
 *
 * Two decks, chosen by `scope`:
 *
 * - `mine` (default) — the caller's own `user_vocabulary`. Roots have only ever
 *   been written by `word-enrichment`, on the one save path that goes through
 *   it (tapping a word in a text). Anki imports, tutor uploads and flashcard
 *   suggestions all leave `root` null, which is why the "words from the same
 *   root" footnote almost never has anything to say.
 * - `curriculum` — the shared `vocabulary_words`, which gained a `root` column
 *   after every lesson in it had already been authored. **Admin only**: every
 *   learner reads these rows, so a wrong root here is wrong for all of them.
 *
 * This is the catch-up pass, and it is built to be cheap:
 *
 * - **A free pre-pass first.** Multi-word entries, anything without Arabic
 *   letters, and a closed-class stoplist are resolved locally and never reach a
 *   model. Identical surface forms are answered once and fanned out.
 * - **Batches of 40**, so the system prompt is paid for once per forty words
 *   rather than once per word.
 * - **`strategy: 'solo'`**, not the `ensemble` that `word-enrichment` uses. A
 *   definition is a generation with a quality gradient and is worth asking
 *   several models; a root is a lookup with one right answer, and an ensemble
 *   would triple the spend for nothing.
 * - **`skipRepair`**, because the dialect-repair pass has nothing to do on
 *   three consonants.
 *
 * The result is permanent either way. A word with no root — a loanword, a
 * particle, a name — is stored as `''` rather than left null, so a later run
 * skips it instead of paying to be told the same thing again. `rootKey('')` is
 * null on the client, so the sentinel can never display or form a family.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { askBrain, BrainHttpError } from "../_shared/aiBrain.ts";
import { enforceDailyCap, isAdminUser } from "../_shared/usageCap.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import type { Dialect } from "../_shared/dialectHelpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Words per model call. Forty answers of three letters fit well inside maxTokens. */
const BATCH_SIZE = 40;
/** Rows examined per invocation. The client calls again to continue. */
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 300;

/**
 * Closed-class words that have no triliteral root worth showing a learner.
 * Resolving them here costs nothing; sending them costs tokens and invites a
 * model to invent an answer rather than decline.
 */
const NO_ROOT_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "حتى", "بين", "عند", "لكن", "او", "أو",
  "و", "ف", "ب", "ل", "ك", "ثم", "بل", "قد", "لا", "ما", "لم", "لن", "ان", "أن", "إن",
  "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "اللي", "الذي", "التي", "هو", "هي", "انا", "أنا",
  "انت", "أنت", "احنا", "إحنا", "نحن", "هم", "هن", "انتو", "أنتو", "شنو", "وش", "ليش",
  "وين", "متى", "كيف", "كم", "ايش", "إيش", "مو", "مب", "مش", "بس", "كذا", "الحين", "ذحين",
  "يا", "اي", "أي", "نعم", "ايوه", "أيوه", "لأ", "كل", "بعض", "غير", "زي", "مثل",
]);

const ARABIC_LETTER = /[ء-ي]/;
const NON_ROOT_CHAR = /[^ء-ي]/g;
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

interface Candidate {
  id: string;
  word_arabic: string;
}

/** Fold a surface form to a dedupe key, so one answer serves every copy of a word. */
function surfaceKey(word: string): string {
  return word
    .normalize("NFC")
    .replace(DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

/**
 * Decide locally whether a word can have a root at all.
 *
 * Returns `''` when the answer is already known to be "no root", or null when
 * the word has to be asked about. Deciding what *not* to send is where the
 * savings are; guessing the root itself is not attempted here, because a
 * plausible-looking wrong root is indistinguishable from a right one once it is
 * in the column, and a false family is worse than no family.
 */
function resolveLocally(word: string): "" | null {
  const trimmed = word.trim();
  if (!trimmed) return "";
  // A phrase's root, if it has one, belongs to a word inside it — not to the
  // phrase — and joining phrases into families teaches nothing.
  if (/\s/.test(trimmed)) return "";
  if (!ARABIC_LETTER.test(trimmed)) return "";
  // Latin letters or digits mean this is a transliteration, a number, or junk.
  if (/[A-Za-z0-9٠-٩]/.test(trimmed)) return "";
  if (NO_ROOT_WORDS.has(surfaceKey(trimmed))) return "";
  return null;
}

/**
 * Accept a model's answer only if it looks like radicals.
 *
 * Deliberately its own small check rather than a copy of the client's
 * `rootKey`: the client re-canonicalises everything it reads, so exact parity
 * is not required here, and duplicating that function across the Deno/browser
 * boundary would create two things to keep in step for no gain.
 */
function sanitiseRoot(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const letters = raw.normalize("NFC").replace(DIACRITICS, "").replace(NON_ROOT_CHAR, "");
  if (letters.length < 2 || letters.length > 5) return "";
  return letters.split("").join(" ");
}

async function rootsForBatch(batch: string[], dialect: Dialect): Promise<Map<number, string>> {
  const result = await askBrain<{ roots?: Array<{ index: number; root: string }> }>({
    purpose: "vocab_root",
    dialect,
    userPrompt: batch.map((word, i) => `${i + 1}. ${word}`).join("\n"),
    systemPromptExtra:
      "Task: for each numbered Arabic word, return its consonantal root. " +
      'Give the radicals separated by single spaces, e.g. "ك ت ب". ' +
      'Return an EMPTY STRING for loanwords, particles, proper nouns, numerals, and any ' +
      "word with no Arabic root. Never guess — an empty string is always better than a " +
      "root you are not sure of.",
    strategy: "solo",
    skipRepair: true,
    temperature: 0,
    maxTokens: 1024,
    tool: {
      name: "return_roots",
      description: "Return the consonantal root for each numbered Arabic word.",
      parameters: {
        type: "object",
        properties: {
          roots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer", description: "1-based index from the input list" },
                root: {
                  type: "string",
                  description: 'Radicals separated by single spaces, or "" if none',
                },
              },
              required: ["index", "root"],
              additionalProperties: false,
            },
          },
        },
        required: ["roots"],
        additionalProperties: false,
      },
    },
  });

  const byIndex = new Map<number, string>();
  for (const entry of result.output?.roots ?? []) {
    // Explicit indices rather than a positional array: a short or reordered
    // response then skips a word instead of silently assigning word 7's root
    // to word 8, which is the failure mode that would be impossible to notice.
    const index = Number(entry?.index) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= batch.length) continue;
    byIndex.set(index, sanitiseRoot(entry?.root));
  }
  return byIndex;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Runs per day, not words per day: one run covers up to MAX_LIMIT words.
  const cap = await enforceDailyCap(req, "enrich-word-roots", 3, corsHeaders, {
    standard: 10,
    allin: 30,
  });
  if (cap.limited) return cap.response;

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    /**
     * Which deck to work through, and the voice to ask in.
     *
     * Present means "this dialect only". My Words shows the count for the
     * dialect the learner is looking at, so the run has to match it — otherwise
     * a press of "Find roots for 12 words" while viewing Gulf could spend the
     * whole batch on the Egyptian deck, leave the Gulf count untouched, and
     * look like it did nothing. Absent means every dialect, which is what the
     * page's mix-all mode counts.
     */
    const dialect = typeof body.dialect === "string" && body.dialect ? (body.dialect as Dialect) : null;

    /**
     * Whose words to work on.
     *
     * `mine` is the learner's own deck. `curriculum` is the shared
     * `vocabulary_words` table, which every learner reads — so it is
     * admin-only, and a wrong root there is a wrong root for everyone rather
     * than for one person.
     */
    const curriculum = body.scope === "curriculum";
    const lessonId = typeof body.lessonId === "string" ? body.lessonId : null;

    if (curriculum && !(await isAdminUser(cap.userId))) {
      return new Response(JSON.stringify({ error: "admin_required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const table = curriculum ? "vocabulary_words" : "user_vocabulary";
    let query = supabase
      .from(table)
      .select("id, word_arabic")
      .is("root", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (curriculum) {
      if (lessonId) query = query.eq("lesson_id", lessonId);
      if (dialect) query = query.eq("dialect_module", dialect);
    } else {
      // Scoped to the caller even though this holds the service role: on this
      // branch the function's whole job is the caller's own deck.
      query = query.eq("user_id", cap.userId);
      if (dialect) query = query.eq("dialect", dialect);
    }

    const { data, error } = await query;
    if (error) throw error;

    const candidates = (data ?? []) as Candidate[];
    const resolved = new Map<string, string>(); // id -> root
    const toAsk = new Map<string, string[]>(); // surface key -> ids

    for (const row of candidates) {
      const local = resolveLocally(row.word_arabic ?? "");
      if (local !== null) {
        resolved.set(row.id, local);
        continue;
      }
      const key = surfaceKey(row.word_arabic);
      const ids = toAsk.get(key);
      if (ids) ids.push(row.id);
      else toAsk.set(key, [row.id]);
    }

    const skippedFree = resolved.size;
    const words = [...toAsk.keys()];

    for (let start = 0; start < words.length; start += BATCH_SIZE) {
      const batch = words.slice(start, start + BATCH_SIZE);
      const roots = await rootsForBatch(batch, dialect ?? "Gulf");
      batch.forEach((word, offset) => {
        // A word the model skipped is left out entirely rather than written as
        // '': it has not been answered, so the next run should still try it.
        if (!roots.has(offset)) return;
        for (const id of toAsk.get(word) ?? []) resolved.set(id, roots.get(offset)!);
      });
    }

    const updates = [...resolved.entries()];
    for (let start = 0; start < updates.length; start += 20) {
      await Promise.all(
        updates.slice(start, start + 20).map(([id, root]) => {
          const write = supabase.from(table).update({ root }).eq("id", id);
          // The owner predicate is the belt to the service role's braces on the
          // personal deck. Curriculum rows have no owner — the admin check at
          // the top of the request is what stands in for it.
          return curriculum ? write : write.eq("user_id", cap.userId);
        }),
      );
    }

    const withRoot = updates.filter(([, root]) => root !== "").length;

    return new Response(
      JSON.stringify({
        ok: true,
        examined: candidates.length,
        // Words that gained a usable root.
        resolved: withRoot,
        // Answered locally, at no cost.
        skippedFree,
        // Whether calling again would do more work.
        more: candidates.length === limit,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    if (e instanceof BrainHttpError && (e.status === 402 || e.status === 429)) {
      return new Response(
        JSON.stringify({ error: e.status === 402 ? "Credits exhausted" : "Rate limited" }),
        { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.error("enrich-word-roots error:", e);
    return new Response(JSON.stringify({ error: "root_backfill_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
