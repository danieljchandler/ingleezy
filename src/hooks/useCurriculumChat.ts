import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { GulfDialect } from '@/components/admin/curriculum-builder/DialectSelector';
import type { LLMModelId } from '@/components/admin/curriculum-builder/ModelSelector';

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  llm_model: string | null;
  structured_output: Record<string, unknown> | null;
  output_type: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  admin_id: string;
  title: string;
  target_dialect: GulfDialect;
  target_stage_id: string | null;
  target_cefr: string | null;
  llm_model: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export function useCurriculumChat() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const requestIdRef = useRef(0);

  // Fetch all sessions
  const sessionsQuery = useQuery({
    queryKey: ['curriculum-chat-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curriculum_chat_sessions' as never)
        .select('*')
        .eq('status', 'active')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChatSession[];
    },
  });

  // Fetch messages for active session
  const messagesQuery = useQuery({
    queryKey: ['curriculum-chat-messages', activeSessionId],
    queryFn: async () => {
      if (!activeSessionId) return [];
      const { data, error } = await supabase
        .from('curriculum_chat_messages' as never)
        .select('*')
        .eq('session_id', activeSessionId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ChatMessage[];
    },
    enabled: !!activeSessionId,
  });

  // Create a new session
  const createSession = useMutation({
    mutationFn: async ({
      dialect,
      model,
      stageId,
      cefr,
    }: {
      dialect: GulfDialect;
      model: LLMModelId;
      stageId?: string;
      cefr?: string;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('curriculum_chat_sessions' as never)
        .insert({
          admin_id: userData.user.id,
          target_dialect: dialect,
          llm_model: model,
          target_stage_id: stageId || null,
          target_cefr: cefr || null,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ChatSession;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['curriculum-chat-sessions'] });
      setActiveSessionId(session.id);
    },
    onError: (err) => {
      toast.error('Failed to create session', { description: (err as Error).message });
    },
  });

  // Send a message and get AI response
  const sendMessage = useCallback(
    async (
      content: string,
      mode: string = 'chat',
      session?: ChatSession,
    ) => {
      const currentSession = session ?? sessionsQuery.data?.find((s) => s.id === activeSessionId);
      if (!currentSession) {
        toast.error('No active session');
        return;
      }

      const reqId = ++requestIdRef.current;
      setIsGenerating(true);

      try {
        // 1. Persist user message
        const { error: insertErr } = await supabase
          .from('curriculum_chat_messages' as never)
          .insert({
            session_id: currentSession.id,
            role: 'user',
            content,
          } as never);
        if (insertErr) throw insertErr;

        // Refresh messages to show user message immediately
        if (reqId === requestIdRef.current) {
          queryClient.invalidateQueries({
            queryKey: ['curriculum-chat-messages', currentSession.id],
          });
        }

        // 2. Build message history for context
        const existingMessages = messagesQuery.data ?? [];
        const historyForLLM = [
          ...existingMessages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content },
        ];

        // 3. Call the edge function
        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          'curriculum-chat',
          {
            body: {
              messages: historyForLLM,
              model: currentSession.llm_model,
              dialect: currentSession.target_dialect,
              stage_context: currentSession.target_cefr
                ? { cefr: currentSession.target_cefr }
                : undefined,
              mode,
            },
          },
        );

        if (reqId !== requestIdRef.current) return; // stale

        if (fnError) throw fnError;

        const responseContent = fnData?.content;
        if (!responseContent) throw new Error('Empty response from AI');

        // 4. Persist assistant message
        const { error: assistantErr } = await supabase
          .from('curriculum_chat_messages' as never)
          .insert({
            session_id: currentSession.id,
            role: 'assistant',
            content: responseContent,
            llm_model: fnData.model,
            structured_output: fnData.structured_output,
            output_type: fnData.output_type,
          } as never);
        if (assistantErr) throw assistantErr;

        // 5. Auto-title the session from the first message
        if (existingMessages.length === 0) {
          const autoTitle = content.slice(0, 60) + (content.length > 60 ? '...' : '');
          await supabase
            .from('curriculum_chat_sessions' as never)
            .update({ title: autoTitle } as never)
            .eq('id', currentSession.id);
          queryClient.invalidateQueries({ queryKey: ['curriculum-chat-sessions'] });
        }

        if (reqId === requestIdRef.current) {
          queryClient.invalidateQueries({
            queryKey: ['curriculum-chat-messages', currentSession.id],
          });
        }
      } catch (err) {
        if (reqId === requestIdRef.current) {
          toast.error('Failed to get AI response', {
            description: (err as Error).message,
          });
        }
      } finally {
        if (reqId === requestIdRef.current) {
          setIsGenerating(false);
        }
      }
    },
    [activeSessionId, sessionsQuery.data, messagesQuery.data, queryClient],
  );

  // Archive a session
  const archiveSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from('curriculum_chat_sessions' as never)
        .update({ status: 'archived' } as never)
        .eq('id', sessionId);
      if (error) throw error;
      return sessionId;
    },
    onSuccess: (archivedSessionId) => {
      queryClient.invalidateQueries({ queryKey: ['curriculum-chat-sessions'] });
      if (archivedSessionId === activeSessionId) {
        setActiveSessionId(null);
      }
    },
  });

  // Update session model
  const updateModel = useCallback(
    async (model: LLMModelId) => {
      if (!activeSessionId) return;
      const { error } = await supabase
        .from('curriculum_chat_sessions' as never)
        .update({ llm_model: model } as never)
        .eq('id', activeSessionId);
      if (error) {
        toast.error('Failed to switch model');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['curriculum-chat-sessions'] });
    },
    [activeSessionId, queryClient],
  );

  // Update structured_output for a message (admin edits before approval)
  const updateMessageStructured = useCallback(
    async (messageId: string, structured: Record<string, unknown>) => {
      const { error } = await supabase
        .from('curriculum_chat_messages' as never)
        .update({ structured_output: structured } as never)
        .eq('id', messageId);
      if (error) {
        toast.error('Failed to save edits', { description: error.message });
        return;
      }
      if (activeSessionId) {
        queryClient.invalidateQueries({
          queryKey: ['curriculum-chat-messages', activeSessionId],
        });
      }
    },
    [activeSessionId, queryClient],
  );

  return {
    sessions: sessionsQuery.data ?? [],
    sessionsLoading: sessionsQuery.isLoading,
    messages: messagesQuery.data ?? [],
    messagesLoading: messagesQuery.isLoading,
    activeSessionId,
    setActiveSessionId,
    isGenerating,
    createSession,
    sendMessage,
    archiveSession,
    updateModel,
    updateMessageStructured,
  };
}
