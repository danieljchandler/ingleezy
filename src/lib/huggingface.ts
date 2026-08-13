import { supabase } from "@/integrations/supabase/client";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDialectResponse(
  prompt: string,
  modelTier: "standard" | "premium",
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("hf-chat", {
        body: { prompt, modelTier },
      });

      if (error) {
        throw error;
      }

      const content = (data as { content?: string })?.content;
      if (content) return content;

      throw new Error("Empty response from model");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        err instanceof Error && "status" in err
          ? (err as { status: number }).status
          : undefined;
      const isRetryable =
        /503|529|busy|overloaded|rate/i.test(message) ||
        status === 503 ||
        status === 529 ||
        status === 429;

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[huggingface] Attempt ${attempt + 1} failed, retrying in ${backoff}ms…`,
        );
        await delay(backoff);
        continue;
      }

      console.error("[huggingface] Request failed:", err);
      return "عذرًا، الخدمة مشغولة حاليًا. يرجى المحاولة مرة أخرى بعد قليل. (Sorry, the service is temporarily busy. Please try again shortly.)";
    }
  }

  return "عذرًا، الخدمة مشغولة حاليًا. يرجى المحاولة مرة أخرى بعد قليل. (Sorry, the service is temporarily busy. Please try again shortly.)";
}
