import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PageAiContext } from "@/lib/pageAiContext";

/**
 * Global state for the Ask AI assistant: one conversation at a time, held in
 * memory only (ephemeral — survives closing the panel and navigating, resets
 * on reload). Pages publish what they're showing via usePageAiContext, and
 * anything (the FAB, the Ask AI chips) can open the panel via useAiAssistant.
 */

export interface AssistantSeed {
  arabic: string;
  english?: string;
}

export interface AssistantMsg {
  role: "user" | "assistant";
  content: string;
}

export type AssistantTab = "chat" | "voice";

interface AiAssistantValue {
  isOpen: boolean;
  activeTab: AssistantTab;
  setActiveTab: (tab: AssistantTab) => void;
  seed: AssistantSeed | null;
  clearSeed: () => void;
  messages: AssistantMsg[];
  setMessages: React.Dispatch<React.SetStateAction<AssistantMsg[]>>;
  /** Set when the current conversation has been saved (row id). */
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pageContext: PageAiContext | null;
  openChat: (seed?: AssistantSeed) => void;
  openVoice: () => void;
  close: () => void;
  newChat: () => void;
  loadConversation: (args: {
    id: string;
    seed: AssistantSeed | null;
    messages: AssistantMsg[];
  }) => void;
}

const AiAssistantContext = createContext<AiAssistantValue | null>(null);

// Internal registration channel for usePageAiContext, separated so pages that
// only publish context don't re-render when the conversation streams.
interface PageRegistryValue {
  register: (id: number, ctx: PageAiContext) => void;
  unregister: (id: number) => void;
}

const PageRegistryContext = createContext<PageRegistryValue | null>(null);

let nextRegistrationId = 1;

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AssistantTab>("chat");
  const [seed, setSeed] = useState<AssistantSeed | null>(null);
  const [messages, setMessages] = useState<AssistantMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageAiContext | null>(null);
  const registrationRef = useRef<number | null>(null);

  const register = useCallback((id: number, ctx: PageAiContext) => {
    registrationRef.current = id;
    setPageContext(ctx);
  }, []);

  const unregister = useCallback((id: number) => {
    // Only the most recent registrant may clear — pages unmount after their
    // successor mounts under StrictMode/transitions.
    if (registrationRef.current === id) {
      registrationRef.current = null;
      setPageContext(null);
    }
  }, []);

  const openChat = useCallback((newSeed?: AssistantSeed) => {
    if (newSeed) {
      setSeed((prev) => {
        // A different sentence starts a fresh conversation about it; the same
        // sentence resumes what's there.
        if (prev?.arabic !== newSeed.arabic) {
          setMessages([]);
          setConversationId(null);
        }
        return newSeed;
      });
    }
    setActiveTab("chat");
    setIsOpen(true);
  }, []);

  const openVoice = useCallback(() => {
    setActiveTab("voice");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const newChat = useCallback(() => {
    setMessages([]);
    setSeed(null);
    setConversationId(null);
  }, []);

  const clearSeed = useCallback(() => setSeed(null), []);

  const loadConversation = useCallback(
    (args: { id: string; seed: AssistantSeed | null; messages: AssistantMsg[] }) => {
      setSeed(args.seed);
      setMessages(args.messages);
      setConversationId(args.id);
      setActiveTab("chat");
      setIsOpen(true);
    },
    [],
  );

  const value = useMemo<AiAssistantValue>(
    () => ({
      isOpen,
      activeTab,
      setActiveTab,
      seed,
      clearSeed,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      pageContext,
      openChat,
      openVoice,
      close,
      newChat,
      loadConversation,
    }),
    [
      isOpen,
      activeTab,
      seed,
      clearSeed,
      messages,
      conversationId,
      pageContext,
      openChat,
      openVoice,
      close,
      newChat,
      loadConversation,
    ],
  );

  const registry = useMemo<PageRegistryValue>(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <PageRegistryContext.Provider value={registry}>
      <AiAssistantContext.Provider value={value}>{children}</AiAssistantContext.Provider>
    </PageRegistryContext.Provider>
  );
}

export function useAiAssistant(): AiAssistantValue {
  const ctx = useContext(AiAssistantContext);
  if (!ctx) {
    throw new Error("useAiAssistant must be used within <AiAssistantProvider>");
  }
  return ctx;
}

/**
 * Publish what this page is showing to the AI assistant. Pass `null` to
 * publish nothing (the route-based fallback applies). Re-registers whenever
 * the context object identity changes — memoize the argument in the page.
 */
export function usePageAiContext(ctx: PageAiContext | null) {
  const registry = useContext(PageRegistryContext);
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = nextRegistrationId++;

  useEffect(() => {
    if (!registry || !ctx) return;
    const id = idRef.current;
    registry.register(id, ctx);
    return () => registry.unregister(id);
  }, [registry, ctx]);
}
