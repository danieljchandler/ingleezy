import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TranslatedSentence {
  arabic: string;
  literal: string;
  natural: string;
  note?: string;
}

export interface TranslateTextResult {
  detected_dialect: "Gulf" | "Egyptian" | "Yemeni";
  sentences: TranslatedSentence[];
  used_dialect: string;
}

type DialectOpt = "auto" | "Gulf" | "Egyptian" | "Yemeni";

export function useTranslateText() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranslateTextResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const translate = useCallback(async (text: string, dialect: DialectOpt = "auto") => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("translate-text", {
        body: { text, dialect },
      });
      if (err) throw err;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string; message?: string }).message
          ?? (data as { error: string }).error);
      }
      setResult(data as TranslateTextResult);
      return data as TranslateTextResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Translation failed";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { translate, loading, result, error, reset };
}
