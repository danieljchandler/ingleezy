import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { AssistantMsg, AssistantSeed } from "@/contexts/AiAssistantContext";

/**
 * Saved Ask AI conversations. The chat itself is ephemeral; these are the
 * ones the learner explicitly kept. List/save/rename/delete over
 * `saved_chat_conversations` (owner-only via RLS).
 */

export interface SavedConversation {
  id: string;
  user_id: string;
  dialect: string;
  title: string;
  seed: AssistantSeed | null;
  page_context: { route?: string; title?: string } | null;
  messages: AssistantMsg[];
  created_at: string;
  updated_at: string;
}

const KEY = "saved-chat-conversations";

export const useSavedConversations = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("saved_chat_conversations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SavedConversation[];
    },
    enabled: !!user,
  });
};

export const useSaveConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (args: {
      /** Present when re-saving an already-saved conversation. */
      id?: string | null;
      dialect: string;
      seed: AssistantSeed | null;
      pageContext: { route?: string; title?: string } | null;
      messages: AssistantMsg[];
    }) => {
      if (!user) throw new Error("Must be logged in");

      const firstUserMsg = args.messages.find((m) => m.role === "user")?.content ?? "Conversation";
      const title = firstUserMsg.length > 80 ? `${firstUserMsg.slice(0, 80)}…` : firstUserMsg;

      if (args.id) {
        const { data, error } = await supabase
          .from("saved_chat_conversations")
          .update({
            messages: args.messages as never,
            updated_at: new Date().toISOString(),
          })
          .eq("id", args.id)
          .eq("user_id", user.id)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as SavedConversation;
      }

      const { data, error } = await supabase
        .from("saved_chat_conversations")
        .insert({
          user_id: user.id,
          dialect: args.dialect,
          title,
          seed: (args.seed ?? null) as never,
          page_context: (args.pageContext ?? null) as never,
          messages: args.messages as never,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedConversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};

export const useRenameConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      if (!user) throw new Error("Must be logged in");
      const { error } = await supabase
        .from("saved_chat_conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Must be logged in");
      const { error } = await supabase
        .from("saved_chat_conversations")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};
