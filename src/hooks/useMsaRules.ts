import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MsaRuleCategory = "sound_shift" | "pronoun" | "verb_prefix" | "vocab_swap";

export interface MsaRule {
  id: string;
  dialect: string;
  category: MsaRuleCategory;
  rule_name: string;
  msa_pattern: string;
  dialect_pattern: string;
  example_msa: string | null;
  example_dialect: string | null;
  example_audio_url: string | null;
  notes: string | null;
  display_order: number;
}

export function useMsaRules(dialect: string) {
  return useQuery({
    queryKey: ["msa-rules", dialect],
    queryFn: async (): Promise<MsaRule[]> => {
      const { data, error } = await supabase
        .from("msa_transformation_rules" as never)
        .select("*")
        .eq("dialect", dialect)
        .eq("status", "published")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MsaRule[];
    },
    staleTime: 5 * 60_000,
  });
}
