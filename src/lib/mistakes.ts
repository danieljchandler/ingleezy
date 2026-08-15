/**
 * Grouping and ranking for the learner's own error corpus.
 *
 * `learner_errors` has been accumulating since it was added: every
 * pronunciation miss, shadow-alignment gap, sentence-coach failure and
 * set-phrase mismatch. All of it fed the AI — the `weak` bucket in
 * learnerProfile.ts — and none of it was ever shown to the person who made the
 * mistakes. The table's own header comment listed "future targeted drills" as
 * the second consumer; this is the read side of that.
 *
 * Pure on purpose: the grouping is the part with real branching, so it's
 * unit-tested here rather than asserted through a rendered page.
 */

/** A row of `learner_errors`, in the columns the UI needs. */
export interface LearnerErrorRow {
  id: string;
  dialect: string;
  source: string;
  target_text: string;
  produced_text: string | null;
  error_kind: string;
  created_at: string;
}

export interface MistakeGroup {
  /** The ENGLISH the learner was aiming for (column names are Arabic-era —
   *  target_text carries English targets post-flip). Identity of the group. */
  target: string;
  dialect: string;
  /** How many unresolved errors are recorded against it. */
  count: number;
  /** Most recent first — what they actually produced, when there was audio. */
  attempts: string[];
  /** Distinct practice surfaces this went wrong on, in first-seen order. */
  sources: string[];
  /** Distinct error kinds, in first-seen order. */
  kinds: string[];
  /** ISO timestamp of the most recent occurrence. */
  lastAt: string;
  /** Every row id in the group, so dismissing clears all of them at once. */
  ids: string[];
}

/** Human wording for `learner_errors.source`. */
const SOURCE_LABEL: Record<string, string> = {
  pronunciation: "النطق",
  shadow: "المحاكاة",
  sentence_coach: "تدريب الجمل",
  set_phrase_voice: "العبارات الجاهزة",
  quiz: "اختبار",
  writing: "الكتابة",
};

/**
 * Human wording for `error_kind`.
 *
 * The column is deliberately free text — the scorers disagree on taxonomy and a
 * new source shouldn't need a migration — so unknown values fall through to
 * themselves rather than being dropped.
 */
const KIND_LABEL: Record<string, string> = {
  mispronunciation: "النطق",
  omission: "أسقطت كلمة",
  insertion: "أضفت كلمة",
  wrong_word: "كلمة خاطئة",
  word_order: "ترتيب الكلمات",
  // The three areas Arabic pulls a writer off course in English: it has no
  // indefinite article, maps prepositions differently, and marks time with
  // fewer forms. `msa_leak` stays for rows the Arabic era already wrote.
  article: "أدوات التعريف",
  preposition: "حروف الجر",
  verb_tense: "زمن الفعل",
  msa_leak: "تسرب فصحى",
  spelling: "الإملاء",
  grammar: "القواعد",
  other: "أخرى",
};

export const labelForSource = (s: string): string => SOURCE_LABEL[s] ?? s;
export const labelForKind = (k: string): string => KIND_LABEL[k] ?? k;

/**
 * Collapse raw error rows into one group per target, most-troublesome first.
 *
 * Grouped on the target rather than listed raw because the useful question is
 * "what do I keep getting wrong", not "what happened at 14:32 on Tuesday". Six
 * separate rows for the same word is one problem, not six.
 *
 * Ranked by count, then recency: a word missed five times outranks one missed
 * twice, and among equals the one still going wrong today comes first.
 */
export function groupMistakes(rows: LearnerErrorRow[]): MistakeGroup[] {
  const byTarget = new Map<string, MistakeGroup>();

  // Newest first, so `attempts` reads most-recent-first and `lastAt` is the
  // first row seen for each target.
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  for (const row of sorted) {
    const target = row.target_text?.trim();
    if (!target) continue;

    // Dialect is part of the identity: the same word can be right in Gulf and
    // wrong in Egyptian, and merging them would hide which one is the problem.
    const key = `${row.dialect} ${target}`;
    const existing = byTarget.get(key);

    if (!existing) {
      byTarget.set(key, {
        target,
        dialect: row.dialect,
        count: 1,
        attempts: row.produced_text?.trim() ? [row.produced_text.trim()] : [],
        sources: [row.source],
        kinds: [row.error_kind],
        lastAt: row.created_at,
        ids: [row.id],
      });
      continue;
    }

    existing.count += 1;
    existing.ids.push(row.id);
    const produced = row.produced_text?.trim();
    if (produced && !existing.attempts.includes(produced)) existing.attempts.push(produced);
    if (!existing.sources.includes(row.source)) existing.sources.push(row.source);
    if (!existing.kinds.includes(row.error_kind)) existing.kinds.push(row.error_kind);
  }

  return [...byTarget.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return Date.parse(b.lastAt) - Date.parse(a.lastAt);
  });
}

/**
 * One-line summary of how often and how recently a target has gone wrong.
 *
 * `now` is injected so the wording is testable without freezing the clock.
 */
export function describeMistake(group: MistakeGroup, now: Date = new Date()): string {
  // Arabic number agreement: 1 مرة واحدة · 2 مرتين · 3-10 مرات · 11+ مرة.
  const n = group.count;
  const times =
    n === 1 ? "مرة واحدة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`;
  const days = Math.floor((now.getTime() - Date.parse(group.lastAt)) / 86_400_000);
  const when =
    days <= 0 ? "اليوم"
    : days === 1 ? "أمس"
    : days === 2 ? "قبل يومين"
    : days <= 10 ? `قبل ${days} أيام`
    : `قبل ${days} يوماً`;
  return `${times} · آخرها ${when}`;
}
