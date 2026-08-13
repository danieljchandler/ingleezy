import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { streaming } from "@/test/support/server/functions";
import { aProfile } from "@/test/support/factories";
import {
  AiAssistantProvider,
  useAiAssistant,
  usePageAiContext,
} from "@/contexts/AiAssistantContext";
import type { PageAiContext } from "@/lib/pageAiContext";
import { AskAiPanel } from "./AskAiPanel";

/**
 * The global Ask AI panel. What matters here is the request contract with
 * assistant-chat — dialect, the seed sentence, and the page context all ride
 * along — and that the streamed reply lands in the transcript. The transport
 * itself (chunk boundaries, auth header) is covered by sseChat.test.ts.
 */

function Opener({ seed }: { seed?: { arabic: string; english?: string } }) {
  const { openChat } = useAiAssistant();
  return (
    <button type="button" onClick={() => openChat(seed)}>
      open-assistant
    </button>
  );
}

/** Stands in for a page that publishes what it's showing. */
function PagePublisher({ ctx }: { ctx: PageAiContext }) {
  usePageAiContext(ctx);
  return null;
}

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function render({
  seed,
  route = "/reading",
  pageContext,
}: {
  seed?: { arabic: string; english?: string };
  route?: string;
  pageContext?: PageAiContext;
} = {}) {
  localStorage.setItem("hakiya_dialect_module", "Gulf");
  const harness = renderWithProviders(
    <AiAssistantProvider>
      {pageContext && <PagePublisher ctx={pageContext} />}
      <Opener seed={seed} />
      <AskAiPanel />
    </AiAssistantProvider>,
    {
      persona: "free",
      route,
      seed: (backend) => backend.db.seed("profiles", [aProfile({ preferred_dialect: "Gulf" })]),
    },
  );
  harness.backend.stubFunction(
    "assistant-chat",
    streaming("Because ", "it is idiomatic."),
  );
  cleanup = harness.cleanup;
  return harness;
}

const open = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "open-assistant" }));
  });
};

const ask = async (text: string) => {
  fireEvent.change(screen.getByPlaceholderText("Ask a question…"), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
};

describe("AskAiPanel", () => {
  it("streams a reply and sends dialect + page context with the question", async () => {
    const { backend } = render();

    await open();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await ask("Why is this passage hard?");

    await waitFor(() => {
      expect(screen.getByText(/Because it is idiomatic\./)).toBeInTheDocument();
    });

    const call = backend.lastCallTo("assistant-chat");
    expect(call).toBeTruthy();
    const body = call!.body as Record<string, unknown>;
    expect(body.dialect).toBe("Gulf");
    expect(body.seed).toBeUndefined();
    const page = body.pageContext as Record<string, unknown>;
    expect(page.route).toBe("/reading");
    // /reading is unregistered here, so the PAGE_HINTS fallback describes it.
    expect(page.title).toBe("Reading Practice");
    expect((body.messages as unknown[]).length).toBe(1);
  });

  it("carries the seed sentence when opened from a chip", async () => {
    const { backend } = render({ seed: { arabic: "شلونك اليوم", english: "How are you today?" } });

    await open();

    // The seed is pinned in the header by the context card.
    expect(screen.getAllByText("شلونك اليوم").length).toBeGreaterThan(0);
    expect(screen.getByText("How are you today?")).toBeInTheDocument();

    // …and rides along in the request.
    await ask("Explain the grammar");
    await waitFor(() => {
      expect(backend.lastCallTo("assistant-chat")).toBeTruthy();
    });
    const body = backend.lastCallTo("assistant-chat")!.body as Record<string, unknown>;
    expect(body.seed).toEqual({ arabic: "شلونك اليوم", english: "How are you today?" });
  });

  it("offers suggested prompts before the first message", async () => {
    render();
    await open();
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
  });

  it("clears the conversation via New chat", async () => {
    render();
    await open();
    await ask("hello");
    await waitFor(() => {
      expect(screen.getByText(/Because it is idiomatic\./)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    });

    expect(screen.queryByText(/Because it is idiomatic\./)).toBeNull();
    expect(screen.getByText("What am I looking at?")).toBeInTheDocument();
  });

  /**
   * The panel is non-modal and only takes part of the screen, so the learner
   * can still see and use the page it's asking about. These cover the pieces
   * that make that true. Note src/test/setup.ts stubs matchMedia to always
   * report false, so the resize handle's own media query is irrelevant here —
   * the button is in the DOM either way.
   */
  describe("staying out of the way of the page", () => {
    it("does not close when the page behind it is clicked", async () => {
      render();
      await open();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Radix dismisses a non-modal dialog on outside pointerdown unless it's
      // prevented. Without the guard, tapping the video to pause would close
      // the panel — the exact thing this layout exists to allow.
      await act(async () => {
        fireEvent.pointerDown(document.body);
        fireEvent.mouseDown(document.body);
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("toggles between the peek and expanded heights", async () => {
      render();
      await open();

      const handle = screen.getByRole("button", { name: "Expand panel" });
      expect(handle).toHaveAttribute("aria-expanded", "false");

      await act(async () => {
        fireEvent.click(handle);
      });

      expect(screen.getByRole("button", { name: "Collapse panel" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("expands automatically for a live voice call", async () => {
      render();
      await open();
      expect(screen.getByRole("button", { name: "Expand panel" })).toBeInTheDocument();

      await act(async () => {
        // Radix tabs switch on mousedown, not click.
        fireEvent.mouseDown(screen.getByRole("tab", { name: /Live voice/ }));
      });

      expect(screen.getByRole("button", { name: "Collapse panel" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
  });

  describe("the context card", () => {
    it("shows what the page is displaying when there's no seed sentence", async () => {
      render({
        pageContext: {
          kind: "video",
          title: "Souq bargaining",
          summary: "Watching a Gulf dialect video.",
          content: "Current subtitle: كم سعر هذا؟ — How much is this?",
        },
      });
      await open();

      expect(screen.getByText("In this video")).toBeInTheDocument();
      expect(
        screen.getAllByText(/Current subtitle: كم سعر هذا؟/).length,
      ).toBeGreaterThan(0);
    });

    it("collapses to hide the detail", async () => {
      render({ seed: { arabic: "شلونك اليوم", english: "How are you today?" } });
      await open();
      expect(screen.getByText("How are you today?")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Hide context" }));
      });

      expect(screen.queryByText("How are you today?")).toBeNull();
    });
  });
});
