import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput, type ChatMode } from "./ChatInput";

/**
 * The composer for the curriculum builder.
 *
 * Everything the builder can make goes through one box, so the box has to carry
 * the distinction: "write me a lesson about markets" and "give me vocabulary
 * about markets" are different jobs with different output shapes, and the model
 * cannot reliably tell them apart from prose. Hence the chip row — the mode is
 * picked explicitly and travels with the message.
 *
 * Picking a mode also seeds the prompt, because the useful half of "Create a
 * complete lesson about: " is the part the admin does not have to type.
 */

vi.mock("./QuickActionsMenu", () => ({
  QuickActionsMenu: ({
    onSelect,
    disabled,
  }: {
    onSelect: (a: { prompt: string; mode: ChatMode }) => void;
    disabled?: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => onSelect({ prompt: "Create a reading passage about: ", mode: "generate_reading" })}
      data-testid="quick-action"
    >
      Quick actions
    </button>
  ),
}));

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render({ disabled, isGenerating }: { disabled?: boolean; isGenerating?: boolean } = {}) {
  const onSend = vi.fn();
  const view = rtlRender(
    <ChatInput onSend={onSend} disabled={disabled} isGenerating={isGenerating} />,
  );
  cleanup = view.unmount;
  return { ...view, onSend };
}

const box = () => screen.getByRole("textbox");
const chip = (label: string) => screen.getByRole("button", { name: label });
const sendButton = () => screen.getAllByRole("button").at(-1)!;

const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe("choosing what to make", () => {
  it("offers every kind the builder can produce", () => {
    render();

    // The chip row is the only place the modes are discoverable; anything
    // missing here is a generator nobody knows exists.
    expect(screen.getByText("Make:")).toBeInTheDocument();
    for (const label of [
      "Chat",
      "Lesson",
      "Vocab",
      "Grammar",
      "Listening",
      "Reading",
      "Daily",
      "Convo",
      "Game",
    ]) {
      expect(chip(label)).toBeInTheDocument();
    }
  });

  it("starts on plain chat", () => {
    render();

    expect(chip("Chat").className).toContain("bg-primary");
    expect(box()).toHaveAttribute("placeholder", "Message the curriculum AI…  (Enter to send)");
  });

  it("seeds the prompt when a maker is picked", () => {
    render();

    fireEvent.click(chip("Lesson"));

    // The stem is the part that makes the mode legible to the model as well as
    // to the admin, and it is the part nobody wants to retype.
    expect(box()).toHaveValue("Create a complete lesson about: ");
    expect(chip("Lesson").className).toContain("bg-primary");
  });

  it("changes the prompt to match the mode", () => {
    render();

    fireEvent.click(chip("Grammar"));

    // The generic "Message the curriculum AI" would leave an admin in Grammar
    // mode with no cue that the reply will be drills rather than prose.
    expect(box()).toHaveAttribute("placeholder", "Describe what to generate…");
  });

  it("does not overwrite something already typed", () => {
    render();
    type("markets in Jeddah");

    fireEvent.click(chip("Lesson"));

    // Realising halfway through which kind of thing you are asking for is the
    // normal way this is used; the stem is a convenience, not a reset.
    expect(box()).toHaveValue("markets in Jeddah");
  });

  it("switches between makers", () => {
    render();
    fireEvent.click(chip("Lesson"));

    fireEvent.click(chip("Vocab"));

    expect(chip("Vocab").className).toContain("bg-primary");
    expect(chip("Lesson").className).not.toContain("bg-primary");
  });

  it("offers a way back to plain chat", () => {
    render();
    fireEvent.click(chip("Lesson"));

    fireEvent.click(screen.getByRole("button", { name: /clear/ }));

    expect(chip("Chat").className).toContain("bg-primary");
  });

  it("hides the clear button while already chatting", () => {
    render();

    // Nothing to clear, and a dead control under the composer is noise.
    expect(screen.queryByRole("button", { name: /clear/ })).toBeNull();
  });

  it("keeps the typed text when the mode is cleared", () => {
    render();
    fireEvent.click(chip("Lesson"));
    type("markets in Jeddah");

    fireEvent.click(screen.getByRole("button", { name: /clear/ }));

    expect(box()).toHaveValue("markets in Jeddah");
  });
});

describe("the quick actions", () => {
  it("fills the box and sets the mode together", () => {
    render();

    fireEvent.click(screen.getByTestId("quick-action"));

    // A canned prompt in the wrong mode produces the wrong output shape, so the
    // two always move as a pair.
    expect(box()).toHaveValue("Create a reading passage about: ");
    expect(chip("Reading").className).toContain("bg-primary");
  });

  it("replaces whatever was there", () => {
    render();
    type("half a thought");

    fireEvent.click(screen.getByTestId("quick-action"));

    // Unlike the chips, a quick action is a whole prompt rather than a stem —
    // appending would produce nonsense.
    expect(box()).toHaveValue("Create a reading passage about: ");
  });
});

describe("sending", () => {
  it("sends the message with the mode it was composed in", () => {
    const { onSend } = render();
    fireEvent.click(chip("Vocab"));
    type("Generate vocabulary words for the topic: markets");

    fireEvent.click(sendButton());

    expect(onSend).toHaveBeenCalledWith(
      "Generate vocabulary words for the topic: markets",
      "generate_vocab",
    );
  });

  it("sends plain chat as chat", () => {
    const { onSend } = render();
    type("what stage should this go in?");

    fireEvent.click(sendButton());

    expect(onSend).toHaveBeenCalledWith("what stage should this go in?", "chat");
  });

  it("trims what it sends", () => {
    const { onSend } = render();
    type("   markets   ");

    fireEvent.click(sendButton());

    // The message is interpolated into a prompt; leading newlines from a paste
    // change how the model reads it.
    expect(onSend).toHaveBeenCalledWith("markets", "chat");
  });

  it("sends on Enter", () => {
    const { onSend } = render();
    type("markets");

    fireEvent.keyDown(box(), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("markets", "chat");
  });

  it("keeps Shift+Enter for a new line", () => {
    const { onSend } = render();
    type("markets");

    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });

    // Prompts here run to several lines — a multi-line brief is the normal case
    // for a whole lesson.
    expect(onSend).not.toHaveBeenCalled();
  });

  it("empties the box and returns to chat afterwards", () => {
    render();
    fireEvent.click(chip("Lesson"));
    type("Create a complete lesson about: markets");

    fireEvent.click(sendButton());

    // The next message is usually a follow-up question about what came back,
    // not another generation.
    expect(box()).toHaveValue("");
    expect(chip("Chat").className).toContain("bg-primary");
  });

  it("will not send nothing", () => {
    const { onSend } = render();

    expect(sendButton()).toBeDisabled();
    type("   ");
    expect(sendButton()).toBeDisabled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("while the builder is busy", () => {
  it("says what it is waiting for", () => {
    render({ isGenerating: true });

    // Generation takes tens of seconds; without this the composer looks broken.
    expect(box()).toHaveAttribute("placeholder", "Waiting for AI response...");
  });

  it("takes nothing until the reply lands", () => {
    const { onSend } = render({ isGenerating: true });

    fireEvent.keyDown(box(), { key: "Enter" });

    // Two generations in flight write into the same preview pane, and the
    // loser's output is what the admin ends up approving.
    expect(box()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("locks the makers and the quick actions too", () => {
    render({ isGenerating: true });

    expect(chip("Lesson")).toBeDisabled();
    expect(screen.getByTestId("quick-action")).toBeDisabled();
  });

  it("is inert when the whole composer is disabled", () => {
    const { onSend } = render({ disabled: true });

    fireEvent.keyDown(box(), { key: "Enter" });

    expect(box()).toBeDisabled();
    expect(chip("Lesson")).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
