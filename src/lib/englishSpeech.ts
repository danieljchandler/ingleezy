import { supabase } from "@/integrations/supabase/client";

/**
 * A model English pronunciation to play next to the learner's own take.
 *
 * Through `elevenlabs-tts`, the multilingual voice the tutor chat already uses
 * for English. The dialect-routed Arabic voices (`useAzureTTS`, Munsit) are
 * the wrong voice for this: they read English with an Arabic accent, which is
 * the one thing a model pronunciation must not have.
 *
 * Called as a fetch rather than `functions.invoke`, which hands an audio body
 * back as text. Each phrase is fetched once per page load.
 */
const cache = new Map<string, string>();

export async function englishSpeechUrl(text: string): Promise<string> {
  const key = text.trim();
  if (!key) throw new Error("Nothing to say");
  const cached = cache.get(key);
  if (cached) return cached;

  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${base}/functions/v1/elevenlabs-tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token ?? anon}`,
      apikey: anon,
    },
    body: JSON.stringify({ text: key }),
  });
  if (!res.ok) throw new Error(`elevenlabs-tts ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  cache.set(key, url);
  return url;
}

/** Forget the fetched audio. For tests. */
export function clearEnglishSpeechCache(): void {
  cache.clear();
}
