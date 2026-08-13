import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import {
  AiAssistantProvider,
  useAiAssistant,
  usePageAiContext,
} from "./AiAssistantContext";
import type { PageAiContext } from "@/lib/pageAiContext";

/**
 * The provider is the meeting point of three parties: chips that open the
 * panel with a sentence, pages that publish what they're showing, and the
 * panel that reads both. The subtle contract is seed identity — opening a
 * chat about a *different* sentence starts fresh, the *same* sentence (or no
 * seed) resumes. Get that wrong and either conversations leak across
 * sentences or every chip tap wipes the user's chat.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <AiAssistantProvider>{children}</AiAssistantProvider>
);

describe("useAiAssistant", () => {
  it("throws a clear error outside the provider", () => {
    expect(() => renderHook(() => useAiAssistant())).toThrow(/AiAssistantProvider/);
  });

  it("opens chat with a seed and keeps the conversation for the same seed", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك", english: "How are you?" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.close());

    // Reopening about the same sentence resumes.
    act(() => result.current.openChat({ arabic: "شلونك", english: "How are you?" }));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.isOpen).toBe(true);
  });

  it("resets the conversation when opened about a different sentence", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.setConversationId("saved-1"));

    act(() => result.current.openChat({ arabic: "وش تسوي" }));

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.seed?.arabic).toBe("وش تسوي");
  });

  it("resumes the in-memory conversation when opened without a seed", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.close());

    act(() => result.current.openChat());

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.seed?.arabic).toBe("شلونك");
  });

  it("newChat clears seed, messages, and saved id", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() => result.current.openChat({ arabic: "شلونك" }));
    act(() => result.current.setMessages([{ role: "user", content: "hi" }]));
    act(() => result.current.setConversationId("saved-1"));
    act(() => result.current.newChat());

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.seed).toBeNull();
    expect(result.current.conversationId).toBeNull();
  });

  it("loadConversation restores a saved chat and opens the panel", () => {
    const { result } = renderHook(() => useAiAssistant(), { wrapper });

    act(() =>
      result.current.loadConversation({
        id: "conv-7",
        seed: { arabic: "يالله" },
        messages: [
          { role: "user", content: "what does this mean?" },
          { role: "assistant", content: "It means let's go." },
        ],
      }),
    );

    expect(result.current.isOpen).toBe(true);
    expect(result.current.conversationId).toBe("conv-7");
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.seed?.arabic).toBe("يالله");
  });
});

describe("usePageAiContext", () => {
  it("publishes on mount and clears on unmount", () => {
    const ctx: PageAiContext = { kind: "video", title: "Souq tour" };

    const { result, unmount } = renderHook(
      () => {
        usePageAiContext(ctx);
        return useAiAssistant();
      },
      { wrapper },
    );

    expect(result.current.pageContext?.title).toBe("Souq tour");
    unmount();
  });

  it("lets a successor page take over even when the old page unmounts late", () => {
    const first: PageAiContext = { kind: "story", title: "First" };
    const second: PageAiContext = { kind: "story", title: "Second" };

    const useBoth = ({ a, b }: { a: PageAiContext | null; b: PageAiContext | null }) => {
      usePageAiContext(a);
      usePageAiContext(b);
      return useAiAssistant();
    };

    const { result, rerender } = renderHook(useBoth, {
      wrapper,
      initialProps: { a: first, b: null as PageAiContext | null },
    });
    expect(result.current.pageContext?.title).toBe("First");

    // The new page registers, then the old page unregisters (unmount order
    // during a route transition). The successor's context must survive.
    rerender({ a: first, b: second });
    expect(result.current.pageContext?.title).toBe("Second");

    rerender({ a: null, b: second });
    expect(result.current.pageContext?.title).toBe("Second");
  });
});
