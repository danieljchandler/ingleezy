import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { AskAISentence } from "./AskAISentence";

/**
 * "Ask AI about this sentence."
 *
 * The chip used to carry its own chat dialog; it is now a trigger into the
 * global assistant panel, seeded with the sentence. What has to keep working
 * across the app's 18 call sites is exactly this contract: same props, same
 * two visual variants, and a click that hands the sentence to the assistant.
 * The conversation itself is covered by AskAiPanel.test.tsx and sseChat.test.ts.
 */

function Probe() {
  const { isOpen, seed, activeTab } = useAiAssistant();
  return (
    <div data-testid="probe">
      {isOpen ? "open" : "closed"}|{activeTab}|{seed ? `${seed.arabic}~${seed.english ?? ""}` : "no-seed"}
    </div>
  );
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(props: { arabic?: string; english?: string; variant?: "icon" | "chip" } = {}) {
  const english = "english" in props ? props.english : "What's up with you today?";
  const harness = renderWithProviders(
    <>
      <AskAISentence arabic={props.arabic ?? "شفيك اليوم؟"} english={english} variant={props.variant} />
      <Probe />
    </>,
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("the way in", () => {
  it("is an unobtrusive icon on a sentence by default", () => {
    render();

    // It hangs off every sentence in the app, so the default has to disappear
    // into the line rather than compete with it.
    expect(screen.getByRole("button", { name: "اسأل الذكاء عن هذي الجملة" })).toBeInTheDocument();
    expect(screen.getByTestId("probe")).toHaveTextContent("closed");
  });

  it("can be a labelled chip where there is room", () => {
    render({ variant: "chip" });
    expect(screen.getByRole("button", { name: /اسأل الذكاء/ })).toBeInTheDocument();
  });
});

describe("opening the assistant", () => {
  it("opens the global chat seeded with the sentence", () => {
    render({ variant: "chip" });

    fireEvent.click(screen.getByRole("button", { name: /اسأل الذكاء/ }));

    expect(screen.getByTestId("probe")).toHaveTextContent(
      "open|chat|شفيك اليوم؟~What's up with you today?",
    );
  });

  it("passes the sentence without an English gloss when none exists", () => {
    render({ english: undefined });

    fireEvent.click(screen.getByRole("button", { name: "اسأل الذكاء عن هذي الجملة" }));

    expect(screen.getByTestId("probe")).toHaveTextContent("open|chat|شفيك اليوم؟~");
  });
});
