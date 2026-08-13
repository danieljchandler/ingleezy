// Embedding client for the semantic content index (content_embeddings).
// OpenAI text-embedding-3-small: strong Arabic performance, 1536 dims, and
// OPENAI_API_KEY is already provisioned for the Realtime voice tutor — no new
// provider. The model id is fixed here on purpose: changing it invalidates
// every stored vector, so it must be a deliberate migration, not a config
// drift.
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

/** OpenAI's per-request input cap is 2048 items; stay well under it. */
const MAX_BATCH = 100;

/**
 * Embed a batch of texts, preserving order. Throws on failure — callers
 * decide whether an embedding outage should fail their request (backfill: yes)
 * or degrade (learner features: fall back to non-semantic behaviour).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured (required for embeddings)');
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH).map((t) => t.slice(0, 4000));
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`embeddings ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data.data) ? data.data : [];
    if (rows.length !== batch.length) {
      throw new Error(`embeddings returned ${rows.length} vectors for ${batch.length} inputs`);
    }
    // OpenAI documents index-ordered results; sort defensively anyway.
    rows.sort((a: { index: number }, b: { index: number }) => a.index - b.index);
    for (const row of rows) out.push(row.embedding as number[]);
  }
  return out;
}
