import { supabase } from "@/integrations/supabase/client";

const VOCAB_COLUMNS =
  "word_arabic, word_english, dialect, stage, ease_factor, interval_days, repetitions, lapses, is_leech, next_review_at, last_reviewed_at, created_at";

/**
 * Export user vocabulary data as a JSON file download.
 */
export async function exportVocabularyAsJSON(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_vocabulary")
    .select(VOCAB_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to export vocabulary: ${error.message}`);

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `hakiya-vocabulary-${formatDate()}.json`);
}

/**
 * Export user vocabulary data as a CSV file download.
 */
export async function exportVocabularyAsCSV(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_vocabulary")
    .select(VOCAB_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to export vocabulary: ${error.message}`);
  if (!data || data.length === 0) throw new Error("No vocabulary data to export.");

  const headers = Object.keys(data[0] as Record<string, unknown>);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => {
          const val = (row as Record<string, unknown>)[h];
          const str = val == null ? "" : String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    ),
  ];

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `hakiya-vocabulary-${formatDate()}.csv`);
}

/**
 * Export word review history as JSON.
 */
export async function exportReviewHistoryAsJSON(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("word_reviews")
    .select(
      "word_id, stage, last_result, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to export review history: ${error.message}`);

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `hakiya-reviews-${formatDate()}.json`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}
