import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StorySuggestion {
  title: string;
  title_arabic: string;
  description: string;
  description_arabic: string;
  source_type: string;
  estimated_length: string;
  themes: string[];
}

export function useStorySuggestions() {
  return useMutation({
    mutationFn: async (opts?: { dialect?: string; difficulty?: string }): Promise<StorySuggestion[]> => {
      const { data, error } = await supabase.functions.invoke("suggest-stories", {
        body: {
          dialect: opts?.dialect || "Gulf",
          difficulty: opts?.difficulty || "intermediate",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.suggestions || !Array.isArray(data.suggestions)) {
        throw new Error("No suggestions returned");
      }
      return data.suggestions as StorySuggestion[];
    },
  });
}

export interface GeneratedStoryText {
  body_english: string;
  author: string | null;
}

/**
 * Expands a StorySuggestion (title + description only) into full ENGLISH story
 * text, so it can be imported directly without the admin having to find and
 * paste a source text themselves.
 *
 * This is the reading library's empty-shelf path: the library prefers real
 * imported texts, and generation is what keeps it stocked when none is to
 * hand. The generated English then goes through the same importer as a pasted
 * one, so both reach their dialect scaffold by a single path.
 */
export function useGenerateStoryText() {
  return useMutation({
    mutationFn: async (opts: {
      suggestion: StorySuggestion;
      dialect: string;
      difficulty: string;
    }): Promise<GeneratedStoryText> => {
      const { suggestion, dialect, difficulty } = opts;
      const { data, error } = await supabase.functions.invoke("generate-suggested-story-text", {
        body: {
          title: suggestion.title,
          title_arabic: suggestion.title_arabic,
          description: suggestion.description,
          source_type: suggestion.source_type,
          estimated_length: suggestion.estimated_length,
          themes: suggestion.themes,
          dialect,
          difficulty,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.detail || data.error);
      if (!data?.body_english) {
        throw new Error("No story text returned");
      }
      return {
        body_english: data.body_english,
        author: data.author ?? null,
      };
    },
  });
}
