import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { TranslatedSentence } from "@/hooks/useTranslateText";

export interface SavedTranslation {
  id: string;
  user_id: string;
  title: string | null;
  source_text: string;
  source_dialect: string | null;
  detected_dialect: string | null;
  sentences: TranslatedSentence[];
  created_at: string;
  updated_at: string;
}

interface SaveInput {
  source_text: string;
  source_dialect?: string | null;
  detected_dialect?: string | null;
  sentences: TranslatedSentence[];
  title?: string | null;
}

export function useSavedTranslations() {
  const { user } = useAuth();
  const [items, setItems] = useState<SavedTranslation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("saved_text_translations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setItems((data ?? []) as unknown as SavedTranslation[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: SaveInput): Promise<SavedTranslation | null> => {
      if (!user) throw new Error("Not signed in");
      const title =
        input.title ??
        (input.source_text.trim().slice(0, 60) +
          (input.source_text.trim().length > 60 ? "…" : ""));
      const { data, error: err } = await supabase
        .from("saved_text_translations")
        .insert({
          user_id: user.id,
          title,
          source_text: input.source_text,
          source_dialect: input.source_dialect ?? null,
          detected_dialect: input.detected_dialect ?? null,
          sentences: input.sentences as unknown as never,
        })
        .select("*")
        .single();
      if (err) throw err;
      const row = data as unknown as SavedTranslation;
      setItems((prev) => [row, ...prev]);
      return row;
    },
    [user],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await supabase
        .from("saved_text_translations")
        .delete()
        .eq("id", id);
      if (err) throw err;
      setItems((prev) => prev.filter((x) => x.id !== id));
    },
    [],
  );

  const get = useCallback(async (id: string): Promise<SavedTranslation | null> => {
    const { data, error: err } = await supabase
      .from("saved_text_translations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (err) throw err;
    return (data ?? null) as unknown as SavedTranslation | null;
  }, []);

  return { items, loading, error, refresh, save, remove, get };
}
